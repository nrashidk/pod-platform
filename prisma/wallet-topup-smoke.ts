// Throwaway smoke for the merchant wallet top-up money-in flow (src/lib/payments
// + the webhook-credit logic). Drives the PURE handleStripeWebhook directly (the
// route is a thin HTTP shell over it) and verifies signatures with the real
// Stripe SDK scheme, so the whole money-in contract is exercised WITHOUT a
// running server or any network call — same approach as the other src/lib smokes.
//
// Asserts the contract points the build plan called out:
//   • redirect alone NEVER credits        — INITIATED top-up = zero ledger effect
//   • verified webhook credits once        — +TOPUP txn, balance up, COMPLETED
//   • SAME event delivered twice           — credits EXACTLY once (idempotent)
//   • SAME event delivered CONCURRENTLY    — credits EXACTLY once (race-safe)
//   • unsigned webhook                      — rejected (400), no credit
//   • invalid-signature webhook             — rejected (400), no credit
//
// Idempotent: wipes its own fixtures first (own "[TESTTOPUP]"/"evt_TESTTOPUP"
// markers, distinct from the other smokes). No db:seed dependency — it builds
// its own merchant/wallet.
// Run: npm run test:wallet-topup

// Fixture gateway secrets — set BEFORE the payments seam reads them (lazy, at
// call time). Overrides whatever .env carries so the smoke signs and verifies
// against the SAME secret, never the real placeholder.
process.env.STRIPE_SECRET_KEY = "sk_test_topupsmoke";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_topupsmoke_fixture";

import Stripe from "stripe";
import { handleStripeWebhook } from "../src/lib/payments/webhook.ts";
import { prisma } from "../src/lib/prisma.ts";

const EMAIL = "topup-smoke@test.local";
const EVENT_PREFIX = "evt_TESTTOPUP";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

// A lightweight Stripe instance ONLY to generate test signature headers (no
// network; generateTestHeaderString is pure crypto).
const stripeForSigning = new Stripe("sk_test_topupsmoke");

const checks: Array<[string, boolean]> = [];
const check = (label: string, pass: boolean) => checks.push([label, pass]);

// Build a checkout.session.completed event body for a given top-up.
function eventBody(opts: {
  eventId: string;
  topUpId: string;
  amountAed: number;
  paymentStatus?: string;
}): string {
  return JSON.stringify({
    id: opts.eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${opts.eventId}`,
        object: "checkout.session",
        client_reference_id: opts.topUpId,
        metadata: { topUpId: opts.topUpId },
        payment_status: opts.paymentStatus ?? "paid",
        amount_total: Math.round(opts.amountAed * 100),
        currency: "aed",
      },
    },
  });
}

// A valid Stripe-Signature header for `payload` under the fixture secret.
function sign(payload: string): string {
  return stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
}

async function cleanup() {
  await prisma.processedWebhookEvent.deleteMany({
    where: { event_id: { startsWith: EVENT_PREFIX } },
  });
  // Deleting the merchant cascades wallet → topUps + transactions.
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

// Current wallet snapshot: balance + count of TOPUP transactions.
async function walletState(walletId: string) {
  const [wallet, topupTxns] = await Promise.all([
    prisma.wallet.findUniqueOrThrow({ where: { id: walletId } }),
    prisma.walletTransaction.count({ where: { walletId, type: "TOPUP" } }),
  ]);
  return { balance: Number(wallet.balance), topupTxns };
}

async function makeTopUp(walletId: string, merchantId: string, amountAed: number) {
  return prisma.walletTopUp.create({
    data: {
      walletId,
      merchantId,
      provider: "stripe",
      amount: amountAed.toFixed(2),
      currency: "AED",
      status: "INITIATED",
    },
    select: { id: true },
  });
}

async function main() {
  await cleanup();

  // ── Fixtures: a merchant with a zero-balance wallet. ──
  const merchant = await prisma.merchant.create({
    data: { name: "[TESTTOPUP] Merchant", email: EMAIL },
  });
  const wallet = await prisma.wallet.create({
    data: { merchantId: merchant.id, currency: "AED", balance: "0" },
  });

  // ════════════════════════════════════════════════════════════════
  // (1) REDIRECT ALONE NEVER CREDITS. An INITIATED top-up (the exact
  //     state after the browser lands on ?topup=processing) moves no money.
  // ════════════════════════════════════════════════════════════════
  const topup1 = await makeTopUp(wallet.id, merchant.id, 250);
  {
    const s = await walletState(wallet.id);
    check("redirect/INITIATED: balance still 0", s.balance === 0);
    check("redirect/INITIATED: zero TOPUP transactions", s.topupTxns === 0);
    const row = await prisma.walletTopUp.findUniqueOrThrow({
      where: { id: topup1.id },
    });
    check("redirect/INITIATED: top-up status still INITIATED", row.status === "INITIATED");
  }

  // ════════════════════════════════════════════════════════════════
  // (2) VERIFIED WEBHOOK CREDITS ONCE.
  // ════════════════════════════════════════════════════════════════
  const creditEventId = `${EVENT_PREFIX}_credit`;
  const creditBody = eventBody({ eventId: creditEventId, topUpId: topup1.id, amountAed: 250 });
  const res1 = await handleStripeWebhook(creditBody, sign(creditBody));
  check("webhook credit: HTTP 200", res1.status === 200);
  check("webhook credit: credited=true", res1.body.credited === true);
  {
    const s = await walletState(wallet.id);
    check("webhook credit: balance now 250", s.balance === 250);
    check("webhook credit: exactly 1 TOPUP transaction", s.topupTxns === 1);
    const row = await prisma.walletTopUp.findUniqueOrThrow({ where: { id: topup1.id } });
    check("webhook credit: top-up status COMPLETED", row.status === "COMPLETED");
    check("webhook credit: top-up linked to its txn", !!row.walletTransactionId);
    const txn = await prisma.walletTransaction.findFirst({
      where: { walletId: wallet.id, type: "TOPUP" },
    });
    check("webhook credit: txn amount is POSITIVE +250", Number(txn?.amount) === 250);
    check("webhook credit: txn balance_after === 250", Number(txn?.balance_after) === 250);
    const evCount = await prisma.processedWebhookEvent.count({
      where: { provider: "stripe", event_id: creditEventId },
    });
    check("webhook credit: 1 ProcessedWebhookEvent row", evCount === 1);
  }

  // ════════════════════════════════════════════════════════════════
  // (3) SAME EVENT DELIVERED TWICE → credits EXACTLY once. Stripe retries
  //     webhooks; a redelivery (same event id) must be a no-op.
  // ════════════════════════════════════════════════════════════════
  const res2 = await handleStripeWebhook(creditBody, sign(creditBody));
  check("double-delivery: HTTP 200 (acknowledged)", res2.status === 200);
  check("double-delivery: credited=false (no second credit)", res2.body.credited === false);
  {
    const s = await walletState(wallet.id);
    check("double-delivery: balance STILL 250", s.balance === 250);
    check("double-delivery: STILL exactly 1 TOPUP transaction", s.topupTxns === 1);
    const evCount = await prisma.processedWebhookEvent.count({
      where: { provider: "stripe", event_id: creditEventId },
    });
    check("double-delivery: STILL 1 ProcessedWebhookEvent row", evCount === 1);
  }

  // ════════════════════════════════════════════════════════════════
  // (4) SAME EVENT DELIVERED CONCURRENTLY → still credits EXACTLY once.
  //     The @@unique([provider, event_id]) is the race-safe serialization point.
  // ════════════════════════════════════════════════════════════════
  const topup2 = await makeTopUp(wallet.id, merchant.id, 100);
  const concEventId = `${EVENT_PREFIX}_conc`;
  const concBody = eventBody({ eventId: concEventId, topUpId: topup2.id, amountAed: 100 });
  const concResults = await Promise.all([
    handleStripeWebhook(concBody, sign(concBody)),
    handleStripeWebhook(concBody, sign(concBody)),
  ]);
  const creditedCount = concResults.filter((r) => r.body.credited === true).length;
  check("concurrent double-delivery: exactly ONE delivery credited", creditedCount === 1);
  {
    const s = await walletState(wallet.id);
    check("concurrent double-delivery: balance now 350 (250 + 100)", s.balance === 350);
    check("concurrent double-delivery: exactly 2 TOPUP transactions total", s.topupTxns === 2);
    const evCount = await prisma.processedWebhookEvent.count({
      where: { provider: "stripe", event_id: concEventId },
    });
    check("concurrent double-delivery: exactly 1 ProcessedWebhookEvent row", evCount === 1);
  }

  // ════════════════════════════════════════════════════════════════
  // (5) UNSIGNED + INVALID-SIGNATURE webhooks are REJECTED — no credit. Use a
  //     fresh INITIATED top-up so any (wrongful) credit would be visible.
  // ════════════════════════════════════════════════════════════════
  const topup3 = await makeTopUp(wallet.id, merchant.id, 500);
  const rejectBody = eventBody({
    eventId: `${EVENT_PREFIX}_reject`,
    topUpId: topup3.id,
    amountAed: 500,
  });
  const before = await walletState(wallet.id);

  // (5a) No signature header at all.
  const unsigned = await handleStripeWebhook(rejectBody, null);
  check("unsigned: HTTP 400", unsigned.status === 400);

  // (5b) A signature for a DIFFERENT payload (tampered body).
  const tamperedSig = sign(eventBody({
    eventId: `${EVENT_PREFIX}_other`,
    topUpId: topup3.id,
    amountAed: 1,
  }));
  const invalid = await handleStripeWebhook(rejectBody, tamperedSig);
  check("invalid-signature: HTTP 400", invalid.status === 400);

  {
    const after = await walletState(wallet.id);
    check("rejected: balance unchanged (still 350)", after.balance === before.balance && after.balance === 350);
    check("rejected: no new TOPUP transaction", after.topupTxns === before.topupTxns);
    const row = await prisma.walletTopUp.findUniqueOrThrow({ where: { id: topup3.id } });
    check("rejected: top-up still INITIATED (never credited)", row.status === "INITIATED");
    const evCount = await prisma.processedWebhookEvent.count({
      where: { event_id: { startsWith: `${EVENT_PREFIX}_reject` } },
    });
    check("rejected: no ProcessedWebhookEvent written", evCount === 0);
  }

  await cleanup();

  console.log("\nAssertions:");
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(
    ok
      ? "\n✅ PASS — wallet credited only by verified webhook, exactly once, race-safe; redirect never credits."
      : "\n❌ FAIL"
  );
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Wallet-topup smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

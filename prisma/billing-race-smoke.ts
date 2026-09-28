// Throwaway smoke test proving recordOrderBilling's wallet write (src/lib/
// billing.ts) cannot lose a concurrent credit. Before the fix, the function
// read wallet.balance once, computed a new absolute value in JS across all
// fulfillment lines, then wrote that absolute value back — so a Stripe
// top-up webhook (src/lib/payments/webhook.ts) crediting the SAME wallet in
// an overlapping transaction could be silently overwritten (a lost update).
// The fix uses an atomic `{ decrement }` per fulfillment line, matching the
// webhook's atomic `{ increment }`, so both writes always compose correctly
// regardless of interleaving.
//
// This test fires a bulk-order billing charge and a wallet top-up webhook
// CONCURRENTLY against the same wallet (Promise.all) and asserts:
//   • the final balance is EXACTLY initial + topup − charged (no lost update)
//   • every WalletTransaction's recorded balance_after replays correctly
//     against the wallet's starting balance, in whatever order the two
//     concurrent writes actually landed
//
// Idempotent: wipes its own TEST fixtures first ("billing-race-smoke@test.local").
// Assumes `npm run db:seed`.
// Run: npm run test:billing-race

process.env.STRIPE_SECRET_KEY = "sk_test_billingracesmoke";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_billingracesmoke_fixture";

import Stripe from "stripe";
import { recordOrderBilling } from "../src/lib/billing.ts";
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { handleStripeWebhook } from "../src/lib/payments/webhook.ts";
import { prisma } from "../src/lib/prisma.ts";

const EMAIL = "billing-race-smoke@test.local";
const EVENT_ID = "evt_TESTBILLINGRACE_credit";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;
const STARTING_BALANCE = 200;
const TOPUP_AED = 500;

const stripeForSigning = new Stripe("sk_test_billingracesmoke");

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function topupEventBody(topUpId: string): string {
  return JSON.stringify({
    id: EVENT_ID,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${EVENT_ID}`,
        object: "checkout.session",
        client_reference_id: topUpId,
        metadata: { topUpId },
        payment_status: "paid",
        amount_total: Math.round(TOPUP_AED * 100),
        currency: "aed",
      },
    },
  });
}

function sign(payload: string): string {
  return stripeForSigning.webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  });
}

async function cleanup() {
  const merchant = await prisma.merchant.findUnique({ where: { email: EMAIL } });
  if (merchant) {
    const orders = await prisma.order.findMany({
      where: { merchantId: merchant.id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length) {
      await prisma.printerLedgerEntry.deleteMany({
        where: { reason: { in: orderIds.map((id) => `WHOLESALE_OWED order:${id}`) } },
      });
    }
    await prisma.processedWebhookEvent.deleteMany({
      where: { provider: "stripe", event_id: EVENT_ID },
    });
    await prisma.wallet.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.order.deleteMany({ where: { merchantId: merchant.id } });
  }
  await prisma.design.deleteMany({ where: { name: "TEST Billing Race Design" } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[TEST BILLING RACE]" } } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();

  // ── Fixtures: a merchant with an existing wallet balance, plus a 2-line
  // order that routes into two fulfillments (same shape as the reconcile
  // smoke: wholesale 350 + 360 → merchant_owed 455 + 468 = 923). ──
  const merchant = await prisma.merchant.create({
    data: { name: "TEST Billing Race Merchant", is_platform_owner: true, email: EMAIL },
  });
  const wallet = await prisma.wallet.create({
    data: { merchantId: merchant.id, currency: "AED", balance: STARTING_BALANCE.toFixed(2) },
  });
  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const mugType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-mug" },
  });
  const design = await prisma.design.create({
    data: {
      merchantId: merchant.id,
      name: "TEST Billing Race Design",
      productTypeId: tshirtType.id,
    },
  });
  const tshirt = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[TEST BILLING RACE] Classic Tee",
      name_ar: "[تجريبي] تي شيرت كلاسيكي",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-RACE-TEE-BLK-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const mug = await prisma.product.create({
    data: {
      productTypeId: mugType.id,
      name_en: "[TEST BILLING RACE] Ceramic Mug",
      name_ar: "[تجريبي] كوب سيراميك",
      retail_price: 45.0,
      variants: { create: { sku: "TEST-RACE-MUG-WHT-11", size: "11oz", color: "White" } },
    },
    include: { variants: true },
  });

  const order = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: {
      name: "Test Buyer",
      line1: "1 Test Street",
      city: "Dubai",
      emirate: "Dubai",
    },
    lines: [
      {
        productId: tshirt.id,
        variantId: tshirt.variants[0].id,
        designId: design.id,
        method: "DTG",
        quantity: 10,
        unit_retail: 79.0,
      },
      {
        productId: mug.id,
        variantId: mug.variants[0].id,
        designId: design.id,
        method: "UV",
        quantity: 20,
        unit_retail: 45.0,
      },
    ],
  });

  const topup = await prisma.walletTopUp.create({
    data: {
      walletId: wallet.id,
      merchantId: merchant.id,
      provider: "stripe",
      amount: TOPUP_AED.toFixed(2),
      currency: "AED",
      status: "INITIATED",
    },
    select: { id: true },
  });
  const topupBody = topupEventBody(topup.id);
  const topupSig = sign(topupBody);

  // ════════════════════════════════════════════════════════════════
  // FIRE BOTH CONCURRENTLY against the SAME wallet row: the billing charge
  // (recordOrderBilling, N `decrement`s) and the top-up credit (webhook, one
  // `increment`). Before the fix, whichever finished last would overwrite the
  // other's absolute balance write.
  // ════════════════════════════════════════════════════════════════
  const [billing, webhookResult] = await Promise.all([
    recordOrderBilling(order.id),
    handleStripeWebhook(topupBody, topupSig),
  ]);

  const checks: Array<[string, boolean]> = [];
  const check = (label: string, pass: boolean) => checks.push([label, pass]);

  check("webhook credit: HTTP 200, credited=true", webhookResult.status === 200 && webhookResult.body.credited === true);
  check(
    "billing: totals owed 923 (455 + 468)",
    billing.totals.merchant_owed === 923
  );

  const finalWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  const expectedFinal = round2(STARTING_BALANCE + TOPUP_AED - billing.totals.merchant_owed);
  check(
    `no lost update: final balance (${Number(finalWallet.balance)}) === start(${STARTING_BALANCE}) + topup(${TOPUP_AED}) − charged(${billing.totals.merchant_owed}) = ${expectedFinal}`,
    round2(Number(finalWallet.balance)) === expectedFinal
  );

  // Replay the full ledger in creation order from the starting balance and
  // confirm every recorded balance_after is internally consistent — proving
  // no write vanished, whichever order the two concurrent transactions
  // actually committed in.
  const txns = await prisma.walletTransaction.findMany({
    where: { walletId: wallet.id },
    orderBy: { createdAt: "asc" },
  });
  check("exactly 3 WalletTransactions (2 charges + 1 topup)", txns.length === 3);
  let running = STARTING_BALANCE;
  let replayOk = true;
  for (const t of txns) {
    running = round2(running + Number(t.amount));
    if (running !== round2(Number(t.balance_after))) replayOk = false;
  }
  check(
    `ledger replays consistently: running total after all txns (${running}) === final wallet balance (${Number(finalWallet.balance)})`,
    replayOk && running === round2(Number(finalWallet.balance))
  );

  await cleanup();

  console.log("\nAssertions:");
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(
    ok
      ? "\n✅ PASS — concurrent billing charge + wallet top-up never lose an update."
      : "\n❌ FAIL"
  );
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Billing-race smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

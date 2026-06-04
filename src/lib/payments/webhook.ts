// Inbound payment-webhook handler — the ONLY thing that credits a wallet.
//
// Pure orchestration (no HTTP types), so the smoke test drives it directly and
// the route handler stays a thin shell. The browser success-redirect deliberately
// has NO path into here: money-in is webhook-only.
//
// Idempotency + race-safety (the requirement): a gateway redelivers webhooks
// (Stripe retries on any non-2xx or timeout). We persist the gateway's event id
// to ProcessedWebhookEvent under a @@unique([provider, event_id]) — the SAME
// race-safe claim pattern as the order API's OrderIdempotencyKey. Two deliveries
// of one event both attempt the insert inside the crediting transaction; exactly
// one wins, the loser hits the unique violation and the WHOLE transaction (the
// credit included) rolls back. So the same event credits EXACTLY once, even
// under concurrent delivery.
//
// Sign convention (matches src/lib/billing.ts): a TOP_UP is a POSITIVE
// WalletTransaction; Wallet.balance is the running net. We increment the balance
// ATOMICALLY (`{ increment }`) so concurrent credits to the same wallet can't
// lose an update.

import { Prisma, type WalletTxnType } from "@prisma/client";
import { prisma } from "../prisma";
import { paymentProvider, WebhookVerificationError } from "./index";

const TOPUP: WalletTxnType = "TOPUP";

export interface WebhookResult {
  status: number; // HTTP status the route should return
  body: Record<string, unknown>;
}

/**
 * Verify + process a Stripe webhook. `rawBody` MUST be the exact received bytes
 * (signatures cover the raw payload). Returns the status/body the route serializes.
 *   • invalid/missing signature → 400, nothing written
 *   • verified non-top-up event → 200 (acknowledged, ignored)
 *   • verified top-up           → 200, wallet credited EXACTLY once (idempotent)
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string | null
): Promise<WebhookResult> {
  // ── (1) Verify. A forged/unsigned body never reaches the ledger. ──
  let event;
  try {
    event = await paymentProvider.parseWebhookEvent(rawBody, signature);
  } catch (e) {
    if (e instanceof WebhookVerificationError) {
      return { status: 400, body: { error: "invalid_signature" } };
    }
    throw e;
  }

  // ── (2) Not a crediting event → acknowledge so the gateway stops retrying. ──
  if (event.type !== "topup_completed" || !event.topUp) {
    return { status: 200, body: { received: true, credited: false } };
  }

  const { topUpId, amount, currency, providerSessionId } = event.topUp;
  const provider = paymentProvider.name;

  // ── (3) Credit, idempotently + race-safely, in ONE transaction. ──
  const outcome = await prisma.$transaction(async (tx) => {
    // (a) Idempotency claim. The unique violation here is what makes a
    // redelivered event a no-op: the loser's whole transaction rolls back.
    try {
      await tx.processedWebhookEvent.create({
        data: { provider, event_id: event.eventId },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return "duplicate" as const; // already processed → credit once total
      }
      throw e;
    }

    // (b) Map the verified payment back to our row.
    const topup = await tx.walletTopUp.findUnique({ where: { id: topUpId } });
    if (!topup) return "no_topup" as const; // unmapped — acknowledge, no credit
    if (topup.status === "COMPLETED") return "already_completed" as const;

    // (c) Atomic credit: increment balance, write the +TOP_UP transaction with
    // the resulting balance_after, mark the top-up COMPLETED and link the txn.
    const wallet = await tx.wallet.update({
      where: { id: topup.walletId },
      data: { balance: { increment: amount } },
    });

    const mismatch =
      Number(topup.amount) !== amount || topup.currency !== currency;
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: topup.walletId,
        type: TOPUP,
        amount: amount.toFixed(2),
        balance_after: wallet.balance,
        note:
          `topup:${topup.id} session:${providerSessionId} event:${event.eventId}` +
          (mismatch
            ? ` (NOTE: gateway amount ${amount} ${currency} ≠ recorded ${topup.amount} ${topup.currency})`
            : ""),
      },
    });

    await tx.walletTopUp.update({
      where: { id: topup.id },
      data: { status: "COMPLETED", walletTransactionId: txn.id },
    });

    return "credited" as const;
  });

  // Every verified outcome is a 200 — the gateway only needs to know we received
  // and accepted it. "credited" is the single path that moved money.
  return { status: 200, body: { received: true, credited: outcome === "credited", outcome } };
}

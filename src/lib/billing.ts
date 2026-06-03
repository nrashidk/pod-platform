// ─────────────────────────────────────────────────────────────
// Billing ledger — RECORD-ONLY money math (this phase).
//
// Layered ON TOP of createOrderWithRouting (src/lib/orders.ts), never inside it
// — orders.ts deliberately defers all wallet/money movement. After routing has
// produced the Fulfillments (each carrying its wholesale_cost), this records the
// three reconciling numbers per fulfillment and per order:
//
//   printer_paid    = the fulfillment's wholesale_cost (what platform owes printer)
//   merchant_owed   = wholesale_cost + flat markup (what the store owner owes us)
//   platform_margin = merchant_owed − printer_paid   (our spread)
//
// "Record-only" means: NO Stripe, NO wallet top-up, NO real charge, NO balance
// enforcement. We persist the DEBT into the existing ledger models —
// WalletTransaction (merchant side) + PrinterLedgerEntry (printer side). The
// wallet balance becomes a running record of what the merchant owes (accrues
// NEGATIVE: a fulfillment charge is a negative amount, balance is the net). Sign
// convention is forward-compatible: when real prepaid top-ups arrive later they
// are POSITIVE amounts on the same field, and balance stays the net.
//
// The margin is ALWAYS computed as (merchant_owed − printer_paid), never as
// (wholesale × markup) independently — so the reconciliation identity
// Σ merchant_owed − Σ printer_paid = Σ platform_margin holds BY CONSTRUCTION,
// per fulfillment, per order, and in aggregate, immune to rounding.
//
// DEFERRED (do NOT add here): the PricingTier engine. The flat markup below is
// the single place a tier engine will later replace — mirrors BULK_THRESHOLD_AED
// in orders.ts.
// ─────────────────────────────────────────────────────────────

import { prisma } from "./prisma";

/**
 * Flat merchant markup over a fulfillment's wholesale cost, this phase's whole
 * pricing rule. merchant_owed = wholesale_cost × (1 + MERCHANT_MARKUP_PCT).
 * Single named constant ON PURPOSE (like BULK_THRESHOLD_AED): when the real
 * stacked/PricingTier pricing lands, this is the one spot it replaces.
 */
export const MERCHANT_MARKUP_PCT = 0.3; // 30%

/** Round to 2 decimal places (currency precision). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The three reconciling numbers for one Fulfillment. */
export interface FulfillmentBilling {
  fulfillmentId: string;
  printerId: string;
  printer_paid: number;
  merchant_owed: number;
  platform_margin: number;
}

/** Per-order billing result: the per-fulfillment rows plus their totals. */
export interface OrderBilling {
  orderId: string;
  merchantId: string;
  currency: string;
  fulfillments: FulfillmentBilling[];
  totals: {
    printer_paid: number;
    merchant_owed: number;
    platform_margin: number;
  };
}

/** Thrown when billing was already recorded for an order (idempotency guard). */
export class BillingAlreadyRecordedError extends Error {
  readonly orderId: string;
  constructor(orderId: string) {
    super(`Billing already recorded for order ${orderId}`);
    this.name = "BillingAlreadyRecordedError";
    this.orderId = orderId;
  }
}

/**
 * Compute (but do not persist) the per-fulfillment billing numbers for an order.
 * margin is derived as owed − paid so the identity is exact by construction.
 */
function computeFulfillmentBilling(
  fulfillments: { id: string; printerId: string; wholesale_cost: unknown }[]
): FulfillmentBilling[] {
  return fulfillments.map((f) => {
    const printer_paid = round2(Number(f.wholesale_cost));
    const merchant_owed = round2(printer_paid * (1 + MERCHANT_MARKUP_PCT));
    const platform_margin = round2(merchant_owed - printer_paid);
    return {
      fulfillmentId: f.id,
      printerId: f.printerId,
      printer_paid,
      merchant_owed,
      platform_margin,
    };
  });
}

/**
 * Record the billing ledger for an already-routed order. RECORD-ONLY: writes one
 * PrinterLedgerEntry (printer side, +owed) and one WalletTransaction (merchant
 * side, −debit) per Fulfillment, all in one transaction. Idempotent guard: throws
 * BillingAlreadyRecordedError if any WalletTransaction already exists for this
 * order. Returns the per-fulfillment numbers + totals.
 */
export async function recordOrderBilling(orderId: string): Promise<OrderBilling> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      fulfillments: {
        select: { id: true, printerId: true, wholesale_cost: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const lines = computeFulfillmentBilling(order.fulfillments);

  await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so a concurrent record can't double-write.
    const already = await tx.walletTransaction.findFirst({
      where: { orderId },
      select: { id: true },
    });
    if (already) {
      throw new BillingAlreadyRecordedError(orderId);
    }

    // Ensure the merchant has a wallet (record-only — NOT a top-up; balance
    // starts wherever it is and accrues the debt as negative amounts).
    const wallet = await tx.wallet.upsert({
      where: { merchantId: order.merchantId },
      create: { merchantId: order.merchantId, currency: order.currency },
      update: {},
    });

    let balance = Number(wallet.balance);

    for (const l of lines) {
      // ── Printer side: +amount = owed TO the printer (model's sign convention).
      await tx.printerLedgerEntry.create({
        data: {
          printerId: l.printerId,
          amount: l.printer_paid.toFixed(2),
          reason: `WHOLESALE_OWED order:${orderId}`,
          fulfillmentId: l.fulfillmentId,
          settled: false,
        },
      });

      // ── Merchant side: a FULFILLMENT_CHARGE debits the wallet (NEGATIVE
      // amount); balance is the running net the merchant owes.
      balance = round2(balance - l.merchant_owed);
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: "FULFILLMENT_CHARGE",
          amount: (-l.merchant_owed).toFixed(2),
          balance_after: balance.toFixed(2),
          orderId,
          note: `f:${l.fulfillmentId} owed=${l.merchant_owed.toFixed(2)} paid=${l.printer_paid.toFixed(2)} margin=${l.platform_margin.toFixed(2)}`,
        },
      });
    }

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balance.toFixed(2) },
    });
  });

  const totals = {
    printer_paid: round2(lines.reduce((s, l) => s + l.printer_paid, 0)),
    merchant_owed: round2(lines.reduce((s, l) => s + l.merchant_owed, 0)),
    platform_margin: round2(lines.reduce((s, l) => s + l.platform_margin, 0)),
  };

  return {
    orderId,
    merchantId: order.merchantId,
    currency: order.currency,
    fulfillments: lines,
    totals,
  };
}

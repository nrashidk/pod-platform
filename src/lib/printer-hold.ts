// ─────────────────────────────────────────────────────────────
// 70/30 printer retention hold — as LEDGER STATES, not money movement.
//
// RECORD-ONLY, consistent with the billing phase (src/lib/billing.ts): nothing
// here transfers money. The 70/30 retention (doc §5b "Retention — 70/30 hold")
// is expressed entirely as PrinterLedgerEntry rows + a lazily-computed status.
//
// Two pieces:
//
//   1. holdStatus()  — a PURE function. The SINGLE source of truth for whether a
//      held 30% is still HELD or has become RELEASABLE. No DB, no clock of its
//      own (now is injected). The ops rollup calls it for display + totals, and
//      any FUTURE payout job MUST call this same function — never re-encode the
//      release rule. "Lazy evaluation": an expired-clean window shows RELEASABLE
//      with NO cron/job having run.
//
//   2. recordDispatchHold() — the SHIPPED hook. Layered ON TOP of
//      advanceFulfillment (called from the action layer right after a successful
//      SHIPPED transition, exactly as recordOrderBilling is called beside
//      createOrderWithRouting), NEVER inside the lifecycle engine. On a BULK
//      fulfillment it SPLITS the single WHOLESALE_OWED ledger entry into a 70%
//      payable entry + a 30% held entry whose amounts sum to the SAME
//      wholesale_cost — so the reconciliation invariant
//        Σ PrinterLedgerEntry.amount == printer_paid
//      is preserved BY CONSTRUCTION. The split changes WHEN money becomes
//      payable (availability), never the totals.
//
// DEFERRED (do NOT add here): real PrinterPayment transfers, cron/scheduling,
// claim resolution (reprint/refund/deduction) mechanics, hold_release_at
// stamping (no event ever fires in lazy mode — we compute instead).
// ─────────────────────────────────────────────────────────────

import type { FulfillmentStatus } from "@prisma/client";
import { prisma } from "./prisma";

/** Fraction paid to the printer on dispatch (doc §223: "70% on dispatch"). */
export const DISPATCH_PAYABLE_PCT = 0.7;

/** Ledger-entry reason markers. The full (sub-threshold) entry is billing.ts's
 *  WHOLESALE_OWED; a bulk dispatch splits it into these two. Page + tests
 *  classify a held bucket by the HELD_30 prefix. */
export const REASON_PAYABLE_70 = "WHOLESALE_PAYABLE_70";
export const REASON_HELD_30 = "WHOLESALE_HELD_30";
export const REASON_WHOLESALE_OWED = "WHOLESALE_OWED";

/** Round to 2 decimal places (currency precision) — same as billing.ts. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type HoldState = "HELD" | "RELEASABLE";

export interface HoldStatusInput {
  /** Lifecycle state of the fulfillment. Must be DELIVERED or CLOSED to release
   *  (delivery is what STARTS the claim window — doc §185). */
  fulfillmentStatus: FulfillmentStatus;
  /** When the 30-day defect window closes. Lives on the SHIPMENT (stamped at the
   *  DELIVERED transition), null until delivered. */
  claimWindowClosesAt: Date | null;
  /** Number of still-OPEN DefectClaims against this fulfillment. Any open claim
   *  blocks release regardless of the window (doc §224: deduct before release). */
  openClaimCount: number;
  /** "Now". INJECTED — this is what makes evaluation lazy and tests exact. */
  now: Date;
}

/**
 * THE source of truth for 70/30 hold availability. Pure — no DB access, no
 * ambient clock. Both the ops billing rollup and any future payout job MUST go
 * through this function so display, totals, and (eventually) real payouts agree
 * by construction; do NOT re-encode the rule anywhere else.
 *
 * Release rule (doc §224 — release on the EVENT, NEVER on elapsed-time-from
 * dispatch, or a slow delivery would leak payment before the buyer can inspect):
 *
 *   RELEASABLE  ⟺  (fulfillmentStatus is DELIVERED or CLOSED)
 *               &&  claimWindowClosesAt != null
 *               &&  now > claimWindowClosesAt        (window fully elapsed)
 *               &&  openClaimCount === 0             (no claim pending)
 *   otherwise   →  HELD
 */
export function holdStatus(input: HoldStatusInput): HoldState {
  const { fulfillmentStatus, claimWindowClosesAt, openClaimCount, now } = input;
  const delivered =
    fulfillmentStatus === "DELIVERED" || fulfillmentStatus === "CLOSED";
  const windowElapsed =
    claimWindowClosesAt != null && now.getTime() > claimWindowClosesAt.getTime();
  if (delivered && windowElapsed && openClaimCount === 0) {
    return "RELEASABLE";
  }
  return "HELD";
}

/** Thrown if a dispatch hold is recorded for a fulfillment that already split. */
export class HoldAlreadyRecordedError extends Error {
  readonly fulfillmentId: string;
  constructor(fulfillmentId: string) {
    super(`Dispatch hold already recorded for fulfillment ${fulfillmentId}`);
    this.name = "HoldAlreadyRecordedError";
    this.fulfillmentId = fulfillmentId;
  }
}

export interface DispatchHoldResult {
  fulfillmentId: string;
  is_bulk: boolean;
  /** null when sub-threshold (no split happened). */
  dispatch_paid: number | null;
  held_amount: number | null;
}

/**
 * The SHIPPED hook. Call AFTER advanceFulfillment(..., "SHIPPED") has committed,
 * from the action layer (ops + printer), the same way recordOrderBilling is
 * called beside createOrderWithRouting. Idempotent.
 *
 *  • Sub-threshold (not is_bulk): NO-OP. The single full WHOLESALE_OWED entry
 *    stays 100% payable; hold_status stays NONE (doc §222: pay in full below
 *    threshold).
 *  • Bulk (is_bulk): SPLIT. In one transaction, delete this fulfillment's
 *    WHOLESALE_OWED entry and create PAYABLE_70 (70%) + HELD_30 (remainder, so
 *    the two sum to wholesale_cost EXACTLY — no rounding drift), then set
 *    hold_status = HELD, dispatch_paid, held_amount. hold_release_at stays null
 *    (no event fires in lazy mode; release is COMPUTED via holdStatus()).
 *
 * The split preserves Σ PrinterLedgerEntry.amount == wholesale_cost, so the
 * reconciliation identity is untouched — only availability changes.
 */
export async function recordDispatchHold(
  fulfillmentId: string
): Promise<DispatchHoldResult> {
  return prisma.$transaction(async (tx) => {
    const f = await tx.fulfillment.findUniqueOrThrow({
      where: { id: fulfillmentId },
      select: {
        id: true,
        orderId: true,
        printerId: true,
        wholesale_cost: true,
        is_bulk: true,
        hold_status: true,
      },
    });

    // Sub-threshold: nothing to hold. Leave the full payable entry untouched.
    if (!f.is_bulk) {
      return {
        fulfillmentId,
        is_bulk: false,
        dispatch_paid: null,
        held_amount: null,
      };
    }

    // Idempotency: a prior split already moved this off NONE. (SHIPPED can only
    // be entered once via the lifecycle, but guard anyway against retries.)
    if (f.hold_status !== "NONE") {
      throw new HoldAlreadyRecordedError(fulfillmentId);
    }

    const wholesale = round2(Number(f.wholesale_cost));
    const dispatch_paid = round2(wholesale * DISPATCH_PAYABLE_PCT);
    // Remainder, NOT an independent round — guarantees 70 + 30 === wholesale.
    const held_amount = round2(wholesale - dispatch_paid);

    // Replace the single full entry with the two split entries. Basing the split
    // on wholesale_cost (the canonical cost) and recreating both guarantees the
    // post-split sum equals wholesale_cost exactly, with no double-counting.
    await tx.printerLedgerEntry.deleteMany({
      where: { fulfillmentId, reason: { startsWith: REASON_WHOLESALE_OWED } },
    });
    await tx.printerLedgerEntry.create({
      data: {
        printerId: f.printerId,
        amount: dispatch_paid.toFixed(2),
        reason: `${REASON_PAYABLE_70} order:${f.orderId}`,
        fulfillmentId,
        settled: false,
      },
    });
    await tx.printerLedgerEntry.create({
      data: {
        printerId: f.printerId,
        amount: held_amount.toFixed(2),
        reason: `${REASON_HELD_30} order:${f.orderId}`,
        fulfillmentId,
        settled: false,
      },
    });

    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        hold_status: "HELD",
        dispatch_paid: dispatch_paid.toFixed(2),
        held_amount: held_amount.toFixed(2),
        // hold_release_at intentionally left null — computed lazily, never stamped.
      },
    });

    return { fulfillmentId, is_bulk: true, dispatch_paid, held_amount };
  });
}

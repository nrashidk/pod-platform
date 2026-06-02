// ─────────────────────────────────────────────────────────────
// Fulfillment lifecycle progression (build step 4, fulfillment layer).
//
// Implements the per-Fulfillment state machine from
// /docs/pod-platform-data-model.md §4 "Order lifecycle (states)":
//
//   ROUTED → IN_PRODUCTION → SHIPPED → DELIVERED → CLOSED
//
// and the doc's rule that the *Order* status is COMPOSITE — an aggregate of
// ALL its Fulfillments, never a single value (doc §134: "A delivered, B in
// production"). Splits localize fault to one Fulfillment (doc §131-133), so a
// mixed order surfaces as PARTIALLY_SHIPPED / PARTIALLY_DELIVERED.
//
// Production guards from doc §219 "Prevention":
//   • Bulk Fulfillments (is_bulk) cannot enter IN_PRODUCTION until the
//     mandatory first article has been approved (first_article_approved_at set).
//
// Delivery (doc §185, §574-577): proof of delivery — recorded on a Shipment —
// STARTS the 30-day defect-claim window. So the DELIVERED transition
// requires/creates a Shipment, stamps delivered_at, and sets
// claim_window_closes_at = delivered_at + 30 days.
//
// DEFERRED this phase (do NOT add here): payment, wallet money movement, the
// 70/30 hold release arithmetic, and DefectClaim handling. Money movement stays
// deferred (CLAUDE.md money model; doc §5b). We move lifecycle state only;
// hold_status / hold amounts are left untouched.
// ─────────────────────────────────────────────────────────────

import type { FulfillmentStatus, OrderStatus } from "@prisma/client";
import { prisma } from "./prisma";

/** Defect-claim window length (doc §187: "30 days from receipt"). */
export const CLAIM_WINDOW_DAYS = 30;

/**
 * The canonical forward lifecycle a Fulfillment walks through. The enum carries
 * extra branch states (FIRST_ARTICLE_*, DIGITIZING, REROUTED, CANCELLED); this
 * module governs the linear main path only — those branches are separate steps.
 */
const LIFECYCLE: FulfillmentStatus[] = [
  "ROUTED",
  "IN_PRODUCTION",
  "SHIPPED",
  "DELIVERED",
  "CLOSED",
];

/**
 * Legal next states keyed by current state. Only single-step forward moves are
 * allowed — no skips (ROUTED → SHIPPED) and no rewinds (SHIPPED → IN_PRODUCTION).
 */
const ALLOWED_NEXT: Record<string, FulfillmentStatus[]> = {
  ROUTED: ["IN_PRODUCTION"],
  IN_PRODUCTION: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
};

export class InvalidTransitionError extends Error {
  readonly from: FulfillmentStatus;
  readonly to: FulfillmentStatus;
  constructor(from: FulfillmentStatus, to: FulfillmentStatus) {
    super(`Illegal fulfillment transition ${from} → ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export class FirstArticleRequiredError extends Error {
  readonly fulfillmentId: string;
  constructor(fulfillmentId: string) {
    super(
      `Fulfillment ${fulfillmentId} is bulk: first article must be approved ` +
        `before IN_PRODUCTION (doc §219).`
    );
    this.name = "FirstArticleRequiredError";
    this.fulfillmentId = fulfillmentId;
  }
}

/**
 * Stage rank along the linear lifecycle, used to aggregate the parent Order's
 * composite status. Branch/pre-routing states collapse onto the nearest main
 * stage so the composite never crashes on an off-path Fulfillment:
 *   first-article + rerouting are still "routed, not yet producing".
 */
function stageRank(status: FulfillmentStatus): number {
  switch (status) {
    case "PENDING_ROUTING":
    case "ROUTED":
    case "FIRST_ARTICLE_PENDING":
    case "FIRST_ARTICLE_APPROVED":
    case "REROUTED":
      return 0; // routed / pre-production
    case "IN_PRODUCTION":
    case "DIGITIZING":
      return 1;
    case "SHIPPED":
      return 2;
    case "DELIVERED":
      return 3;
    case "CLOSED":
      return 4;
    case "CANCELLED":
      return -1; // excluded from the aggregate
    default:
      return 0;
  }
}

/**
 * Derive an Order's composite status from ALL its Fulfillments' statuses
 * (doc §134). Mixed progress surfaces as PARTIALLY_SHIPPED / PARTIALLY_DELIVERED;
 * uniform progress collapses to the shared stage.
 */
export function computeOrderStatus(
  fulfillmentStatuses: FulfillmentStatus[]
): OrderStatus {
  const active = fulfillmentStatuses.filter((s) => s !== "CANCELLED");
  // Every Fulfillment cancelled (or none at all) → the Order is cancelled.
  if (active.length === 0) return "CANCELLED";

  const ranks = active.map(stageRank);
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);

  if (min >= 4) return "CLOSED"; // all closed
  if (min >= 3) return "DELIVERED"; // all delivered (some maybe closed)
  if (max >= 3) return "PARTIALLY_DELIVERED"; // some delivered, some not
  if (min >= 2) return "SHIPPED"; // all shipped, none delivered yet
  if (max >= 2) return "PARTIALLY_SHIPPED"; // some shipped, some behind
  if (max >= 1) return "IN_PRODUCTION"; // at least one producing, none shipped
  return "ROUTED";
}

export interface AdvanceOptions {
  /**
   * Timestamp used for the DELIVERED stamp (delivered_at + claim window).
   * Defaults to now; injectable so tests can assert exact window math.
   */
  deliveredAt?: Date;
}

/**
 * Advance a single Fulfillment one legal step along the lifecycle, then
 * recompute and persist the parent Order's composite status.
 *
 * Enforces:
 *  (1) ordered transitions only (ALLOWED_NEXT) — illegal jumps/rewinds throw;
 *  (2) bulk Fulfillments cannot enter IN_PRODUCTION until first article approved;
 *  (3) DELIVERED requires/creates a Shipment, stamps delivered_at and sets
 *      claim_window_closes_at = delivered_at + 30 days.
 *
 * Returns the updated Fulfillment (with shipments) plus the recomputed parent
 * Order status. Does NOT touch payment / wallet / 70/30 hold / DefectClaim.
 */
export async function advanceFulfillment(
  fulfillmentId: string,
  toStatus: FulfillmentStatus,
  opts: AdvanceOptions = {}
) {
  return prisma.$transaction(async (tx) => {
    const fulfillment = await tx.fulfillment.findUniqueOrThrow({
      where: { id: fulfillmentId },
      include: { shipments: true },
    });

    const from = fulfillment.status;

    // (1) Ordered-transition gate.
    if (!LIFECYCLE.includes(toStatus)) {
      throw new InvalidTransitionError(from, toStatus);
    }
    if (!(ALLOWED_NEXT[from] ?? []).includes(toStatus)) {
      throw new InvalidTransitionError(from, toStatus);
    }

    // (2) Bulk first-article gate on entering production.
    if (
      toStatus === "IN_PRODUCTION" &&
      fulfillment.is_bulk &&
      fulfillment.first_article_approved_at == null
    ) {
      throw new FirstArticleRequiredError(fulfillmentId);
    }

    // (3) DELIVERED: require/create a Shipment, stamp delivery + claim window.
    if (toStatus === "DELIVERED") {
      const deliveredAt = opts.deliveredAt ?? new Date();
      const claimWindowClosesAt = new Date(
        deliveredAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );

      // Reuse the existing Shipment (issued at SHIPPED) if present; else create
      // one so delivery is always recorded against a Shipment (doc §574).
      const existing = fulfillment.shipments[0];
      if (existing) {
        await tx.shipment.update({
          where: { id: existing.id },
          data: {
            delivered_at: deliveredAt,
            claim_window_closes_at: claimWindowClosesAt,
          },
        });
      } else {
        await tx.shipment.create({
          data: {
            fulfillmentId,
            delivered_at: deliveredAt,
            claim_window_closes_at: claimWindowClosesAt,
          },
        });
      }
    }

    // Apply the Fulfillment transition.
    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: { status: toStatus },
    });

    // (4) Recompute the parent Order's composite status from ALL fulfillments.
    const siblings = await tx.fulfillment.findMany({
      where: { orderId: fulfillment.orderId },
      select: { status: true },
    });
    const orderStatus = computeOrderStatus(siblings.map((s) => s.status));
    await tx.order.update({
      where: { id: fulfillment.orderId },
      data: { status: orderStatus },
    });

    const updated = await tx.fulfillment.findUniqueOrThrow({
      where: { id: fulfillmentId },
      include: { shipments: true },
    });
    return { fulfillment: updated, orderStatus };
  });
}

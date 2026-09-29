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
//     The path through that gate is a side branch, driven by
//     submitFirstArticle / decideFirstArticle (below):
//       ROUTED → FIRST_ARTICLE_PENDING → FIRST_ARTICLE_APPROVED → IN_PRODUCTION
//                                      ↘ (rejected) ROUTED, printer re-makes it
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
import { releasePrinterLoad } from "./printer-load";
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
  // Bulk only: reached via decideFirstArticle("APPROVE"); then production may start.
  FIRST_ARTICLE_APPROVED: ["IN_PRODUCTION"],
  IN_PRODUCTION: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
};

/**
 * The single legal next status from `status`, or null if the Fulfillment has no
 * forward move — terminal CLOSED, excluded CANCELLED, or any branch/pre-routing
 * state absent from ALLOWED_NEXT. Single source of truth for "can this advance?":
 * the ops UI uses it to render/hide the advance control instead of re-encoding
 * the lifecycle table.
 */
export function nextFulfillmentStatus(
  status: FulfillmentStatus
): FulfillmentStatus | null {
  return (ALLOWED_NEXT[status] ?? [])[0] ?? null;
}

/**
 * The SUBSET of lifecycle targets a PRINTER is permitted to set. A printer drives
 * its own work into production and out the door, but DELIVERED (proof-of-delivery,
 * starts the claim window) and CLOSED (claim window settled) are operator/courier
 * territory — a printer must never set them. Enforced in BOTH the printer action
 * layer and the UI; this is the single source of truth for the subset.
 */
export const PRINTER_ADVANCE_TARGETS: readonly FulfillmentStatus[] = [
  "IN_PRODUCTION",
  "SHIPPED",
];

/**
 * The next status a PRINTER may advance `status` to, or null when the next
 * lifecycle step is outside the printer-permitted subset (or there is none).
 * The printer UI renders/hides its advance control from THIS — so a SHIPPED
 * fulfillment shows "nothing further for you" rather than an Advance-to-DELIVERED
 * button it isn't allowed to press.
 */
export function nextPrinterStatus(
  status: FulfillmentStatus
): FulfillmentStatus | null {
  const next = nextFulfillmentStatus(status);
  return next && PRINTER_ADVANCE_TARGETS.includes(next) ? next : null;
}

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

/**
 * Raised when an advance is attempted against a Fulfillment that the caller does
 * not own. The check is done INSIDE the advance transaction (see
 * advanceFulfillment's ownerPrinterId guard), comparing the persisted row's
 * printerId to the session-derived id — so a printer forging another printer's
 * fulfillmentId is rejected before any mutation, with no check-then-act race.
 */
export class FulfillmentOwnershipError extends Error {
  readonly fulfillmentId: string;
  readonly ownerPrinterId: string;
  constructor(fulfillmentId: string, ownerPrinterId: string) {
    super(
      `Fulfillment ${fulfillmentId} is not owned by printer ${ownerPrinterId}; ` +
        `refusing to advance.`
    );
    this.name = "FulfillmentOwnershipError";
    this.fulfillmentId = fulfillmentId;
    this.ownerPrinterId = ownerPrinterId;
  }
}

/** DELIVERED was attempted, with proof required, and no valid reference given. */
export class ProofOfDeliveryRequiredError extends Error {
  readonly fulfillmentId: string;
  constructor(fulfillmentId: string) {
    super(`Fulfillment ${fulfillmentId}: proof of delivery is required for DELIVERED.`);
    this.name = "ProofOfDeliveryRequiredError";
    this.fulfillmentId = fulfillmentId;
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

/** Carrier + tracking number entered when a printer dispatches a fulfillment. */
export interface ShipmentDetails {
  carrier: string;
  trackingNumber: string;
}

/** Longest carrier / tracking text we store (form input is untrusted). */
export const SHIPMENT_FIELD_MAX = 100;

/**
 * Trim and validate carrier + tracking input. Returns null unless BOTH are
 * non-empty and within SHIPMENT_FIELD_MAX — the printer dispatch action refuses
 * to mark SHIPPED without them (queue 7).
 */
export function parseShipmentDetails(
  carrier: unknown,
  trackingNumber: unknown
): ShipmentDetails | null {
  const c = typeof carrier === "string" ? carrier.trim() : "";
  const t = typeof trackingNumber === "string" ? trackingNumber.trim() : "";
  if (!c || !t || c.length > SHIPMENT_FIELD_MAX || t.length > SHIPMENT_FIELD_MAX) {
    return null;
  }
  return { carrier: c, trackingNumber: t };
}

/** Longest proof-of-delivery reference we store (form input is untrusted). */
export const POD_REFERENCE_MAX = 300;

/**
 * Trim and validate a proof-of-delivery reference (courier signature reference,
 * receipt number or a link to the courier's delivery confirmation). Returns null
 * when empty or longer than POD_REFERENCE_MAX — the ops DELIVERED action refuses
 * to mark delivery without one (queue 11).
 */
export function parseProofOfDelivery(reference: unknown): string | null {
  const r = typeof reference === "string" ? reference.trim() : "";
  return r && r.length <= POD_REFERENCE_MAX ? r : null;
}

export interface AdvanceOptions {
  /**
   * Timestamp used for the DELIVERED stamp (delivered_at + claim window).
   * Defaults to now; injectable so tests can assert exact window math.
   */
  deliveredAt?: Date;

  /**
   * OWNERSHIP guard. When set, the advance verifies — inside the SAME
   * transaction that would mutate the row, before any write — that the
   * Fulfillment's persisted printerId equals this id, throwing
   * FulfillmentOwnershipError otherwise. The id MUST come from the caller's
   * session (AuthContext.printerId), never from client input. This closes the
   * check-then-act race: a printer cannot advance another printer's fulfillment
   * even by forging the fulfillmentId. Operator callers omit it (no ownership
   * constraint) and behave exactly as before.
   */
  ownerPrinterId?: string;

  /**
   * Carrier + tracking recorded on the Shipment created at SHIPPED. Optional at
   * this layer (operator advances and older callers omit it → the Shipment is
   * still created, with null carrier/tracking); the PRINTER dispatch action
   * requires it before calling.
   */
  shipment?: ShipmentDetails;

  /**
   * Proof-of-delivery reference recorded on the Shipment at DELIVERED (stored in
   * Shipment.proof_of_delivery_url). Optional at this layer (older callers omit
   * it); the ops DELIVERED action requires it before calling.
   */
  proofOfDelivery?: string;

  /**
   * When true, DELIVERED without a proofOfDelivery reference throws
   * ProofOfDeliveryRequiredError before any write. The ops action sets it;
   * other callers omit it (unchanged behaviour).
   */
  requireProofOfDelivery?: boolean;
}

/**
 * Advance a single Fulfillment one legal step along the lifecycle, then
 * recompute and persist the parent Order's composite status.
 *
 * Enforces:
 *  (1) ordered transitions only (ALLOWED_NEXT) — illegal jumps/rewinds throw;
 *  (2) bulk Fulfillments cannot enter IN_PRODUCTION until first article approved;
 *  (3) SHIPPED creates the Shipment (carrier + tracking when given);
 *      DELIVERED reuses it (or creates one), stamps delivered_at and sets
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

    // (0) Ownership gate — runs FIRST, inside this transaction, before any
    // mutation. When ownerPrinterId is supplied (printer-initiated advance) the
    // persisted printerId must match the session-derived id. A forged
    // fulfillmentId pointing at another printer's row is rejected here, with no
    // window between the check and the write.
    if (
      opts.ownerPrinterId &&
      fulfillment.printerId !== opts.ownerPrinterId
    ) {
      throw new FulfillmentOwnershipError(fulfillmentId, opts.ownerPrinterId);
    }

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

    if (
      toStatus === "DELIVERED" &&
      opts.requireProofOfDelivery &&
      !opts.proofOfDelivery
    ) {
      throw new ProofOfDeliveryRequiredError(fulfillmentId);
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
            ...(opts.proofOfDelivery
              ? { proof_of_delivery_url: opts.proofOfDelivery }
              : {}),
          },
        });
      } else {
        await tx.shipment.create({
          data: {
            fulfillmentId,
            delivered_at: deliveredAt,
            claim_window_closes_at: claimWindowClosesAt,
            proof_of_delivery_url: opts.proofOfDelivery ?? null,
          },
        });
      }
    }

    // (3a) SHIPPED: the Shipment row is created at dispatch (queue 7), carrying
    // carrier + tracking when supplied. DELIVERED later reuses this row.
    if (toStatus === "SHIPPED" && fulfillment.shipments.length === 0) {
      await tx.shipment.create({
        data: {
          fulfillmentId,
          carrier: opts.shipment?.carrier ?? null,
          tracking_number: opts.shipment?.trackingNumber ?? null,
        },
      });
    }

    // Apply the Fulfillment transition.
    await tx.fulfillment.update({
      where: { id: fulfillmentId },
      data: { status: toStatus },
    });

    // (3b) Leaving the printer's queue frees its capacity, in this same
    // transaction (queue 5). CANCELLED / REROUTED will call this too (queue 19, 20).
    if (toStatus === "SHIPPED") {
      await releasePrinterLoad(tx, fulfillmentId);
    }

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

/**
 * Bulk first-article step 1: the printer has produced the single proof unit, so
 * the Fulfillment waits for approval. ROUTED → FIRST_ARTICLE_PENDING, bulk only
 * (doc §219: the first article is mandatory on bulk, and only on bulk).
 */
export async function submitFirstArticle(fulfillmentId: string) {
  return firstArticleStep(fulfillmentId, "ROUTED", "FIRST_ARTICLE_PENDING", true);
}

/**
 * Bulk first-article step 2: the operator judges the proof unit against the
 * locked print file. APPROVE → FIRST_ARTICLE_APPROVED and stamps
 * first_article_approved_at (the value the IN_PRODUCTION gate checks).
 * REJECT → back to ROUTED with no stamp, so the printer must make a new proof
 * unit; the gate stays closed.
 */
export async function decideFirstArticle(
  fulfillmentId: string,
  decision: "APPROVE" | "REJECT"
) {
  return firstArticleStep(
    fulfillmentId,
    "FIRST_ARTICLE_PENDING",
    decision === "APPROVE" ? "FIRST_ARTICLE_APPROVED" : "ROUTED",
    false
  );
}

async function firstArticleStep(
  fulfillmentId: string,
  from: FulfillmentStatus,
  to: FulfillmentStatus,
  requireBulk: boolean
) {
  return prisma.$transaction(async (tx) => {
    const f = await tx.fulfillment.findUniqueOrThrow({
      where: { id: fulfillmentId },
    });
    if (f.status !== from || (requireBulk && !f.is_bulk)) {
      throw new InvalidTransitionError(f.status, to);
    }
    // Conditional write: a concurrent decision on the same row loses cleanly.
    const { count } = await tx.fulfillment.updateMany({
      where: { id: fulfillmentId, status: from },
      data: {
        status: to,
        first_article_approved_at:
          to === "FIRST_ARTICLE_APPROVED" ? new Date() : null,
        // A rejected proof unit's photo must not be shown against the next proof.
        ...(to === "ROUTED"
          ? { first_article_photo_url: null, first_article_photo_uploaded_at: null }
          : {}),
      },
    });
    if (count !== 1) throw new InvalidTransitionError(f.status, to);

    const siblings = await tx.fulfillment.findMany({
      where: { orderId: f.orderId },
      select: { status: true },
    });
    const orderStatus = computeOrderStatus(siblings.map((s) => s.status));
    await tx.order.update({
      where: { id: f.orderId },
      data: { status: orderStatus },
    });
    return { orderStatus };
  });
}

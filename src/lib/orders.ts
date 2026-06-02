// ─────────────────────────────────────────────────────────────
// Order creation + routing assignment (build step 4, sub-step 3).
//
// Turns a cart of OrderLines into a persisted Order whose lines are split
// across Fulfillments by the capability-matrix router. Implements the
// assignment side of /docs/pod-platform-data-model.md §"Routing algorithm":
//
//   1. Each line is routed via findEligiblePrinters (capability gate →
//      capacity gate → cost-primary → proximity tiebreak). Top survivor wins.
//   2. Lines whose top printer is the SAME printer collapse into ONE
//      Fulfillment (fewer parcels, fewer shipping fees, fewer defect surfaces —
//      doc §159). Lines routed to DIFFERENT printers split into separate
//      Fulfillments. A split happens ONLY because of differing capability/printer
//      (doc §131, §144); quantity is never divided across printers.
//   3. Order + OrderLines + Fulfillments are written atomically, each
//      Fulfillment carrying its wholesale_cost (Σ of its lines' effective cost)
//      and the bulk flags derived from that cost.
//
// DEFERRED this phase (do NOT add here): payment, wallet money movement,
// DefectClaim, and the 70/30 hold/retention arithmetic. We set is_bulk and
// first_article_required (they're routing/production attributes), but leave
// hold_status at its NONE default and the hold amounts null — the retention
// engine is a later sub-step.
// ─────────────────────────────────────────────────────────────

import type { OrderOrigination, PrintMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { findEligiblePrinters } from "./routing";

/**
 * Bulk threshold: a Fulfillment whose production (wholesale) cost is at/above
 * this is "bulk" → mandatory first-article approval + (later) 70/30 retention.
 * Value-only, no piece count; adjustable as real defect costs are learned
 * (doc §"Retention — 70/30 hold").
 */
export const BULK_THRESHOLD_AED = 1000;

export interface CreateOrderLineInput {
  /** Catalog product being ordered; its productType drives routing. */
  productId: string;
  variantId: string;
  designId: string;
  /** Required print method — with the product's type, the routing capability. */
  method: PrintMethod;
  quantity: number;
  /** Retail unit price collected by the STORE's gateway (platform never holds it). */
  unit_retail: number;
}

export interface CreateOrderInput {
  merchantId: string;
  origination?: OrderOrigination; // default OWN_STORE (merchant zero)
  storeId?: string | null;
  externalOrderRef?: string | null;
  recipient: {
    name: string;
    phone?: string | null;
    line1: string;
    line2?: string | null;
    city: string;
    emirate?: string | null;
    country?: string; // default AE
  };
  currency?: string; // default AED
  /** Optional ship-to point; enables the proximity tiebreaker in routing. */
  destination?: { latitude: number; longitude: number };
  lines: CreateOrderLineInput[];
}

/** A line after routing: which printer/capability won, and at what cost. */
interface RoutedLine {
  input: CreateOrderLineInput;
  productTypeId: string;
  printerId: string;
  capabilityId: string | null;
  effectiveUnitCost: number;
  lineCost: number; // effectiveUnitCost × quantity
}

export class UnroutableLineError extends Error {
  readonly productTypeId: string;
  readonly method: PrintMethod;
  readonly quantity: number;

  constructor(productTypeId: string, method: PrintMethod, quantity: number) {
    super(
      `No eligible printer for productType=${productTypeId} method=${method} qty=${quantity}`
    );
    this.name = "UnroutableLineError";
    this.productTypeId = productTypeId;
    this.method = method;
    this.quantity = quantity;
  }
}

/**
 * Create an Order, route every line, and split the lines into Fulfillments by
 * chosen printer. Returns the persisted Order with its fulfillments (each
 * including its lines + printer). Throws UnroutableLineError if any line has no
 * eligible printer — the whole order is rejected (nothing is written).
 */
export async function createOrderWithRouting(input: CreateOrderInput) {
  if (!input.lines.length) {
    throw new Error("createOrderWithRouting: order must have at least one line");
  }

  // ── Resolve each line's productType from its catalog Product (routing keys
  // off productType + method; the OrderLine itself records product/variant).
  const productIds = [...new Set(input.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, productTypeId: true },
  });
  const typeByProduct = new Map(products.map((p) => [p.id, p.productTypeId]));

  // ── (1) ROUTE each line; (2) pick the top-ranked eligible printer. ──
  const routed: RoutedLine[] = [];
  for (const line of input.lines) {
    const productTypeId = typeByProduct.get(line.productId);
    if (!productTypeId) {
      throw new Error(
        `createOrderWithRouting: unknown productId ${line.productId}`
      );
    }

    const eligible = await findEligiblePrinters({
      productTypeId,
      method: line.method,
      quantity: line.quantity,
      destination: input.destination,
    });
    if (eligible.length === 0) {
      throw new UnroutableLineError(productTypeId, line.method, line.quantity);
    }
    const top = eligible[0]; // ranked: cost-primary, proximity tiebreak

    // The capability id behind this (printer, productType, method) — used as a
    // convenience pointer on single-capability Fulfillments.
    const cap = await prisma.printerCapability.findUnique({
      where: {
        printerId_productTypeId_method: {
          printerId: top.printerId,
          productTypeId,
          method: line.method,
        },
      },
      select: { id: true },
    });

    routed.push({
      input: line,
      productTypeId,
      printerId: top.printerId,
      capabilityId: cap?.id ?? null,
      effectiveUnitCost: top.effectiveUnitCost,
      lineCost: top.totalCost,
    });
  }

  // ── (3) GROUP routed lines by chosen printer → one Fulfillment per printer.
  // Same printer (even across different capabilities) ⇒ one Fulfillment.
  const groups = new Map<string, RoutedLine[]>();
  for (const r of routed) {
    const g = groups.get(r.printerId);
    if (g) g.push(r);
    else groups.set(r.printerId, [r]);
  }

  // Per-group Fulfillment economics + bulk flags.
  const fulfillmentPlans = [...groups.entries()].map(([printerId, lines]) => {
    const wholesale_cost = lines.reduce((sum, l) => sum + l.lineCost, 0);
    const is_bulk = wholesale_cost >= BULK_THRESHOLD_AED;
    // capabilityId is a single pointer; meaningful only when the whole
    // Fulfillment is one capability. Mixed-capability group ⇒ leave null.
    const capIds = new Set(lines.map((l) => l.capabilityId));
    const capabilityId =
      capIds.size === 1 ? (lines[0].capabilityId ?? null) : null;
    return { printerId, lines, wholesale_cost, is_bulk, capabilityId };
  });

  const retail_total = input.lines.reduce(
    (sum, l) => sum + l.unit_retail * l.quantity,
    0
  );
  const currency = input.currency ?? "AED";

  // ── (4) PERSIST atomically: Order → Fulfillments → OrderLines. ──
  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        origination: input.origination ?? "OWN_STORE",
        merchantId: input.merchantId,
        storeId: input.storeId ?? null,
        external_order_ref: input.externalOrderRef ?? null,
        // Fulfillments are assigned below ⇒ the order's derived display status
        // is ROUTED. (Full status derivation / payment gating is a later step.)
        status: "ROUTED",
        recipient_name: input.recipient.name,
        recipient_phone: input.recipient.phone ?? null,
        shipping_line1: input.recipient.line1,
        shipping_line2: input.recipient.line2 ?? null,
        shipping_city: input.recipient.city,
        shipping_emirate: input.recipient.emirate ?? null,
        shipping_country: input.recipient.country ?? "AE",
        retail_total: retail_total.toFixed(2),
        currency,
        // paid_at stays null — payment is collected by the store's gateway,
        // not this function (platform never holds buyer funds).
      },
    });

    for (const plan of fulfillmentPlans) {
      const fulfillment = await tx.fulfillment.create({
        data: {
          orderId: order.id,
          printerId: plan.printerId,
          capabilityId: plan.capabilityId,
          status: "ROUTED", // printer assigned
          wholesale_cost: plan.wholesale_cost.toFixed(2),
          is_bulk: plan.is_bulk,
          first_article_required: plan.is_bulk, // mandatory on bulk
          // hold_status defaults NONE; hold amounts left null — retention
          // engine is deferred this phase.
        },
      });

      for (const l of plan.lines) {
        await tx.orderLine.create({
          data: {
            orderId: order.id,
            fulfillmentId: fulfillment.id,
            productId: l.input.productId,
            variantId: l.input.variantId,
            designId: l.input.designId,
            method: l.input.method,
            quantity: l.input.quantity,
            unit_retail: l.input.unit_retail.toFixed(2),
          },
        });
      }
    }

    return order.id;
  });

  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      fulfillments: {
        include: { printer: true, lines: true },
        orderBy: { createdAt: "asc" },
      },
      lines: true,
    },
  });
}

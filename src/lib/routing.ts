// ─────────────────────────────────────────────────────────────
// Capability-matrix routing query (READ-ONLY).
//
// Implements the routing rule from /docs/pod-platform-data-model.md §"Routing
// algorithm" and CLAUDE.md:
//
//   capability gate  →  capacity gate  →  rank by cost (primary) → proximity (tiebreak)
//
//   1. CAPABILITY GATE (hard): printer must have an ACTIVE PrinterCapability
//      matching productType + method, and meet min_qty / max_qty for the qty.
//   2. CAPACITY GATE (hard, not a weight): exclude printers that aren't ACTIVE,
//      aren't blind_ship_confirmed, or whose current_load + qty would exceed
//      daily_capacity_units. A printer over its threshold drops out entirely.
//   3. RANK survivors by COST (primary, cheapest effective unit cost first),
//      then PROXIMITY (tiebreaker only — weak domestically, gains weight GCC-wide).
//
// This is the read side only. It performs NO writes and assigns nothing; the
// Fulfillment/assignment step belongs to the order layer (build step 4).
// ─────────────────────────────────────────────────────────────

import type { PrintMethod, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface RoutingQuery {
  /** Resolve the product type by id OR slug (one is required). */
  productTypeId?: string;
  slug?: string;
  method: PrintMethod;
  quantity: number;
  /** Optional ship-to point; enables the proximity tiebreaker. */
  destination?: { latitude: number; longitude: number };
}

export interface EligiblePrinter {
  printerId: string;
  printerName: string;
  emirate: string | null;
  country: string;
  method: PrintMethod;
  quantity: number;
  /** Per-unit cost after applying any matching PricingTier. */
  effectiveUnitCost: number;
  /** effectiveUnitCost × quantity. */
  totalCost: number;
  /** min_qty of the pricing tier that applied, or null if base price was used. */
  appliedTierMinQty: number | null;
  /** Great-circle km to destination, or null when proximity can't be computed. */
  distanceKm: number | null;
}

/** Prisma Decimal | number → number, without pulling in Decimal at runtime. */
function toNum(d: Prisma.Decimal | number): number {
  return typeof d === "number" ? d : Number(d.toString());
}

/** Haversine great-circle distance in km. */
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number }
): number {
  const R = 6371; // Earth radius, km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Return the eligible printers for a (productType, method, quantity), ranked
 * per the routing rule. Empty array = order line is unfulfillable as asked
 * (no capable printer, or all capable printers fail a hard gate).
 */
export async function findEligiblePrinters(
  q: RoutingQuery
): Promise<EligiblePrinter[]> {
  if (!q.productTypeId && !q.slug) {
    throw new Error("findEligiblePrinters: provide productTypeId or slug");
  }
  if (!Number.isInteger(q.quantity) || q.quantity < 1) {
    throw new Error("findEligiblePrinters: quantity must be a positive integer");
  }

  // ── CAPABILITY GATE + part of CAPACITY GATE (the parts expressible in SQL).
  // We push as much as possible into the query; the capacity arithmetic
  // (current_load + qty vs daily_capacity) is finished in code below.
  const capabilities = await prisma.printerCapability.findMany({
    where: {
      method: q.method,
      active: true,
      min_qty: { lte: q.quantity },
      // max_qty null = no cap; otherwise must be ≥ requested quantity.
      OR: [{ max_qty: null }, { max_qty: { gte: q.quantity } }],
      ...(q.productTypeId
        ? { productTypeId: q.productTypeId }
        : { productType: { slug: q.slug } }),
      // Printer-side hard gates that ARE expressible here.
      printer: {
        status: "ACTIVE",
        blind_ship_confirmed: true,
      },
    },
    include: {
      printer: true,
      pricingTiers: true,
    },
  });

  const eligible: EligiblePrinter[] = [];

  for (const cap of capabilities) {
    const p = cap.printer;

    // ── CAPACITY GATE (finish): would taking this quantity push the printer
    // at/over its daily threshold? null capacity = uncapped (no signal yet).
    if (p.daily_capacity_units !== null) {
      if (p.current_load_units + q.quantity > p.daily_capacity_units) {
        continue; // over capacity → drops out of eligibility entirely
      }
    }

    // ── COST: base wholesale, overridden by the highest pricing tier whose
    // min_qty the order meets (tiers override at/above their min_qty).
    let unitCost = toNum(cap.unit_wholesale_cost);
    let appliedTierMinQty: number | null = null;
    for (const tier of cap.pricingTiers) {
      if (tier.min_qty <= q.quantity) {
        if (appliedTierMinQty === null || tier.min_qty > appliedTierMinQty) {
          appliedTierMinQty = tier.min_qty;
          unitCost = toNum(tier.unit_cost);
        }
      }
    }

    // ── PROXIMITY (tiebreaker only): computable only with both endpoints.
    let distanceKm: number | null = null;
    if (
      q.destination &&
      p.latitude !== null &&
      p.longitude !== null
    ) {
      distanceKm = haversineKm(q.destination, {
        latitude: p.latitude,
        longitude: p.longitude,
      });
    }

    eligible.push({
      printerId: p.id,
      printerName: p.name,
      emirate: p.emirate,
      country: p.country,
      method: cap.method,
      quantity: q.quantity,
      effectiveUnitCost: unitCost,
      totalCost: unitCost * q.quantity,
      appliedTierMinQty,
      distanceKm,
    });
  }

  // ── RANK: cost primary (cheapest first), proximity tiebreaker, then a
  // stable final tiebreak on printerId so output is deterministic.
  eligible.sort((a, b) => {
    if (a.effectiveUnitCost !== b.effectiveUnitCost) {
      return a.effectiveUnitCost - b.effectiveUnitCost;
    }
    // Equal cost → proximity. Nulls sort last (no penalty over each other).
    const da = a.distanceKm ?? Infinity;
    const db = b.distanceKm ?? Infinity;
    if (da !== db) return da - db;
    return a.printerId.localeCompare(b.printerId);
  });

  return eligible;
}

// SCOPED data access for orders — the concrete data-layer authorization the
// whole phase exists to enforce. Callers pass the session-derived AuthContext
// (from getAuthContext/requireRole); the scoping `where` is built from THAT,
// never from request params. A MERCHANT can only ever read their own merchant's
// orders; a PRINTER only orders containing a fulfillment assigned to them;
// OPERATOR sees everything.
//
// Pure data layer (no next/headers) so it is unit-testable in plain Node and
// reusable by any caller. AuthContext is imported type-only, so this module
// never pulls in the Next-only session helper at runtime.

import type { AuthContext } from "./auth-context";
import { prisma } from "./prisma";

// The include shape the ops view (and future role-scoped views) render from.
const ORDER_INCLUDE = {
  fulfillments: {
    orderBy: { createdAt: "asc" },
    include: {
      printer: true,
      shipments: { orderBy: { createdAt: "asc" } },
      lines: { include: { product: true, variant: true } },
    },
  },
} as const;

// Return the orders the caller is authorized to see — scoped at the query level.
//
// SECURITY-CRITICAL: the merchantId/printerId come from the session context, and
// we throw (never fall through) if a scoped role is missing its id. Prisma
// treats `where: { merchantId: undefined }` as "no filter" and would return
// EVERY order — a silent full-scope leak. The DB CHECK makes a null here
// impossible, but we defend in depth regardless.
export async function getOrdersForCaller(ctx: AuthContext) {
  switch (ctx.role) {
    case "OPERATOR":
      return prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        include: ORDER_INCLUDE,
      });

    case "MERCHANT":
      if (!ctx.merchantId) {
        throw new Error(
          "Refusing to scope orders: MERCHANT context has no merchantId."
        );
      }
      return prisma.order.findMany({
        where: { merchantId: ctx.merchantId },
        orderBy: { createdAt: "desc" },
        include: ORDER_INCLUDE,
      });

    case "PRINTER":
      if (!ctx.printerId) {
        throw new Error(
          "Refusing to scope orders: PRINTER context has no printerId."
        );
      }
      return prisma.order.findMany({
        where: { fulfillments: { some: { printerId: ctx.printerId } } },
        orderBy: { createdAt: "desc" },
        include: ORDER_INCLUDE,
      });

    default: {
      // Exhaustiveness guard: a new role must be handled explicitly, never
      // default-allowed.
      const _exhaustive: never = ctx.role;
      throw new Error(`Unhandled role in getOrdersForCaller: ${_exhaustive}`);
    }
  }
}

// The include shape the printer view renders from: the parent order (for the
// human-facing ref + currency) and the fulfillment's own lines.
// Work-view extras (queue 8): the merchant brand to apply, and each line's
// design placements — id/placement/status only, never the print file URL (the
// file is fetched through the ownership-checked work-file route).
const FULFILLMENT_INCLUDE = {
  // Only what the printer needs to ship + brand: no retail total / payment
  // fields (the printer is paid wholesale, never sees the buyer's price).
  order: {
    select: {
      id: true,
      recipient_name: true,
      recipient_phone: true,
      shipping_line1: true,
      shipping_line2: true,
      shipping_city: true,
      shipping_emirate: true,
      shipping_country: true,
      merchant: {
        select: {
          name: true,
          brand_logo_url: true,
          packing_slip_message: true,
          return_address: true,
          custom_packaging_note: true,
        },
      },
    },
  },
  lines: {
    include: {
      product: true,
      variant: true,
      design: {
        select: {
          id: true,
          name: true,
          placements: {
            select: { id: true, placement: true, validation_status: true },
            orderBy: { placement: "asc" },
          },
        },
      },
    },
  },
} as const;

// Return the Fulfillments assigned to the calling PRINTER — scoped at the query
// level to ctx.printerId. Unlike getOrdersForCaller (which returns whole orders,
// and for a SPLIT order would include sibling fulfillments belonging to other
// printers), this returns ONLY the caller's own fulfillment rows. A printer must
// never see another printer's work.
//
// SECURITY-CRITICAL: printerId comes from the session context, and we throw
// (never fall through) on a missing id. Prisma treats
// `where: { printerId: undefined }` as "no filter" and would return EVERY
// fulfillment — a silent full-scope leak. The DB CHECK makes a null impossible
// for a PRINTER, but we defend in depth regardless. Restricted to the PRINTER
// role: this accessor exists only to scope a printer to its own queue.
export async function getFulfillmentsForPrinter(ctx: AuthContext) {
  if (ctx.role !== "PRINTER") {
    throw new Error(
      `getFulfillmentsForPrinter is PRINTER-only; got role ${ctx.role}.`
    );
  }
  if (!ctx.printerId) {
    throw new Error(
      "Refusing to scope fulfillments: PRINTER context has no printerId."
    );
  }
  return prisma.fulfillment.findMany({
    where: { printerId: ctx.printerId },
    orderBy: { createdAt: "asc" },
    include: FULFILLMENT_INCLUDE,
  });
}

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

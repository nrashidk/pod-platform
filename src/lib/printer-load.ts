// ─────────────────────────────────────────────────────────────
// Printer capacity accounting (queue item 5, data model §3 step 3.2).
//
// `Printer.current_load_units` is what the routing capacity gate reads
// (src/lib/routing.ts). It is maintained here, always with the caller's
// transaction client so the load moves in the SAME transaction as the state
// change that causes it:
//
//   • RESERVE  when a Fulfillment is created by routing (orders.ts);
//   • RELEASE  when it reaches SHIPPED (fulfillment.ts), and — once those
//     transitions exist (queue 19, 20) — CANCELLED or REROUTED.
//
// The units held by a Fulfillment are recorded on the row itself
// (`Fulfillment.load_units`), so a release always gives back exactly what was
// reserved and can never run twice: it is a conditional write that zeroes
// `load_units`, and only the caller that wins that write decrements the printer.
// ─────────────────────────────────────────────────────────────

import type { Prisma } from "@prisma/client";

export class PrinterCapacityError extends Error {
  readonly printerId: string;
  readonly units: number;
  constructor(printerId: string, units: number) {
    super(`Printer ${printerId} has no capacity left for ${units} more unit(s).`);
    this.name = "PrinterCapacityError";
    this.printerId = printerId;
    this.units = units;
  }
}

/**
 * Reserve `units` of the printer's daily capacity for `fulfillmentId`.
 * Conditional write: the printer's load is only raised if it still fits, so two
 * orders racing for the last slots cannot both succeed (the loser throws
 * PrinterCapacityError and its transaction rolls back). A printer with no
 * `daily_capacity_units` is uncapped but its load is still tracked.
 */
export async function reservePrinterLoad(
  tx: Prisma.TransactionClient,
  printerId: string,
  fulfillmentId: string,
  units: number
): Promise<void> {
  if (!Number.isInteger(units) || units < 1) {
    throw new Error("reservePrinterLoad: units must be a positive integer");
  }
  const printer = await tx.printer.findUniqueOrThrow({
    where: { id: printerId },
    select: { daily_capacity_units: true },
  });
  const { count } = await tx.printer.updateMany({
    where: {
      id: printerId,
      ...(printer.daily_capacity_units === null
        ? {}
        : { current_load_units: { lte: printer.daily_capacity_units - units } }),
    },
    data: { current_load_units: { increment: units } },
  });
  if (count !== 1) throw new PrinterCapacityError(printerId, units);
  await tx.fulfillment.update({
    where: { id: fulfillmentId },
    data: { load_units: units },
  });
}

/**
 * Give back whatever load `fulfillmentId` is holding. Idempotent: a fulfillment
 * holding nothing (never reserved, or already released) is a no-op.
 */
export async function releasePrinterLoad(
  tx: Prisma.TransactionClient,
  fulfillmentId: string
): Promise<void> {
  const f = await tx.fulfillment.findUnique({
    where: { id: fulfillmentId },
    select: { printerId: true, load_units: true },
  });
  if (!f || f.load_units <= 0) return;
  // Only the writer that flips load_units → 0 decrements the printer.
  const { count } = await tx.fulfillment.updateMany({
    where: { id: fulfillmentId, load_units: f.load_units },
    data: { load_units: 0 },
  });
  if (count !== 1) return;
  await tx.printer.update({
    where: { id: f.printerId },
    data: { current_load_units: { decrement: f.load_units } },
  });
}

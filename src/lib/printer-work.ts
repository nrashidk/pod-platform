// Printer work view data (queue 8, data model §4, §6): what a printer needs to
// produce a fulfillment — the validated print files, and the merchant brand to
// apply. Every read is scoped to the calling printer's own fulfillments.
//
// Print files live in a PRIVATE store (merchant design IP). They are never put
// in page HTML: the page links to a route that calls printerWorkFileUrl on each
// click, which re-checks ownership and mints a short-lived signed URL.

import type { PlacementCode } from "@prisma/client";
import { prisma } from "./prisma";
import { getPrintFileStore, type PrintFileStore } from "./print-file-store";

// Fulfillments a printer can no longer produce: files are not served for these.
const NOT_PRODUCIBLE = ["REROUTED", "CANCELLED"] as const;

/**
 * Short-lived signed URL for ONE validated print file of a fulfillment this
 * printer owns. Null (never an error) when anything does not line up — wrong
 * printer, unknown fulfillment, design not on one of its lines, file missing or
 * not PASSED, fulfillment rerouted/cancelled, or signing fails — so the caller
 * can return one undifferentiated 404.
 */
export async function printerWorkFileUrl(
  printerId: string,
  target: { fulfillmentId: string; designId: string; placement: PlacementCode },
  store: PrintFileStore = getPrintFileStore()
): Promise<string | null> {
  if (!printerId) return null; // never let an empty id widen the filter
  const line = await prisma.orderLine.findFirst({
    where: {
      designId: target.designId,
      fulfillmentId: target.fulfillmentId,
      fulfillment: {
        printerId,
        status: { notIn: [...NOT_PRODUCIBLE] },
      },
    },
    select: { id: true },
  });
  if (!line) return null;

  const file = await prisma.designPlacement.findUnique({
    where: {
      designId_placement: {
        designId: target.designId,
        placement: target.placement,
      },
    },
    select: { print_file_url: true, validation_status: true },
  });
  if (!file || file.validation_status !== "PASSED" || !file.print_file_url) {
    return null;
  }
  try {
    return await store.signedReadUrl(file.print_file_url);
  } catch {
    return null;
  }
}

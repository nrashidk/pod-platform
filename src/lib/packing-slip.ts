// White-label packing slip data (queue 9, data model §6): what goes on the slip
// that ships inside a parcel — the MERCHANT's brand, the ship-to, and what is in
// the box. Never the platform's or the printer's name, and never any price.
// Scoped to the calling printer's own fulfillments; anything else is null so the
// page can answer one undifferentiated 404.

import { prisma } from "./prisma";

// A rerouted/cancelled fulfillment will not be produced, so no slip is issued.
const NO_SLIP = ["REROUTED", "CANCELLED"] as const;

export async function getPackingSlipForPrinter(
  printerId: string,
  fulfillmentId: string
) {
  if (!printerId || !fulfillmentId) return null; // never widen the filter
  const f = await prisma.fulfillment.findFirst({
    where: {
      id: fulfillmentId,
      printerId,
      status: { notIn: [...NO_SLIP] },
    },
    select: {
      id: true,
      order: {
        select: {
          id: true,
          external_order_ref: true,
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
              packing_slip_message: true,
              packing_slip_message_ar: true,
              return_address: true,
              return_address_ar: true,
            },
          },
        },
      },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantity: true,
          product: { select: { name_en: true, name_ar: true } },
          variant: { select: { sku: true, size: true, color: true } },
        },
      },
    },
  });
  return f;
}

// Estimated delivery (queue 12, data model §1 Printer / §4):
//   estimated_delivery_days = printer.production_lead_days + shipping days
// where shipping days come from the ShippingLeadTime table for the order's
// destination (emirate override → country → FALLBACK_SHIPPING_DAYS).
// Set on the Fulfillment when it is created at routing.

import type { Prisma } from "@prisma/client";

/** Used when no ShippingLeadTime row matches the destination country. */
export const FALLBACK_SHIPPING_DAYS = 5;

export async function shippingDaysFor(
  tx: Prisma.TransactionClient,
  country: string,
  emirate?: string | null
): Promise<number> {
  const code = country.trim().toUpperCase();
  const em = (emirate ?? "").trim();
  const rows = await tx.shippingLeadTime.findMany({
    where: { country: code, emirate: { in: em ? [em, ""] : [""] } },
  });
  const exact = em ? rows.find((r) => r.emirate === em) : undefined;
  const any = rows.find((r) => r.emirate === "");
  return (exact ?? any)?.days ?? FALLBACK_SHIPPING_DAYS;
}

export const estimatedDeliveryDays = (productionLeadDays: number, shippingDays: number) =>
  Math.max(0, productionLeadDays) + Math.max(0, shippingDays);

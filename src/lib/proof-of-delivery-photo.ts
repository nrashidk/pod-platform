// Optional photo/scan of the courier's delivery confirmation (queue 11b, data
// model §3/§4). OPS attaches it beside the text reference — at the moment of
// marking delivered, or later (replaceable). Bytes go through the private
// print-file store seam (tests pass a StubPrintFileStore). Viewing is by
// short-lived signed URL only; the raw stored URL is never sent to a browser.

import { prisma } from "./prisma";
import {
  FIRST_ARTICLE_PHOTO_MAX_BYTES,
  FIRST_ARTICLE_PHOTO_TYPES,
  matchesSignature,
} from "./first-article-photo";
import { getPrintFileStore, type PrintFileStore } from "./print-file-store";

export const POD_PHOTO_MAX_BYTES = FIRST_ARTICLE_PHOTO_MAX_BYTES;

export type PodPhotoReason = "type" | "size" | "empty" | "notDelivered";

export class PodPhotoInvalidError extends Error {
  readonly reason: PodPhotoReason;
  constructor(reason: PodPhotoReason) {
    super(`Proof-of-delivery photo rejected: ${reason}`);
    this.name = "PodPhotoInvalidError";
    this.reason = reason;
  }
}

export type PodPhotoFile = { buffer: Buffer; filename: string; contentType: string };

/** Pure check: JPEG/PNG/WebP by real byte signature, non-empty, ≤ 4 MB. */
export function validatePodPhoto(file: PodPhotoFile): void {
  if (file.buffer.length === 0) throw new PodPhotoInvalidError("empty");
  if (file.buffer.length > POD_PHOTO_MAX_BYTES) throw new PodPhotoInvalidError("size");
  if (
    !(FIRST_ARTICLE_PHOTO_TYPES as readonly string[]).includes(file.contentType) ||
    !matchesSignature(file.contentType, file.buffer)
  ) {
    throw new PodPhotoInvalidError("type");
  }
}

/**
 * Store the photo on the fulfillment's (first) DELIVERED shipment — the same one the pages read (attach or replace).
 * Refused when the fulfillment has no delivered shipment — the photo is proof
 * OF delivery, so it cannot exist before delivery.
 */
export async function attachProofOfDeliveryPhoto(
  fulfillmentId: string,
  file: PodPhotoFile,
  store: PrintFileStore = getPrintFileStore()
): Promise<void> {
  validatePodPhoto(file);

  const shipment = await prisma.shipment.findFirst({
    where: { fulfillmentId, delivered_at: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!shipment) throw new PodPhotoInvalidError("notDelivered");

  const stored = await store.put({
    buffer: file.buffer,
    filename: `pod-${fulfillmentId}-${file.filename}`,
    contentType: file.contentType,
  });

  const { count } = await prisma.shipment.updateMany({
    where: { id: shipment.id, delivered_at: { not: null } },
    data: { proof_of_delivery_photo_url: stored.url },
  });
  if (count !== 1) throw new PodPhotoInvalidError("notDelivered");
}

/** Signed read link, or null when there is no photo / signing fails (page still renders). */
export async function podPhotoViewUrl(
  photoUrl: string | null,
  store: PrintFileStore = getPrintFileStore()
): Promise<string | null> {
  if (!photoUrl) return null;
  try {
    return await store.signedReadUrl(photoUrl);
  } catch {
    return null;
  }
}

/**
 * Merchant door to the photo: only when the fulfillment belongs to an order of
 * THIS merchant (merchantId from the session). Any miss → null (one 404).
 */
export async function merchantPodPhotoUrl(
  merchantId: string,
  fulfillmentId: string,
  store: PrintFileStore = getPrintFileStore()
): Promise<string | null> {
  if (!merchantId || !fulfillmentId) return null;
  const shipment = await prisma.shipment.findFirst({
    where: {
      fulfillmentId,
      proof_of_delivery_photo_url: { not: null },
      fulfillment: { order: { merchantId } },
    },
    orderBy: { createdAt: "asc" },
    select: { proof_of_delivery_photo_url: true },
  });
  return podPhotoViewUrl(shipment?.proof_of_delivery_photo_url ?? null, store);
}

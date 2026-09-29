// Photo proof of the bulk first article (queue 4b, data model §5b).
//
// The PRINTER uploads a photo of the first unit; that upload also submits the
// first article (ROUTED → FIRST_ARTICLE_PENDING), so ops sees the photo when
// approving. While the fulfillment is still pending the printer may replace the
// photo. Bytes go through the print-file store seam (private Blob; tests pass a
// StubPrintFileStore). Ownership is checked against the session-derived printer
// id, never client input.

import { prisma } from "./prisma";
import {
  FulfillmentOwnershipError,
  InvalidTransitionError,
  submitFirstArticle,
} from "./fulfillment";
import { getPrintFileStore, type PrintFileStore } from "./print-file-store";

export const FIRST_ARTICLE_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
/** Kept under the 4.5 MB serverless request-body ceiling. */
export const FIRST_ARTICLE_PHOTO_MAX_BYTES = 4 * 1024 * 1024;

export type FirstArticlePhotoReason = "type" | "size" | "empty";

export class FirstArticlePhotoInvalidError extends Error {
  readonly reason: FirstArticlePhotoReason;
  constructor(reason: FirstArticlePhotoReason) {
    super(`First-article photo rejected: ${reason}`);
    this.name = "FirstArticlePhotoInvalidError";
    this.reason = reason;
  }
}

// The browser-claimed content type is not trusted: the bytes must carry the
// matching JPEG / PNG / WebP signature.
function matchesSignature(contentType: string, b: Buffer): boolean {
  switch (contentType) {
    case "image/jpeg":
      return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
    case "image/png":
      return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP";
    default:
      return false;
  }
}

export async function submitFirstArticleWithPhoto(
  fulfillmentId: string,
  ownerPrinterId: string,
  file: { buffer: Buffer; filename: string; contentType: string },
  store: PrintFileStore = getPrintFileStore()
) {
  if (file.buffer.length === 0) throw new FirstArticlePhotoInvalidError("empty");
  if (file.buffer.length > FIRST_ARTICLE_PHOTO_MAX_BYTES) {
    throw new FirstArticlePhotoInvalidError("size");
  }
  if (!(FIRST_ARTICLE_PHOTO_TYPES as readonly string[]).includes(file.contentType)) {
    throw new FirstArticlePhotoInvalidError("type");
  }
  if (!matchesSignature(file.contentType, file.buffer)) {
    throw new FirstArticlePhotoInvalidError("type");
  }

  const f = await prisma.fulfillment.findUniqueOrThrow({
    where: { id: fulfillmentId },
  });
  if (f.printerId !== ownerPrinterId) {
    throw new FulfillmentOwnershipError(fulfillmentId, ownerPrinterId);
  }
  if (
    !f.is_bulk ||
    (f.status !== "ROUTED" && f.status !== "FIRST_ARTICLE_PENDING")
  ) {
    throw new InvalidTransitionError(f.status, "FIRST_ARTICLE_PENDING");
  }

  const stored = await store.put({
    buffer: file.buffer,
    filename: `first-article-${fulfillmentId}-${file.filename}`,
    contentType: file.contentType,
  });

  // Conditional write: only while still ROUTED/PENDING and still this printer's.
  const { count } = await prisma.fulfillment.updateMany({
    where: {
      id: fulfillmentId,
      printerId: ownerPrinterId,
      status: { in: ["ROUTED", "FIRST_ARTICLE_PENDING"] },
    },
    data: {
      first_article_photo_url: stored.url,
      first_article_photo_uploaded_at: new Date(),
    },
  });
  if (count !== 1) throw new InvalidTransitionError(f.status, "FIRST_ARTICLE_PENDING");

  if (f.status === "ROUTED") await submitFirstArticle(fulfillmentId);
}

/**
 * Short-lived read link for ops. Null when there is no photo or signing fails
 * (e.g. Blob token missing) — the ops page must still render.
 */
export async function firstArticlePhotoViewUrl(
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

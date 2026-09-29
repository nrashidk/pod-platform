// Merchant brand settings (queue 10, data model §1 Merchant, §6 white-label).
//
// The merchant edits ONLY their own brand assets: logo, packing-slip message
// (EN/AR), return address (EN/AR) and packaging note. The merchant id always
// comes from the caller's session, never client input. Text is trimmed, empty
// becomes null, and each field has a length cap. The logo goes through the
// print-file store seam (private Blob; tests pass a StubPrintFileStore) and is
// checked by the bytes' real signature, not the browser-claimed type.

import { prisma } from "./prisma";
import { matchesSignature } from "./first-article-photo";
import { getPrintFileStore, type PrintFileStore } from "./print-file-store";

export const BRAND_LOGO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Kept under the serverless request-body ceiling (next.config bodySizeLimit). */
export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;

export const BRAND_TEXT_LIMITS = {
  packing_slip_message: 500,
  packing_slip_message_ar: 500,
  return_address: 300,
  return_address_ar: 300,
  custom_packaging_note: 300,
} as const;

export type BrandTextField = keyof typeof BRAND_TEXT_LIMITS;
export type BrandTextInput = Partial<Record<BrandTextField, string | null | undefined>>;

export type BrandInvalidReason = "too_long" | "type" | "size" | "empty";

export class BrandInvalidError extends Error {
  readonly reason: BrandInvalidReason;
  readonly field?: string;
  constructor(reason: BrandInvalidReason, field?: string) {
    super(`Brand settings rejected: ${reason}${field ? ` (${field})` : ""}`);
    this.name = "BrandInvalidError";
    this.reason = reason;
    this.field = field;
  }
}

const BRAND_SELECT = {
  name: true,
  brand_logo_url: true,
  packing_slip_message: true,
  packing_slip_message_ar: true,
  return_address: true,
  return_address_ar: true,
  custom_packaging_note: true,
} as const;

export async function getMerchantBrand(merchantId: string) {
  return prisma.merchant.findUniqueOrThrow({
    where: { id: merchantId },
    select: BRAND_SELECT,
  });
}

/** Save the text fields. A field left out of `input` is untouched; an empty
 * string clears it. All-or-nothing: one bad field rejects the whole save. */
export async function updateMerchantBrandText(
  merchantId: string,
  input: BrandTextInput
) {
  const data: Record<string, string | null> = {};
  for (const field of Object.keys(BRAND_TEXT_LIMITS) as BrandTextField[]) {
    const raw = input[field];
    if (raw === undefined) continue;
    // Browsers submit line breaks as \r\n but count them as one character in
    // maxLength; normalise so the server cap matches what the form allowed.
    const v = (raw ?? "").replace(/\r\n?/g, "\n").trim();
    if (v.length > BRAND_TEXT_LIMITS[field]) {
      throw new BrandInvalidError("too_long", field);
    }
    data[field] = v === "" ? null : v;
  }
  return prisma.merchant.update({
    where: { id: merchantId },
    data,
    select: BRAND_SELECT,
  });
}

export async function uploadMerchantLogo(
  merchantId: string,
  file: { buffer: Buffer; filename: string; contentType: string },
  store: PrintFileStore = getPrintFileStore()
) {
  if (file.buffer.length === 0) throw new BrandInvalidError("empty", "logo");
  if (file.buffer.length > BRAND_LOGO_MAX_BYTES) {
    throw new BrandInvalidError("size", "logo");
  }
  if (
    !(BRAND_LOGO_TYPES as readonly string[]).includes(file.contentType) ||
    !matchesSignature(file.contentType, file.buffer)
  ) {
    throw new BrandInvalidError("type", "logo");
  }
  const stored = await store.put({
    buffer: file.buffer,
    filename: `brand-logo-${merchantId}-${file.filename}`,
    contentType: file.contentType,
  });
  return prisma.merchant.update({
    where: { id: merchantId },
    data: { brand_logo_url: stored.url },
    select: BRAND_SELECT,
  });
}

export async function removeMerchantLogo(merchantId: string) {
  return prisma.merchant.update({
    where: { id: merchantId },
    data: { brand_logo_url: null },
    select: BRAND_SELECT,
  });
}

/** Short-lived read link for the merchant's own settings page. Null when there
 * is no logo or signing fails — the page must still render. */
export async function brandLogoViewUrl(
  logoUrl: string | null,
  store: PrintFileStore = getPrintFileStore()
): Promise<string | null> {
  if (!logoUrl) return null;
  try {
    return await store.signedReadUrl(logoUrl);
  } catch {
    return null;
  }
}

/** The text a viewer in `locale` should see: the Arabic variant when set,
 * otherwise the English one. */
export function localizedBrandText(
  en: string | null,
  ar: string | null,
  locale: "en" | "ar"
): string | null {
  return locale === "ar" ? ar || en : en || ar;
}

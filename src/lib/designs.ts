// ─────────────────────────────────────────────────────────────
// MERCHANT DESIGN MANAGER — the engine behind /merchant/designs.
//
// Next-independent (no next/*) so the whole upload→validate→persist path and the
// orderability rule are unit-testable under the plain-Node smoke loader, exactly
// like src/lib/api-orders.ts. The server actions in src/app/merchant/designs are
// a thin shell over these functions (read the File, buffer it, call in).
//
// A Design carries a productType; each uploaded print file is validated against
// the PrintArea spec for that productType + placement (validatePrintFile reads
// the ACTUAL bytes — claimed dimensions are never trusted), then stored via the
// PrintFileStore seam and recorded as a DesignPlacement (PASSED/FLAGGED + the
// human-readable reasons). FLAGGED placements can be re-uploaded (upsert).
// ─────────────────────────────────────────────────────────────

import type { PlacementCode, DesignValidationStatus } from "@prisma/client";
import { prisma } from "./prisma";
import {
  validatePrintFile,
  toDesignPlacementValidation,
  type PrintAreaSpec,
} from "./print-file-validation";
import type { PrintFileStore, PrintFilePut } from "./print-file-store";

// Content types we accept at upload. This is a cheap early gate; the REAL format
// gate is validatePrintFile, which reads the actual bytes via sharp and checks
// them against the PrintArea's allowed_formats (a lying Content-Type can't pass).
export const ACCEPTED_CONTENT_TYPES = ["image/png", "image/jpeg"] as const;

/** Why an upload was rejected before it ever reached validation/storage. */
export type UploadRejectCode =
  | "design_not_found" // not owned by this merchant (or doesn't exist)
  | "no_print_area" // productType has no PrintArea for this placement
  | "bad_content_type" // not PNG/JPEG
  | "too_large" // exceeds the placement spec's max_file_mb
  | "blob_missing"; // finalize: the URL isn't a blob in our own store

export class UploadRejectedError extends Error {
  readonly code: UploadRejectCode;
  constructor(code: UploadRejectCode, message: string) {
    super(message);
    this.name = "UploadRejectedError";
    this.code = code;
  }
}

// Map a PrintArea row to the validator's pure spec type.
function toSpec(area: {
  placement: PlacementCode;
  width_mm: number;
  height_mm: number;
  min_dpi: number;
  recommended_dpi: number;
  allowed_formats: string[];
  color_profile: string;
  requires_transparency: boolean;
  max_file_mb: number;
}): PrintAreaSpec {
  return {
    placement: area.placement,
    width_mm: area.width_mm,
    height_mm: area.height_mm,
    min_dpi: area.min_dpi,
    recommended_dpi: area.recommended_dpi,
    allowed_formats: area.allowed_formats,
    color_profile: area.color_profile,
    requires_transparency: area.requires_transparency,
    max_file_mb: area.max_file_mb,
  };
}

/** Create a design for a merchant. Scoped: merchantId comes from the session. */
export async function createDesign(input: {
  merchantId: string;
  name: string;
  productTypeId: string;
}) {
  return prisma.design.create({
    data: {
      merchantId: input.merchantId,
      name: input.name,
      productTypeId: input.productTypeId,
    },
    select: { id: true },
  });
}

export interface UploadFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
  /** Byte size as reported by the multipart parser (File.size) — used for the
   * pre-upload size gate so an oversized file is rejected before it's stored. */
  size: number;
}

export interface UploadPlacementResult {
  placementId: string;
  // validatePrintFile only ever yields PASSED or FLAGGED (PENDING is the
  // pre-validation row default, never produced here).
  status: "PASSED" | "FLAGGED";
  reasons: string[];
}

/**
 * Validate + store + persist one print file for a (design, placement).
 *
 * Order of operations (cheap rejects first, external write last):
 *  1. ownership   — the design must belong to merchantId (else design_not_found)
 *  2. spec        — the productType must have a PrintArea for this placement
 *  3. size gate   — size ≤ spec.max_file_mb, checked BEFORE validating/uploading
 *  4. type gate   — Content-Type ∈ PNG/JPEG (cheap; bytes are the real gate)
 *  5. validate    — validatePrintFile reads the actual bytes (DPI/format/dims/…)
 *  6. store       — PrintFileStore.put (stub in tests, Vercel Blob in the app)
 *  7. persist     — upsert DesignPlacement (re-upload overwrites the row)
 *
 * Both PASSED and FLAGGED files are stored + recorded: print_file_url is
 * non-null and a merchant must be able to see/replace a FLAGGED file.
 */
export async function uploadPlacement(input: {
  merchantId: string;
  designId: string;
  placement: PlacementCode;
  file: UploadFile;
  store: PrintFileStore;
}): Promise<UploadPlacementResult> {
  const { merchantId, designId, placement, file, store } = input;

  // (1) Ownership — scoped to the session merchant; a foreign/absent design is
  // indistinguishable (no existence leak).
  const design = await prisma.design.findFirst({
    where: { id: designId, merchantId },
    select: { id: true, productTypeId: true },
  });
  if (!design) {
    throw new UploadRejectedError("design_not_found", "Design not found.");
  }

  // (2) Spec — the PrintArea for this design's productType + placement.
  const area = await prisma.printArea.findUnique({
    where: {
      productTypeId_placement: { productTypeId: design.productTypeId, placement },
    },
  });
  if (!area) {
    throw new UploadRejectedError(
      "no_print_area",
      `This product type has no ${placement} print area.`
    );
  }
  const spec = toSpec(area);

  // (3) Size gate — BEFORE validating or uploading. validatePrintFile rechecks
  // size from the buffer as a backstop, but this avoids the external upload.
  const fileMb = file.size / (1024 * 1024);
  if (fileMb > spec.max_file_mb) {
    throw new UploadRejectedError(
      "too_large",
      `File ${fileMb.toFixed(1)}MB exceeds the ${spec.max_file_mb}MB limit for ${placement}.`
    );
  }

  // (4) Content-type gate — cheap; sharp is the authoritative format check.
  if (!ACCEPTED_CONTENT_TYPES.includes(file.contentType as never)) {
    throw new UploadRejectedError(
      "bad_content_type",
      "Only PNG or JPEG files are accepted."
    );
  }

  // (5) Validate the ACTUAL bytes against the spec.
  const result = await validatePrintFile(
    { buffer: file.buffer, filename: file.filename, bytes: file.size },
    spec
  );
  const mapped = toDesignPlacementValidation(result);

  // (6) Store (stub in tests, Vercel Blob in the app).
  const put: PrintFilePut = {
    buffer: file.buffer,
    filename: file.filename,
    contentType: file.contentType,
  };
  const stored = await store.put(put);

  // (7) Persist — upsert so a re-upload over a FLAGGED placement overwrites it.
  return persistPlacement(designId, placement, stored.url, result);
}

// Resolve a (design, placement) to its owning merchant's spec. Throws the same
// rejects as uploadPlacement's steps (1)+(2). Shared by both ingestion paths.
async function resolveDesignSpec(
  merchantId: string,
  designId: string,
  placement: PlacementCode
): Promise<PrintAreaSpec> {
  const design = await prisma.design.findFirst({
    where: { id: designId, merchantId },
    select: { id: true, productTypeId: true },
  });
  if (!design) {
    throw new UploadRejectedError("design_not_found", "Design not found.");
  }
  const area = await prisma.printArea.findUnique({
    where: {
      productTypeId_placement: { productTypeId: design.productTypeId, placement },
    },
  });
  if (!area) {
    throw new UploadRejectedError(
      "no_print_area",
      `This product type has no ${placement} print area.`
    );
  }
  return toSpec(area);
}

// Upsert the DesignPlacement row from a validation result. Re-upload over an
// existing (FLAGGED) placement overwrites it; print_file_url is always set.
async function persistPlacement(
  designId: string,
  placement: PlacementCode,
  printFileUrl: string,
  result: Awaited<ReturnType<typeof validatePrintFile>>
): Promise<UploadPlacementResult> {
  const mapped = toDesignPlacementValidation(result);
  const row = await prisma.designPlacement.upsert({
    where: { designId_placement: { designId, placement } },
    create: {
      designId,
      placement,
      print_file_url: printFileUrl,
      validation_status: mapped.validation_status,
      validation_notes: mapped.validation_notes,
    },
    update: {
      print_file_url: printFileUrl,
      validation_status: mapped.validation_status,
      validation_notes: mapped.validation_notes,
    },
    select: { id: true },
  });
  return { placementId: row.id, status: result.status, reasons: result.reasons };
}

/**
 * Finalize a CLIENT-UPLOADED print file (the browser → Vercel Blob direct path).
 *
 * The bytes are ALREADY in Blob storage (uploaded with a short-lived token whose
 * issuance — see the upload route — already re-checked merchant ownership, the
 * PNG/JPEG content-type allowlist, and the per-placement max size). This server
 * step re-establishes EVERY guarantee against storage, trusting nothing the
 * client said about the file:
 *  1. ownership   — the design must belong to merchantId (else design_not_found)
 *  2. spec        — the productType must have a PrintArea for this placement
 *  3. storage own — head(blobUrl) must resolve in OUR store (else blob_missing);
 *                   a spoofed/foreign URL never gets persisted
 *  4. size gate   — AUTHORITATIVE stored size ≤ spec.max_file_mb
 *  5. type gate   — stored Content-Type ∈ PNG/JPEG (bytes are the real gate)
 *  6. validate    — validatePrintFile reads the ACTUAL stored bytes
 *  7. persist     — upsert DesignPlacement (PASSED/FLAGGED + reasons)
 *
 * Validating after storing (vs. before, as in uploadPlacement) is fine: both
 * PASSED and FLAGGED files are stored + recorded either way.
 */
export async function finalizePlacementUpload(input: {
  merchantId: string;
  designId: string;
  placement: PlacementCode;
  blobUrl: string;
  store: PrintFileStore;
}): Promise<UploadPlacementResult> {
  const { merchantId, designId, placement, blobUrl, store } = input;

  // (1)+(2) Ownership + spec.
  const spec = await resolveDesignSpec(merchantId, designId, placement);

  // (3) Storage ownership — the URL MUST be a blob in our own store. This is the
  // guard against finalizing an arbitrary/foreign URL into print_file_url.
  const meta = await store.head(blobUrl);
  if (!meta) {
    throw new UploadRejectedError(
      "blob_missing",
      "Uploaded file was not found in storage."
    );
  }

  // (4) Size gate — from the AUTHORITATIVE stored size (not a client claim).
  const fileMb = meta.size / (1024 * 1024);
  if (fileMb > spec.max_file_mb) {
    throw new UploadRejectedError(
      "too_large",
      `File ${fileMb.toFixed(1)}MB exceeds the ${spec.max_file_mb}MB limit for ${placement}.`
    );
  }

  // (5) Content-type gate — from stored metadata; sharp is the real format gate.
  if (!ACCEPTED_CONTENT_TYPES.includes((meta.contentType ?? "") as never)) {
    throw new UploadRejectedError(
      "bad_content_type",
      "Only PNG or JPEG files are accepted."
    );
  }

  // (6) Validate the ACTUAL stored bytes against the spec.
  const buffer = await store.readBytes(blobUrl);
  const result = await validatePrintFile(
    { buffer, filename: blobUrl, bytes: meta.size },
    spec
  );

  // (7) Persist.
  return persistPlacement(designId, placement, blobUrl, result);
}

// ─────────────────────────────────────────────────────────────
// ORDERABILITY RULE — the single source of truth, enforced at the data layer.
//
// A design is orderable iff it has ≥1 placement AND every placement it has is
// PASSED. A FRONT-only shirt design is legitimately orderable. NOTE: if a
// product type ever REQUIRES a specific placement, that's a future `required`
// flag on PrintArea — NOT a change to this rule.
// ─────────────────────────────────────────────────────────────

export function isDesignOrderable(
  placements: { validation_status: DesignValidationStatus }[]
): boolean {
  return (
    placements.length > 0 &&
    placements.every((p) => p.validation_status === "PASSED")
  );
}

/**
 * For a set of design ids, return per-id { owned, orderable } scoped to the
 * merchant. Used by the order entry points (API + ops form) to reject designs
 * that aren't owned OR aren't fully PASSED. Ids not owned by the merchant are
 * present with owned:false (so callers can give a precise but non-leaky error).
 */
export async function getDesignOrderability(
  merchantId: string,
  designIds: string[]
): Promise<Map<string, { owned: boolean; orderable: boolean }>> {
  const ids = [...new Set(designIds)];
  const owned = await prisma.design.findMany({
    where: { id: { in: ids }, merchantId },
    select: { id: true, placements: { select: { validation_status: true } } },
  });
  const result = new Map<string, { owned: boolean; orderable: boolean }>();
  for (const id of ids) result.set(id, { owned: false, orderable: false });
  for (const d of owned) {
    result.set(d.id, { owned: true, orderable: isDesignOrderable(d.placements) });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
// READ MODELS for the merchant design manager UI.
// ─────────────────────────────────────────────────────────────

export interface PlacementView {
  placement: PlacementCode;
  /** "NONE" when no file has been uploaded for this PrintArea yet. */
  status: DesignValidationStatus | "NONE";
  notes: string | null;
  print_file_url: string | null;
  max_file_mb: number;
  allowed_formats: string[];
}

export interface DesignView {
  id: string;
  name: string;
  productType: { id: string; name_en: string; name_ar: string };
  orderable: boolean;
  placements: PlacementView[];
}

/**
 * List a merchant's designs (scoped) with every PrintArea of each design's
 * productType merged against the uploaded placements — so the UI can show an
 * upload slot per area, with PASSED/FLAGGED/NONE status and reasons.
 */
export async function listMyDesigns(merchantId: string): Promise<DesignView[]> {
  const designs = await prisma.design.findMany({
    where: { merchantId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      productType: {
        select: {
          id: true,
          name_en: true,
          name_ar: true,
          printAreas: {
            select: {
              placement: true,
              max_file_mb: true,
              allowed_formats: true,
            },
          },
        },
      },
      placements: {
        select: {
          placement: true,
          validation_status: true,
          validation_notes: true,
          print_file_url: true,
        },
      },
    },
  });

  return designs.map((d) => {
    const byPlacement = new Map(d.placements.map((p) => [p.placement, p]));
    const placements: PlacementView[] = d.productType.printAreas.map((area) => {
      const existing = byPlacement.get(area.placement);
      return {
        placement: area.placement,
        status: existing?.validation_status ?? "NONE",
        notes: existing?.validation_notes ?? null,
        print_file_url: existing?.print_file_url ?? null,
        max_file_mb: area.max_file_mb,
        allowed_formats: area.allowed_formats,
      };
    });
    return {
      id: d.id,
      name: d.name,
      productType: {
        id: d.productType.id,
        name_en: d.productType.name_en,
        name_ar: d.productType.name_ar,
      },
      orderable: isDesignOrderable(d.placements),
      placements,
    };
  });
}

/** Product types a merchant can create a design for (any with ≥1 PrintArea). */
export async function listDesignableProductTypes() {
  return prisma.productType.findMany({
    where: { printAreas: { some: {} } },
    orderBy: { name_en: "asc" },
    select: { id: true, name_en: true, name_ar: true },
  });
}

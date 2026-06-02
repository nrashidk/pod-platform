// Print-file spec validation — the production-quality half of the two-file
// pipeline (docs §2). The mockup is the buyer-approved *preview*; the print
// file is the artifact actually sent to the printer and must pass spec
// validation (DPI / dimensions / format / transparency / color / size) before
// an order can leave for the printer. With no escrow, this is a load-bearing
// safety layer, not a nice-to-have (docs §1).
//
// This module is intentionally DB-free: it inspects bytes and returns a
// result. Mapping that result onto a DesignPlacement row is done by the caller
// via `toDesignPlacementValidation`.
import sharp from "sharp";

const MM_PER_INCH = 25.4;

// Mirrors the spec fields on the PrintArea model. The caller passes the
// PrintArea for the target (productType + placement); we don't import Prisma
// here so the validator stays a pure, testable unit.
export type PrintAreaSpec = {
  placement: string;
  width_mm: number;
  height_mm: number;
  min_dpi: number;
  recommended_dpi: number;
  allowed_formats: string[]; // e.g. ["PNG"], ["PNG","JPEG"]
  color_profile: string; // e.g. "sRGB", "CMYK"
  requires_transparency: boolean; // true for DTG on dark garments
  max_file_mb: number;
};

// The uploaded file. A Buffer (not a path) so this works for real HTTP uploads
// and for in-memory test images alike. `bytes` is optional; we fall back to
// buffer length.
export type UploadedPrintFile = {
  buffer: Buffer;
  filename?: string;
  bytes?: number;
};

// What sharp actually read off the file — surfaced for transparency/debugging.
export type PrintFileMetadata = {
  format: string | null; // normalized, e.g. "PNG", "JPEG", "GIF"
  width_px: number | null;
  height_px: number | null;
  density_dpi: number | null; // embedded DPI tag
  effective_dpi_w: number | null; // pixels mapped onto the physical print area
  effective_dpi_h: number | null;
  has_alpha: boolean;
  color_space: string | null; // sharp's space, e.g. "srgb", "cmyk"
  file_mb: number;
};

export type PrintFileValidationResult = {
  status: "PASSED" | "FLAGGED";
  reasons: string[]; // human-readable; empty when PASSED
  read: PrintFileMetadata;
};

// sharp reports format as lowercase ("jpeg","png","gif"...). Normalize to the
// uppercase tokens used in PrintArea.allowed_formats. JPEG has two spellings.
function normalizeFormat(format: string | undefined): string | null {
  if (!format) return null;
  const upper = format.toUpperCase();
  return upper === "JPG" ? "JPEG" : upper;
}

// Pixels needed to fill `mm` at `dpi`.
function requiredPixels(mm: number, dpi: number): number {
  return Math.ceil((mm / MM_PER_INCH) * dpi);
}

/**
 * Validate an uploaded print file against a target PrintArea spec.
 * Returns PASSED, or FLAGGED with specific human-readable reasons.
 *
 * Checks (each contributes its own reason on failure):
 *  - format ∈ allowed_formats
 *  - embedded DPI ≥ min_dpi
 *  - enough pixels to fill the print area at min_dpi (effective resolution)
 *  - transparency: ONLY flags when spec.requires_transparency && !hasAlpha
 *  - file size ≤ max_file_mb
 *  - color profile matches (best-effort; sharp can't always read the ICC tag)
 */
export async function validatePrintFile(
  file: UploadedPrintFile,
  spec: PrintAreaSpec
): Promise<PrintFileValidationResult> {
  const reasons: string[] = [];
  const fileBytes = file.bytes ?? file.buffer.length;
  const fileMb = fileBytes / (1024 * 1024);

  let meta: sharp.Metadata;
  try {
    meta = await sharp(file.buffer).metadata();
  } catch {
    // Unreadable by sharp = not a usable raster print file. Flag and bail with
    // whatever metadata we have (none).
    return {
      status: "FLAGGED",
      reasons: ["file is not a readable image (could not parse metadata)"],
      read: {
        format: null,
        width_px: null,
        height_px: null,
        density_dpi: null,
        effective_dpi_w: null,
        effective_dpi_h: null,
        has_alpha: false,
        color_space: null,
        file_mb: Number(fileMb.toFixed(2)),
      },
    };
  }

  const format = normalizeFormat(meta.format);
  const widthPx = meta.width ?? null;
  const heightPx = meta.height ?? null;
  const densityDpi = meta.density ?? null;
  const hasAlpha = meta.hasAlpha ?? false;
  const colorSpace = meta.space ?? null;

  const effDpiW =
    widthPx != null ? Math.round(widthPx / (spec.width_mm / MM_PER_INCH)) : null;
  const effDpiH =
    heightPx != null
      ? Math.round(heightPx / (spec.height_mm / MM_PER_INCH))
      : null;

  // 1. Format
  if (format && !spec.allowed_formats.includes(format)) {
    reasons.push(
      `format ${format} not allowed (allowed: ${spec.allowed_formats.join(", ")})`
    );
  }

  // 2. Embedded DPI tag
  if (densityDpi != null && densityDpi < spec.min_dpi) {
    reasons.push(`DPI ${densityDpi} below minimum ${spec.min_dpi}`);
  }

  // 3. Effective resolution — enough pixels to fill the print area at min_dpi.
  if (widthPx != null && heightPx != null) {
    const reqW = requiredPixels(spec.width_mm, spec.min_dpi);
    const reqH = requiredPixels(spec.height_mm, spec.min_dpi);
    if (widthPx < reqW || heightPx < reqH) {
      reasons.push(
        `dimensions ${widthPx}×${heightPx}px too small for ${spec.placement} ` +
          `print area (needs ≥${reqW}×${reqH}px at ${spec.min_dpi} DPI)`
      );
    }
  }

  // 4. Transparency — CONDITIONAL: only flag when the spec requires an alpha
  //    channel and the file lacks one. Never a blanket rule.
  if (spec.requires_transparency && !hasAlpha) {
    reasons.push(
      `${spec.placement} requires transparency (alpha channel) but file is opaque`
    );
  }

  // 5. File size
  if (fileMb > spec.max_file_mb) {
    reasons.push(
      `file ${fileMb.toFixed(1)}MB exceeds maximum ${spec.max_file_mb}MB`
    );
  }

  // 6. Color profile (best-effort). sharp's `space` is "srgb"/"cmyk"/"b-w";
  //    compare loosely against the spec token. Only flag a clear mismatch.
  if (colorSpace && spec.color_profile) {
    const want = spec.color_profile.toLowerCase();
    const got = colorSpace.toLowerCase();
    const wantIsCmyk = want.includes("cmyk");
    const gotIsCmyk = got.includes("cmyk");
    if (wantIsCmyk !== gotIsCmyk) {
      reasons.push(
        `color profile ${colorSpace} does not match required ${spec.color_profile}`
      );
    }
  }

  return {
    status: reasons.length === 0 ? "PASSED" : "FLAGGED",
    reasons,
    read: {
      format,
      width_px: widthPx,
      height_px: heightPx,
      density_dpi: densityDpi,
      effective_dpi_w: effDpiW,
      effective_dpi_h: effDpiH,
      has_alpha: hasAlpha,
      color_space: colorSpace,
      file_mb: Number(fileMb.toFixed(2)),
    },
  };
}

// Maps a validation result onto the DesignPlacement fields. `validation_status`
// matches the DesignValidationStatus enum (PASSED/FLAGGED); PENDING is the
// pre-validation default on the row and is never produced here.
export function toDesignPlacementValidation(result: PrintFileValidationResult): {
  validation_status: "PASSED" | "FLAGGED";
  validation_notes: string | null;
} {
  return {
    validation_status: result.status,
    validation_notes: result.reasons.length ? result.reasons.join("; ") : null,
  };
}

// ─────────────────────────────────────────────────────────────
// MOCKUP GENERATOR — data model §2 ("the two-file pipeline").
//
// A mockup is the on-screen PREVIEW a merchant approves; it is NOT sent to a
// printer and carries no production fidelity. It is rendered from the design's
// already-VALIDATED print files (PASSED placements only), so a pretty mockup can
// never be built from a bad print file.
//
// Next-independent (no next/*), like src/lib/designs.ts, so the whole path is
// testable under the plain-Node smoke loader with the stub store.
//
// Template: a clearly-labelled [PLACEHOLDER] product panel drawn in SVG (owner
// ruling P12 — real product photos arrive pre-launch). The panel is a plain
// backdrop with the print area drawn to scale (from PrintArea width/height) and
// the design composited into it. Real product photos replace the backdrop later
// without changing this module's contract (stores design.mockup_url).
//
// Text baked into the image is ASCII only ("[PLACEHOLDER]" + product slug +
// placement code): the renderer has no guaranteed Arabic font, and the marker is
// a build-time watermark, not a UI string. All UI copy around it is bilingual.
// ─────────────────────────────────────────────────────────────

import sharp from "sharp";
import type { PlacementCode } from "@prisma/client";
import { prisma } from "./prisma";
import type { PrintFileStore } from "./print-file-store";
import { isDesignOrderable } from "./designs";

export const PANEL_PX = 600; // each placement panel is a square
const AREA_MAX_PX = 380; // longest side of the drawn print area within a panel
const MAX_PANELS = 6;

export type MockupRejectCode =
  | "design_not_found" // not owned by this merchant (or doesn't exist)
  | "nothing_to_render" // no PASSED placement to render from
  | "mockup_locked" // already approved — a new version is needed to change it
  | "no_mockup" // approve: nothing generated yet (or files changed since)
  | "not_orderable" // approve: a placement is missing/FLAGGED — fix before locking
  | "render_failed"; // a stored print file could not be decoded

export class MockupRejectedError extends Error {
  readonly code: MockupRejectCode;
  constructor(code: MockupRejectCode) {
    super(code);
    this.code = code;
    this.name = "MockupRejectedError";
  }
}

// Stable panel order: front-of-product first.
const PLACEMENT_ORDER: PlacementCode[] = [
  "FRONT",
  "WRAP",
  "FULL",
  "BACK",
  "LEFT_SLEEVE",
  "RIGHT_SLEEVE",
];

const escapeXml = (s: string): string =>
  s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Pixel box of the print area inside a panel: aspect ratio kept, centred. */
export function printAreaBox(width_mm: number, height_mm: number) {
  const scale = AREA_MAX_PX / Math.max(width_mm, height_mm);
  const w = Math.max(1, Math.round(width_mm * scale));
  const h = Math.max(1, Math.round(height_mm * scale));
  return {
    width: w,
    height: h,
    left: Math.round((PANEL_PX - w) / 2),
    top: Math.round((PANEL_PX - h) / 2),
  };
}

/** The [PLACEHOLDER] backdrop for one placement (SVG → no binary assets). */
function backdropSvg(
  box: { width: number; height: number; left: number; top: number },
  productSlug: string,
  placement: PlacementCode
): Buffer {
  const label = escapeXml(`[PLACEHOLDER] ${productSlug} - ${placement}`);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_PX}" height="${PANEL_PX}">` +
      `<rect width="${PANEL_PX}" height="${PANEL_PX}" fill="#eef0f3"/>` +
      `<rect x="40" y="40" width="${PANEL_PX - 80}" height="${PANEL_PX - 80}" rx="28" fill="#ffffff" stroke="#c9ced6" stroke-width="3"/>` +
      `<rect x="${box.left - 2}" y="${box.top - 2}" width="${box.width + 4}" height="${box.height + 4}" fill="none" stroke="#9aa3af" stroke-width="2" stroke-dasharray="8 6"/>` +
      `<text x="${PANEL_PX / 2}" y="${PANEL_PX - 60}" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#6b7280">${label}</text>` +
      `</svg>`
  );
}

/** Render one panel: backdrop + the print file scaled into the print area. */
export async function renderPanel(input: {
  printFile: Buffer;
  width_mm: number;
  height_mm: number;
  productSlug: string;
  placement: PlacementCode;
}): Promise<Buffer> {
  const box = printAreaBox(input.width_mm, input.height_mm);
  const art = await sharp(input.printFile)
    .resize(box.width, box.height, { fit: "fill" })
    .png()
    .toBuffer();
  return sharp(backdropSvg(box, input.productSlug, input.placement))
    .composite([{ input: art, left: box.left, top: box.top }])
    .png()
    .toBuffer();
}

/** Join panels left-to-right into one PNG. */
async function joinPanels(panels: Buffer[]): Promise<Buffer> {
  if (panels.length === 1) return panels[0];
  return sharp({
    create: {
      width: PANEL_PX * panels.length,
      height: PANEL_PX,
      channels: 3,
      background: { r: 238, g: 240, b: 243 },
    },
  })
    .composite(panels.map((input, i) => ({ input, left: i * PANEL_PX, top: 0 })))
    .png()
    .toBuffer();
}

/**
 * Generate (or regenerate — revisions are free and unlimited, data model §2) the
 * mockup for one of the merchant's designs and store it as design.mockup_url.
 *
 *  1. ownership — design must belong to merchantId (else design_not_found)
 *  2. lock      — an approved mockup is immutable (mockup_locked)
 *  3. sources   — only PASSED placements with a print file are rendered
 *  4. render    — bytes read back from the store; never client claims
 *  5. store     — PrintFileStore.put, then persist the reference
 */
export async function generateMockup(input: {
  merchantId: string;
  designId: string;
  store: PrintFileStore;
}): Promise<{ mockupUrl: string; panels: number }> {
  const { merchantId, designId, store } = input;

  const design = await prisma.design.findFirst({
    where: { id: designId, merchantId },
    select: {
      id: true,
      mockup_approved_at: true,
      productType: {
        select: {
          slug: true,
          printAreas: { select: { placement: true, width_mm: true, height_mm: true } },
        },
      },
      placements: {
        where: { validation_status: "PASSED" },
        select: { placement: true, print_file_url: true },
      },
    },
  });
  if (!design) throw new MockupRejectedError("design_not_found");
  if (design.mockup_approved_at) throw new MockupRejectedError("mockup_locked");

  const areas = new Map(design.productType.printAreas.map((a) => [a.placement, a]));
  const sources = design.placements
    .filter((p) => p.print_file_url && areas.has(p.placement))
    .sort(
      (a, b) =>
        PLACEMENT_ORDER.indexOf(a.placement) - PLACEMENT_ORDER.indexOf(b.placement)
    )
    .slice(0, MAX_PANELS);
  if (sources.length === 0) throw new MockupRejectedError("nothing_to_render");

  let png: Buffer;
  try {
    const panels: Buffer[] = [];
    for (const s of sources) {
      const area = areas.get(s.placement)!;
      panels.push(
        await renderPanel({
          printFile: await store.readBytes(s.print_file_url),
          width_mm: area.width_mm,
          height_mm: area.height_mm,
          productSlug: design.productType.slug,
          placement: s.placement,
        })
      );
    }
    png = await joinPanels(panels);
  } catch (e) {
    console.error("generateMockup render failed:", e);
    throw new MockupRejectedError("render_failed");
  }

  const stored = await store.put({
    buffer: png,
    filename: `mockup-${design.id}.png`,
    contentType: "image/png",
  });

  // Write under the Design row lock (the same lock persistPlacement takes) and
  // re-check both that the design is still unapproved AND that its PASSED print
  // files are still exactly the ones rendered — otherwise an upload/approval
  // landing mid-render could leave (or lock in) a mockup that doesn't match.
  await prisma.$transaction(async (tx) => {
    const updated = await tx.design.updateMany({
      where: { id: design.id, merchantId, mockup_approved_at: null },
      data: { mockup_url: stored.url },
    });
    if (updated.count === 0) throw new MockupRejectedError("mockup_locked");
    const current = await tx.designPlacement.findMany({
      where: { designId: design.id, validation_status: "PASSED" },
      select: { placement: true, print_file_url: true },
    });
    const key = (r: { placement: string; print_file_url: string | null }) =>
      `${r.placement}=${r.print_file_url}`;
    const eligible = current.filter((c) => c.print_file_url && areas.has(c.placement));
    const same =
      Math.min(eligible.length, MAX_PANELS) === sources.length &&
      sources.every((r) => eligible.some((c) => key(c) === key(r)));
    if (!same) throw new MockupRejectedError("render_failed");
  });

  return { mockupUrl: stored.url, panels: sources.length };
}

/**
 * Merchant approves the design's mockup — the timestamped lock on design intent
 * (data model §2, §4). After this the design's print files are immutable
 * (uploadPlacement / finalizePlacementUpload → design_locked) and the mockup
 * cannot be regenerated; changing anything needs a NEW design.
 *
 *  1. ownership — design must belong to merchantId (else design_not_found)
 *  2. already approved → mockup_locked
 *  3. a current mockup must exist (any file change clears it → no_mockup)
 *  4. every placement must be PASSED (not_orderable) — otherwise a FLAGGED
 *     file would be locked in forever
 *  5. stamp mockup_approved_at with a conditional write on the exact mockup
 *     that was read, so a concurrent upload/regenerate cannot be approved stale
 */
export async function approveMockup(input: {
  merchantId: string;
  designId: string;
}): Promise<{ approvedAt: Date }> {
  const { merchantId, designId } = input;

  const design = await prisma.design.findFirst({
    where: { id: designId, merchantId },
    select: {
      id: true,
      mockup_url: true,
      mockup_approved_at: true,
      placements: { select: { validation_status: true } },
    },
  });
  if (!design) throw new MockupRejectedError("design_not_found");
  if (design.mockup_approved_at) throw new MockupRejectedError("mockup_locked");
  if (!design.mockup_url) throw new MockupRejectedError("no_mockup");
  if (!isDesignOrderable(design.placements)) {
    throw new MockupRejectedError("not_orderable");
  }

  const approvedAt = new Date();
  const updated = await prisma.design.updateMany({
    where: {
      id: design.id,
      merchantId,
      mockup_approved_at: null,
      mockup_url: design.mockup_url,
    },
    data: { mockup_approved_at: approvedAt },
  });
  if (updated.count === 0) {
    // Lost a race: either someone approved it, or the mockup changed under us.
    const now = await prisma.design.findFirst({
      where: { id: design.id, merchantId },
      select: { mockup_approved_at: true },
    });
    throw new MockupRejectedError(now?.mockup_approved_at ? "mockup_locked" : "no_mockup");
  }
  return { approvedAt };
}

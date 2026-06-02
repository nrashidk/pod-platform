// Throwaway smoke test for validatePrintFile against the T-Shirt FRONT and
// Mug WRAP specs. DB-free and deterministic: specs are inline constants that
// MIRROR prisma/seed.mjs, and sample images are generated in-memory with sharp
// (no committed binary fixtures, no Date/random).
//
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/print-validation-smoke.ts
import sharp from "sharp";
import {
  validatePrintFile,
  toDesignPlacementValidation,
  type PrintAreaSpec,
} from "../src/lib/print-file-validation.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";

// ── Specs — mirror prisma/seed.mjs PrintArea rows (kept in sync by hand) ──
// T-Shirt FRONT: 305×406mm, 150 DPI min, PNG only, DTG transparency required.
const TSHIRT_FRONT: PrintAreaSpec = {
  placement: "FRONT",
  width_mm: 305,
  height_mm: 406,
  min_dpi: 150,
  recommended_dpi: 300,
  allowed_formats: ["PNG"],
  color_profile: "sRGB",
  requires_transparency: true,
  max_file_mb: 200,
};
// Mug WRAP: 203×95mm, 300 DPI min, PNG/JPEG, no transparency requirement.
const MUG_WRAP: PrintAreaSpec = {
  placement: "WRAP",
  width_mm: 203,
  height_mm: 95,
  min_dpi: 300,
  recommended_dpi: 300,
  allowed_formats: ["PNG", "JPEG"],
  color_profile: "sRGB",
  requires_transparency: false,
  max_file_mb: 100,
};

// ── In-memory image generation ──
type ImgOpts = {
  width: number;
  height: number;
  format: "PNG" | "JPEG" | "GIF";
  alpha: boolean;
  density: number;
};

async function makeImage(o: ImgOpts): Promise<Buffer> {
  const channels = o.alpha ? 4 : 3;
  const background = o.alpha
    ? { r: 12, g: 80, b: 140, alpha: 1 }
    : { r: 12, g: 80, b: 140 };
  const img = sharp({
    create: { width: o.width, height: o.height, channels, background },
  }).withMetadata({ density: o.density });

  if (o.format === "PNG") return img.png().toBuffer();
  if (o.format === "JPEG") return img.jpeg().toBuffer();
  return img.gif().toBuffer();
}

type Case = {
  label: string;
  spec: PrintAreaSpec;
  img: ImgOpts;
  filename: string;
  expect: "PASSED" | "FLAGGED";
};

const cases: Case[] = [
  {
    label: "T-Shirt FRONT — good PNG, alpha, 300 DPI",
    spec: TSHIRT_FRONT,
    img: { width: 1850, height: 2450, format: "PNG", alpha: true, density: 300 },
    filename: "tshirt-front-good.png",
    expect: "PASSED",
  },
  {
    label: "T-Shirt FRONT — low-res PNG @ 96 DPI",
    spec: TSHIRT_FRONT,
    img: { width: 600, height: 800, format: "PNG", alpha: true, density: 96 },
    filename: "tshirt-front-lowres.png",
    expect: "FLAGGED",
  },
  {
    label: "T-Shirt FRONT — opaque PNG (no alpha)",
    spec: TSHIRT_FRONT,
    img: { width: 1850, height: 2450, format: "PNG", alpha: false, density: 300 },
    filename: "tshirt-front-opaque.png",
    expect: "FLAGGED",
  },
  {
    label: "Mug WRAP — good JPEG, 300 DPI",
    spec: MUG_WRAP,
    img: { width: 2500, height: 1200, format: "JPEG", alpha: false, density: 300 },
    filename: "mug-wrap-good.jpg",
    expect: "PASSED",
  },
  {
    label: "Mug WRAP — GIF (format not allowed)",
    spec: MUG_WRAP,
    img: { width: 2500, height: 1200, format: "GIF", alpha: false, density: 300 },
    filename: "mug-wrap-wrong-format.gif",
    expect: "FLAGGED",
  },
  {
    label: "Mug WRAP — tiny JPEG @ 96 DPI",
    spec: MUG_WRAP,
    img: { width: 800, height: 400, format: "JPEG", alpha: false, density: 96 },
    filename: "mug-wrap-tiny.jpg",
    expect: "FLAGGED",
  },
];

const CONTENT_TYPE: Record<ImgOpts["format"], string> = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
};

async function main() {
  const store = new StubPrintFileStore();
  let pass = 0;

  for (const c of cases) {
    const buffer = await makeImage(c.img);

    // Storage seam: persist the reference (stub — no bytes written anywhere).
    const stored = await store.put({
      buffer,
      filename: c.filename,
      contentType: CONTENT_TYPE[c.img.format],
    });

    const result = await validatePrintFile({ buffer, filename: c.filename }, c.spec);
    const mapped = toDesignPlacementValidation(result);
    const ok = result.status === c.expect;
    if (ok) pass++;

    console.log(`\n■ ${c.label}`);
    console.log(`  stored:  ${stored.url} (${result.read.file_mb}MB, not persisted)`);
    console.log(
      `  read:    ${result.read.format} ${result.read.width_px}×${result.read.height_px}px, ` +
        `tag ${result.read.density_dpi}dpi, effective ${result.read.effective_dpi_w}×${result.read.effective_dpi_h}dpi, ` +
        `alpha=${result.read.has_alpha}, space=${result.read.color_space}`
    );
    console.log(`  expect:  ${c.expect}`);
    console.log(`  result:  ${result.status} ${ok ? "✓" : "✗ MISMATCH"}`);
    if (result.reasons.length) {
      result.reasons.forEach((r) => console.log(`            - ${r}`));
    }
    console.log(
      `  → DesignPlacement: validation_status=${mapped.validation_status}, ` +
        `validation_notes=${mapped.validation_notes ?? "null"}`
    );
  }

  console.log(`\n${pass}/${cases.length} cases matched expectation.`);
  if (pass !== cases.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

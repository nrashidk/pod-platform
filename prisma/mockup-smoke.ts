// Smoke for the mockup generator (src/lib/mockup.ts, queue 14). StubPrintFileStore
// only — never real Blob. Print files are generated in-memory with sharp.
//
// Asserts:
//   • no PASSED placement          → nothing_to_render (mockup_url stays null)
//   • PASSED FRONT                 → mockup stored: one 600x600 panel, the design
//                                    drawn inside the print area, [PLACEHOLDER]
//                                    backdrop outside it
//   • FLAGGED placements are NOT rendered (only PASSED ones become panels)
//   • FRONT + BACK PASSED          → two panels (1200 wide)
//   • regenerate is allowed until approved (free, unlimited revisions)
//   • approved mockup              → mockup_locked, mockup_url unchanged
//   • another merchant's design    → design_not_found
//
// Idempotent. Assumes `npm run db:seed`. Run: npm run test:mockup
import sharp from "sharp";
import { createDesign, uploadPlacement, type UploadFile } from "../src/lib/designs.ts";
import { generateMockup, MockupRejectedError, PANEL_PX, printAreaBox } from "../src/lib/mockup.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
import { prisma } from "../src/lib/prisma.ts";

const EMAIL_A = "mockup-a@test.local";
const EMAIL_B = "mockup-b@test.local";

async function cleanup() {
  await prisma.design.deleteMany({ where: { name: { startsWith: "MOCKUP " } } });
  await prisma.merchant.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
}

async function png(alpha: boolean): Promise<UploadFile> {
  const buffer = await sharp({
    create: {
      width: 1850,
      height: 2450,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 12, g: 80, b: 140, alpha: 1 } : { r: 12, g: 80, b: 140 },
    },
  })
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
  return { buffer, filename: "art.png", contentType: "image/png", size: buffer.length };
}

const checks: Array<[string, boolean]> = [];
const check = (label: string, pass: boolean) => checks.push([label, pass]);

async function rejectCode(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof MockupRejectedError ? e.code : `other:${String(e)}`;
  }
}

async function main() {
  await cleanup();
  const store = new StubPrintFileStore();
  const merchantA = await prisma.merchant.create({ data: { name: "MOCKUP Merchant A", email: EMAIL_A } });
  const merchantB = await prisma.merchant.create({ data: { name: "MOCKUP Merchant B", email: EMAIL_B } });
  const tee = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
    include: { printAreas: true },
  });
  const upload = async (designId: string, placement: "FRONT" | "BACK", alpha: boolean) =>
    uploadPlacement({ merchantId: merchantA.id, designId, placement, file: await png(alpha), store });

  // (1) No placements → nothing to render.
  const d = await createDesign({ merchantId: merchantA.id, name: "MOCKUP One", productTypeId: tee.id });
  check("no placements → nothing_to_render", (await rejectCode(generateMockup({ merchantId: merchantA.id, designId: d.id, store }))) === "nothing_to_render");

  // (2) Only a FLAGGED placement (opaque, transparency required) → still nothing.
  check("opaque BACK → FLAGGED", (await upload(d.id, "BACK", false)).status === "FLAGGED");
  check("only FLAGGED → nothing_to_render", (await rejectCode(generateMockup({ merchantId: merchantA.id, designId: d.id, store }))) === "nothing_to_render");

  // (3) PASSED FRONT + FLAGGED BACK → one panel.
  check("FRONT → PASSED", (await upload(d.id, "FRONT", true)).status === "PASSED");
  const res = await generateMockup({ merchantId: merchantA.id, designId: d.id, store });
  check("FLAGGED placement not rendered → 1 panel", res.panels === 1);
  const row = await prisma.design.findUniqueOrThrow({ where: { id: d.id } });
  check("mockup_url persisted", row.mockup_url === res.mockupUrl && !!row.mockup_url);
  const img = sharp(await store.readBytes(row.mockup_url!));
  const meta = await img.metadata();
  check("mockup is a 600x600 PNG", meta.format === "png" && meta.width === PANEL_PX && meta.height === PANEL_PX);
  const front = tee.printAreas.find((a) => a.placement === "FRONT")!;
  const box = printAreaBox(front.width_mm, front.height_mm);
  const px = async (x: number, y: number) => {
    const { data } = await sharp(await store.readBytes(row.mockup_url!))
      .extract({ left: x, top: y, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return [data[0], data[1], data[2]];
  };
  const centre = await px(PANEL_PX / 2, PANEL_PX / 2);
  check("design colour drawn inside the print area", centre[0] === 12 && centre[1] === 80 && centre[2] === 140);
  const corner = await px(2, 2);
  check("[PLACEHOLDER] backdrop outside the print area", corner[0] === 238 && corner[1] === 240 && corner[2] === 243);
  check("print area fits inside the panel", box.left >= 0 && box.top >= 0 && box.left + box.width <= PANEL_PX);

  // (4) Fix BACK → regenerate (allowed) → two panels.
  check("re-upload BACK → PASSED", (await upload(d.id, "BACK", true)).status === "PASSED");
  const res2 = await generateMockup({ merchantId: merchantA.id, designId: d.id, store });
  const meta2 = await sharp(await store.readBytes(res2.mockupUrl)).metadata();
  check("FRONT+BACK → 2 panels, 1200 wide", res2.panels === 2 && meta2.width === PANEL_PX * 2);

  // (5) Another merchant cannot generate for this design.
  check("foreign merchant → design_not_found", (await rejectCode(generateMockup({ merchantId: merchantB.id, designId: d.id, store }))) === "design_not_found");

  // (6) Approved mockup is locked; url unchanged.
  await prisma.design.update({ where: { id: d.id }, data: { mockup_approved_at: new Date() } });
  const before = (await prisma.design.findUniqueOrThrow({ where: { id: d.id } })).mockup_url;
  check("approved → mockup_locked", (await rejectCode(generateMockup({ merchantId: merchantA.id, designId: d.id, store }))) === "mockup_locked");
  const after = (await prisma.design.findUniqueOrThrow({ where: { id: d.id } })).mockup_url;
  check("locked mockup_url unchanged", before === after);

  // (7) Approval landing DURING the render (after the pre-check, before the
  // write) must not be overwritten: a store whose put() approves the design.
  const d2 = await createDesign({ merchantId: merchantA.id, name: "MOCKUP Race", productTypeId: tee.id });
  await upload(d2.id, "FRONT", true);
  const racing = Object.create(store) as StubPrintFileStore;
  racing.put = async (f) => {
    await prisma.design.update({ where: { id: d2.id }, data: { mockup_approved_at: new Date() } });
    return store.put(f);
  };
  check("approval mid-render → mockup_locked", (await rejectCode(generateMockup({ merchantId: merchantA.id, designId: d2.id, store: racing }))) === "mockup_locked");
  check("mid-render approval leaves mockup_url null", (await prisma.design.findUniqueOrThrow({ where: { id: d2.id } })).mockup_url === null);

  // (8) A stored print file that can't be decoded → render_failed, no url.
  const d3 = await createDesign({ merchantId: merchantA.id, name: "MOCKUP Broken", productTypeId: tee.id });
  await upload(d3.id, "FRONT", true);
  const broken = Object.create(store) as StubPrintFileStore;
  broken.readBytes = async () => Buffer.from("not an image");
  check("undecodable file → render_failed", (await rejectCode(generateMockup({ merchantId: merchantA.id, designId: d3.id, store: broken }))) === "render_failed");
  check("render_failed leaves mockup_url null", (await prisma.design.findUniqueOrThrow({ where: { id: d3.id } })).mockup_url === null);

  await cleanup();
  let failed = 0;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
    if (!pass) failed++;
  }
  await prisma.$disconnect();
  if (failed) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  }
  console.log(`\nAll ${checks.length} mockup checks passed`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});

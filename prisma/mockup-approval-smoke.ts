// Smoke for mockup approval + lock (src/lib/mockup.ts approveMockup and the
// design_locked guard in src/lib/designs.ts, queue 14b). StubPrintFileStore only.
//
// Asserts:
//   • no mockup yet                   → no_mockup
//   • foreign merchant                → design_not_found
//   • a FLAGGED placement present     → not_orderable (never lock a bad file)
//   • re-uploading any file after generating clears the stale mockup (no_mockup)
//   • approve stamps mockup_approved_at once; a second approve → mockup_locked
//   • approved: uploadPlacement AND finalizePlacementUpload → design_locked and
//     the placement row + mockup_url are unchanged; regenerate → mockup_locked
//   • approval racing an upload: never ends with an approved design whose files
//     changed after the approved mockup was made
//
// Idempotent. Assumes `npm run db:seed`. Run: npm run test:mockup-approval
import sharp from "sharp";
import {
  createDesign,
  finalizePlacementUpload,
  uploadPlacement,
  UploadRejectedError,
  type UploadFile,
} from "../src/lib/designs.ts";
import { approveMockup, generateMockup, MockupRejectedError } from "../src/lib/mockup.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
import { prisma } from "../src/lib/prisma.ts";

const EMAIL_A = "mockup-appr-a@test.local";
const EMAIL_B = "mockup-appr-b@test.local";

async function cleanup() {
  await prisma.design.deleteMany({ where: { name: { startsWith: "APPROVE " } } });
  await prisma.merchant.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
}

async function png(alpha: boolean, r = 12): Promise<UploadFile> {
  const buffer = await sharp({
    create: {
      width: 1850,
      height: 2450,
      channels: alpha ? 4 : 3,
      background: alpha ? { r, g: 80, b: 140, alpha: 1 } : { r, g: 80, b: 140 },
    },
  })
    .withMetadata({ density: 300 })
    .png()
    .toBuffer();
  return { buffer, filename: `art-${r}.png`, contentType: "image/png", size: buffer.length };
}

const checks: Array<[string, boolean]> = [];
const check = (label: string, pass: boolean) => checks.push([label, pass]);

async function code(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (e instanceof MockupRejectedError || e instanceof UploadRejectedError) return e.code;
    return `other:${String(e)}`;
  }
}

async function main() {
  await cleanup();
  const store = new StubPrintFileStore();
  const a = await prisma.merchant.create({ data: { name: "APPROVE Merchant A", email: EMAIL_A } });
  const b = await prisma.merchant.create({ data: { name: "APPROVE Merchant B", email: EMAIL_B } });
  const tee = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const up = async (designId: string, placement: "FRONT" | "BACK", alpha = true, r = 12) =>
    uploadPlacement({ merchantId: a.id, designId, placement, file: await png(alpha, r), store });
  const approve = (designId: string, merchantId = a.id) => approveMockup({ merchantId, designId });
  const gen = (designId: string) => generateMockup({ merchantId: a.id, designId, store });
  const row = (id: string) => prisma.design.findUniqueOrThrow({ where: { id }, include: { placements: true } });

  const d = await createDesign({ merchantId: a.id, name: "APPROVE One", productTypeId: tee.id });

  // (1) Nothing generated yet.
  check("no mockup → no_mockup", (await code(approve(d.id))) === "no_mockup");
  await up(d.id, "FRONT");
  check("files but no mockup → no_mockup", (await code(approve(d.id))) === "no_mockup");
  check("foreign merchant → design_not_found", (await code(approve(d.id, b.id))) === "design_not_found");

  // (2) A FLAGGED placement blocks approval (it would be locked in forever).
  await gen(d.id);
  check("BACK opaque → FLAGGED", (await up(d.id, "BACK", false)).status === "FLAGGED");
  check("changing a file clears the stale mockup", (await row(d.id)).mockup_url === null);
  await gen(d.id); // FRONT is PASSED, so a mockup can be built from it
  check("FLAGGED placement → not_orderable", (await code(approve(d.id))) === "not_orderable");
  check("BACK fixed → PASSED", (await up(d.id, "BACK", true)).status === "PASSED");
  check("fixing BACK cleared the mockup again", (await code(approve(d.id))) === "no_mockup");

  // (3) Happy path.
  const res = await gen(d.id);
  const frontBefore = (await row(d.id)).placements.find((p) => p.placement === "FRONT")!;
  const ok = await approve(d.id);
  const approved = await row(d.id);
  check("approve stamps mockup_approved_at", approved.mockup_approved_at !== null && Math.abs(approved.mockup_approved_at.getTime() - ok.approvedAt.getTime()) < 1000);
  check("approval keeps the mockup", approved.mockup_url === res.mockupUrl);
  check("second approve → mockup_locked", (await code(approve(d.id))) === "mockup_locked");
  check("approved timestamp unchanged by 2nd approve", (await row(d.id)).mockup_approved_at?.getTime() === approved.mockup_approved_at?.getTime());

  // (4) Locked: uploads (both paths), regenerate.
  check("upload after approval → design_locked", (await code(up(d.id, "FRONT", true, 99))) === "design_locked");
  const put = await store.put({ buffer: (await png(true, 77)).buffer, filename: "late.png", contentType: "image/png" });
  check(
    "finalize after approval → design_locked",
    (await code(finalizePlacementUpload({ merchantId: a.id, designId: d.id, placement: "FRONT", blobUrl: put.url, store }))) === "design_locked"
  );
  check("regenerate after approval → mockup_locked", (await code(gen(d.id))) === "mockup_locked");
  const after = await row(d.id);
  const frontAfter = after.placements.find((p) => p.placement === "FRONT")!;
  check("locked placement row unchanged", frontAfter.print_file_url === frontBefore.print_file_url && frontAfter.validation_status === "PASSED");
  check("locked mockup_url unchanged", after.mockup_url === res.mockupUrl);

  // (5) Race: approval vs a replacing upload. Whatever wins, an approved design
  // must still hold exactly the file its mockup was built from.
  const d2 = await createDesign({ merchantId: a.id, name: "APPROVE Race", productTypeId: tee.id });
  await up(d2.id, "FRONT");
  await gen(d2.id);
  const original = (await row(d2.id)).placements[0].print_file_url;
  const [approveRes, uploadRes] = await Promise.allSettled([approve(d2.id), up(d2.id, "FRONT", true, 55)]);
  const fin = await row(d2.id);
  const front = fin.placements.find((p) => p.placement === "FRONT")!;
  const approvedNow = fin.mockup_approved_at !== null;
  check(
    "race: approved ⇒ upload rejected and file untouched; else upload won and mockup cleared",
    approvedNow
      ? approveRes.status === "fulfilled" && uploadRes.status === "rejected" && front.print_file_url === original
      : approveRes.status === "rejected" && fin.mockup_url === null
  );

  // (6) Generate racing a replacing upload: the file changes during the render,
  // so the finished mockup is stale and must NOT be stored/approvable.
  const d3 = await createDesign({ merchantId: a.id, name: "APPROVE Stale", productTypeId: tee.id });
  await up(d3.id, "FRONT");
  const racing = Object.create(store) as StubPrintFileStore;
  racing.put = async (f) => {
    await up(d3.id, "FRONT", true, 33);
    return store.put(f);
  };
  check(
    "file replaced mid-render → generate refuses",
    (await code(generateMockup({ merchantId: a.id, designId: d3.id, store: racing }))) === "render_failed"
  );
  check("stale mockup never stored", (await row(d3.id)).mockup_url === null);
  check("stale mockup cannot be approved", (await code(approve(d3.id))) === "no_mockup");
  await gen(d3.id);
  check("regenerate after the change → approvable", (await code(approve(d3.id))) === null);

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
  console.log(`\nAll ${checks.length} mockup-approval checks passed`);
}

main().catch(async (e) => {
  console.error(e);
  await cleanup().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

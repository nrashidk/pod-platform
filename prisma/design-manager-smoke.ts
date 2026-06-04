// Throwaway smoke for the merchant design manager (src/lib/designs +
// orderability gate in src/lib/api-orders). Drives the PURE engine directly —
// the server actions are a thin shell over these — so the whole flow is
// exercised without a running server, exactly like the other src/lib smokes.
//
// Crucially uses StubPrintFileStore DIRECTLY: NO test ever touches real Vercel
// Blob. Sample print files are generated in-memory with sharp (no committed
// binaries, no Date/random).
//
// Asserts:
//   • upload a PASSING PNG          → DesignPlacement PASSED; design orderable
//   • upload a FLAGGED PNG          → PLACEMENT FLAGGED with reasons; NOT orderable
//   • re-upload a good file over it  → flips to PASSED; orderable again
//   • orderability gate (order API): FLAGGED design   → 422 invalid_design
//                                     placement-less   → 422 invalid_design
//                                     fully-PASSED      → 201 created
//   • ownership: merchant A cannot SEE or ATTACH merchant B's design
//
// Idempotent: wipes its own fixtures first. Assumes `npm run db:seed`.
// Run: npm run test:design-manager
import sharp from "sharp";
import {
  createDesign,
  uploadPlacement,
  finalizePlacementUpload,
  listMyDesigns,
  getDesignOrderability,
  UploadRejectedError,
  type UploadFile,
} from "../src/lib/designs.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
import { apiCreateOrder } from "../src/lib/api-orders.ts";
import { generateApiKey } from "../src/lib/api-auth.ts";
import { prisma } from "../src/lib/prisma.ts";

const EMAIL_A = "design-mgr-a@test.local";
const EMAIL_B = "design-mgr-b@test.local";

async function cleanup() {
  for (const email of [EMAIL_A, EMAIL_B]) {
    const merchant = await prisma.merchant.findUnique({ where: { email } });
    if (!merchant) continue;
    const orders = await prisma.order.findMany({
      where: { merchantId: merchant.id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length) {
      await prisma.printerLedgerEntry.deleteMany({
        where: { reason: { in: orderIds.map((id) => `WHOLESALE_OWED order:${id}`) } },
      });
    }
    await prisma.wallet.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.order.deleteMany({ where: { merchantId: merchant.id } });
  }
  // Prefix "DESIGNMGR " / "[DESIGNMGR]" is unique to this suite, so it never
  // deletes another suite's fixtures (DesignPlacement cascades on Design delete).
  await prisma.design.deleteMany({ where: { name: { startsWith: "DESIGNMGR " } } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[DESIGNMGR]" } } });
  await prisma.merchant.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
}

// ── In-memory image generation (mirrors print-validation-smoke). ──
type ImgOpts = { width: number; height: number; alpha: boolean; density: number };
async function makePng(o: ImgOpts): Promise<Buffer> {
  const channels = o.alpha ? 4 : 3;
  const background = o.alpha
    ? { r: 12, g: 80, b: 140, alpha: 1 }
    : { r: 12, g: 80, b: 140 };
  return sharp({ create: { width: o.width, height: o.height, channels, background } })
    .withMetadata({ density: o.density })
    .png()
    .toBuffer();
}
async function pngFile(name: string, o: ImgOpts): Promise<UploadFile> {
  const buffer = await makePng(o);
  return { buffer, filename: name, contentType: "image/png", size: buffer.length };
}

const checks: Array<[string, boolean]> = [];
const check = (label: string, pass: boolean) => checks.push([label, pass]);
const body = (o: unknown) => JSON.stringify(o);

async function main() {
  await cleanup();
  const store = new StubPrintFileStore();

  // ── Fixtures: two merchants, an API key for A, a DTG-capable tee. ──
  const merchantA = await prisma.merchant.create({
    data: { name: "DESIGNMGR Merchant A", is_platform_owner: true, email: EMAIL_A },
  });
  const merchantB = await prisma.merchant.create({
    data: { name: "DESIGNMGR Merchant B", email: EMAIL_B },
  });

  const keyA = generateApiKey();
  await prisma.merchantApiKey.create({
    data: {
      merchantId: merchantA.id,
      name: "smoke",
      token_hash: keyA.token_hash,
      token_prefix: keyA.token_prefix,
      last4: keyA.last4,
    },
  });
  const AUTH_A = `Bearer ${keyA.token}`;

  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[DESIGNMGR] Tee",
      name_ar: "[DESIGNMGR] تي شيرت",
      retail_price: 79.0,
      variants: { create: { sku: "DESIGNMGR-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });

  // tshirt FRONT/BACK spec: PNG only, 150 DPI min, transparency required.
  const good: ImgOpts = { width: 1850, height: 2450, alpha: true, density: 300 };
  const opaque: ImgOpts = { width: 1850, height: 2450, alpha: false, density: 300 };

  // ── (1) Create a design + upload a PASSING front file. ──
  const d1 = await createDesign({
    merchantId: merchantA.id,
    name: "DESIGNMGR Passing",
    productTypeId: tshirtType.id,
  });
  const frontRes = await uploadPlacement({
    merchantId: merchantA.id,
    designId: d1.id,
    placement: "FRONT",
    file: await pngFile("front.png", good),
    store,
  });
  check("FRONT good PNG → PASSED", frontRes.status === "PASSED");
  check("FRONT PASSED has no reasons", frontRes.reasons.length === 0);

  let view1 = (await listMyDesigns(merchantA.id)).find((d) => d.id === d1.id)!;
  check("single PASSED placement → design orderable", view1.orderable === true);

  // ── (2) Upload a FLAGGED back file (opaque → transparency required). ──
  const backBad = await uploadPlacement({
    merchantId: merchantA.id,
    designId: d1.id,
    placement: "BACK",
    file: await pngFile("back-opaque.png", opaque),
    store,
  });
  check("BACK opaque PNG → FLAGGED", backBad.status === "FLAGGED");
  check("FLAGGED placement carries reasons", backBad.reasons.length > 0);

  view1 = (await listMyDesigns(merchantA.id)).find((d) => d.id === d1.id)!;
  check("design with a FLAGGED placement → NOT orderable", view1.orderable === false);
  const backView = view1.placements.find((p) => p.placement === "BACK")!;
  check("FLAGGED reasons persisted on the row", (backView.notes ?? "").length > 0);

  // ── (3) Re-upload a good file over the FLAGGED placement → flips to PASSED. ──
  const backFixed = await uploadPlacement({
    merchantId: merchantA.id,
    designId: d1.id,
    placement: "BACK",
    file: await pngFile("back-good.png", good),
    store,
  });
  check("re-upload good over FLAGGED → PASSED", backFixed.status === "PASSED");
  view1 = (await listMyDesigns(merchantA.id)).find((d) => d.id === d1.id)!;
  check("all placements PASSED → orderable again", view1.orderable === true);

  // ── (3b) CLIENT-UPLOAD finalize path: bytes are ALREADY in the store (the
  // browser uploaded them direct); finalizePlacementUpload reads them BACK from
  // storage and validates the actual bytes — never a client claim. Modeled here
  // by store.put() (stand-in for the direct upload) then finalize on its URL. ──
  const dFin = await createDesign({
    merchantId: merchantA.id,
    name: "DESIGNMGR Finalize",
    productTypeId: tshirtType.id,
  });
  const goodStored = await store.put({
    buffer: await makePng(good),
    filename: "front-final.png",
    contentType: "image/png",
  });
  const finGood = await finalizePlacementUpload({
    merchantId: merchantA.id,
    designId: dFin.id,
    placement: "FRONT",
    blobUrl: goodStored.url,
    store,
  });
  check("finalize: stored PASSING PNG → PASSED", finGood.status === "PASSED");

  // Opaque file in storage → FLAGGED (transparency reason) — proves the finalize
  // path validates the real stored bytes, not the content-type or any claim.
  const opaqueStored = await store.put({
    buffer: await makePng(opaque),
    filename: "back-final-opaque.png",
    contentType: "image/png",
  });
  const finFlagged = await finalizePlacementUpload({
    merchantId: merchantA.id,
    designId: dFin.id,
    placement: "BACK",
    blobUrl: opaqueStored.url,
    store,
  });
  check("finalize: stored opaque PNG → FLAGGED with reasons", finFlagged.status === "FLAGGED" && finFlagged.reasons.length > 0);

  // A URL that isn't a blob in our store is rejected before anything persists.
  let finMissing = false;
  try {
    await finalizePlacementUpload({
      merchantId: merchantA.id,
      designId: dFin.id,
      placement: "FRONT",
      blobUrl: "stub://print-files/never-uploaded.png",
      store,
    });
  } catch (e) {
    finMissing = e instanceof UploadRejectedError && e.code === "blob_missing";
  }
  check("finalize: URL not in our store → rejected (blob_missing)", finMissing);

  // ── (4) A FLAGGED-only design + a placement-less design (both NOT orderable). ──
  const d2 = await createDesign({
    merchantId: merchantA.id,
    name: "DESIGNMGR Flagged",
    productTypeId: tshirtType.id,
  });
  await uploadPlacement({
    merchantId: merchantA.id,
    designId: d2.id,
    placement: "FRONT",
    file: await pngFile("flagged-front.png", opaque),
    store,
  });
  const d3 = await createDesign({
    merchantId: merchantA.id,
    name: "DESIGNMGR Empty",
    productTypeId: tshirtType.id,
  });

  const orderability = await getDesignOrderability(merchantA.id, [d1.id, d2.id, d3.id]);
  check("orderability map: PASSED design owned+orderable", orderability.get(d1.id)?.orderable === true);
  check("orderability map: FLAGGED design owned, NOT orderable", orderability.get(d2.id)?.owned === true && orderability.get(d2.id)?.orderable === false);
  check("orderability map: empty design NOT orderable", orderability.get(d3.id)?.orderable === false);

  // ── (5) Order API enforces the gate. ──
  const recipient = { name: "Test Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" };
  const line = (designRef: string) => ({
    sku: "DESIGNMGR-TEE-M",
    method: "DTG",
    quantity: 2,
    design_ref: designRef,
  });

  const flaggedOrder = await apiCreateOrder(
    AUTH_A,
    body({ idempotency_key: "dm-flagged", recipient, lines: [line(d2.id)] })
  );
  check(
    "order API: FLAGGED design → 422 invalid_design",
    flaggedOrder.httpStatus === 422 && (flaggedOrder.body as any).error.code === "invalid_design"
  );

  const emptyOrder = await apiCreateOrder(
    AUTH_A,
    body({ idempotency_key: "dm-empty", recipient, lines: [line(d3.id)] })
  );
  check(
    "order API: placement-less design → 422 invalid_design",
    emptyOrder.httpStatus === 422 && (emptyOrder.body as any).error.code === "invalid_design"
  );

  const passedOrder = await apiCreateOrder(
    AUTH_A,
    body({ idempotency_key: "dm-passed", recipient, lines: [line(d1.id)] })
  );
  check("order API: fully-PASSED design → 201 created", passedOrder.httpStatus === 201);

  // ── (6) Ownership: A cannot SEE or ATTACH B's design. ──
  const dB = await createDesign({
    merchantId: merchantB.id,
    name: "DESIGNMGR B Secret",
    productTypeId: tshirtType.id,
  });
  await uploadPlacement({
    merchantId: merchantB.id,
    designId: dB.id,
    placement: "FRONT",
    file: await pngFile("b-front.png", good),
    store,
  });

  const aList = await listMyDesigns(merchantA.id);
  check("A's design list excludes B's design", !aList.some((d) => d.id === dB.id));

  let attachRejected = false;
  try {
    await uploadPlacement({
      merchantId: merchantA.id,
      designId: dB.id,
      placement: "BACK",
      file: await pngFile("a-steals-b.png", good),
      store,
    });
  } catch (e) {
    attachRejected = e instanceof UploadRejectedError && e.code === "design_not_found";
  }
  check("A uploading to B's design → rejected (design_not_found)", attachRejected);

  const ownB = await getDesignOrderability(merchantA.id, [dB.id]);
  check("A's orderability check treats B's design as not owned", ownB.get(dB.id)?.owned === false);

  const stealOrder = await apiCreateOrder(
    AUTH_A,
    body({ idempotency_key: "dm-steal", recipient, lines: [line(dB.id)] })
  );
  check(
    "order API: A ordering B's (even PASSED) design → 422 invalid_design",
    stealOrder.httpStatus === 422 && (stealOrder.body as any).error.code === "invalid_design"
  );

  // ── Report ──
  let passed = 0;
  console.log("\nAssertions:");
  for (const [label, ok] of checks) {
    console.log(`${ok ? "✅" : "❌"} ${label}`);
    if (ok) passed++;
  }
  console.log(`\n${passed}/${checks.length} checks passed.`);
  await cleanup();
  if (passed !== checks.length) {
    console.log("\n❌ FAIL — merchant design manager contract broken.");
    process.exit(1);
  }
  console.log("\n✅ PASS — upload→validate→persist, orderability gate, and ownership all hold.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

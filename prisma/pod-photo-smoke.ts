// Smoke test for the proof-of-delivery PHOTO (queue 11b): attach/replace only on
// a delivered shipment, byte-signature + size + empty checks, merchant-scoped
// signed link (stub store, never real Blob), text reference kept.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/pod-photo-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { advanceFulfillment } from "../src/lib/fulfillment.ts";
import {
  attachProofOfDeliveryPhoto,
  merchantPodPhotoUrl,
  PodPhotoInvalidError,
  POD_PHOTO_MAX_BYTES,
  podPhotoViewUrl,
  validatePodPhoto,
} from "../src/lib/proof-of-delivery-photo.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}
async function reason(fn: () => unknown): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof PodPhotoInvalidError ? e.reason : "other";
  }
}

const EMAIL = "pod-photo@test.local";
const OTHER = "pod-photo-other@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: { in: [EMAIL, OTHER] } } } });
  await prisma.design.deleteMany({ where: { merchant: { email: { in: [EMAIL, OTHER] } } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] POD Photo Tee" } });
  await prisma.merchant.deleteMany({ where: { email: { in: [EMAIL, OTHER] } } });
}

const jpg = (n = 100) => ({
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(Math.max(n - 3, 0), 1)]).subarray(0, n),
  filename: "pod.jpg",
  contentType: "image/jpeg",
});

async function main() {
  await cleanup();
  const store = new StubPrintFileStore();

  // ── Pure validation. ──
  check("valid JPEG passes", (await reason(() => validatePodPhoto(jpg()))) === null);
  check("empty refused", (await reason(() => validatePodPhoto(jpg(0)))) === "empty");
  check("oversize refused", (await reason(() => validatePodPhoto(jpg(POD_PHOTO_MAX_BYTES + 1)))) === "size");
  check("PDF content type refused", (await reason(() => validatePodPhoto({ ...jpg(), contentType: "application/pdf" }))) === "type");
  check(
    "bytes that are not the claimed image refused",
    (await reason(() => validatePodPhoto({ buffer: Buffer.from("<html>x</html>"), filename: "x.png", contentType: "image/png" }))) === "type"
  );

  // ── Fixture: a shipped (not yet delivered) fulfillment. ──
  const merchant = await prisma.merchant.create({ data: { name: "TEST POD Photo Merchant", email: EMAIL } });
  const other = await prisma.merchant.create({ data: { name: "TEST POD Photo Other", email: OTHER } });
  const type = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST POD Photo Design", productTypeId: type.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: type.id,
      name_en: "[TEST] POD Photo Tee",
      name_ar: "[تجريبي] تي شيرت صورة التسليم",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-PODP-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const order = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "POD Photo Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
    lines: [
      { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity: 2, unit_retail: 79.0 },
    ],
  });
  const f = order.fulfillments[0];
  await advanceFulfillment(f.id, "IN_PRODUCTION");
  await advanceFulfillment(f.id, "SHIPPED", { shipment: { carrier: "TEST Courier", trackingNumber: "TRK-P" } });

  check(
    "photo refused before delivery",
    (await reason(() => attachProofOfDeliveryPhoto(f.id, jpg(), store))) === "notDelivered"
  );

  await advanceFulfillment(f.id, "DELIVERED", { proofOfDelivery: "REF-PHOTO-1", requireProofOfDelivery: true });
  const ship = () => prisma.shipment.findFirstOrThrow({ where: { fulfillmentId: f.id } });
  check("no photo stored yet", (await ship()).proof_of_delivery_photo_url === null);

  // ── Attach, then replace. ──
  check("bad photo on a delivered shipment refused", (await reason(() => attachProofOfDeliveryPhoto(f.id, jpg(0), store))) === "empty");
  check("refusal stored nothing", (await ship()).proof_of_delivery_photo_url === null);

  await attachProofOfDeliveryPhoto(f.id, jpg(), store);
  const first = (await ship()).proof_of_delivery_photo_url;
  check("photo stored on the Shipment", !!first && first.startsWith("stub://"));
  check("text reference kept beside the photo", (await ship()).proof_of_delivery_url === "REF-PHOTO-1");

  await attachProofOfDeliveryPhoto(f.id, { ...jpg(), filename: "second.jpg" }, store);
  const second = (await ship()).proof_of_delivery_photo_url;
  check("photo can be replaced", !!second && second !== first);
  check("still one Shipment row", (await prisma.shipment.count({ where: { fulfillmentId: f.id } })) === 1);

  // ── Viewing: signed link only, merchant-scoped. ──
  check("ops view link is signed, not the raw URL", (await podPhotoViewUrl(second, store)) !== null);
  check("no photo → no link", (await podPhotoViewUrl(null, store)) === null);
  check("owning merchant gets a link", (await merchantPodPhotoUrl(merchant.id, f.id, store)) !== null);
  check("another merchant gets nothing", (await merchantPodPhotoUrl(other.id, f.id, store)) === null);
  check("unknown fulfillment gets nothing", (await merchantPodPhotoUrl(merchant.id, "nope", store)) === null);

  console.log(ok ? "\n✅ PASS — proof-of-delivery photo attached and scoped." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("POD-photo smoke failed:", e);
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });

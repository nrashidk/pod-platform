// Smoke test for proof of delivery (queue 11, data model §3/§4): the reference is
// trimmed/validated, recorded on the Shipment at DELIVERED (beside carrier +
// tracking, which are kept), and delivery still starts the 30-day claim window.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/proof-of-delivery-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import {
  advanceFulfillment,
  CLAIM_WINDOW_DAYS,
  parseProofOfDelivery,
  POD_REFERENCE_MAX,
} from "../src/lib/fulfillment.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

const EMAIL = "pod-check@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] POD Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();

  // ── Pure validation. ──
  check("trims a reference", parseProofOfDelivery("  AWB-123 signed  ") === "AWB-123 signed");
  check("empty is refused", parseProofOfDelivery("") === null);
  check("whitespace-only is refused", parseProofOfDelivery("   ") === null);
  check("non-string is refused", parseProofOfDelivery(null) === null && parseProofOfDelivery(42) === null);
  check("at the limit is accepted", parseProofOfDelivery("x".repeat(POD_REFERENCE_MAX)) !== null);
  check("over the limit is refused", parseProofOfDelivery("x".repeat(POD_REFERENCE_MAX + 1)) === null);

  // ── Engine: POD lands on the dispatch Shipment. ──
  const merchant = await prisma.merchant.create({
    data: { name: "TEST POD Merchant", email: EMAIL },
  });
  const tshirtType = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST POD Design", productTypeId: tshirtType.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[TEST] POD Tee",
      name_ar: "[تجريبي] تي شيرت",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-POD-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const order = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "POD Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
    lines: [
      { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity: 2, unit_retail: 79.0 },
    ],
  });
  const f = order.fulfillments[0];

  await advanceFulfillment(f.id, "IN_PRODUCTION");
  await advanceFulfillment(f.id, "SHIPPED", { shipment: { carrier: "TEST Courier", trackingNumber: "TRK-1" } });
  const before = await prisma.shipment.findFirstOrThrow({ where: { fulfillmentId: f.id } });
  check("no proof recorded before delivery", before.proof_of_delivery_url === null);

  const deliveredAt = new Date("2026-06-02T00:00:00.000Z");
  await advanceFulfillment(f.id, "DELIVERED", { deliveredAt, proofOfDelivery: "SIGNED-REF-777" });
  const ships = await prisma.shipment.findMany({ where: { fulfillmentId: f.id } });
  check("still one Shipment row", ships.length === 1);
  const s = ships[0];
  check("proof reference stored on the Shipment", s.proof_of_delivery_url === "SIGNED-REF-777");
  check("carrier + tracking kept", s.carrier === "TEST Courier" && s.tracking_number === "TRK-1");
  check("delivered_at stamped", s.delivered_at?.toISOString() === deliveredAt.toISOString());
  check(
    `claim window = delivered_at + ${CLAIM_WINDOW_DAYS}d`,
    s.claim_window_closes_at?.getTime() === deliveredAt.getTime() + CLAIM_WINDOW_DAYS * 86400000
  );

  console.log(ok ? "\n✅ PASS — proof of delivery recorded with the delivery." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Proof-of-delivery smoke failed:", e);
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });

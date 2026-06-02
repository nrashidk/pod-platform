// Throwaway smoke test for advanceFulfillment (the fulfillment lifecycle layer).
//
// Builds a split order (T-Shirt+DTG ×10 → Apparel Co, Mug+UV ×20 → HardGoods Co),
// then walks each Fulfillment through ROUTED → IN_PRODUCTION → SHIPPED →
// DELIVERED → CLOSED, printing the parent Order's COMPOSITE status at each step
// to show PARTIALLY_SHIPPED / PARTIALLY_DELIVERED emerging from mixed states.
// Also checks the two guards: illegal jumps are rejected, and a BULK fulfillment
// is blocked out of IN_PRODUCTION until its first article is approved.
//
// Idempotent: wipes its own TEST fixtures first. Assumes `npm run db:seed` has
// created the TEST product types / printers / capabilities.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/fulfillment-lifecycle-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import {
  advanceFulfillment,
  CLAIM_WINDOW_DAYS,
  FirstArticleRequiredError,
  InvalidTransitionError,
} from "../src/lib/fulfillment.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

async function cleanup() {
  await prisma.order.deleteMany({
    where: { merchant: { email: "merchant-zero@test.local" } },
  });
  await prisma.design.deleteMany({ where: { name: { startsWith: "TEST " } } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[TEST]" } } });
  await prisma.merchant.deleteMany({ where: { email: "merchant-zero@test.local" } });
}

// Re-read the parent order's derived status straight from the DB.
async function orderStatus(orderId: string) {
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return o.status;
}

async function main() {
  await cleanup();

  // ── Fixtures (same shape as the order-routing smoke). ──
  const merchant = await prisma.merchant.create({
    data: {
      name: "TEST Merchant Zero",
      is_platform_owner: true,
      email: "merchant-zero@test.local",
    },
  });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST Design" },
  });
  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const mugType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-mug" },
  });
  const tshirt = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[TEST] Classic Tee",
      name_ar: "[تجريبي] تي شيرت كلاسيكي",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-TEE-BLK-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const mug = await prisma.product.create({
    data: {
      productTypeId: mugType.id,
      name_en: "[TEST] Ceramic Mug",
      name_ar: "[تجريبي] كوب سيراميك",
      retail_price: 45.0,
      variants: { create: { sku: "TEST-MUG-WHT-11", size: "11oz", color: "White" } },
    },
    include: { variants: true },
  });

  // ── The split order: two capabilities → two Fulfillments. ──
  const order = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Test Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
    lines: [
      { productId: tshirt.id, variantId: tshirt.variants[0].id, designId: design.id, method: "DTG", quantity: 10, unit_retail: 79.0 },
      { productId: mug.id, variantId: mug.variants[0].id, designId: design.id, method: "UV", quantity: 20, unit_retail: 45.0 },
    ],
  });

  // Identify the two fulfillments by printer so steps read clearly.
  const tee = order.fulfillments.find((f) => f.printer.name === "TEST Apparel Co")!;
  const mugF = order.fulfillments.find((f) => f.printer.name === "TEST HardGoods Co")!;
  console.log(`\nSplit order ${order.id} → ${order.fulfillments.length} fulfillments`);
  console.log(`  Tee  fulfillment ${tee.id}  (Apparel Co)`);
  console.log(`  Mug  fulfillment ${mugF.id}  (HardGoods Co)\n`);

  // ── Guard A: illegal jump is rejected (ROUTED → SHIPPED skips production). ──
  let jumped = false;
  try {
    await advanceFulfillment(tee.id, "SHIPPED");
  } catch (e) {
    jumped = e instanceof InvalidTransitionError;
  }
  check("illegal jump ROUTED → SHIPPED rejected", jumped);

  // ── Walk both fulfillments through the lifecycle, interleaved. ──
  const steps: Array<[string, string]> = [];
  async function step(label: string, fId: string, to: any, deliveredAt?: Date) {
    const { orderStatus: os } = await advanceFulfillment(fId, to, deliveredAt ? { deliveredAt } : {});
    const teeS = (await prisma.fulfillment.findUniqueOrThrow({ where: { id: tee.id } })).status;
    const mugS = (await prisma.fulfillment.findUniqueOrThrow({ where: { id: mugF.id } })).status;
    steps.push([label, `tee=${teeS}  mug=${mugS}  →  ORDER=${os}`]);
    return os;
  }

  check("initial composite is ROUTED", (await orderStatus(order.id)) === "ROUTED");

  let s = await step("tee → IN_PRODUCTION", tee.id, "IN_PRODUCTION");
  check("one producing, one routed → IN_PRODUCTION", s === "IN_PRODUCTION");

  s = await step("mug → IN_PRODUCTION", mugF.id, "IN_PRODUCTION");
  check("both producing → IN_PRODUCTION", s === "IN_PRODUCTION");

  s = await step("tee → SHIPPED", tee.id, "SHIPPED");
  check("one shipped, one producing → PARTIALLY_SHIPPED", s === "PARTIALLY_SHIPPED");

  s = await step("mug → SHIPPED", mugF.id, "SHIPPED");
  check("both shipped → SHIPPED", s === "SHIPPED");

  const teeDeliveredAt = new Date("2026-06-02T00:00:00.000Z");
  s = await step("tee → DELIVERED", tee.id, "DELIVERED", teeDeliveredAt);
  check("one delivered, one shipped → PARTIALLY_DELIVERED", s === "PARTIALLY_DELIVERED");

  s = await step("mug → DELIVERED", mugF.id, "DELIVERED");
  check("both delivered → DELIVERED", s === "DELIVERED");

  s = await step("tee → CLOSED", tee.id, "CLOSED");
  check("one closed, one delivered → DELIVERED", s === "DELIVERED");

  s = await step("mug → CLOSED", mugF.id, "CLOSED");
  check("both closed → CLOSED", s === "CLOSED");

  console.log("\nLifecycle walk:");
  console.table(steps.map(([step, state]) => ({ step, state })));

  // ── DELIVERED side effects: Shipment created, claim window = +30 days. ──
  const teeShip = await prisma.shipment.findFirstOrThrow({ where: { fulfillmentId: tee.id } });
  check("DELIVERED created/stamped a Shipment", teeShip != null);
  check(
    "delivered_at stamped to the given date",
    teeShip.delivered_at?.toISOString() === teeDeliveredAt.toISOString()
  );
  const expectedClose = new Date(
    teeDeliveredAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );
  check(
    `claim_window_closes_at = delivered_at + ${CLAIM_WINDOW_DAYS}d`,
    teeShip.claim_window_closes_at?.toISOString() === expectedClose.toISOString()
  );
  console.log(
    `\n  tee shipment: delivered_at=${teeShip.delivered_at?.toISOString()}  ` +
      `claim_window_closes_at=${teeShip.claim_window_closes_at?.toISOString()}`
  );

  // ── Guard B: bulk fulfillment blocked from IN_PRODUCTION pre first-article. ──
  const bulkOrder = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Bulk Buyer", line1: "2 Test St", city: "Dubai", emirate: "Dubai" },
    // 30 tees × 35 wholesale = AED 1,050 ≥ 1,000 → is_bulk, first_article_required.
    lines: [
      { productId: tshirt.id, variantId: tshirt.variants[0].id, designId: design.id, method: "DTG", quantity: 30, unit_retail: 79.0 },
    ],
  });
  const bulkF = bulkOrder.fulfillments[0];
  check("bulk fulfillment flagged is_bulk", bulkF.is_bulk === true);

  let blocked = false;
  try {
    await advanceFulfillment(bulkF.id, "IN_PRODUCTION");
  } catch (e) {
    blocked = e instanceof FirstArticleRequiredError;
  }
  check("bulk blocked from IN_PRODUCTION before first-article approval", blocked);

  // Approve the first article, then it proceeds.
  await prisma.fulfillment.update({
    where: { id: bulkF.id },
    data: { status: "FIRST_ARTICLE_APPROVED", first_article_approved_at: new Date() },
  });
  // Re-seat to ROUTED so the canonical ROUTED → IN_PRODUCTION step is legal
  // (FIRST_ARTICLE_APPROVED is a branch state outside the linear gate).
  await prisma.fulfillment.update({ where: { id: bulkF.id }, data: { status: "ROUTED" } });
  const { orderStatus: bulkOs } = await advanceFulfillment(bulkF.id, "IN_PRODUCTION");
  check("bulk proceeds to IN_PRODUCTION once first-article approved", bulkOs === "IN_PRODUCTION");

  console.log(ok ? "\n✅ PASS — fulfillment lifecycle + composite order status correct." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Fulfillment-lifecycle smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

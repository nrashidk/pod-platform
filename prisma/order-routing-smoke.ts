// Throwaway smoke test for createOrderWithRouting against the seed data.
// Creates clearly-labeled TEST fixtures (merchant zero, a design, two
// products+variants), builds a 2-line order (T-Shirt+DTG ×10, Mug+UV ×20),
// and asserts it splits into exactly two Fulfillments with correct costs.
// Also covers queue 6: same-capability lines are routed as one group.
//
// Idempotent: wipes its own TEST fixtures first. Assumes `npm run db:seed` has
// already created the TEST product types / printers / capabilities.
// Run: npm run test:order-routing
import { UnroutableLineError, createOrderWithRouting } from "../src/lib/orders.ts";
import { prisma } from "../src/lib/prisma.ts";

async function cleanup() {
  // Orders by merchant zero cascade to their lines + fulfillments.
  await prisma.order.deleteMany({
    where: { merchant: { email: "merchant-zero@test.local" } },
  });
  await prisma.design.deleteMany({ where: { name: { startsWith: "TEST " } } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[TEST]" } } });
  await prisma.merchant.deleteMany({
    where: { email: "merchant-zero@test.local" },
  });
}

async function main() {
  await cleanup();

  // ── Fixtures the order layer needs but the foundation seed doesn't make. ──
  const merchant = await prisma.merchant.create({
    data: {
      name: "TEST Merchant Zero",
      is_platform_owner: true,
      email: "merchant-zero@test.local",
    },
  });

  // Find the seeded TEST product types, then make a catalog Product+variant each.
  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const mugType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-mug" },
  });

  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST Design", productTypeId: tshirtType.id },
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

  // ── The order: two lines needing two different capabilities → must split. ──
  const order = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: {
      name: "Test Buyer",
      line1: "1 Test Street",
      city: "Dubai",
      emirate: "Dubai",
    },
    lines: [
      {
        productId: tshirt.id,
        variantId: tshirt.variants[0].id,
        designId: design.id,
        method: "DTG",
        quantity: 10,
        unit_retail: 79.0,
      },
      {
        productId: mug.id,
        variantId: mug.variants[0].id,
        designId: design.id,
        method: "UV",
        quantity: 20,
        unit_retail: 45.0,
      },
    ],
  });

  // ── Report + assertions. ──
  console.log(`\nOrder ${order.id}  status=${order.status}  lines=${order.lines.length}`);
  console.log(`Fulfillments: ${order.fulfillments.length}\n`);

  const rows = order.fulfillments.map((f) => ({
    printer: f.printer.name,
    lines: f.lines.length,
    wholesale_cost: Number(f.wholesale_cost),
    is_bulk: f.is_bulk,
    first_article_required: f.first_article_required,
    status: f.status,
  }));
  console.table(rows);

  const byPrinter = Object.fromEntries(
    order.fulfillments.map((f) => [f.printer.name, Number(f.wholesale_cost)])
  );

  const checks: Array<[string, boolean]> = [
    ["exactly 2 fulfillments (the split)", order.fulfillments.length === 2],
    ["one to TEST Apparel Co", "TEST Apparel Co" in byPrinter],
    ["one to TEST HardGoods Co", "TEST HardGoods Co" in byPrinter],
    ["Apparel Co wholesale = 350 (10 × 35)", byPrinter["TEST Apparel Co"] === 350],
    ["HardGoods Co wholesale = 360 (20 × 18)", byPrinter["TEST HardGoods Co"] === 360],
    ["each fulfillment has exactly 1 line", order.fulfillments.every((f) => f.lines.length === 1)],
    ["neither is bulk (both < AED 1000)", order.fulfillments.every((f) => !f.is_bulk)],
  ];

  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }

  // ── Tier 1 (queue 6): lines of ONE capability are grouped and routed on the
  // group total. Business cards need min_qty 50 at HardGoods Co: 30 + 30 = 60
  // is routable as a group though neither line alone is.
  const cardType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-business-card" },
  });
  const card = await prisma.product.create({
    data: {
      productTypeId: cardType.id,
      name_en: "[TEST] Business Card",
      name_ar: "[تجريبي] بطاقة عمل",
      retail_price: 1.5,
      variants: {
        create: [
          { sku: "TEST-CARD-A", size: "std", color: "White" },
          { sku: "TEST-CARD-B", size: "std", color: "Cream" },
        ],
      },
    },
    include: { variants: true },
  });
  const recipient = { name: "Test Buyer", line1: "1 Test Street", city: "Dubai", emirate: "Dubai" };
  const cardLine = (i: number, quantity: number) => ({
    productId: card.id,
    variantId: card.variants[i].id,
    designId: design.id,
    method: "PAPER_PRINT" as const,
    quantity,
    unit_retail: 1.5,
  });

  const grouped = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient,
    lines: [cardLine(0, 30), cardLine(1, 30)],
  });
  let underMinRejected = false;
  try {
    await createOrderWithRouting({
      merchantId: merchant.id,
      recipient,
      lines: [cardLine(0, 30), cardLine(1, 10)],
    });
  } catch (e) {
    underMinRejected = e instanceof UnroutableLineError;
  }
  const groupChecks: Array<[string, boolean]> = [
    ["same-capability lines (30+30 cards) meet min_qty 50 as a group", grouped.fulfillments.length === 1],
    ["group fulfillment carries both lines", grouped.fulfillments[0]?.lines.length === 2],
    ["group lines share one fulfillment (one printer)", grouped.lines.every((l) => l.fulfillmentId === grouped.fulfillments[0]?.id)],
    ["group cost = 60 × 0.80 = 48", Number(grouped.fulfillments[0]?.wholesale_cost) === 48],
    ["group total 40 < min_qty 50 is unroutable", underMinRejected],
  ];
  for (const [label, pass] of groupChecks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }

  console.log(ok ? "\n✅ PASS — order split correctly; capability groups routed whole." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Order-routing smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

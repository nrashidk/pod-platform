// ─────────────────────────────────────────────────────────────
// OPS-VIEW DEMO SEED — persistent, clickable demo data for /ops.
//
// Creates a handful of real Orders via the REAL createOrderWithRouting engine
// so the ops view has something to drive. All rows are clearly-labeled DEMO
// data under their OWN markers, deliberately DISTINCT from the smoke tests'
// markers so the two never wipe each other:
//   • merchant email   ops-demo@demo.local      (smoke uses merchant-zero@…)
//   • design names      "DEMO …"                 (smoke uses "TEST …")
//   • product names     "[DEMO] …"               (smoke uses "[TEST] …")
//
// Depends on the foundation seed (`npm run db:seed`) having created the
// product types + 2 printers + capability matrix. Idempotent: wipes its own
// DEMO rows first, then recreates.
//
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/seed-ops-demo.ts
//   (or: npm run db:seed:ops)
// ─────────────────────────────────────────────────────────────
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { prisma } from "../src/lib/prisma.ts";

const MERCHANT_EMAIL = "ops-demo@demo.local";

async function cleanup() {
  await prisma.order.deleteMany({
    where: { merchant: { email: MERCHANT_EMAIL } },
  });
  await prisma.design.deleteMany({ where: { name: { startsWith: "DEMO " } } });
  await prisma.product.deleteMany({
    where: { name_en: { startsWith: "[DEMO]" } },
  });
  await prisma.merchant.deleteMany({ where: { email: MERCHANT_EMAIL } });
}

async function main() {
  console.log("⚠️  Seeding OPS-VIEW DEMO DATA only (markers: ops-demo / DEMO / [DEMO]).\n");
  await cleanup();

  // ── Foundation dependency check ──
  const tshirtType = await prisma.productType.findUnique({
    where: { slug: "test-tshirt" },
  });
  const mugType = await prisma.productType.findUnique({
    where: { slug: "test-mug" },
  });
  const cardType = await prisma.productType.findUnique({
    where: { slug: "test-business-card" },
  });
  if (!tshirtType || !mugType || !cardType) {
    throw new Error(
      "Foundation product types missing. Run `npm run db:seed` first " +
        "(it creates the product types, printers, and capability matrix)."
    );
  }

  // ── DEMO merchant + design + catalog products. ──
  const merchant = await prisma.merchant.create({
    data: {
      name: "DEMO Merchant",
      is_platform_owner: true,
      email: MERCHANT_EMAIL,
    },
  });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "DEMO Design" },
  });

  const tshirt = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[DEMO] Classic Tee",
      name_ar: "[تجريبي] تي شيرت كلاسيكي",
      retail_price: 79.0,
      variants: { create: { sku: "DEMO-TEE-BLK-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const mug = await prisma.product.create({
    data: {
      productTypeId: mugType.id,
      name_en: "[DEMO] Ceramic Mug",
      name_ar: "[تجريبي] كوب سيراميك",
      retail_price: 45.0,
      variants: { create: { sku: "DEMO-MUG-WHT-11", size: "11oz", color: "White" } },
    },
    include: { variants: true },
  });
  const card = await prisma.product.create({
    data: {
      productTypeId: cardType.id,
      name_en: "[DEMO] Business Card",
      name_ar: "[تجريبي] بطاقة عمل",
      retail_price: 0.0,
      variants: { create: { sku: "DEMO-CARD-STD", size: "85x55mm" } },
    },
    include: { variants: true },
  });

  const tee = { productId: tshirt.id, variantId: tshirt.variants[0].id };
  const mugV = { productId: mug.id, variantId: mug.variants[0].id };
  const cardV = { productId: card.id, variantId: card.variants[0].id };

  // ── Order 1: single fulfillment — Tee DTG ×5 (5×35 = 175, non-bulk). ──
  const o1 = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Aisha Khan", line1: "12 Marina Walk", city: "Dubai", emirate: "Dubai" },
    lines: [{ ...tee, designId: design.id, method: "DTG", quantity: 5, unit_retail: 79.0 }],
  });

  // ── Order 2: SPLIT — Tee DTG ×10 (Apparel) + Mug UV ×20 (HardGoods). ──
  const o2 = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Omar Saleh", line1: "5 Corniche Rd", city: "Abu Dhabi", emirate: "Abu Dhabi" },
    lines: [
      { ...tee, designId: design.id, method: "DTG", quantity: 10, unit_retail: 79.0 },
      { ...mugV, designId: design.id, method: "UV", quantity: 20, unit_retail: 45.0 },
    ],
  });

  // ── Order 3: single fulfillment — Business Card PAPER_PRINT ×100 (80, non-bulk). ──
  const o3 = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Fatima Noor", line1: "88 Jumeirah Beach Rd", city: "Dubai", emirate: "Dubai" },
    lines: [{ ...cardV, designId: design.id, method: "PAPER_PRINT", quantity: 100, unit_retail: 1.5 }],
  });

  // ── Order 4: BULK, intentionally STUCK — Tee DTG ×30 (30×35 = 1,050 ≥ 1,000).
  // is_bulk + first_article_required, NOT first-article-approved → its advance
  // control is blocked at IN_PRODUCTION in the ops view (by design). ──
  const o4 = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Hessa Al Marri", line1: "1 Business Bay", city: "Dubai", emirate: "Dubai" },
    lines: [{ ...tee, designId: design.id, method: "DTG", quantity: 30, unit_retail: 79.0 }],
  });

  console.table(
    [o1, o2, o3, o4].map((o, i) => ({
      "#": i + 1,
      order: o.id.slice(-8),
      status: o.status,
      fulfillments: o.fulfillments.length,
      bulk: o.fulfillments.some((f) => f.is_bulk),
    }))
  );
  console.log("\n✅ Demo seed complete — open /ops to drive these orders.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Ops demo seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

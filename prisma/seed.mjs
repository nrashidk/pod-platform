// ─────────────────────────────────────────────────────────────
// POD Platform — SEED SCRIPT (placeholder / test data only)
//
// ⚠️  EVERYTHING THIS SCRIPT CREATES IS CLEARLY-LABELED TEST DATA.
//     - ProductType slugs are prefixed  "test-"   and names with "[TEST]"
//     - Printer names are prefixed       "TEST "
//     These markers make the rows trivial to find and delete later
//     (see the cleanup block below, which deletes by those same markers).
//
// Purpose: give the routing/capability-matrix queries (build step 3)
//          something to run against. NOT real catalog or supplier data.
//
// Run with:   node prisma/seed.mjs
// Idempotent: re-running wipes the prior TEST data first, then reseeds.
// ─────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("⚠️  Seeding PLACEHOLDER TEST DATA only.\n");

  // ── 1. Clean up any prior TEST data (idempotent reseed) ──────
  // CHILD rows BEFORE PARENTS, so a partial run can NEVER strand the
  // capability matrix (the old order deleted capabilities first, then died on
  // the Printer/ProductType FKs — leaving routing broken). The two parents we
  // recreate are TEST Printers and test- ProductTypes; both have inbound FKs
  // WITHOUT onDelete:Cascade that must be cleared first:
  //   • Fulfillment.printer        → no cascade  ⇒ clear fulfillments
  //   • Product.productType        → no cascade  ⇒ clear products
  //   • PrinterCapability.productType → no cascade ⇒ clear capabilities
  // We scope to anything referencing the TEST printers / test- types, so this
  // is safe to run regardless of what test/demo data was left behind.

  // (a) Orders touching a TEST printer (via fulfillment) or a test- product
  //     type (via line). Deleting the Order cascades its Fulfillments,
  //     OrderLines, and Shipments (all onDelete:Cascade) — clearing the
  //     Fulfillment→Printer FK that blocked the old cleanup.
  const delOrders = await prisma.order.deleteMany({
    where: {
      OR: [
        { fulfillments: { some: { printer: { name: { startsWith: "TEST " } } } } },
        {
          lines: {
            some: { product: { productType: { slug: { startsWith: "test-" } } } },
          },
        },
      ],
    },
  });

  // (b) Products on a test- product type → cascades their ProductVariants.
  //     (OrderLine→Product FK has no cascade, but the lines are gone with (a).)
  const delProducts = await prisma.product.deleteMany({
    where: { productType: { slug: { startsWith: "test-" } } },
  });

  // (c) PrinterCapabilities on a TEST printer OR a test- product type — must
  //     precede the ProductTypes they reference (that FK has no cascade).
  const delCaps = await prisma.printerCapability.deleteMany({
    where: {
      OR: [
        { printer: { name: { startsWith: "TEST " } } },
        { productType: { slug: { startsWith: "test-" } } },
      ],
    },
  });

  // (d) Now the parents are unreferenced and delete cleanly.
  const delPrinters = await prisma.printer.deleteMany({
    where: { name: { startsWith: "TEST " } },
  });
  const delTypes = await prisma.productType.deleteMany({
    where: { slug: { startsWith: "test-" } },
  });

  console.log(
    `Cleanup: removed ${delOrders.count} orders, ${delProducts.count} products, ` +
      `${delCaps.count} capabilities, ${delPrinters.count} printers, ` +
      `${delTypes.count} product types.\n`
  );

  // ── 2. ProductTypes + their intrinsic PrintAreas ─────────────
  // Realistic production-file specs (dimensions in mm, DPI as noted).

  // T-Shirt — DTG/embroidery garment. FRONT + BACK print areas.
  const tshirt = await prisma.productType.create({
    data: {
      slug: "test-tshirt",
      name_en: "[TEST] T-Shirt",
      name_ar: "[تجريبي] تي شيرت",
      category: "APPAREL",
      printAreas: {
        create: [
          {
            placement: "FRONT",
            width_mm: 305, // ~12 in
            height_mm: 406, // ~16 in
            min_dpi: 150,
            recommended_dpi: 300,
            allowed_formats: ["PNG"],
            color_profile: "sRGB",
            requires_transparency: true, // DTG on dark garments
            bleed_mm: 0,
            max_file_mb: 200,
          },
          {
            placement: "BACK",
            width_mm: 305,
            height_mm: 406,
            min_dpi: 150,
            recommended_dpi: 300,
            allowed_formats: ["PNG"],
            color_profile: "sRGB",
            requires_transparency: true,
            bleed_mm: 0,
            max_file_mb: 200,
          },
        ],
      },
    },
  });

  // Mug — 11oz ceramic, UV wrap print. Single WRAP area.
  const mug = await prisma.productType.create({
    data: {
      slug: "test-mug",
      name_en: "[TEST] Mug (11oz)",
      name_ar: "[تجريبي] كوب (11 أونصة)",
      category: "DRINKWARE",
      printAreas: {
        create: [
          {
            placement: "WRAP",
            width_mm: 203, // ~8 in printable wrap
            height_mm: 95, // ~3.7 in tall
            min_dpi: 300,
            recommended_dpi: 300,
            allowed_formats: ["PNG", "JPEG"],
            color_profile: "sRGB",
            requires_transparency: false,
            bleed_mm: 3,
            max_file_mb: 100,
          },
        ],
      },
    },
  });

  // Business Card — standard 85x55mm, paper print. FRONT area (with bleed).
  const card = await prisma.productType.create({
    data: {
      slug: "test-business-card",
      name_en: "[TEST] Business Card",
      name_ar: "[تجريبي] بطاقة عمل",
      category: "PAPER",
      printAreas: {
        create: [
          {
            placement: "FRONT",
            width_mm: 85, // standard business card
            height_mm: 55,
            min_dpi: 300,
            recommended_dpi: 300,
            allowed_formats: ["PDF", "PNG"],
            color_profile: "CMYK",
            requires_transparency: false,
            bleed_mm: 3,
            max_file_mb: 50,
          },
        ],
      },
    },
  });

  console.log("Created 3 product types (T-Shirt, Mug, Business Card).");

  // ── 3. Two PLACEHOLDER printers (obvious TEST data) ──────────
  // Flags set so they're routing-eligible for later testing:
  // ACTIVE + blind_ship_confirmed + contract_signed + spare capacity.
  const apparelCo = await prisma.printer.create({
    data: {
      name: "TEST Apparel Co",
      status: "ACTIVE",
      emirate: "Dubai",
      country: "AE",
      blind_ship_confirmed: true,
      return_address: "TEST return address — Dubai, UAE",
      contract_signed: true,
      accepts_bulk_holdback: true,
      daily_capacity_units: 500,
      current_load_units: 0,
      payout_terms: "TEST — upfront full <1000 AED; 70/30 bulk",
    },
  });

  const hardGoodsCo = await prisma.printer.create({
    data: {
      name: "TEST HardGoods Co",
      status: "ACTIVE",
      emirate: "Abu Dhabi",
      country: "AE",
      blind_ship_confirmed: true,
      return_address: "TEST return address — Abu Dhabi, UAE",
      contract_signed: true,
      accepts_bulk_holdback: true,
      daily_capacity_units: 800,
      current_load_units: 0,
      payout_terms: "TEST — upfront full <1000 AED; 70/30 bulk",
    },
  });

  console.log("Created 2 test printers (Apparel Co, HardGoods Co).");

  // ── 4. PrinterCapability matrix (placeholder wholesale costs) ─
  await prisma.printerCapability.createMany({
    data: [
      // TEST Apparel Co — T-Shirt via DTG and via EMBROIDERY
      {
        printerId: apparelCo.id,
        productTypeId: tshirt.id,
        method: "DTG",
        unit_wholesale_cost: 35.0, // placeholder AED
        min_qty: 1,
        active: true,
        requires_digitization: false,
      },
      {
        printerId: apparelCo.id,
        productTypeId: tshirt.id,
        method: "EMBROIDERY",
        unit_wholesale_cost: 55.0, // placeholder AED
        min_qty: 1,
        active: true,
        requires_digitization: true, // embroidery needs a digitization step
      },
      // TEST HardGoods Co — Mug via UV, Business Card via PAPER_PRINT
      {
        printerId: hardGoodsCo.id,
        productTypeId: mug.id,
        method: "UV",
        unit_wholesale_cost: 18.0, // placeholder AED
        min_qty: 1,
        active: true,
        requires_digitization: false,
      },
      {
        printerId: hardGoodsCo.id,
        productTypeId: card.id,
        method: "PAPER_PRINT",
        unit_wholesale_cost: 0.8, // placeholder AED per card
        min_qty: 50, // cards sold in batches
        active: true,
        requires_digitization: false,
      },
    ],
  });

  console.log("Created 4 printer-capability rows.\n");
  console.log("✅ Seed complete (all rows are TEST data).");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Seed failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

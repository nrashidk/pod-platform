// Smoke test for estimated delivery (queue 12): the Fulfillment's
// estimated_delivery_days = printer.production_lead_days + shipping days for the
// destination (emirate override → country → fallback).
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/estimated-delivery-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { FALLBACK_SHIPPING_DAYS } from "../src/lib/estimated-delivery.ts";
import { daysText } from "../src/app/ops/labels.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

const EMAIL = "eta-check@test.local";
const OVERRIDE_EMIRATE = "TEST Emirate";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] ETA Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
  await prisma.shippingLeadTime.deleteMany({ where: { emirate: OVERRIDE_EMIRATE } });
  await prisma.shippingLeadTime.deleteMany({ where: { country: "ZZ" } });
}

async function main() {
  await cleanup();

  const merchant = await prisma.merchant.create({ data: { name: "TEST ETA Merchant", email: EMAIL } });
  const tshirtType = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST ETA Design", productTypeId: tshirtType.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[TEST] ETA Tee",
      name_ar: "[تجريبي] تي شيرت",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-ETA-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const order = async (country: string | undefined, emirate: string | null) => {
    const o = await createOrderWithRouting({
      merchantId: merchant.id,
      recipient: { name: "ETA Buyer", line1: "1 Test St", city: "Dubai", emirate, country },
      lines: [
        { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity: 1, unit_retail: 79.0 },
      ],
    });
    return o.fulfillments[0];
  };

  // Default rows come from the migration: AE = 2 days.
  const ae = await prisma.shippingLeadTime.findUniqueOrThrow({
    where: { country_emirate: { country: "AE", emirate: "" } },
  });
  const f1 = await order(undefined, null);
  const lead = f1.printer.production_lead_days;
  check("uses the printer's production lead days", lead >= 0);
  check(
    "estimate = production lead + default UAE shipping days",
    f1.estimated_delivery_days === lead + ae.days
  );

  // Per-emirate override beats the country row.
  await prisma.shippingLeadTime.create({ data: { country: "AE", emirate: OVERRIDE_EMIRATE, days: 9 } });
  const f2 = await order("AE", OVERRIDE_EMIRATE);
  check("emirate override wins", f2.estimated_delivery_days === lead + 9);
  const f3 = await order("AE", "Some Other Emirate");
  check("unknown emirate falls back to the country row", f3.estimated_delivery_days === lead + ae.days);

  // Unknown country → fallback constant.
  const f4 = await order("ZZ", null);
  check("unknown country uses the fallback days", f4.estimated_delivery_days === lead + FALLBACK_SHIPPING_DAYS);

  // Lead time change is picked up by new orders.
  await prisma.printer.update({ where: { id: f1.printerId }, data: { production_lead_days: lead + 4 } });
  try {
    const f5 = await order(undefined, null);
    check("a changed production lead time applies to new orders", f5.estimated_delivery_days === lead + 4 + ae.days);
  } finally {
    await prisma.printer.update({ where: { id: f1.printerId }, data: { production_lead_days: lead } });
  }

  // Labels.
  check("English day forms", daysText(1, "en") === "1 day" && daysText(5, "en") === "5 days");
  check(
    "Arabic day forms",
    daysText(1, "ar") === "يوم واحد" && daysText(2, "ar") === "يومان" &&
      daysText(5, "ar") === "5 أيام" && daysText(12, "ar") === "12 يومًا"
  );

  console.log(ok ? "\n✅ PASS — estimated delivery set at routing." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await cleanup();
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("Estimated-delivery smoke failed:", e);
    await cleanup().catch(() => {});
    await prisma.$disconnect();
    process.exit(1);
  });

// Smoke test for the white-label packing slip (queue 9, data model §6): the
// owning printer gets the merchant-branded slip data; no other printer does;
// rerouted/cancelled work gets none; and the data never carries prices or any
// printer/platform identity.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/packing-slip-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { getPackingSlipForPrinter } from "../src/lib/packing-slip.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

const EMAIL = "packing-slip@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] Slip Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();
  const merchant = await prisma.merchant.create({
    data: {
      name: "TEST Slip Merchant",
      is_platform_owner: true,
      email: EMAIL,
      packing_slip_message: "Thank you from TEST Slip",
      return_address: "5 Return Rd, Dubai",
    },
  });
  const type = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST Slip Design", productTypeId: type.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: type.id,
      name_en: "[TEST] Slip Tee",
      name_ar: "[تجريبي] تي شيرت القسيمة",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-SLIP-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const { fulfillments } = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Slip Buyer", line1: "3 Slip St", city: "Dubai", emirate: "Dubai" },
    lines: [
      { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity: 3, unit_retail: 79.0 },
    ],
  });
  const f = fulfillments[0];

  const slip = await getPackingSlipForPrinter(f.printerId, f.id);
  check("owning printer gets the slip", slip != null);
  check(
    "slip carries the merchant brand (name, message, return address)",
    slip?.order.merchant.name === "TEST Slip Merchant" &&
      slip.order.merchant.packing_slip_message === "Thank you from TEST Slip" &&
      slip.order.merchant.return_address === "5 Return Rd, Dubai"
  );
  check(
    "slip carries ship-to and the parcel's items (EN + AR names, variant, qty)",
    slip?.order.recipient_name === "Slip Buyer" &&
      slip.order.shipping_line1 === "3 Slip St" &&
      slip.lines.length === 1 &&
      slip.lines[0].quantity === 3 &&
      slip.lines[0].variant.sku === "TEST-SLIP-TEE-M" &&
      slip.lines[0].product.name_ar.length > 0
  );
  const json = JSON.stringify(slip);
  check(
    "slip has no prices, printer or wallet data",
    !json.includes("unit_retail") &&
      !json.includes("retail") &&
      !json.includes("printerId") &&
      !json.includes("wholesale") &&
      slip != null &&
      !("printer" in slip)
  );

  check(
    "slip carries the order ref field (store's own number when present)",
    slip != null && "external_order_ref" in slip.order
  );
  check(
    "another printer gets no slip",
    (await getPackingSlipForPrinter("not-the-owner", f.id)) === null
  );
  check("an empty printer id gets no slip", (await getPackingSlipForPrinter("", f.id)) === null);
  check("an unknown fulfillment gets no slip", (await getPackingSlipForPrinter(f.printerId, "nope")) === null);

  await prisma.fulfillment.update({ where: { id: f.id }, data: { status: "REROUTED" } });
  check("rerouted work gets no slip", (await getPackingSlipForPrinter(f.printerId, f.id)) === null);
  await prisma.fulfillment.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
  check("cancelled work gets no slip", (await getPackingSlipForPrinter(f.printerId, f.id)) === null);

  await cleanup();
  console.log(ok ? "\n✅ PASS — packing slip correct." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Packing slip smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

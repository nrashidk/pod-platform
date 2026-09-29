// Smoke test for the printer work view (queue 8, data model §4, §6): the owning
// printer gets a signed link for each PASSED print file of its fulfillment and
// sees the merchant brand + ship-to; nobody else does, and unvalidated files,
// other designs and rerouted/cancelled work are never served.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/printer-work-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { getFulfillmentsForPrinter } from "../src/lib/orders-access.ts";
import { printerWorkFileUrl } from "../src/lib/printer-work.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

const EMAIL = "printer-work@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] Work View Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();
  const store = new StubPrintFileStore();
  const merchant = await prisma.merchant.create({
    data: {
      name: "TEST Work-View Merchant",
      is_platform_owner: true,
      email: EMAIL,
      packing_slip_message: "Thanks from TEST brand",
      return_address: "1 Return Rd, Dubai",
    },
  });
  const type = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST Work Design", productTypeId: type.id },
  });
  const otherDesign = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST Other Design", productTypeId: type.id },
  });
  const front = await store.put({ buffer: Buffer.from("front"), filename: "work-front.png", contentType: "image/png" });
  const back = await store.put({ buffer: Buffer.from("back"), filename: "work-back.png", contentType: "image/png" });
  const other = await store.put({ buffer: Buffer.from("other"), filename: "work-other.png", contentType: "image/png" });
  await prisma.designPlacement.create({
    data: { designId: design.id, placement: "FRONT", print_file_url: front.url, validation_status: "PASSED" },
  });
  await prisma.designPlacement.create({
    data: { designId: design.id, placement: "BACK", print_file_url: back.url, validation_status: "FLAGGED" },
  });
  await prisma.designPlacement.create({
    data: { designId: otherDesign.id, placement: "FRONT", print_file_url: other.url, validation_status: "PASSED" },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: type.id,
      name_en: "[TEST] Work View Tee",
      name_ar: "[تجريبي] تي شيرت عرض العمل",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-WORK-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const { fulfillments } = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Work Buyer", line1: "9 Ship St", city: "Dubai", emirate: "Dubai" },
    lines: [
      { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity: 2, unit_retail: 79.0 },
    ],
  });
  const f = fulfillments[0];
  const printerId = f.printerId;
  const target = { fulfillmentId: f.id, designId: design.id, placement: "FRONT" as const };

  check(
    "owner gets a link for a PASSED file",
    (await printerWorkFileUrl(printerId, target, store)) === front.url
  );
  check(
    "a FLAGGED file is never served",
    (await printerWorkFileUrl(printerId, { ...target, placement: "BACK" }, store)) === null
  );
  check(
    "a placement with no file returns null",
    (await printerWorkFileUrl(printerId, { ...target, placement: "WRAP" }, store)) === null
  );
  check(
    "another printer gets nothing",
    (await printerWorkFileUrl("not-the-owner", target, store)) === null
  );
  check("an empty printer id gets nothing", (await printerWorkFileUrl("", target, store)) === null);
  check(
    "a design that is not on the fulfillment's lines is refused",
    (await printerWorkFileUrl(printerId, { ...target, designId: otherDesign.id }, store)) === null
  );
  check(
    "an unknown fulfillment is refused",
    (await printerWorkFileUrl(printerId, { ...target, fulfillmentId: "nope" }, store)) === null
  );

  const mine = (
    await getFulfillmentsForPrinter({ userId: "u", email: "p@test.local", role: "PRINTER", merchantId: null, printerId })
  ).find((x) => x.id === f.id);
  check("printer's queue includes the fulfillment", mine != null);
  check(
    "work view carries the merchant brand to apply",
    mine?.order.merchant.name === "TEST Work-View Merchant" &&
      mine.order.merchant.packing_slip_message === "Thanks from TEST brand" &&
      mine.order.merchant.return_address === "1 Return Rd, Dubai"
  );
  check(
    "work view carries the ship-to address",
    mine?.order.recipient_name === "Work Buyer" && mine.order.shipping_line1 === "9 Ship St"
  );
  const placements = mine?.lines[0].design.placements ?? [];
  check(
    "work view lists placements with status but never the file URL",
    placements.length === 2 &&
      placements.every((p) => !("print_file_url" in p)) &&
      placements.find((p) => p.placement === "FRONT")?.validation_status === "PASSED" &&
      placements.find((p) => p.placement === "BACK")?.validation_status === "FLAGGED"
  );

  check(
    "work view hides the buyer's retail total and payment fields",
    mine != null && !("retail_total" in mine.order) && !("paid_at" in mine.order)
  );

  await prisma.fulfillment.update({ where: { id: f.id }, data: { status: "REROUTED" } });
  check(
    "rerouted work no longer serves files",
    (await printerWorkFileUrl(printerId, target, store)) === null
  );
  await prisma.fulfillment.update({ where: { id: f.id }, data: { status: "CANCELLED" } });
  check(
    "cancelled work no longer serves files",
    (await printerWorkFileUrl(printerId, target, store)) === null
  );

  await cleanup();
  console.log(ok ? "\n✅ PASS — printer work view correct." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Printer work smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

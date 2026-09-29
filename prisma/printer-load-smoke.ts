// Smoke test for capacity accounting (queue 5, data model §3 step 3.2):
// routing reserves units on the printer, SHIPPED releases them exactly once,
// and a full printer drops out of routing. Only lib functions move state.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/printer-load-smoke.ts
import { createOrderWithRouting, UnroutableLineError } from "../src/lib/orders.ts";
import { advanceFulfillment } from "../src/lib/fulfillment.ts";
import { releasePrinterLoad } from "../src/lib/printer-load.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

const EMAIL = "printer-load@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] Load Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();
  // TEST Apparel Co is the only seeded printer that makes t-shirts via DTG.
  const printer = await prisma.printer.findFirstOrThrow({ where: { name: "TEST Apparel Co" } });
  const original = { cap: printer.daily_capacity_units, load: printer.current_load_units };
  await prisma.printer.update({
    where: { id: printer.id },
    data: { daily_capacity_units: 50, current_load_units: 0 },
  });
  const load = async () =>
    (await prisma.printer.findUniqueOrThrow({ where: { id: printer.id } })).current_load_units;

  try {
    const merchant = await prisma.merchant.create({
      data: { name: "TEST Load Merchant", is_platform_owner: true, email: EMAIL },
    });
    const type = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
    const design = await prisma.design.create({
      data: { merchantId: merchant.id, name: "TEST Load Design", productTypeId: type.id },
    });
    const tee = await prisma.product.create({
      data: {
        productTypeId: type.id,
        name_en: "[TEST] Load Tee",
        name_ar: "[تجريبي] تي شيرت الحمل",
        retail_price: 79.0,
        variants: { create: { sku: "TEST-LOAD-TEE-M", size: "M", color: "Black" } },
      },
      include: { variants: true },
    });
    const place = (quantity: number) =>
      createOrderWithRouting({
        merchantId: merchant.id,
        recipient: { name: "Load Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
        lines: [
          { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity, unit_retail: 79.0 },
        ],
      });

    // ── Two lines on one printer that fit alone but not together: rejected as
    // unroutable (not a crash), nothing written. ──
    let multiRejected = false;
    try {
      await createOrderWithRouting({
        merchantId: merchant.id,
        recipient: { name: "Load Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
        lines: [30, 30].map((quantity) => ({
          productId: tee.id, variantId: tee.variants[0].id, designId: design.id,
          method: "DTG" as const, quantity, unit_retail: 79.0,
        })),
      });
    } catch (e) {
      multiRejected = e instanceof UnroutableLineError;
    }
    check("two 30-unit lines on 50 capacity are rejected as unroutable", multiRejected);
    check(
      "rejected multi-line order leaves no load or order behind",
      (await load()) === 0 &&
        (await prisma.order.count({ where: { merchantId: merchant.id } })) === 0
    );

    // ── Race: two orders of 30 for 50 units of capacity — exactly one wins. ──
    const raced = await Promise.allSettled([place(30), place(30)]);
    check(
      "two concurrent 30-unit orders on 50 capacity: exactly one succeeds",
      raced.filter((r) => r.status === "fulfilled").length === 1
    );
    check("load is 30 after the race (loser left nothing behind)", (await load()) === 30);
    check(
      "the loser left no order behind",
      (await prisma.order.count({ where: { merchantId: merchant.id } })) === 1
    );

    // ── Reserve on routing. ──
    const winner = raced.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<
      Awaited<ReturnType<typeof place>>
    >;
    check("fulfillment records the 30 units it holds", winner.value.fulfillments[0].load_units === 30);

    const twenty = (await place(20)).fulfillments[0];
    check("load is 50 after a 20-unit order", (await load()) === 50);

    // ── Full printer drops out of routing. ──
    let unroutable = false;
    try {
      await place(1);
    } catch (e) {
      unroutable = e instanceof UnroutableLineError;
    }
    check("a full printer drops out of routing (1 more unit is unroutable)", unroutable);
    check("failed order does not change the load", (await load()) === 50);

    // ── Release at SHIPPED, exactly once. ──
    await advanceFulfillment(twenty.id, "IN_PRODUCTION");
    check("IN_PRODUCTION still holds the load", (await load()) === 50);
    await advanceFulfillment(twenty.id, "SHIPPED");
    check("SHIPPED releases its 20 units", (await load()) === 30);
    check(
      "released fulfillment holds 0 units",
      (await prisma.fulfillment.findUniqueOrThrow({ where: { id: twenty.id } })).load_units === 0
    );
    await prisma.$transaction((tx) => releasePrinterLoad(tx, twenty.id));
    check("a second release is a no-op", (await load()) === 30);

    // ── Capacity is usable again after release. ──
    await place(20);
    check("freed capacity routes again (load back to 50)", (await load()) === 50);

    await cleanup();
  } finally {
    await prisma.printer.update({
      where: { id: printer.id },
      data: { daily_capacity_units: original.cap, current_load_units: original.load },
    });
  }
  console.log(ok ? "\n✅ PASS — capacity accounting correct." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Printer-load smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

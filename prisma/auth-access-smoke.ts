// ─────────────────────────────────────────────────────────────
// AUTH ACCESS SMOKE — proves the DATA-LAYER scoping in getOrdersForCaller.
// This is the load-bearing OWASP guarantee of the auth phase: a MERCHANT can
// only ever read its OWN merchant's orders, a PRINTER only orders containing a
// fulfillment assigned to it, an OPERATOR sees all — enforced in the QUERY, not
// the UI. Creates isolated AUTHCHK-marked rows, asserts positive AND negative
// cases plus the null-id guard, then cleans up.
//
// Run: npm run test:auth
// ─────────────────────────────────────────────────────────────
import { getOrdersForCaller } from "../src/lib/orders-access.ts";
import { prisma } from "../src/lib/prisma.ts";

const MARK = "AUTHCHK";
let failures = 0;

function assert(cond: boolean, msg: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
}

async function cleanup() {
  await prisma.fulfillment.deleteMany({
    where: { order: { recipient_name: { startsWith: MARK } } },
  });
  await prisma.order.deleteMany({
    where: { recipient_name: { startsWith: MARK } },
  });
  await prisma.printer.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.merchant.deleteMany({
    where: { email: { startsWith: "authchk-" } },
  });
}

async function main() {
  await cleanup();

  const mA = await prisma.merchant.create({
    data: { name: `${MARK} Merchant A`, email: "authchk-a@chk.local" },
  });
  const mB = await prisma.merchant.create({
    data: { name: `${MARK} Merchant B`, email: "authchk-b@chk.local" },
  });
  const pA = await prisma.printer.create({ data: { name: `${MARK} Printer A` } });
  const pB = await prisma.printer.create({ data: { name: `${MARK} Printer B` } });

  const mkOrder = (merchantId: string, tag: string) =>
    prisma.order.create({
      data: {
        origination: "OWN_STORE",
        merchantId,
        recipient_name: `${MARK} ${tag}`,
        shipping_line1: "1 St",
        shipping_city: "Dubai",
        retail_total: 100,
      },
    });
  const oA = await mkOrder(mA.id, "Order-A");
  const oB = await mkOrder(mB.id, "Order-B");
  // A SECOND order for merchant B, so the merchant-scoping negative case proves
  // isolation against more than one foreign order (a merchant view that leaked
  // would surface BOTH of B's here). Drives the merchant read-only view's
  // scoping guarantee — the merchant page reuses this same getOrdersForCaller
  // MERCHANT branch.
  const oB2 = await mkOrder(mB.id, "Order-B2");
  await prisma.fulfillment.create({
    data: { orderId: oA.id, printerId: pA.id, wholesale_cost: 50 },
  });
  await prisma.fulfillment.create({
    data: { orderId: oB.id, printerId: pB.id, wholesale_cost: 50 },
  });
  await prisma.fulfillment.create({
    data: { orderId: oB2.id, printerId: pB.id, wholesale_cost: 50 },
  });

  const ids = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));

  console.log("OPERATOR sees everything:");
  const op = ids(
    await getOrdersForCaller({
      userId: "x", email: "op", role: "OPERATOR", merchantId: null, printerId: null,
    })
  );
  assert(op.has(oA.id) && op.has(oB.id), "operator sees both orders");

  console.log("MERCHANT scoped to own merchant (drives the /merchant view):");
  const ma = ids(
    await getOrdersForCaller({
      userId: "x", email: "ma", role: "MERCHANT", merchantId: mA.id, printerId: null,
    })
  );
  assert(ma.has(oA.id), "merchant A sees its own order (positive)");
  assert(!ma.has(oB.id), "merchant A does NOT see merchant B's order (negative)");
  assert(
    !ma.has(oB2.id),
    "merchant A does NOT see merchant B's SECOND order (negative, multi-order)"
  );
  assert(
    ma.has(oA.id) && [...ma].every((id) => id !== oB.id && id !== oB2.id),
    "merchant A's result set contains its own order and NONE of merchant B's"
  );

  console.log("PRINTER scoped to assigned fulfillments:");
  const pb = ids(
    await getOrdersForCaller({
      userId: "x", email: "pb", role: "PRINTER", merchantId: null, printerId: pB.id,
    })
  );
  assert(pb.has(oB.id), "printer B sees the order it fulfills (positive)");
  assert(!pb.has(oA.id), "printer B does NOT see printer A's order (negative)");

  console.log("Null-id guard (scope-bypass footgun):");
  let threw = false;
  try {
    await getOrdersForCaller({
      userId: "x", email: "bad", role: "MERCHANT", merchantId: null, printerId: null,
    });
  } catch {
    threw = true;
  }
  assert(threw, "MERCHANT with null merchantId throws instead of returning all");

  await cleanup();
  await prisma.$disconnect();
  if (failures > 0) {
    console.log(`\n✖ ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log("\n✓ ALL PASS");
}

main().catch(async (e) => {
  console.error(e);
  await cleanup();
  await prisma.$disconnect();
  process.exit(1);
});

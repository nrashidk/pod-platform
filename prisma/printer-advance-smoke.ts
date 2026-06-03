// ─────────────────────────────────────────────────────────────
// PRINTER ADVANCE SMOKE — proves the security core of the printer view:
//
//  • READ scope: getFulfillmentsForPrinter returns ONLY the caller printer's
//    own fulfillments (positive + negative), and throws on a null printerId
//    (full-scope-leak guard).
//  • WRITE ownership (the load-bearing NEGATIVE test): a printer attempting to
//    advance a fulfillment that ISN'T theirs — by forging the fulfillmentId — is
//    rejected at the ENGINE with FulfillmentOwnershipError, and the victim row
//    is left UNCHANGED. The check is inside advanceFulfillment's transaction, so
//    there is no check-then-act race.
//  • WRITE subset: a printer may only target IN_PRODUCTION / SHIPPED;
//    nextPrinterStatus never offers DELIVERED/CLOSED.
//  • OPERATOR path UNCHANGED: advanceFulfillment with NO ownerPrinterId advances
//    any fulfillment exactly as before (regression guard for /ops).
//
// Creates isolated PRNTRCHK-marked rows, asserts, then cleans up.
// Run: npm run test:printer
// ─────────────────────────────────────────────────────────────
import { getFulfillmentsForPrinter } from "../src/lib/orders-access.ts";
import {
  advanceFulfillment,
  FulfillmentOwnershipError,
  nextPrinterStatus,
} from "../src/lib/fulfillment.ts";
import { prisma } from "../src/lib/prisma.ts";
import type { AuthContext } from "../src/lib/auth-context.ts";

const MARK = "PRNTRCHK";
let failures = 0;

function assert(cond: boolean, msg: string) {
  console.log(`  ${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
}

const printerCtx = (printerId: string): AuthContext => ({
  userId: "x",
  email: "p",
  role: "PRINTER",
  merchantId: null,
  printerId,
});

async function cleanup() {
  await prisma.fulfillment.deleteMany({
    where: { order: { recipient_name: { startsWith: MARK } } },
  });
  await prisma.order.deleteMany({
    where: { recipient_name: { startsWith: MARK } },
  });
  await prisma.printer.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.merchant.deleteMany({
    where: { email: { startsWith: "prntrchk-" } },
  });
}

async function main() {
  await cleanup();

  const merchant = await prisma.merchant.create({
    data: { name: `${MARK} Merchant`, email: "prntrchk-m@chk.local" },
  });
  const pA = await prisma.printer.create({ data: { name: `${MARK} Printer A` } });
  const pB = await prisma.printer.create({ data: { name: `${MARK} Printer B` } });

  const order = await prisma.order.create({
    data: {
      origination: "OWN_STORE",
      merchantId: merchant.id,
      recipient_name: `${MARK} Order`,
      shipping_line1: "1 St",
      shipping_city: "Dubai",
      retail_total: 100,
    },
  });

  // One fulfillment per printer, both starting at ROUTED (ready to advance).
  const fA = await prisma.fulfillment.create({
    data: { orderId: order.id, printerId: pA.id, wholesale_cost: 50, status: "ROUTED" },
  });
  const fB = await prisma.fulfillment.create({
    data: { orderId: order.id, printerId: pB.id, wholesale_cost: 50, status: "ROUTED" },
  });

  // ── READ SCOPE ──────────────────────────────────────────────
  console.log("Read scope (own fulfillments only):");
  const aRows = new Set(
    (await getFulfillmentsForPrinter(printerCtx(pA.id))).map((r) => r.id)
  );
  assert(aRows.has(fA.id), "printer A sees its own fulfillment (positive)");
  assert(!aRows.has(fB.id), "printer A does NOT see printer B's fulfillment (negative)");

  console.log("Null-printerId guard (scope-bypass footgun):");
  let nullThrew = false;
  try {
    await getFulfillmentsForPrinter({ ...printerCtx(pA.id), printerId: null });
  } catch {
    nullThrew = true;
  }
  assert(nullThrew, "null printerId throws instead of returning every fulfillment");

  // ── WRITE: advance OWN (positive) ───────────────────────────
  console.log("Advance own fulfillment along the printer subset:");
  await advanceFulfillment(fA.id, "IN_PRODUCTION", { ownerPrinterId: pA.id });
  await advanceFulfillment(fA.id, "SHIPPED", { ownerPrinterId: pA.id });
  const aAfter = await prisma.fulfillment.findUniqueOrThrow({ where: { id: fA.id } });
  assert(aAfter.status === "SHIPPED", "printer A advanced own ROUTED → IN_PRODUCTION → SHIPPED");

  // ── ★ WRITE: NEGATIVE — advance a fulfillment that ISN'T yours ──
  console.log("★ NEGATIVE: printer A forges printer B's fulfillmentId:");
  const bBefore = await prisma.fulfillment.findUniqueOrThrow({ where: { id: fB.id } });
  let ownershipThrew = false;
  try {
    // Printer A (session id = pA) attempts to advance B's fulfillment.
    await advanceFulfillment(fB.id, "IN_PRODUCTION", { ownerPrinterId: pA.id });
  } catch (e) {
    ownershipThrew = e instanceof FulfillmentOwnershipError;
  }
  assert(ownershipThrew, "advancing another printer's fulfillment throws FulfillmentOwnershipError");
  const bAfter = await prisma.fulfillment.findUniqueOrThrow({ where: { id: fB.id } });
  assert(
    bAfter.status === bBefore.status && bAfter.status === "ROUTED",
    "victim fulfillment status is UNCHANGED after the rejected advance"
  );

  // ── WRITE: subset never exposes DELIVERED / CLOSED ──────────
  console.log("Printer-permitted transition subset:");
  assert(nextPrinterStatus("ROUTED") === "IN_PRODUCTION", "ROUTED → IN_PRODUCTION offered");
  assert(nextPrinterStatus("IN_PRODUCTION") === "SHIPPED", "IN_PRODUCTION → SHIPPED offered");
  assert(nextPrinterStatus("SHIPPED") === null, "SHIPPED → DELIVERED is NOT offered to a printer");
  assert(nextPrinterStatus("DELIVERED") === null, "DELIVERED → CLOSED is NOT offered to a printer");

  // ── OPERATOR path unchanged (no ownerPrinterId) ─────────────
  console.log("Operator path unchanged (no ownership constraint):");
  // fA is SHIPPED; an operator (no owner) advances it onward to DELIVERED — the
  // exact full-lifecycle move the printer is forbidden from making.
  await advanceFulfillment(fA.id, "DELIVERED");
  const aOp = await prisma.fulfillment.findUniqueOrThrow({ where: { id: fA.id } });
  assert(aOp.status === "DELIVERED", "operator advance (no owner) still reaches DELIVERED");

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

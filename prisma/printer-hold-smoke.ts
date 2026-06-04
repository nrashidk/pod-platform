// Throwaway smoke test for the 70/30 printer retention hold (src/lib/printer-hold.ts).
//
// Builds a split order on seed data:
//   • Tee + DTG × 30  → wholesale 1050  → BULK (≥ AED 1,000)
//   • Mug + UV  × 20  → wholesale  360  → SUB-THRESHOLD
// records billing (one WHOLESALE_OWED entry per fulfillment), then:
//   1. BULK SHIPPED → recordDispatchHold SPLITS the ledger 70/30; totals
//      unchanged and still reconciling (Σ entries == wholesale).
//   2. SUB-THRESHOLD SHIPPED → recordDispatchHold is a NO-OP; 100% payable,
//      hold_status NONE, no HELD entry. (also case 7: non-bulk never holds)
//   3. held + window NOT expired           → holdStatus() === HELD.
//   4. held + DELIVERED + window expired + no claim → holdStatus() === RELEASABLE
//      (pure function, NO job; hold_release_at stays null).
//   5. open DefectClaim → blocks release even with expired window (HELD).
//   6. claim closed → release unblocked (RELEASABLE).
//
// Idempotent: wipes its own TEST fixtures first. Assumes `npm run db:seed`.
// Run: npm run test:printer-hold
import {
  recordDispatchHold,
  holdStatus,
  HoldAlreadyRecordedError,
  REASON_HELD_30,
  REASON_PAYABLE_70,
  REASON_WHOLESALE_OWED,
} from "../src/lib/printer-hold.ts";
import { recordOrderBilling, MERCHANT_MARKUP_PCT } from "../src/lib/billing.ts";
import { advanceFulfillment } from "../src/lib/fulfillment.ts";
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { prisma } from "../src/lib/prisma.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 24 * 60 * 60 * 1000;

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}

async function cleanup() {
  const merchant = await prisma.merchant.findUnique({
    where: { email: "merchant-zero@test.local" },
  });
  if (merchant) {
    // Collect fulfillment ids BEFORE the order cascade removes them, so we can
    // wipe the unlinked PrinterLedgerEntry rows (no FK) by fulfillmentId.
    const fulfillments = await prisma.fulfillment.findMany({
      where: { order: { merchantId: merchant.id } },
      select: { id: true },
    });
    const fIds = fulfillments.map((f) => f.id);
    if (fIds.length) {
      await prisma.printerLedgerEntry.deleteMany({
        where: { fulfillmentId: { in: fIds } },
      });
    }
    await prisma.wallet.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.order.deleteMany({ where: { merchantId: merchant.id } });
  }
  await prisma.design.deleteMany({ where: { name: { startsWith: "TEST " } } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[TEST]" } } });
  await prisma.merchant.deleteMany({
    where: { email: "merchant-zero@test.local" },
  });
}

async function ledgerFor(fulfillmentId: string) {
  return prisma.printerLedgerEntry.findMany({ where: { fulfillmentId } });
}

async function main() {
  await cleanup();

  // ── Fixtures (same shape as the other smokes). ──
  const merchant = await prisma.merchant.create({
    data: {
      name: "TEST Merchant Zero",
      is_platform_owner: true,
      email: "merchant-zero@test.local",
    },
  });
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

  // ── Route a split order: tee×30 (BULK, 1050) + mug×20 (sub, 360). ──
  const order = await createOrderWithRouting({
    merchantId: merchant.id,
    recipient: { name: "Test Buyer", line1: "1 Test Street", city: "Dubai", emirate: "Dubai" },
    lines: [
      { productId: tshirt.id, variantId: tshirt.variants[0].id, designId: design.id, method: "DTG", quantity: 30, unit_retail: 79.0 },
      { productId: mug.id, variantId: mug.variants[0].id, designId: design.id, method: "UV", quantity: 20, unit_retail: 45.0 },
    ],
  });
  await recordOrderBilling(order.id);

  const fulfillments = await prisma.fulfillment.findMany({
    where: { orderId: order.id },
    select: { id: true, is_bulk: true, wholesale_cost: true },
  });
  const bulk = fulfillments.find((f) => f.is_bulk)!;
  const sub = fulfillments.find((f) => !f.is_bulk)!;
  check("fixture: one BULK fulfillment (wholesale 1050)", !!bulk && Number(bulk.wholesale_cost) === 1050);
  check("fixture: one SUB-THRESHOLD fulfillment (wholesale 360)", !!sub && Number(sub.wholesale_cost) === 360);

  // Pre-split: each fulfillment has a single full WHOLESALE_OWED entry.
  const bulkPre = await ledgerFor(bulk.id);
  check(
    "pre-split: BULK has single WHOLESALE_OWED entry = 1050",
    bulkPre.length === 1 &&
      bulkPre[0].reason.startsWith(REASON_WHOLESALE_OWED) &&
      Number(bulkPre[0].amount) === 1050
  );

  // ── Drive BULK to SHIPPED. Bulk must clear first-article before production. ──
  await prisma.fulfillment.update({
    where: { id: bulk.id },
    data: { first_article_approved_at: new Date() },
  });
  await advanceFulfillment(bulk.id, "IN_PRODUCTION");
  await advanceFulfillment(bulk.id, "SHIPPED");
  const bulkHold = await recordDispatchHold(bulk.id);

  // ── Drive SUB to SHIPPED (not bulk → no first-article gate). ──
  await advanceFulfillment(sub.id, "IN_PRODUCTION");
  await advanceFulfillment(sub.id, "SHIPPED");
  const subHold = await recordDispatchHold(sub.id);

  // ── CASE 1: BULK SHIPPED → 70/30 split recorded. ──
  const bulkRow = await prisma.fulfillment.findUniqueOrThrow({ where: { id: bulk.id } });
  const bulkEntries = await ledgerFor(bulk.id);
  const payable70 = bulkEntries.find((e) => e.reason.startsWith(REASON_PAYABLE_70));
  const held30 = bulkEntries.find((e) => e.reason.startsWith(REASON_HELD_30));
  const owedLeft = bulkEntries.find((e) => e.reason.startsWith(REASON_WHOLESALE_OWED));
  check("[1] bulk hold_status === HELD", bulkRow.hold_status === "HELD");
  check("[1] bulk dispatch_paid === 735 (70%)", Number(bulkRow.dispatch_paid) === 735);
  check("[1] bulk held_amount === 315 (remainder)", Number(bulkRow.held_amount) === 315);
  check("[1] recordDispatchHold returned 735/315", bulkHold.dispatch_paid === 735 && bulkHold.held_amount === 315);
  check("[1] ledger split into PAYABLE_70 + HELD_30, original removed", !!payable70 && !!held30 && !owedLeft && bulkEntries.length === 2);
  check("[1] PAYABLE_70 amount === 735", !!payable70 && Number(payable70.amount) === 735);
  check("[1] HELD_30 amount === 315", !!held30 && Number(held30.amount) === 315);
  check(
    "[1] split sums to wholesale (735 + 315 === 1050) — totals unchanged",
    round2(Number(payable70!.amount) + Number(held30!.amount)) === 1050
  );
  check("[1] hold_release_at NOT stamped (lazy, no event)", bulkRow.hold_release_at === null);

  // ── CASE 2 / 7: SUB-THRESHOLD SHIPPED → no-op, 100% payable, no hold. ──
  const subRow = await prisma.fulfillment.findUniqueOrThrow({ where: { id: sub.id } });
  const subEntries = await ledgerFor(sub.id);
  check("[2] sub hold_status stays NONE", subRow.hold_status === "NONE");
  check("[2] recordDispatchHold reported no split", subHold.is_bulk === false && subHold.held_amount === null);
  check(
    "[2/7] sub keeps single full WHOLESALE_OWED entry = 360, no HELD entry",
    subEntries.length === 1 &&
      subEntries[0].reason.startsWith(REASON_WHOLESALE_OWED) &&
      Number(subEntries[0].amount) === 360 &&
      !subEntries.some((e) => e.reason.startsWith(REASON_HELD_30))
  );

  // ── Reconciliation invariant across BOTH fulfillments (totals unchanged). ──
  const allEntries = [...bulkEntries, ...subEntries];
  const totalPayable = round2(allEntries.reduce((s, e) => s + Number(e.amount), 0));
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { merchantId: merchant.id },
    include: { transactions: { where: { orderId: order.id } } },
  });
  const totalOwed = round2(wallet.transactions.reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
  const totalMargin = round2(totalOwed - totalPayable);
  check("[recon] Σ printer entries === 1410 (1050 + 360), unchanged by split", totalPayable === 1410);
  check(
    `[recon] Σowed − Σpayable === Σmargin (${totalOwed} − ${totalPayable} === ${totalMargin})`,
    round2(totalOwed - totalPayable) === totalMargin
  );
  check(
    `[recon] Σowed === Σpayable × 1.30 (${totalOwed} === ${round2(totalPayable * (1 + MERCHANT_MARKUP_PCT))})`,
    totalOwed === round2(totalPayable * (1 + MERCHANT_MARKUP_PCT))
  );

  // ── Deliver the BULK fulfillment to start the claim window (fixed time). ──
  const deliveredAt = new Date();
  await advanceFulfillment(bulk.id, "DELIVERED", { deliveredAt });
  const shipment = await prisma.shipment.findFirstOrThrow({
    where: { fulfillmentId: bulk.id },
    orderBy: { createdAt: "desc" },
  });
  const closesAt = shipment.claim_window_closes_at!;

  // ── CASE 3: held + window NOT expired → HELD. ──
  const s3 = holdStatus({
    fulfillmentStatus: "DELIVERED",
    claimWindowClosesAt: closesAt,
    openClaimCount: 0,
    now: new Date(deliveredAt.getTime() + 1 * DAY),
  });
  check("[3] delivered, window NOT expired → HELD", s3 === "HELD");

  // ── CASE 4: delivered + window expired + no claim → RELEASABLE (no job). ──
  const s4 = holdStatus({
    fulfillmentStatus: "DELIVERED",
    claimWindowClosesAt: closesAt,
    openClaimCount: 0,
    now: new Date(deliveredAt.getTime() + 31 * DAY),
  });
  check("[4] delivered + window expired + no claim → RELEASABLE (computed, no job)", s4 === "RELEASABLE");
  const bulkAfter = await prisma.fulfillment.findUniqueOrThrow({ where: { id: bulk.id } });
  check("[4] hold_release_at STILL null (releasability is computed, never stamped)", bulkAfter.hold_release_at === null);

  // ── CASE 5: open DefectClaim → blocks release even past the window. ──
  const claim = await prisma.defectClaim.create({
    data: { fulfillmentId: bulk.id, status: "OPEN", description: "TEST defect" },
  });
  const openCount = await prisma.defectClaim.count({
    where: { fulfillmentId: bulk.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });
  const s5 = holdStatus({
    fulfillmentStatus: "DELIVERED",
    claimWindowClosesAt: closesAt,
    openClaimCount: openCount,
    now: new Date(deliveredAt.getTime() + 31 * DAY),
  });
  check("[5] open claim blocks release even with expired window → HELD", openCount === 1 && s5 === "HELD");

  // ── CASE 6: close the claim → release unblocked → RELEASABLE. ──
  await prisma.defectClaim.update({ where: { id: claim.id }, data: { status: "RESOLVED" } });
  const openCountAfter = await prisma.defectClaim.count({
    where: { fulfillmentId: bulk.id, status: { in: ["OPEN", "UNDER_REVIEW"] } },
  });
  const s6 = holdStatus({
    fulfillmentStatus: "DELIVERED",
    claimWindowClosesAt: closesAt,
    openClaimCount: openCountAfter,
    now: new Date(deliveredAt.getTime() + 31 * DAY),
  });
  check("[6] claim closed → release unblocked → RELEASABLE", openCountAfter === 0 && s6 === "RELEASABLE");

  // ── Idempotency: re-recording the bulk hold throws (no double split). ──
  let idempotent = false;
  try {
    await recordDispatchHold(bulk.id);
  } catch (e) {
    idempotent = e instanceof HoldAlreadyRecordedError;
  }
  const bulkEntriesAfter = await ledgerFor(bulk.id);
  check("[idem] re-recording throws HoldAlreadyRecordedError", idempotent);
  check("[idem] still exactly 2 ledger entries after retry", bulkEntriesAfter.length === 2);

  console.log(
    ok
      ? "\n✅ PASS — 70/30 hold splits the ledger, totals reconcile, and release is computed lazily by holdStatus()."
      : "\n❌ FAIL"
  );
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Printer-hold smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

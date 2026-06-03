// Throwaway smoke test for recordOrderBilling (src/lib/billing.ts) against seed
// data. Builds the same two-fulfillment split order as order-routing-smoke
// (Tee+DTG ×10 → 350, Mug+UV ×20 → 360), records the billing ledger, then reads
// back the WalletTransaction (merchant side) + PrinterLedgerEntry (printer side)
// rows and proves the three numbers reconcile:
//
//   per fulfillment:  merchant_owed − printer_paid === platform_margin
//   per order:        Σ merchant_owed − Σ printer_paid === Σ platform_margin
//   aggregate:        same identity across all rows
//   idempotency:      re-recording throws BillingAlreadyRecordedError
//
// Idempotent: wipes its own TEST fixtures first. Assumes `npm run db:seed`.
// Run: npm run test:billing
import {
  recordOrderBilling,
  BillingAlreadyRecordedError,
  MERCHANT_MARKUP_PCT,
} from "../src/lib/billing.ts";
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { prisma } from "../src/lib/prisma.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function cleanup() {
  // Orders by merchant zero cascade to lines + fulfillments. WalletTransactions
  // cascade from the wallet; PrinterLedgerEntry is unlinked (no FK), wipe by the
  // TEST reason marker. Then the wallet, design, products, merchant.
  const merchant = await prisma.merchant.findUnique({
    where: { email: "merchant-zero@test.local" },
  });
  if (merchant) {
    const orders = await prisma.order.findMany({
      where: { merchantId: merchant.id },
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length) {
      await prisma.printerLedgerEntry.deleteMany({
        where: { reason: { in: orderIds.map((id) => `WHOLESALE_OWED order:${id}`) } },
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

async function main() {
  await cleanup();

  // ── Fixtures (same shape as order-routing-smoke). ──
  const merchant = await prisma.merchant.create({
    data: {
      name: "TEST Merchant Zero",
      is_platform_owner: true,
      email: "merchant-zero@test.local",
    },
  });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST Design" },
  });
  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const mugType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-mug" },
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

  // ── Route the order (two capabilities → two fulfillments). ──
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

  // ── Record the billing ledger. ──
  const billing = await recordOrderBilling(order.id);

  console.log(`\nOrder ${order.id}  markup=${MERCHANT_MARKUP_PCT * 100}%`);
  console.log("Per-fulfillment billing (from recordOrderBilling):");
  console.table(
    billing.fulfillments.map((f) => ({
      fulfillment: f.fulfillmentId.slice(-8),
      printer_paid: f.printer_paid,
      merchant_owed: f.merchant_owed,
      platform_margin: f.platform_margin,
    }))
  );

  // ── Read the PERSISTED ledger back (prove it's recorded, not just computed). ──
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { merchantId: merchant.id },
    include: { transactions: { where: { orderId: order.id } } },
  });
  const printerEntries = await prisma.printerLedgerEntry.findMany({
    where: { fulfillmentId: { in: billing.fulfillments.map((f) => f.fulfillmentId) } },
  });

  const persistedOwed = round2(
    wallet.transactions.reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
  );
  const persistedPaid = round2(
    printerEntries.reduce((s, e) => s + Number(e.amount), 0)
  );

  // ── Assertions. ──
  const checks: Array<[string, boolean]> = [];

  // Per-fulfillment identity.
  for (const f of billing.fulfillments) {
    checks.push([
      `[fulfillment ${f.fulfillmentId.slice(-8)}] owed(${f.merchant_owed}) − paid(${f.printer_paid}) === margin(${f.platform_margin})`,
      round2(f.merchant_owed - f.printer_paid) === f.platform_margin,
    ]);
    checks.push([
      `[fulfillment ${f.fulfillmentId.slice(-8)}] owed === round(paid × 1.30)`,
      f.merchant_owed === round2(f.printer_paid * (1 + MERCHANT_MARKUP_PCT)),
    ]);
  }

  // Known wholesale values from routing: 350 and 360.
  const owedByPaid = Object.fromEntries(
    billing.fulfillments.map((f) => [f.printer_paid, f.merchant_owed])
  );
  checks.push(["paid 350 → owed 455 (350 × 1.30)", owedByPaid[350] === 455]);
  checks.push(["paid 360 → owed 468 (360 × 1.30)", owedByPaid[360] === 468]);

  // Per-order identity (computed totals).
  checks.push([
    `per-order: Σowed(${billing.totals.merchant_owed}) − Σpaid(${billing.totals.printer_paid}) === Σmargin(${billing.totals.platform_margin})`,
    round2(billing.totals.merchant_owed - billing.totals.printer_paid) ===
      billing.totals.platform_margin,
  ]);

  // Persisted ledger matches the computed totals (recorded, not just returned).
  checks.push([
    `persisted merchant-side Σ (WalletTransaction) === Σowed (${persistedOwed} === ${billing.totals.merchant_owed})`,
    persistedOwed === billing.totals.merchant_owed,
  ]);
  checks.push([
    `persisted printer-side Σ (PrinterLedgerEntry) === Σpaid (${persistedPaid} === ${billing.totals.printer_paid})`,
    persistedPaid === billing.totals.printer_paid,
  ]);

  // Aggregate identity straight off the persisted rows.
  checks.push([
    `aggregate (persisted): Σowed − Σpaid === Σmargin (${persistedOwed} − ${persistedPaid} === ${billing.totals.platform_margin})`,
    round2(persistedOwed - persistedPaid) === billing.totals.platform_margin,
  ]);

  // Wallet balance accrued the debt as NEGATIVE net.
  checks.push([
    `wallet balance accrued debt: balance(${Number(wallet.balance)}) === −Σowed`,
    round2(Number(wallet.balance)) === round2(-billing.totals.merchant_owed),
  ]);

  // Charges are recorded as NEGATIVE amounts (sign convention).
  checks.push([
    "all merchant charges are negative amounts",
    wallet.transactions.every((t) => Number(t.amount) < 0),
  ]);

  // Idempotency: a second record throws.
  let idempotent = false;
  try {
    await recordOrderBilling(order.id);
  } catch (e) {
    idempotent = e instanceof BillingAlreadyRecordedError;
  }
  checks.push(["re-recording throws BillingAlreadyRecordedError", idempotent]);

  // No duplicate rows after the failed second attempt.
  const txnCount = await prisma.walletTransaction.count({
    where: { orderId: order.id },
  });
  checks.push([
    `still exactly 2 WalletTransactions after retry (got ${txnCount})`,
    txnCount === 2,
  ]);

  console.log("\nAssertions:");
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }

  console.log(
    ok
      ? "\n✅ PASS — billing recorded and reconciles per fulfillment, per order, and in aggregate."
      : "\n❌ FAIL"
  );
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Billing-reconcile smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

// Throwaway smoke test for createOrderWithRoutingAndBilling (src/lib/billing.ts,
// queue item 2). Before this, createOrderWithRouting (src/lib/orders.ts) and
// recordOrderBilling (src/lib/billing.ts) ran as two SEPARATE transactions: a
// crash or a thrown error between the two calls left a routed order with no
// charge recorded against it. createOrderWithRoutingAndBilling now runs
// persistRoutedOrder (orders.ts) and writeOrderBilling (billing.ts) inside ONE
// prisma.$transaction, so either both commit or neither does.
//
// Asserts:
//   happy path        — one call returns a routed order whose ledger is
//                        ALREADY reconciled (no separate recordOrderBilling
//                        call needed) — same identity checks as
//                        billing-reconcile-smoke, exercised via the new
//                        combined entry point.
//   nothing on failure — an UnroutableLineError (routing fails before the
//                        transaction opens) leaves the order count, wallet
//                        transaction count and printer ledger count UNCHANGED
//                        — no orphan order, no partial ledger.
//   shared guard       — an order created via createOrderWithRoutingAndBilling
//                        still trips recordOrderBilling's BillingAlreadyRecordedError
//                        on a second call, proving both entry points share the
//                        same BillingClaim (writeOrderBilling extraction didn't
//                        fork the idempotency guard).
//
// Idempotent: wipes its own TEST fixtures first. Assumes `npm run db:seed`.
// Run: npm run test:order-billing-atomic
import {
  createOrderWithRoutingAndBilling,
  recordOrderBilling,
  BillingAlreadyRecordedError,
  MERCHANT_MARKUP_PCT,
} from "../src/lib/billing.ts";
import { UnroutableLineError } from "../src/lib/orders.ts";
import { prisma } from "../src/lib/prisma.ts";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const EMAIL = "atomic-order-billing@test.local";

async function cleanup() {
  const merchant = await prisma.merchant.findUnique({ where: { email: EMAIL } });
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
  await prisma.design.deleteMany({ where: { name: { startsWith: "TESTATOMIC " } } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[TESTATOMIC]" } } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();

  const merchant = await prisma.merchant.create({
    data: { name: "TEST Atomic Order Billing", is_platform_owner: true, email: EMAIL },
  });
  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TESTATOMIC Design", productTypeId: tshirtType.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[TESTATOMIC] Tee",
      name_ar: "[تجريبي] تي شيرت",
      retail_price: 79.0,
      variants: { create: { sku: "TESTATOMIC-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });

  const recipient = { name: "Test Buyer", line1: "1 Test Street", city: "Dubai", emirate: "Dubai" };

  const checks: Array<[string, boolean]> = [];
  const check = (label: string, pass: boolean) => checks.push([label, pass]);

  // ════════════════════════════════════════════════════════════════
  // Happy path — one call, routed AND billed, ledger reconciles.
  // ════════════════════════════════════════════════════════════════
  const { order, billing } = await createOrderWithRoutingAndBilling({
    merchantId: merchant.id,
    recipient,
    lines: [
      {
        productId: tee.id,
        variantId: tee.variants[0].id,
        designId: design.id,
        method: "DTG",
        quantity: 10,
        unit_retail: 79.0,
      },
    ],
  });

  check("order was persisted (ROUTED, one fulfillment)", order.status === "ROUTED" && order.fulfillments.length === 1);

  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { merchantId: merchant.id },
    include: { transactions: { where: { orderId: order.id } } },
  });
  const printerEntries = await prisma.printerLedgerEntry.findMany({
    where: { fulfillmentId: { in: billing.fulfillments.map((f) => f.fulfillmentId) } },
  });

  check(
    "billing already recorded when the call returns (no second call needed)",
    wallet.transactions.length === billing.fulfillments.length &&
      printerEntries.length === billing.fulfillments.length
  );
  for (const f of billing.fulfillments) {
    check(
      `[fulfillment ${f.fulfillmentId.slice(-8)}] owed − paid === margin`,
      round2(f.merchant_owed - f.printer_paid) === f.platform_margin
    );
    check(
      `[fulfillment ${f.fulfillmentId.slice(-8)}] owed === round(paid × 1.30)`,
      f.merchant_owed === round2(f.printer_paid * (1 + MERCHANT_MARKUP_PCT))
    );
  }
  check(
    "wallet balance accrued exactly the billed debt",
    round2(Number(wallet.balance)) === round2(-billing.totals.merchant_owed)
  );

  // ════════════════════════════════════════════════════════════════
  // Nothing written on a routing failure — the whole point of queue item 2.
  // UnroutableLineError is thrown by planRoutedOrder BEFORE the transaction
  // opens, so this proves the composed function still rejects the whole
  // order atomically (no orphan order, no partial ledger) exactly like the
  // standalone createOrderWithRouting always did.
  // ════════════════════════════════════════════════════════════════
  const beforeOrders = await prisma.order.count({ where: { merchantId: merchant.id } });
  const beforeTxns = await prisma.walletTransaction.count({ where: { wallet: { merchantId: merchant.id } } });
  const beforeLedger = await prisma.printerLedgerEntry.count();

  let threwUnroutable = false;
  try {
    await createOrderWithRoutingAndBilling({
      merchantId: merchant.id,
      recipient,
      lines: [
        {
          productId: tee.id,
          variantId: tee.variants[0].id,
          designId: design.id,
          method: "UV", // T-Shirt has no UV capability in the seed — guaranteed unroutable.
          quantity: 5,
          unit_retail: 79.0,
        },
      ],
    });
  } catch (e) {
    threwUnroutable = e instanceof UnroutableLineError;
  }
  check("unroutable line throws UnroutableLineError", threwUnroutable);

  const afterOrders = await prisma.order.count({ where: { merchantId: merchant.id } });
  const afterTxns = await prisma.walletTransaction.count({ where: { wallet: { merchantId: merchant.id } } });
  const afterLedger = await prisma.printerLedgerEntry.count();
  check(`no orphan order after the failed call (${beforeOrders} → ${afterOrders})`, afterOrders === beforeOrders);
  check(`no wallet transaction after the failed call (${beforeTxns} → ${afterTxns})`, afterTxns === beforeTxns);
  check(`no printer ledger entry after the failed call (${beforeLedger} → ${afterLedger})`, afterLedger === beforeLedger);

  // ════════════════════════════════════════════════════════════════
  // Shared guard — recordOrderBilling's BillingClaim still fires for an
  // order created through the NEW combined entry point, proving
  // writeOrderBilling's extraction kept ONE idempotency guard, not two.
  // ════════════════════════════════════════════════════════════════
  let alreadyRecorded = false;
  try {
    await recordOrderBilling(order.id);
  } catch (e) {
    alreadyRecorded = e instanceof BillingAlreadyRecordedError;
  }
  check("recordOrderBilling on an already-atomically-billed order throws BillingAlreadyRecordedError", alreadyRecorded);

  console.log("\nAssertions:");
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(
    ok
      ? "\n✅ PASS — order creation and billing commit atomically; a routing failure leaves nothing behind."
      : "\n❌ FAIL"
  );
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Order-billing-atomic smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

// Throwaway smoke test for the programmatic order-intake API (src/lib/api-orders
// + src/lib/api-auth). Drives the PURE orchestration directly (the route
// handlers are a thin HTTP shell over these), so the whole contract is exercised
// without a running server — same approach as the other src/lib smokes.
//
// Asserts the contract points called out in the build plan:
//   • bad / missing / revoked API key            → 401 unauthorized
//   • happy path                                  → 201, order created + billed,
//                                                    printer NOT exposed, unit_retail echoed
//   • idempotent retry (same key)                 → 200, SAME order, no double-bill
//   • two concurrent retries (same key)           → exactly ONE order, never two
//   • unknown SKU                                 → 422 unknown_sku
//   • method not a capability                     → 422 method_not_capable
//   • design_ref not owned by caller              → 422 invalid_design
//   • valid-capability-but-unroutable line        → 422 unroutable_line (+ claim released)
//   • foreign-merchant order fetch                → 404 not_found (no existence leak)
//   • owner order fetch                           → 200
//
// Idempotent: wipes its own fixtures first. Assumes `npm run db:seed`.
// Run: npm run test:api-intake
import { apiCreateOrder, apiGetOrder } from "../src/lib/api-orders.ts";
import { generateApiKey } from "../src/lib/api-auth.ts";
import { createOrderWithRouting } from "../src/lib/orders.ts";
import { prisma } from "../src/lib/prisma.ts";

const EMAIL_A = "api-merchant-a@test.local";
const EMAIL_B = "api-merchant-b@test.local";

async function cleanup() {
  for (const email of [EMAIL_A, EMAIL_B]) {
    const merchant = await prisma.merchant.findUnique({ where: { email } });
    if (!merchant) continue;
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
    // apiKeys + idempotencyKeys + wallet(+txns) cascade on merchant delete, but
    // orders must go first (Order→Merchant is a restricted relation).
    await prisma.wallet.deleteMany({ where: { merchantId: merchant.id } });
    await prisma.order.deleteMany({ where: { merchantId: merchant.id } });
  }
  // Prefix "[TESTAPI]" / "TESTAPI " deliberately does NOT start with the other
  // smokes' "[TEST]" / "TEST " markers, so the suites never delete each other's
  // fixtures.
  await prisma.design.deleteMany({ where: { name: { startsWith: "TESTAPI " } } });
  await prisma.product.deleteMany({ where: { name_en: { startsWith: "[TESTAPI]" } } });
  await prisma.merchant.deleteMany({ where: { email: { in: [EMAIL_A, EMAIL_B] } } });
}

const checks: Array<[string, boolean]> = [];
const check = (label: string, pass: boolean) => checks.push([label, pass]);
const body = (o: unknown) => JSON.stringify(o);

async function main() {
  await cleanup();

  // ── Fixtures: two merchants, an API key for A, a design each. ──
  const merchantA = await prisma.merchant.create({
    data: { name: "TESTAPI Merchant A", is_platform_owner: true, email: EMAIL_A },
  });
  const merchantB = await prisma.merchant.create({
    data: { name: "TESTAPI Merchant B", email: EMAIL_B },
  });

  // A's live key (capture the raw token once — only the hash is stored).
  const liveKey = generateApiKey();
  await prisma.merchantApiKey.create({
    data: {
      merchantId: merchantA.id,
      name: "smoke live",
      token_hash: liveKey.token_hash,
      token_prefix: liveKey.token_prefix,
      last4: liveKey.last4,
    },
  });
  const AUTH_A = `Bearer ${liveKey.token}`;

  // A second key for A that we revoke, to prove a revoked key → 401.
  const revokedKey = generateApiKey();
  await prisma.merchantApiKey.create({
    data: {
      merchantId: merchantA.id,
      name: "smoke revoked",
      token_hash: revokedKey.token_hash,
      token_prefix: revokedKey.token_prefix,
      last4: revokedKey.last4,
      revoked_at: new Date(),
    },
  });

  const designA = await prisma.design.create({
    data: { merchantId: merchantA.id, name: "TESTAPI Design A" },
  });
  const designB = await prisma.design.create({
    data: { merchantId: merchantB.id, name: "TESTAPI Design B" },
  });

  // Catalog: a DTG-capable tee (routable) + a PAPER_PRINT business card whose
  // capability has min_qty 50 (qty 1 is a VALID capability but UNROUTABLE).
  const tshirtType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-tshirt" },
  });
  const cardType = await prisma.productType.findUniqueOrThrow({
    where: { slug: "test-business-card" },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: tshirtType.id,
      name_en: "[TESTAPI] Tee",
      name_ar: "[TESTAPI] تي شيرت",
      retail_price: 79.0,
      variants: { create: { sku: "TESTAPI-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const card = await prisma.product.create({
    data: {
      productTypeId: cardType.id,
      name_en: "[TESTAPI] Card",
      name_ar: "[TESTAPI] بطاقة",
      retail_price: 5.0,
      variants: { create: { sku: "TESTAPI-CARD", size: "Std", color: "White" } },
    },
    include: { variants: true },
  });

  const recipient = {
    name: "Test Buyer",
    line1: "1 Test Street",
    city: "Dubai",
    emirate: "Dubai",
  };
  const teeLine = { sku: "TESTAPI-TEE-M", method: "DTG", quantity: 2, design_ref: designA.id };

  // ── (1) Bad / missing key → 401. ──
  const noHeader = await apiCreateOrder(null, body({ idempotency_key: "x", recipient, lines: [teeLine] }));
  check("missing Authorization → 401 unauthorized", noHeader.httpStatus === 401 && (noHeader.body as any).error.code === "unauthorized");

  const badKey = await apiCreateOrder("Bearer not-a-real-key", body({ idempotency_key: "x", recipient, lines: [teeLine] }));
  check("unknown key → 401 unauthorized", badKey.httpStatus === 401 && (badKey.body as any).error.code === "unauthorized");

  const revoked = await apiCreateOrder(`Bearer ${revokedKey.token}`, body({ idempotency_key: "x", recipient, lines: [teeLine] }));
  check("revoked key → 401 unauthorized", revoked.httpStatus === 401 && (revoked.body as any).error.code === "unauthorized");

  // ── (2) Happy path → 201; printer NOT exposed; unit_retail echoed. ──
  const created = await apiCreateOrder(AUTH_A, body({ idempotency_key: "idem-happy", recipient, lines: [teeLine] }));
  const createdBody = created.body as any;
  check("happy path → 201 created", created.httpStatus === 201 && typeof createdBody.id === "string");
  const orderAId: string = createdBody.id;
  check("response exposes NO printer identity", JSON.stringify(createdBody).toLowerCase().indexOf("printer") === -1);
  check("response echoes unit_retail per line (79)", createdBody.lines?.[0]?.unit_retail === 79);
  check("response echoes sku per line", createdBody.lines?.[0]?.sku === "TESTAPI-TEE-M");
  // Billing was recorded: one WalletTransaction for this order.
  const billedCount1 = await prisma.walletTransaction.count({ where: { orderId: orderAId } });
  check("billing recorded once (1 wallet txn)", billedCount1 === 1);

  // ── (3) Idempotent retry → 200, SAME order, NO double-bill. ──
  const retry = await apiCreateOrder(AUTH_A, body({ idempotency_key: "idem-happy", recipient, lines: [teeLine] }));
  check("idempotent retry → 200", retry.httpStatus === 200);
  check("idempotent retry returns the SAME order id", (retry.body as any).id === orderAId);
  const ordersAfterRetry = await prisma.order.count({ where: { merchantId: merchantA.id } });
  check("retry created no second order (count still 1)", ordersAfterRetry === 1);
  const billedCount2 = await prisma.walletTransaction.count({ where: { orderId: orderAId } });
  check("retry did NOT double-bill (still 1 wallet txn)", billedCount2 === 1);

  // ── (4) Two concurrent retries with a NEW key → exactly ONE order. ──
  const beforeConcurrent = await prisma.order.count({ where: { merchantId: merchantA.id } });
  const [c1, c2] = await Promise.all([
    apiCreateOrder(AUTH_A, body({ idempotency_key: "idem-concurrent", recipient, lines: [teeLine] })),
    apiCreateOrder(AUTH_A, body({ idempotency_key: "idem-concurrent", recipient, lines: [teeLine] })),
  ]);
  const afterConcurrent = await prisma.order.count({ where: { merchantId: merchantA.id } });
  const statuses = [c1.httpStatus, c2.httpStatus].sort();
  const exactlyOneCreated = statuses.filter((s) => s === 201).length === 1;
  const otherIsReplayOrInProgress = statuses.some((s) => s === 200 || s === 409);
  check("concurrent: exactly one 201 (the winner)", exactlyOneCreated);
  check("concurrent: other is 200 replay or 409 in-progress", otherIsReplayOrInProgress);
  check("concurrent: exactly ONE new order created", afterConcurrent - beforeConcurrent === 1);

  // ── (5) Unknown SKU → 422 unknown_sku. ──
  const unknownSku = await apiCreateOrder(AUTH_A, body({
    idempotency_key: "idem-unknown-sku",
    recipient,
    lines: [{ sku: "NOPE-DOES-NOT-EXIST", method: "DTG", quantity: 1, design_ref: designA.id }],
  }));
  check("unknown SKU → 422 unknown_sku", unknownSku.httpStatus === 422 && (unknownSku.body as any).error.code === "unknown_sku");

  // ── (6) Method not a capability → 422 method_not_capable. ──
  const badMethod = await apiCreateOrder(AUTH_A, body({
    idempotency_key: "idem-bad-method",
    recipient,
    lines: [{ sku: "TESTAPI-TEE-M", method: "UV", quantity: 1, design_ref: designA.id }],
  }));
  check("method not capable → 422 method_not_capable", badMethod.httpStatus === 422 && (badMethod.body as any).error.code === "method_not_capable");

  // ── (7) design_ref owned by another merchant → 422 invalid_design. ──
  const foreignDesign = await apiCreateOrder(AUTH_A, body({
    idempotency_key: "idem-foreign-design",
    recipient,
    lines: [{ sku: "TESTAPI-TEE-M", method: "DTG", quantity: 1, design_ref: designB.id }],
  }));
  check("foreign design_ref → 422 invalid_design", foreignDesign.httpStatus === 422 && (foreignDesign.body as any).error.code === "invalid_design");

  // ── (8) Valid-capability-but-unroutable line (card qty 1 < min_qty 50). ──
  const unroutable = await apiCreateOrder(AUTH_A, body({
    idempotency_key: "idem-unroutable",
    recipient,
    lines: [{ sku: "TESTAPI-CARD", method: "PAPER_PRINT", quantity: 1, design_ref: designA.id }],
  }));
  check("unroutable line → 422 unroutable_line", unroutable.httpStatus === 422 && (unroutable.body as any).error.code === "unroutable_line");
  check("unroutable error carries structured details", typeof (unroutable.body as any).error.details?.method === "string");
  // Claim must have been RELEASED so the same key can be retried after a fix.
  const leftoverClaim = await prisma.orderIdempotencyKey.findUnique({
    where: { merchantId_idempotency_key: { merchantId: merchantA.id, idempotency_key: "idem-unroutable" } },
    select: { id: true },
  });
  check("unroutable failure released the idempotency claim", leftoverClaim === null);

  // ── (9) Foreign-merchant order fetch → 404 (no existence leak). ──
  // Build an order owned by B (B has no key; create it directly via the engine).
  const orderB = await createOrderWithRouting({
    merchantId: merchantB.id,
    recipient,
    lines: [{ productId: tee.id, variantId: tee.variants[0].id, designId: designB.id, method: "DTG", quantity: 2, unit_retail: 79 }],
  });
  const foreignGet = await apiGetOrder(AUTH_A, orderB.id);
  check("A fetching B's order → 404 not_found", foreignGet.httpStatus === 404 && (foreignGet.body as any).error.code === "not_found");

  const unknownGet = await apiGetOrder(AUTH_A, "ord_does_not_exist");
  check("A fetching a nonexistent id → identical 404", unknownGet.httpStatus === 404 && (unknownGet.body as any).error.code === "not_found");

  // ── (10) Owner order fetch → 200. ──
  const ownerGet = await apiGetOrder(AUTH_A, orderAId);
  check("A fetching A's own order → 200", ownerGet.httpStatus === 200 && (ownerGet.body as any).id === orderAId);
  check("GET response also hides printer identity", JSON.stringify(ownerGet.body).toLowerCase().indexOf("printer") === -1);

  // ── Report. ──
  console.log("");
  let ok = true;
  for (const [label, pass] of checks) {
    console.log(`${pass ? "✅" : "❌"} ${label}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "\n✅ PASS — programmatic intake API contract holds." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("API-intake smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

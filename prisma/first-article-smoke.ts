// Smoke test for the bulk first-article flow (queue 4, data model §5b / §219):
//   ROUTED → FIRST_ARTICLE_PENDING → FIRST_ARTICLE_APPROVED → IN_PRODUCTION,
//   or rejected → back to ROUTED with the gate still closed.
// Everything goes through the lib functions — no direct DB writes to move state.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/first-article-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import {
  advanceFulfillment,
  decideFirstArticle,
  submitFirstArticle,
  FirstArticleRequiredError,
  InvalidTransitionError,
} from "../src/lib/fulfillment.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}
async function rejects(fn: () => Promise<unknown>, cls: new (...a: never[]) => Error) {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof cls;
  }
}

const EMAIL = "first-article@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] First-Article Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();
  const merchant = await prisma.merchant.create({
    data: { name: "TEST First-Article Merchant", is_platform_owner: true, email: EMAIL },
  });
  const type = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST FA Design", productTypeId: type.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: type.id,
      name_en: "[TEST] First-Article Tee",
      name_ar: "[تجريبي] تي شيرت العيّنة الأولى",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-FA-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const place = (quantity: number) =>
    createOrderWithRouting({
      merchantId: merchant.id,
      recipient: { name: "FA Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
      lines: [
        { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity, unit_retail: 79.0 },
      ],
    });
  const status = async (id: string) =>
    (await prisma.fulfillment.findUniqueOrThrow({ where: { id } }));

  // ── Bulk: 30 × 35 = AED 1,050 ≥ 1,000. ──
  const bulk = (await place(30)).fulfillments[0];
  check("fixture is bulk", bulk.is_bulk === true);

  check(
    "approve/reject before the proof unit is submitted is refused",
    (await rejects(() => decideFirstArticle(bulk.id, "APPROVE"), InvalidTransitionError)) &&
      (await rejects(() => decideFirstArticle(bulk.id, "REJECT"), InvalidTransitionError))
  );

  await submitFirstArticle(bulk.id);
  check("submit → FIRST_ARTICLE_PENDING", (await status(bulk.id)).status === "FIRST_ARTICLE_PENDING");
  check(
    "cannot submit twice",
    await rejects(() => submitFirstArticle(bulk.id), InvalidTransitionError)
  );
  check(
    "pending cannot jump to IN_PRODUCTION",
    await rejects(() => advanceFulfillment(bulk.id, "IN_PRODUCTION"), InvalidTransitionError)
  );

  await decideFirstArticle(bulk.id, "REJECT");
  const rej = await status(bulk.id);
  check("reject → back to ROUTED, not approved", rej.status === "ROUTED" && rej.first_article_approved_at == null);
  check(
    "gate still closed after reject",
    await rejects(() => advanceFulfillment(bulk.id, "IN_PRODUCTION"), FirstArticleRequiredError)
  );

  await submitFirstArticle(bulk.id);
  await decideFirstArticle(bulk.id, "APPROVE");
  const appr = await status(bulk.id);
  check(
    "approve → FIRST_ARTICLE_APPROVED with timestamp",
    appr.status === "FIRST_ARTICLE_APPROVED" && appr.first_article_approved_at != null
  );
  check(
    "cannot decide twice",
    await rejects(() => decideFirstArticle(bulk.id, "REJECT"), InvalidTransitionError)
  );
  const { orderStatus } = await advanceFulfillment(bulk.id, "IN_PRODUCTION");
  check("approved bulk proceeds to IN_PRODUCTION", orderStatus === "IN_PRODUCTION");

  // ── Non-bulk never goes through first article. ──
  const small = (await place(2)).fulfillments[0];
  check("small fixture is not bulk", small.is_bulk === false);
  check(
    "non-bulk cannot submit a first article",
    await rejects(() => submitFirstArticle(small.id), InvalidTransitionError)
  );

  await cleanup();
  console.log(ok ? "\n✅ PASS — first-article flow correct." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("First-article smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

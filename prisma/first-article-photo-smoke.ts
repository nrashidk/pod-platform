// Smoke test for first-article PHOTO proof (queue 4b, data model §5b):
// the owning printer uploads a photo (stub store, never real Blob), which
// submits the first article; wrong owner / bad type / oversize / non-bulk /
// wrong status are refused and change nothing.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/first-article-photo-smoke.ts
import { createOrderWithRouting } from "../src/lib/orders.ts";
import {
  decideFirstArticle,
  FulfillmentOwnershipError,
  InvalidTransitionError,
} from "../src/lib/fulfillment.ts";
import {
  FIRST_ARTICLE_PHOTO_MAX_BYTES,
  FirstArticlePhotoInvalidError,
  firstArticlePhotoViewUrl,
  submitFirstArticleWithPhoto,
} from "../src/lib/first-article-photo.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
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

const EMAIL = "first-article-photo@test.local";

async function cleanup() {
  await prisma.order.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.design.deleteMany({ where: { merchant: { email: EMAIL } } });
  await prisma.product.deleteMany({ where: { name_en: "[TEST] FA Photo Tee" } });
  await prisma.merchant.deleteMany({ where: { email: EMAIL } });
}

async function main() {
  await cleanup();
  const store = new StubPrintFileStore();
  const merchant = await prisma.merchant.create({
    data: { name: "TEST First-Article-Photo Merchant", is_platform_owner: true, email: EMAIL },
  });
  const type = await prisma.productType.findUniqueOrThrow({ where: { slug: "test-tshirt" } });
  const design = await prisma.design.create({
    data: { merchantId: merchant.id, name: "TEST FAP Design", productTypeId: type.id },
  });
  const tee = await prisma.product.create({
    data: {
      productTypeId: type.id,
      name_en: "[TEST] FA Photo Tee",
      name_ar: "[تجريبي] تي شيرت صورة العيّنة",
      retail_price: 79.0,
      variants: { create: { sku: "TEST-FAP-TEE-M", size: "M", color: "Black" } },
    },
    include: { variants: true },
  });
  const place = (quantity: number) =>
    createOrderWithRouting({
      merchantId: merchant.id,
      recipient: { name: "FAP Buyer", line1: "1 Test St", city: "Dubai", emirate: "Dubai" },
      lines: [
        { productId: tee.id, variantId: tee.variants[0].id, designId: design.id, method: "DTG", quantity, unit_retail: 79.0 },
      ],
    });
  const row = (id: string) => prisma.fulfillment.findUniqueOrThrow({ where: { id } });
  const jpg = (n = 100) => ({ buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(Math.max(n - 3, 0), 1)]).subarray(0, n), filename: "proof.jpg", contentType: "image/jpeg" });

  const bulk = (await place(30)).fulfillments[0];
  check("fixture is bulk", bulk.is_bulk === true);
  const owner = bulk.printerId;

  check(
    "another printer cannot upload",
    await rejects(() => submitFirstArticleWithPhoto(bulk.id, "not-the-owner", jpg(), store), FulfillmentOwnershipError)
  );
  check(
    "wrong content type refused",
    await rejects(
      () => submitFirstArticleWithPhoto(bulk.id, owner, { ...jpg(), contentType: "application/pdf" }, store),
      FirstArticlePhotoInvalidError
    )
  );
  check(
    "bytes that are not the claimed image type refused",
    await rejects(
      () => submitFirstArticleWithPhoto(bulk.id, owner, { buffer: Buffer.from("<html>not an image</html>"), filename: "x.png", contentType: "image/png" }, store),
      FirstArticlePhotoInvalidError
    )
  );
  check(
    "oversize refused",
    await rejects(
      () => submitFirstArticleWithPhoto(bulk.id, owner, jpg(FIRST_ARTICLE_PHOTO_MAX_BYTES + 1), store),
      FirstArticlePhotoInvalidError
    )
  );
  check(
    "empty refused",
    await rejects(() => submitFirstArticleWithPhoto(bulk.id, owner, jpg(0), store), FirstArticlePhotoInvalidError)
  );
  const untouched = await row(bulk.id);
  check(
    "refusals changed nothing",
    untouched.status === "ROUTED" && untouched.first_article_photo_url == null
  );

  await submitFirstArticleWithPhoto(bulk.id, owner, jpg(), store);
  const pending = await row(bulk.id);
  check(
    "upload stores the photo and submits the first article",
    pending.status === "FIRST_ARTICLE_PENDING" &&
      pending.first_article_photo_url != null &&
      pending.first_article_photo_uploaded_at != null &&
      (await store.head(pending.first_article_photo_url)) != null
  );
  check(
    "ops can get a read link for the photo",
    (await firstArticlePhotoViewUrl(pending.first_article_photo_url, store)) === pending.first_article_photo_url &&
      (await firstArticlePhotoViewUrl(null, store)) === null
  );

  const firstUrl = pending.first_article_photo_url;
  await submitFirstArticleWithPhoto(bulk.id, owner, { ...jpg(), filename: "proof2.jpg" }, store);
  const replaced = await row(bulk.id);
  check(
    "photo can be replaced while pending; status unchanged",
    replaced.status === "FIRST_ARTICLE_PENDING" && replaced.first_article_photo_url !== firstUrl
  );

  await decideFirstArticle(bulk.id, "REJECT");
  const rejected = await row(bulk.id);
  check(
    "reject clears the photo so it cannot be shown for the next proof",
    rejected.status === "ROUTED" && rejected.first_article_photo_url == null && rejected.first_article_photo_uploaded_at == null
  );
  await submitFirstArticleWithPhoto(bulk.id, owner, jpg(), store);
  await decideFirstArticle(bulk.id, "APPROVE");
  check(
    "no upload after approval",
    await rejects(() => submitFirstArticleWithPhoto(bulk.id, owner, jpg(), store), InvalidTransitionError)
  );

  const small = (await place(2)).fulfillments[0];
  check(
    "non-bulk cannot upload a first-article photo",
    await rejects(() => submitFirstArticleWithPhoto(small.id, small.printerId, jpg(), store), InvalidTransitionError)
  );

  await cleanup();
  console.log(ok ? "\n✅ PASS — first-article photo proof correct." : "\n❌ FAIL");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("First-article photo smoke failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

// Smoke test for merchant brand settings (queue 10, data model §1/§6): a
// merchant edits only their own brand text + logo; bad input is rejected with
// nothing written; the logo is judged by its real bytes; Arabic variants fall
// back to English; the packing slip data carries the Arabic variants.
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/merchant-brand-smoke.ts
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_TEXT_LIMITS,
  BrandInvalidError,
  getMerchantBrand,
  localizedBrandText,
  removeMerchantLogo,
  updateMerchantBrandText,
  uploadMerchantLogo,
} from "../src/lib/merchant-brand.ts";
import { StubPrintFileStore } from "../src/lib/print-file-store.ts";
import { prisma } from "../src/lib/prisma.ts";

let ok = true;
function check(label: string, pass: boolean) {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) ok = false;
}
async function rejects(fn: () => Promise<unknown>, reason: string): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch (e) {
    return e instanceof BrandInvalidError && e.reason === reason;
  }
}

const A = "brand-a@test.local";
const B = "brand-b@test.local";
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

async function cleanup() {
  await prisma.merchant.deleteMany({ where: { email: { in: [A, B] } } });
}

async function main() {
  await cleanup();
  const a = await prisma.merchant.create({ data: { name: "TEST Brand A", email: A } });
  const b = await prisma.merchant.create({
    data: { name: "TEST Brand B", email: B, packing_slip_message: "B message" },
  });
  const store = new StubPrintFileStore();

  // ── text ──
  const saved = await updateMerchantBrandText(a.id, {
    packing_slip_message: "  Thanks!  ",
    packing_slip_message_ar: "شكرًا لك",
    return_address: "1 Return Rd, Dubai",
    return_address_ar: "",
    custom_packaging_note: "Tissue paper",
  });
  check(
    "text saved trimmed; empty string becomes null",
    saved.packing_slip_message === "Thanks!" &&
      saved.packing_slip_message_ar === "شكرًا لك" &&
      saved.return_address === "1 Return Rd, Dubai" &&
      saved.return_address_ar === null &&
      saved.custom_packaging_note === "Tissue paper"
  );

  const partial = await updateMerchantBrandText(a.id, { packing_slip_message: "Second" });
  check(
    "a field left out is untouched",
    partial.packing_slip_message === "Second" && partial.custom_packaging_note === "Tissue paper"
  );

  check(
    "over-long text is rejected",
    await rejects(
      () =>
        updateMerchantBrandText(a.id, {
          packing_slip_message: "x".repeat(BRAND_TEXT_LIMITS.packing_slip_message + 1),
        }),
      "too_long"
    )
  );
  check(
    "one bad field rejects the whole save (nothing written)",
    await rejects(
      () =>
        updateMerchantBrandText(a.id, {
          custom_packaging_note: "changed",
          return_address: "y".repeat(BRAND_TEXT_LIMITS.return_address + 1),
        }),
      "too_long"
    )
  );
  const afterBad = await getMerchantBrand(a.id);
  check(
    "rejected save left the stored values as they were",
    afterBad.custom_packaging_note === "Tissue paper" &&
      afterBad.packing_slip_message === "Second"
  );
  const bAfter = await getMerchantBrand(b.id);
  check(
    "another merchant's brand is untouched",
    bAfter.packing_slip_message === "B message" && bAfter.packing_slip_message_ar === null
  );

  // ── logo ──
  check(
    "empty logo rejected",
    await rejects(
      () => uploadMerchantLogo(a.id, { buffer: Buffer.alloc(0), filename: "l.png", contentType: "image/png" }, store),
      "empty"
    )
  );
  check(
    "non-image type rejected",
    await rejects(
      () => uploadMerchantLogo(a.id, { buffer: PNG, filename: "l.pdf", contentType: "application/pdf" }, store),
      "type"
    )
  );
  check(
    "spoofed type (PNG claim, wrong bytes) rejected",
    await rejects(
      () => uploadMerchantLogo(a.id, { buffer: Buffer.alloc(64, 7), filename: "l.png", contentType: "image/png" }, store),
      "type"
    )
  );
  check(
    "oversize logo rejected",
    await rejects(
      () =>
        uploadMerchantLogo(
          a.id,
          { buffer: Buffer.concat([PNG, Buffer.alloc(BRAND_LOGO_MAX_BYTES)]), filename: "l.png", contentType: "image/png" },
          store
        ),
      "size"
    )
  );
  check("rejected uploads set no logo", (await getMerchantBrand(a.id)).brand_logo_url === null);

  const withLogo = await uploadMerchantLogo(a.id, { buffer: PNG, filename: "logo.png", contentType: "image/png" }, store);
  check(
    "valid PNG stored and referenced",
    !!withLogo.brand_logo_url && (await store.head(withLogo.brand_logo_url)) != null
  );
  check("other merchant has no logo", (await getMerchantBrand(b.id)).brand_logo_url === null);
  check("logo removed", (await removeMerchantLogo(a.id)).brand_logo_url === null);

  // ── locale fallback ──
  check(
    "AR shown when set; EN shown for EN",
    localizedBrandText("hello", "مرحبا", "ar") === "مرحبا" &&
      localizedBrandText("hello", "مرحبا", "en") === "hello"
  );
  check(
    "falls back across languages when one is missing; null when both missing",
    localizedBrandText("hello", null, "ar") === "hello" &&
      localizedBrandText(null, "مرحبا", "en") === "مرحبا" &&
      localizedBrandText(null, null, "ar") === null
  );

  await cleanup();
  if (!ok) process.exit(1);
  console.log("merchant-brand smoke: all checks passed");
}

main()
  .catch(async (e) => {
    console.error(e);
    await cleanup().catch(() => {});
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

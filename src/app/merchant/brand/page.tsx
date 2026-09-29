// Merchant brand settings (server component). A signed-in MERCHANT edits ONLY
// their own brand assets — the merchant id comes from the session, never a
// request param. Plain forms posting to server actions; the outcome comes back
// as ?saved=1 / ?err=<kind>. Bilingual EN/AR with RTL via logical utilities.

import { requireRole } from "@/lib/auth-context";
import { type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/locale";
import { prisma } from "@/lib/prisma";
import {
  BRAND_TEXT_LIMITS,
  brandLogoViewUrl,
  getMerchantBrand,
} from "@/lib/merchant-brand";
import { MerchantShell } from "../MerchantShell";
import { bt, brandErrorKey } from "./labels";
import {
  removeLogoAction,
  saveBrandTextAction,
  uploadLogoAction,
} from "./actions";

export const dynamic = "force-dynamic";

const inputCls =
  "mt-1 block w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-sm";
const buttonCls =
  "rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600";

export default async function MerchantBrandPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; saved?: string; err?: string }>;
}) {
  const ctx = await requireRole("MERCHANT");
  const sp = await searchParams;
  const locale: Locale = await getRequestLocale(sp.lang);

  const [brand, wallet] = await Promise.all([
    ctx.merchantId ? getMerchantBrand(ctx.merchantId) : Promise.resolve(null),
    ctx.merchantId
      ? prisma.wallet.findUnique({
          where: { merchantId: ctx.merchantId },
          select: { balance: true, currency: true },
        })
      : Promise.resolve(null),
  ]);
  const logoUrl = brand ? await brandLogoViewUrl(brand.brand_logo_url) : null;
  const walletChip = wallet
    ? { balance: Number(wallet.balance), currency: wallet.currency }
    : null;

  return (
    <MerchantShell
      locale={locale}
      active="brand"
      basePath="/merchant/brand"
      wallet={walletChip}
    >
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{bt("title", locale)}</h1>
          <p className="mt-1.5 text-sm text-muted">{bt("subtitle", locale)}</p>
        </header>

        {sp.saved === "1" && (
          <p role="status" className="mb-4 rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">
            {bt("saved", locale)}
          </p>
        )}
        {sp.err && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">
            {bt(brandErrorKey(sp.err), locale)}
          </p>
        )}

        {!brand ? (
          <p className="text-muted">{bt("errGeneric", locale)}</p>
        ) : (
          <>
            <section className="mb-8 rounded-2xl border border-hairline bg-surface p-5 shadow-card">
              <h2 className="text-sm font-semibold text-ink">{bt("logoHeading", locale)}</h2>
              <p className="mb-3 mt-1 text-sm text-muted">{bt("logoHint", locale)}</p>
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoUrl}
                  alt={bt("logoAlt", locale)}
                  className="mb-3 max-h-24 max-w-full rounded-md border border-hairline bg-white p-2"
                />
              ) : (
                <p className="mb-3 text-sm text-muted">
                  {brand.brand_logo_url ? bt("logoAlt", locale) : bt("logoNone", locale)}
                </p>
              )}
              <form action={uploadLogoAction} className="flex flex-wrap items-center gap-3">
                <input
                  type="file"
                  name="logo"
                  accept="image/jpeg,image/png,image/webp"
                  required
                  className="text-sm"
                />
                <button type="submit" className={buttonCls}>
                  {bt("logoUpload", locale)}
                </button>
              </form>
              {brand.brand_logo_url && (
                <form action={removeLogoAction} className="mt-3">
                  <button type="submit" className="text-sm font-medium text-red-700 underline">
                    {bt("logoRemove", locale)}
                  </button>
                </form>
              )}
            </section>

            <form
              action={saveBrandTextAction}
              className="rounded-2xl border border-hairline bg-surface p-5 shadow-card"
            >
              <h2 className="text-sm font-semibold text-ink">{bt("textHeading", locale)}</h2>
              <p className="mb-3 mt-1 text-sm text-muted">{bt("messageHint", locale)}</p>

              <label className="block text-sm font-medium">
                {bt("messageEn", locale)}
                <textarea
                  name="packing_slip_message"
                  rows={3}
                  dir="ltr"
                  maxLength={BRAND_TEXT_LIMITS.packing_slip_message}
                  defaultValue={brand.packing_slip_message ?? ""}
                  className={inputCls}
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                {bt("messageAr", locale)}
                <textarea
                  name="packing_slip_message_ar"
                  rows={3}
                  dir="rtl"
                  maxLength={BRAND_TEXT_LIMITS.packing_slip_message_ar}
                  defaultValue={brand.packing_slip_message_ar ?? ""}
                  className={inputCls}
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                {bt("returnEn", locale)}
                <textarea
                  name="return_address"
                  rows={3}
                  dir="ltr"
                  maxLength={BRAND_TEXT_LIMITS.return_address}
                  defaultValue={brand.return_address ?? ""}
                  className={inputCls}
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                {bt("returnAr", locale)}
                <textarea
                  name="return_address_ar"
                  rows={3}
                  dir="rtl"
                  maxLength={BRAND_TEXT_LIMITS.return_address_ar}
                  defaultValue={brand.return_address_ar ?? ""}
                  className={inputCls}
                />
              </label>
              <label className="mt-4 block text-sm font-medium">
                {bt("packagingNote", locale)}
                <span className="block text-xs font-normal text-muted">
                  {bt("packagingHint", locale)}
                </span>
                <textarea
                  name="custom_packaging_note"
                  rows={2}
                  maxLength={BRAND_TEXT_LIMITS.custom_packaging_note}
                  defaultValue={brand.custom_packaging_note ?? ""}
                  className={inputCls}
                />
              </label>
              <button type="submit" className={`mt-5 ${buttonCls}`}>
                {bt("save", locale)}
              </button>
            </form>
          </>
        )}
      </div>
    </MerchantShell>
  );
}

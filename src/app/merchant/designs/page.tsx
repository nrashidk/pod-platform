// Merchant design manager (server component). A signed-in MERCHANT sees ONLY
// their OWN designs — scoped in the data layer from the session's merchantId,
// never from client input. They create designs and upload a print file per
// placement; each file is validated against the PrintArea spec and recorded as
// PASSED/FLAGGED. A design is orderable only when every placement is PASSED.
// Bilingual EN/AR with RTL — consistent with /merchant.

import Link from "next/link";
import { requireRole } from "@/lib/auth-context";
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { listMyDesigns, listDesignableProductTypes } from "@/lib/designs";
import { LogoutButton } from "@/components/logout-button";
import { CreateDesignForm } from "./CreateDesignForm";
import { UploadPlacementForm } from "./UploadPlacementForm";
import {
  dt,
  placementLabel,
  statusLabel,
  placementRequirements,
  friendlyReason,
} from "./labels";

// Designs + validation statuses change as files are uploaded; always fresh.
export const dynamic = "force-dynamic";

export default async function MerchantDesignsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  // DATA-LAYER GATE: MERCHANT-only. requireRole reads the session server-side
  // and redirects anyone who isn't a signed-in merchant. ctx.merchantId is the
  // identity every scoped read below filters on (never a request param).
  const ctx = await requireRole("MERCHANT");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);

  const [designs, productTypes] = await Promise.all([
    ctx.merchantId ? listMyDesigns(ctx.merchantId) : Promise.resolve([]),
    listDesignableProductTypes(),
  ]);

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{dt("title", locale)}</h1>
            <p className="mt-1 text-sm text-gray-600">{dt("subtitle", locale)}</p>
            <Link
              href={`/merchant?lang=${locale}`}
              className="mt-2 inline-block text-sm font-medium text-gray-600 hover:text-gray-900"
            >
              {dt("backToOrders", locale)}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle locale={locale} />
            <LogoutButton label={dt("logout", locale)} />
          </div>
        </header>

        {/* Create design */}
        <section className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">{dt("createHeading", locale)}</h2>
          <p className="mt-1 mb-3 text-sm text-gray-500">{dt("createHint", locale)}</p>
          <CreateDesignForm locale={locale} productTypes={productTypes} />
        </section>

        {/* List */}
        {designs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            {dt("noDesigns", locale)}
          </p>
        ) : (
          <ul className="space-y-4">
            {designs.map((d) => (
              <li
                key={d.id}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="font-medium">{d.name}</div>
                    <div className="mt-0.5 text-sm text-gray-500">
                      {locale === "ar" ? d.productType.name_ar : d.productType.name_en}
                    </div>
                  </div>
                  <OrderableBadge orderable={d.orderable} locale={locale} />
                </div>

                <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {dt("placementsHeading", locale)}
                  </h3>
                  <ul className="space-y-4">
                    {d.placements.map((p) => (
                      <li
                        key={p.placement}
                        className="rounded-lg border border-gray-200 bg-white p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium">
                            {placementLabel(p.placement, locale)}
                          </span>
                          <StatusBadge status={p.status} locale={locale} />
                        </div>

                        {/* Up-front requirements, stated BEFORE a file is chosen
                            and derived from the PrintArea spec — so the merchant
                            knows the target and the first upload can succeed. */}
                        <div className="mt-2 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600">
                          <span className="font-medium text-gray-700">
                            {dt("reqLabel", locale)}:{" "}
                          </span>
                          {placementRequirements(locale, {
                            formats: p.allowed_formats,
                            minWidthPx: p.min_width_px,
                            minHeightPx: p.min_height_px,
                            maxFileMb: p.max_file_mb,
                          })}
                          {p.print_file_url && (
                            <>
                              {" "}
                              {/* Private store: link to the ownership-gated route,
                                  which mints a short-lived signed URL on click.
                                  Never the raw blob URL (it 403s + would leak IP). */}
                              <a
                                href={`/api/merchant/designs/file?designId=${encodeURIComponent(
                                  d.id
                                )}&placement=${encodeURIComponent(p.placement)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-medium text-gray-600 underline hover:text-gray-900"
                              >
                                {dt("viewFile", locale)}
                              </a>
                            </>
                          )}
                        </div>

                        {/* FLAGGED reasons persisted on the row — re-stated in
                            plain, non-technical language at this display layer
                            (the persisted strings stay technical for ops/tests). */}
                        {p.status === "FLAGGED" && p.notes && (
                          <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                            <p className="font-medium">{dt("reasonsHeading", locale)}</p>
                            <ul className="mt-1 list-disc space-y-1 ps-4">
                              {p.notes.split("; ").map((r, i) => (
                                <li key={i}>{friendlyReason(r, locale)}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <UploadPlacementForm
                          locale={locale}
                          designId={d.id}
                          placement={p.placement}
                          hasFile={p.status !== "NONE"}
                          maxFileMb={p.max_file_mb}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LangToggle({ locale }: { locale: Locale }) {
  const base = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-gray-900 text-white";
  const inactive = "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200";
  return (
    <div className="flex items-center gap-2">
      <Link href="/merchant/designs?lang=en" className={`${base} ${locale === "en" ? active : inactive}`}>
        {dt("langEN", locale)}
      </Link>
      <Link href="/merchant/designs?lang=ar" className={`${base} ${locale === "ar" ? active : inactive}`}>
        {dt("langAR", locale)}
      </Link>
    </div>
  );
}

function OrderableBadge({ orderable, locale }: { orderable: boolean; locale: Locale }) {
  const tone = orderable ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {orderable ? dt("orderable", locale) : dt("notOrderable", locale)}
    </span>
  );
}

function StatusBadge({
  status,
  locale,
}: {
  status: "PASSED" | "FLAGGED" | "PENDING" | "NONE";
  locale: Locale;
}) {
  const tone =
    status === "PASSED"
      ? "bg-green-100 text-green-800"
      : status === "FLAGGED"
        ? "bg-amber-100 text-amber-800"
        : status === "PENDING"
          ? "bg-blue-100 text-blue-800"
          : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>
      {statusLabel(status, locale)}
    </span>
  );
}

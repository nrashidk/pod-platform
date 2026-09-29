// Printer-facing view (server component). A signed-in PRINTER sees ONLY the
// fulfillments assigned to its own printerId (scoped in the data layer from the
// session, never client input), and can advance each one along the
// printer-permitted subset of the lifecycle (IN_PRODUCTION → SHIPPED). DELIVERED
// and CLOSED are courier/operator territory and are never offered here.
// Bilingual EN/AR with RTL — consistent with /ops and /login.

import Link from "next/link";
import type { FulfillmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth-context";
import { getFulfillmentsForPrinter } from "@/lib/orders-access";
import { nextPrinterStatus } from "@/lib/fulfillment";
import { getDirection, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/locale";
import { LogoutButton } from "@/components/logout-button";
import {
  fulfillmentStatusLabel,
  methodLabel,
  placementLabel,
  shipT,
  t,
} from "./labels";
import { advanceAction, firstArticlePhotoAction } from "./actions";

// Always render fresh data — advances mutate state between requests.
export const dynamic = "force-dynamic";

export default async function PrinterPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; err?: string; why?: string }>;
}) {
  // DATA-LAYER GATE (not middleware): PRINTER-only. requireRole reads the session
  // server-side and redirects anyone who isn't a signed-in printer. Independent of
  // middleware — if middleware were bypassed, this still holds. ctx.printerId is
  // the session identity every read/write below scopes on.
  const ctx = await requireRole("PRINTER");

  const sp = await searchParams;
  const locale: Locale = await getRequestLocale(sp.lang);
  const dir = getDirection(locale);
  const errFulfillmentId = sp.err ?? null;
  const why = sp.why ?? null;

  // Scoped read: ONLY this printer's fulfillments, filtered at the query level by
  // the session's printerId (never a request param).
  const fulfillments = await getFulfillmentsForPrinter(ctx);

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {t("title", locale)}
            </h1>
            <p className="mt-1 text-sm text-gray-600">{t("subtitle", locale)}</p>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle locale={locale} />
            <LogoutButton label={t("logout", locale)} />
          </div>
        </header>

        {fulfillments.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            {t("noFulfillments", locale)}
          </p>
        ) : (
          <ul className="space-y-4">
            {fulfillments.map((f) => {
              const next = nextPrinterStatus(f.status);
              const blockedFirstArticle =
                next === "IN_PRODUCTION" &&
                f.is_bulk &&
                f.first_article_approved_at == null;
              const showError = errFulfillmentId === f.id;

              return (
                <li
                  key={f.id}
                  className="overflow-hidden rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{t("orderRef", locale)}</span>
                        <span className="font-mono">{f.order.id.slice(-8)}</span>
                        <span aria-hidden>·</span>
                        <span>{f.order.recipient_name}</span>
                      </div>
                      {f.is_bulk && (
                        <span className="mt-1 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          {t("bulk", locale)}
                        </span>
                      )}
                    </div>
                    <FulfillmentStatusBadge
                      status={f.status}
                      label={fulfillmentStatusLabel(f.status, locale)}
                    />
                  </div>

                  {/* Lines: product, variant, method, qty */}
                  <ul className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-sm text-gray-700">
                    {f.lines.map((l) => (
                      <li
                        key={l.id}
                        className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                      >
                        <span className="font-medium">
                          {locale === "ar"
                            ? l.product.name_ar
                            : l.product.name_en}
                        </span>
                        <span className="text-gray-400">({l.variant.sku})</span>
                        <span aria-hidden className="text-gray-300">
                          ·
                        </span>
                        <span>
                          {t("method", locale)}: {methodLabel(l.method, locale)}
                        </span>
                        <span aria-hidden className="text-gray-300">
                          ·
                        </span>
                        <span>
                          {t("qty", locale)}: {l.quantity}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* Work view (queue 8): ship-to, print files, brand to apply.
                      Files are links to the ownership-checked work-file route;
                      the private-store URL never reaches this page. */}
                  <div className="mt-3 grid gap-3 border-t border-gray-100 pt-3 text-sm text-gray-700 sm:grid-cols-2">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {t("shipTo", locale)}
                      </h3>
                      <address className="mt-1 not-italic">
                        <div>{f.order.recipient_name}</div>
                        <div>{f.order.shipping_line1}</div>
                        {f.order.shipping_line2 && (
                          <div>{f.order.shipping_line2}</div>
                        )}
                        <div>
                          {[
                            f.order.shipping_city,
                            f.order.shipping_emirate,
                            f.order.shipping_country,
                          ]
                            .filter(Boolean)
                            .join(locale === "ar" ? "، " : ", ")}
                        </div>
                        {f.order.recipient_phone && (
                          <div>
                            {t("phone", locale)}:{" "}
                            <span dir="ltr">{f.order.recipient_phone}</span>
                          </div>
                        )}
                      </address>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {t("brandHeading", locale)}
                      </h3>
                      {brandIsEmpty(f.order.merchant) ? (
                        <p className="mt-1 text-gray-500">
                          {t("brandNone", locale)}
                        </p>
                      ) : (
                        <dl className="mt-1 space-y-0.5">
                          <BrandRow
                            label={t("brandName", locale)}
                            value={f.order.merchant.name}
                          />
                          <BrandRow
                            label={t("brandLogo", locale)}
                            value={f.order.merchant.brand_logo_url}
                            ltr
                          />
                          <BrandRow
                            label={t("brandMessage", locale)}
                            value={f.order.merchant.packing_slip_message}
                          />
                          <BrandRow
                            label={t("brandReturn", locale)}
                            value={f.order.merchant.return_address}
                          />
                          <BrandRow
                            label={t("brandPackaging", locale)}
                            value={f.order.merchant.custom_packaging_note}
                          />
                        </dl>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-gray-700">
                    <h3 className="font-semibold text-gray-900">
                      {t("printFiles", locale)}
                    </h3>
                    <ul className="mt-1 space-y-1">
                      {uniqueDesigns(f.lines).map((d) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1"
                        >
                          <span className="font-medium">
                            {t("design", locale)}: {d.name}
                          </span>
                          {d.placements.length === 0 && (
                            <span className="text-gray-500">
                              {t("fileNotReady", locale)}
                            </span>
                          )}
                          {d.placements.map((p) =>
                            p.validation_status === "PASSED" &&
                            f.status !== "REROUTED" &&
                            f.status !== "CANCELLED" ? (
                              <a
                                key={p.id}
                                href={`/api/printer/work-file?fulfillmentId=${encodeURIComponent(f.id)}&designId=${encodeURIComponent(d.id)}&placement=${p.placement}`}
                                className="rounded-md border border-gray-300 px-2 py-0.5 text-gray-900 hover:bg-gray-100"
                              >
                                {placementLabel(p.placement, locale)} ·{" "}
                                {t("downloadFile", locale)}
                              </a>
                            ) : (
                              <span key={p.id} className="text-gray-500">
                                {placementLabel(p.placement, locale)} ·{" "}
                                {t("fileNotReady", locale)}
                              </span>
                            )
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* First-article photo proof (bulk): shown whenever a photo can be
                      uploaded — including while awaiting approval, when there is
                      no advance target at all. */}
                  {f.is_bulk &&
                    (f.status === "ROUTED" ||
                      f.status === "FIRST_ARTICLE_PENDING") && (
                      <form
                        action={firstArticlePhotoAction}
                        className="mt-3 flex flex-col gap-2 rounded-md border border-gray-200 p-3"
                      >
                        <input type="hidden" name="fulfillmentId" value={f.id} />
                        <input type="hidden" name="lang" value={locale} />
                        <label className="text-sm font-medium text-gray-700">
                          {t(
                            f.status === "ROUTED"
                              ? "firstArticlePhotoLabel"
                              : "firstArticlePhotoReplace",
                            locale
                          )}
                          <input
                            type="file"
                            name="photo"
                            accept="image/jpeg,image/png,image/webp"
                            required
                            className="mt-1 block w-full text-sm text-gray-600 file:me-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white"
                          />
                        </label>
                        <button
                          type="submit"
                          className="inline-flex w-fit items-center rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
                        >
                          {t("firstArticlePhotoSubmit", locale)}
                        </button>
                      </form>
                    )}

                  {/* Advance control — only ever offers a printer-permitted target */}
                  <div className="mt-3">
                    {next == null ? (
                      <p className="text-sm text-gray-400">
                        {t("noFurther", locale)}
                      </p>
                    ) : blockedFirstArticle ? (
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          disabled
                          aria-disabled
                          className="inline-flex w-fit cursor-not-allowed items-center rounded-md bg-gray-200 px-3 py-1.5 text-sm font-medium text-gray-400"
                        >
                          {t("advanceTo", locale)}{" "}
                          {fulfillmentStatusLabel(next, locale)}
                        </button>
                        <p className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          <span aria-hidden>⏳</span>
                          {t("blockedFirstArticle", locale)}
                        </p>
                      </div>
                    ) : (
                      <form action={advanceAction}>
                        <input
                          type="hidden"
                          name="fulfillmentId"
                          value={f.id}
                        />
                        <input type="hidden" name="toStatus" value={next} />
                        <input type="hidden" name="lang" value={locale} />
                        {next === "SHIPPED" && (
                          <div className="mb-2 flex flex-wrap gap-3">
                            <label className="text-sm font-medium text-gray-700">
                              {shipT("carrier", locale)}
                              <input
                                type="text"
                                name="carrier"
                                required
                                maxLength={100}
                                dir="ltr"
                                className="mt-1 block w-48 rounded-md border border-gray-300 px-2 py-1 text-sm"
                              />
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              {shipT("tracking", locale)}
                              <input
                                type="text"
                                name="trackingNumber"
                                required
                                maxLength={100}
                                dir="ltr"
                                className="mt-1 block w-56 rounded-md border border-gray-300 px-2 py-1 text-sm"
                              />
                            </label>
                          </div>
                        )}
                        <button
                          type="submit"
                          className="inline-flex items-center rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700"
                        >
                          {t("advanceTo", locale)}{" "}
                          {fulfillmentStatusLabel(next, locale)}
                        </button>
                      </form>
                    )}

                    {showError && (
                      <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                        {t(
                          why === "shipment"
                            ? "shipmentRequired"
                            : why === "photo-type"
                            ? "photoErrType"
                            : why === "photo-size"
                              ? "photoErrSize"
                              : why === "photo-empty"
                                ? "photoErrEmpty"
                                : "errorRejected",
                          locale
                        )}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

type BrandFields = {
  name: string;
  brand_logo_url: string | null;
  packing_slip_message: string | null;
  return_address: string | null;
  custom_packaging_note: string | null;
};

// "No brand assets" = none of the optional brand fields is set (the merchant
// name alone is not an asset to apply).
function brandIsEmpty(m: BrandFields): boolean {
  return !(
    m.brand_logo_url ||
    m.packing_slip_message ||
    m.return_address ||
    m.custom_packaging_note
  );
}

// One design can sit on several lines of a fulfillment; list it once.
function uniqueDesigns<D extends { id: string }>(
  lines: { design: D }[]
): D[] {
  const seen = new Map<string, D>();
  for (const l of lines) if (!seen.has(l.design.id)) seen.set(l.design.id, l.design);
  return [...seen.values()];
}

function BrandRow({
  label,
  value,
  ltr,
}: {
  label: string;
  value: string | null;
  ltr?: boolean;
}) {
  if (!value) return null;
  return (
    <div>
      <dt className="inline text-gray-500">{label}: </dt>
      <dd className="inline" dir={ltr ? "ltr" : undefined}>
        {value}
      </dd>
    </div>
  );
}

function LangToggle({ locale }: { locale: Locale }) {
  const base = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-gray-900 text-white";
  const inactive =
    "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200";
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/printer?lang=en"
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t("langEN", locale)}
      </Link>
      <Link
        href="/printer?lang=ar"
        className={`${base} ${locale === "ar" ? active : inactive}`}
      >
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

function FulfillmentStatusBadge({
  status,
  label,
}: {
  status: FulfillmentStatus;
  label: string;
}) {
  const tone =
    status === "CLOSED" || status === "DELIVERED"
      ? "bg-green-100 text-green-800"
      : status === "CANCELLED"
        ? "bg-red-100 text-red-700"
        : status === "SHIPPED"
          ? "bg-blue-100 text-blue-800"
          : status === "IN_PRODUCTION"
            ? "bg-indigo-100 text-indigo-800"
            : "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

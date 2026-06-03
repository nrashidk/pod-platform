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
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { LogoutButton } from "@/components/logout-button";
import { fulfillmentStatusLabel, methodLabel, t } from "./labels";
import { advanceAction } from "./actions";

// Always render fresh data — advances mutate state between requests.
export const dynamic = "force-dynamic";

export default async function PrinterPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; err?: string }>;
}) {
  // DATA-LAYER GATE (not middleware): PRINTER-only. requireRole reads the session
  // server-side and redirects anyone who isn't a signed-in printer. Independent of
  // middleware — if middleware were bypassed, this still holds. ctx.printerId is
  // the session identity every read/write below scopes on.
  const ctx = await requireRole("PRINTER");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);
  const errFulfillmentId = sp.err ?? null;

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
                        {t("errorRejected", locale)}
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

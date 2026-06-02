// Internal ops view (server component). Lists every order with its COMPOSITE
// status; each order expands to its fulfillments (printer, lines, wholesale
// cost, bulk flag, status); each fulfillment carries an "advance" control that
// calls the real advanceFulfillment engine. Bilingual EN/AR with RTL — dir is
// set on the page container (the root <html dir> follows the default locale
// until the later locale-resolution step described in src/lib/i18n.ts).

import Link from "next/link";
import type { FulfillmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth-context";
import { getOrdersForCaller } from "@/lib/orders-access";
import { nextFulfillmentStatus } from "@/lib/fulfillment";
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { LogoutButton } from "@/components/logout-button";
import {
  fulfillmentStatusLabel,
  methodLabel,
  orderStatusLabel,
  t,
} from "./labels";
import { advanceAction } from "./actions";

// Always render fresh data — advances mutate state between requests.
export const dynamic = "force-dynamic";

// Prisma Decimal fields arrive as Decimal objects (or strings via JSON);
// normalise through toString so we don't depend on the runtime Decimal type.
function money(value: { toString(): string }, currency: string): string {
  return `${Number(value.toString()).toFixed(2)} ${currency}`;
}

export default async function OpsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; err?: string }>;
}) {
  // DATA-LAYER GATE (not middleware): this page is OPERATOR-only. requireRole
  // reads the session server-side and redirects anyone who isn't a signed-in
  // operator. Independent of middleware — if middleware were bypassed, this
  // still holds.
  const ctx = await requireRole("OPERATOR");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);
  const errFulfillmentId = sp.err ?? null;

  // Fetch through the scoped accessor (OPERATOR ⇒ all orders). Routing every
  // read through the authorization layer keeps the gate and the query together.
  const orders = await getOrdersForCaller(ctx);

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

        {orders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            {t("noOrders", locale)}
          </p>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li
                key={order.id}
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 hover:bg-gray-50">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span className="font-mono">{order.id.slice(-8)}</span>
                        <span aria-hidden>·</span>
                        <span>{order.recipient_name}</span>
                      </div>
                      <div className="mt-1 text-sm text-gray-500">
                        {t("retailTotal", locale)}:{" "}
                        {money(order.retail_total, order.currency)} ·{" "}
                        {order.fulfillments.length} {t("fulfillments", locale)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <OrderStatusBadge
                        status={order.status}
                        label={orderStatusLabel(order.status, locale)}
                      />
                      <span className="text-gray-400 transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:-rotate-90">
                        ›
                      </span>
                    </div>
                  </summary>

                  <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
                    <ul className="space-y-3">
                      {order.fulfillments.map((f) => {
                        const next = nextFulfillmentStatus(f.status);
                        const blockedFirstArticle =
                          next === "IN_PRODUCTION" &&
                          f.is_bulk &&
                          f.first_article_approved_at == null;
                        const showError = errFulfillmentId === f.id;

                        return (
                          <li
                            key={f.id}
                            className="rounded-lg border border-gray-200 bg-white p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="font-medium">
                                  {t("printer", locale)}: {f.printer.name}
                                </div>
                                <div className="mt-1 text-sm text-gray-600">
                                  {t("wholesaleCost", locale)}:{" "}
                                  {money(f.wholesale_cost, order.currency)}
                                  {f.is_bulk && (
                                    <span className="ms-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                                      {t("bulk", locale)}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <FulfillmentStatusBadge
                                status={f.status}
                                label={fulfillmentStatusLabel(f.status, locale)}
                              />
                            </div>

                            {/* Lines */}
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
                                  <span className="text-gray-400">
                                    ({l.variant.sku})
                                  </span>
                                  <span aria-hidden className="text-gray-300">
                                    ·
                                  </span>
                                  <span>
                                    {t("method", locale)}:{" "}
                                    {methodLabel(l.method, locale)}
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

                            {/* Advance control */}
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
                                  <input
                                    type="hidden"
                                    name="toStatus"
                                    value={next}
                                  />
                                  <input
                                    type="hidden"
                                    name="lang"
                                    value={locale}
                                  />
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
                                  {t("errorInvalidTransition", locale)}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LangToggle({ locale }: { locale: Locale }) {
  const base =
    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-gray-900 text-white";
  const inactive = "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200";
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/ops?lang=en"
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t("langEN", locale)}
      </Link>
      <Link
        href="/ops?lang=ar"
        className={`${base} ${locale === "ar" ? active : inactive}`}
      >
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

// Composite order status — color-grouped by lifecycle stage.
function OrderStatusBadge({
  status,
  label,
}: {
  status: string;
  label: string;
}) {
  const tone =
    status === "CLOSED" || status === "DELIVERED"
      ? "bg-green-100 text-green-800"
      : status === "CANCELLED"
        ? "bg-red-100 text-red-700"
        : status.startsWith("PARTIALLY")
          ? "bg-blue-100 text-blue-800"
          : "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
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

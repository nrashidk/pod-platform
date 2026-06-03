// Merchant-facing view (server component). A signed-in MERCHANT sees ONLY their
// OWN orders — scoped in the data layer from the session's merchantId, never
// from client input (reuses the tested getOrdersForCaller MERCHANT branch).
//
// READ-ONLY by design: merchants WATCH order progress; they do NOT advance
// fulfillments (that is printer/operator territory). There are deliberately NO
// write controls — no advance forms, no server actions, no editing.
//
// We also deliberately OMIT each fulfillment's wholesale_cost: that is the
// platform's cost to the printer and reveals the margin charged to the store. A
// merchant sees their RETAIL total (what they're billed) but not the wholesale
// leg. Bilingual EN/AR with RTL — consistent with /ops, /printer and /login.

import Link from "next/link";
import type { FulfillmentStatus } from "@prisma/client";
import { requireRole } from "@/lib/auth-context";
import { getOrdersForCaller } from "@/lib/orders-access";
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { LogoutButton } from "@/components/logout-button";
import {
  orderStatusLabel,
  fulfillmentStatusLabel,
  methodLabel,
  t,
} from "./labels";

// Always render fresh data — fulfillment statuses move between requests (driven
// by printers/operators elsewhere; the merchant just sees the latest state).
export const dynamic = "force-dynamic";

// Prisma Decimal fields arrive as Decimal objects (or strings via JSON);
// normalise through toString so we don't depend on the runtime Decimal type.
function money(value: { toString(): string }, currency: string): string {
  return `${Number(value.toString()).toFixed(2)} ${currency}`;
}

export default async function MerchantPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  // DATA-LAYER GATE (not middleware): MERCHANT-only. requireRole reads the
  // session server-side and redirects anyone who isn't a signed-in merchant.
  // Independent of middleware — if middleware were bypassed, this still holds.
  // ctx.merchantId is the session identity the scoped read below filters on.
  const ctx = await requireRole("MERCHANT");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);

  // Scoped read: ONLY this merchant's orders, filtered at the query level by the
  // session's merchantId (never a request param). getOrdersForCaller throws if a
  // MERCHANT context somehow has no merchantId rather than returning everything.
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

                  {/* Expandable fulfillment breakdown — READ-ONLY (no advance
                      controls; merchants only watch progress). */}
                  <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-4">
                    <ul className="space-y-3">
                      {order.fulfillments.map((f) => (
                        <li
                          key={f.id}
                          className="rounded-lg border border-gray-200 bg-white p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="font-medium">
                              {t("printer", locale)}: {f.printer.name}
                              {f.is_bulk && (
                                <span className="ms-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
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
                        </li>
                      ))}
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
  const base = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-gray-900 text-white";
  const inactive =
    "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200";
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/merchant?lang=en"
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t("langEN", locale)}
      </Link>
      <Link
        href="/merchant?lang=ar"
        className={`${base} ${locale === "ar" ? active : inactive}`}
      >
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

// Composite order status — color-grouped by lifecycle stage (mirrors /ops).
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

// Merchant orders list (server component). A signed-in MERCHANT sees ONLY their
// OWN orders — scoped in the data layer from the session's merchantId, never from
// client input (reuses the tested getOrdersForCaller MERCHANT branch). The wallet
// is read only to feed the shell's balance chip (session merchantId, never input).
//
// READ-ONLY by design: merchants WATCH order progress; they do NOT advance
// fulfillments (printer/operator territory). There are deliberately NO write
// controls. We also OMIT each fulfillment's wholesale_cost — that is the
// platform's cost to the printer and reveals the margin. A merchant sees their
// RETAIL total but not the wholesale leg. Bilingual EN/AR with RTL.

import { requireRole } from "@/lib/auth-context";
import { getOrdersForCaller } from "@/lib/orders-access";
import { prisma } from "@/lib/prisma";
import { isLocale, type Locale } from "@/lib/i18n";
import { MerchantShell } from "../MerchantShell";
import { OrderStatusBadge, FulfillmentStatusBadge } from "../badges";
import { methodLabel, t } from "../labels";

// Always render fresh data — fulfillment statuses move between requests (driven
// by printers/operators elsewhere; the merchant just sees the latest state).
export const dynamic = "force-dynamic";

function money(value: { toString(): string }, currency: string): string {
  return `${Number(value.toString()).toFixed(2)} ${currency}`;
}

export default async function MerchantOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  // DATA-LAYER GATE: MERCHANT-only.
  const ctx = await requireRole("MERCHANT");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";

  const [orders, wallet] = await Promise.all([
    getOrdersForCaller(ctx),
    ctx.merchantId
      ? prisma.wallet.findUnique({
          where: { merchantId: ctx.merchantId },
          select: { balance: true, currency: true },
        })
      : Promise.resolve(null),
  ]);
  const walletChip = wallet
    ? { balance: Number(wallet.balance), currency: wallet.currency }
    : null;

  return (
    <MerchantShell
      locale={locale}
      active="orders"
      basePath="/merchant/orders"
      wallet={walletChip}
    >
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t("title", locale)}</h1>
          <p className="mt-1.5 text-sm text-muted">{t("subtitle", locale)}</p>
        </header>

        {orders.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-10 text-center text-muted">
            {t("noOrders", locale)}
          </p>
        ) : (
          <ul className="space-y-4">
            {orders.map((order) => (
              <li
                key={order.id}
                className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card"
              >
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-inset/60">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-muted">
                        <span className="font-mono text-xs">
                          {order.id.slice(-8)}
                        </span>
                        <span aria-hidden className="text-hairline-strong">
                          ·
                        </span>
                        <span className="font-medium text-ink">
                          {order.recipient_name}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-muted">
                        {t("retailTotal", locale)}:{" "}
                        <span className="font-mono tabular-nums">
                          {money(order.retail_total, order.currency)}
                        </span>{" "}
                        · {order.fulfillments.length} {t("fulfillments", locale)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <OrderStatusBadge status={order.status} locale={locale} />
                      <span className="text-faint transition-transform group-open:rotate-90 rtl:rotate-180 rtl:group-open:-rotate-90">
                        ›
                      </span>
                    </div>
                  </summary>

                  {/* Expandable fulfillment breakdown — READ-ONLY. */}
                  <div className="border-t border-hairline bg-inset/50 px-5 py-4">
                    <ul className="space-y-3">
                      {order.fulfillments.map((f) => (
                        <li
                          key={f.id}
                          className="rounded-xl border border-hairline bg-surface p-4"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="font-medium text-ink">
                              <span className="text-muted">
                                {t("printer", locale)}:
                              </span>{" "}
                              {f.printer.name}
                              {f.is_bulk && (
                                <span className="ms-2 inline-flex items-center rounded-full bg-gold-50 px-2 py-0.5 text-xs font-semibold text-gold-600">
                                  {t("bulk", locale)}
                                </span>
                              )}
                            </div>
                            <FulfillmentStatusBadge status={f.status} locale={locale} />
                          </div>

                          {/* Lines: product, variant, method, qty */}
                          <ul className="mt-3 space-y-1 border-t border-hairline pt-3 text-sm text-muted">
                            {f.lines.map((l) => (
                              <li
                                key={l.id}
                                className="flex flex-wrap items-center gap-x-2 gap-y-0.5"
                              >
                                <span className="font-medium text-ink">
                                  {locale === "ar"
                                    ? l.product.name_ar
                                    : l.product.name_en}
                                </span>
                                <span className="text-faint">({l.variant.sku})</span>
                                <span aria-hidden className="text-hairline-strong">
                                  ·
                                </span>
                                <span>
                                  {t("method", locale)}:{" "}
                                  {methodLabel(l.method, locale)}
                                </span>
                                <span aria-hidden className="text-hairline-strong">
                                  ·
                                </span>
                                <span>
                                  {t("qty", locale)}:{" "}
                                  <span className="font-mono tabular-nums">
                                    {l.quantity}
                                  </span>
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
    </MerchantShell>
  );
}

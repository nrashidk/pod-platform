// Merchant dashboard home (server component). A signed-in MERCHANT lands here and
// sees ONLY their OWN data — orders, wallet, and designs are each scoped in the
// data layer from the session's merchantId, never from client input (reusing the
// tested getOrdersForCaller MERCHANT branch, the scoped wallet read, and
// listMyDesigns). This page is COMPOSITION ONLY: every number is derived in-render
// from data the existing read functions already return — no new queries, no logic.
//
// READ-ONLY by design: merchants WATCH progress; advancing fulfillments is
// printer/operator territory and is never offered here. Bilingual EN/AR with RTL.

import Link from "next/link";
import { requireRole } from "@/lib/auth-context";
import { getOrdersForCaller } from "@/lib/orders-access";
import { listMyDesigns } from "@/lib/designs";
import { prisma } from "@/lib/prisma";
import { isLocale, type Locale } from "@/lib/i18n";
import { MerchantShell } from "./MerchantShell";
import { TopUpForm } from "./TopUpForm";
import { OrderStatusBadge, Badge } from "./badges";
import { t } from "./labels";

// Always render fresh data — fulfillment + design statuses move between requests.
export const dynamic = "force-dynamic";

// Presentational low-balance threshold (AED). Min top-up is 50 and bulk retention
// triggers at 1,000, so 200 is a sensible early warning. Display-only — it gates
// nothing in the data layer.
const LOW_BALANCE_AED = 200;

function money(value: { toString(): string }, currency: string): string {
  return `${Number(value.toString()).toFixed(2)} ${currency}`;
}

export default async function MerchantDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; topup?: string }>;
}) {
  // DATA-LAYER GATE: MERCHANT-only. requireRole reads the session server-side and
  // redirects anyone who isn't a signed-in merchant. ctx.merchantId is the
  // identity every scoped read below filters on (never a request param).
  const ctx = await requireRole("MERCHANT");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const topupState = sp.topup; // "processing" | "cancelled" after a gateway return

  const [orders, wallet, designs] = await Promise.all([
    getOrdersForCaller(ctx),
    ctx.merchantId
      ? prisma.wallet.findUnique({
          where: { merchantId: ctx.merchantId },
          select: { balance: true, currency: true },
        })
      : Promise.resolve(null),
    ctx.merchantId ? listMyDesigns(ctx.merchantId) : Promise.resolve([]),
  ]);

  const balance = wallet ? Number(wallet.balance) : 0;
  const walletCurrency = wallet?.currency ?? "AED";

  // ── Derived order counts (presentation only) ──
  const orderStats = {
    active: orders.filter(
      (o) =>
        o.status !== "CLOSED" &&
        o.status !== "CANCELLED" &&
        o.status !== "DELIVERED"
    ).length,
    inProduction: orders.filter((o) => o.status === "IN_PRODUCTION").length,
    shipped: orders.filter(
      (o) => o.status === "SHIPPED" || o.status === "PARTIALLY_SHIPPED"
    ).length,
    completed: orders.filter(
      (o) => o.status === "CLOSED" || o.status === "DELIVERED"
    ).length,
  };

  // ── Derived design counts ──
  const designFlagged = designs.filter((d) =>
    d.placements.some((p) => p.status === "FLAGGED")
  );
  const designStats = {
    orderable: designs.filter((d) => d.orderable).length,
    flagged: designFlagged.length,
    inProgress: designs.filter(
      (d) => !d.orderable && !d.placements.some((p) => p.status === "FLAGGED")
    ).length,
  };

  const lowBalance = balance < LOW_BALANCE_AED;
  const hasAttention = designFlagged.length > 0 || lowBalance;

  const recentOrders = orders.slice(0, 5);
  const recentDesigns = designs.slice(0, 5);

  return (
    <MerchantShell
      locale={locale}
      active="dashboard"
      basePath="/merchant"
      wallet={wallet ? { balance, currency: walletCurrency } : null}
    >
      {/* Page header */}
      <div className="animate-rise" style={{ animationDelay: "0ms" }}>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {t("welcomeBack", locale)}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          <span className="font-medium text-ink">{ctx.email}</span>
          <span className="mx-2 text-faint" aria-hidden>
            ·
          </span>
          {t("dashSubtitle", locale)}
        </p>
      </div>

      {/* Gateway-return banners — purely informational; the wallet credits from
          the webhook, never from this page. */}
      {topupState === "processing" && (
        <p className="mt-6 rounded-xl border border-info-fg/15 bg-info-bg px-4 py-3 text-sm font-medium text-info-fg">
          {t("processingNotice", locale)}
        </p>
      )}
      {topupState === "cancelled" && (
        <p className="mt-6 rounded-xl border border-warn-fg/15 bg-warn-bg px-4 py-3 text-sm font-medium text-warn-fg">
          {t("cancelledNotice", locale)}
        </p>
      )}

      {/* Needs attention — only renders when something is actually wrong. */}
      {hasAttention && (
        <section
          className="mt-6 animate-rise rounded-2xl border border-warn-fg/20 bg-warn-bg/60 p-5 shadow-card"
          style={{ animationDelay: "60ms" }}
        >
          <h2 className="flex items-center gap-2 text-sm font-semibold text-warn-fg">
            <AlertIcon />
            {t("attentionHeading", locale)}
          </h2>
          <ul className="mt-3 space-y-2.5">
            {designFlagged.length > 0 && (
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface/70 px-4 py-3">
                <span className="text-sm text-ink">
                  <span className="font-semibold">{designFlagged.length}</span>{" "}
                  {t("attnFlaggedDesigns", locale)}
                </span>
                <Link
                  href={`/merchant/designs?lang=${locale}`}
                  className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
                >
                  {t("reviewDesigns", locale)}
                </Link>
              </li>
            )}
            {lowBalance && (
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface/70 px-4 py-3">
                <span className="text-sm text-ink">
                  {t("attnLowBalance", locale)}{" "}
                  <span className="font-mono font-semibold tabular-nums">
                    ({balance.toFixed(2)} {walletCurrency})
                  </span>
                </span>
                <a
                  href="#wallet"
                  className="shrink-0 rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600"
                >
                  {t("topUpNow", locale)}
                </a>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* KPI row */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Wallet */}
        <section
          id="wallet"
          className="animate-rise scroll-mt-24 rounded-2xl border border-hairline bg-surface p-5 shadow-card"
          style={{ animationDelay: "100ms" }}
        >
          <KpiTitle>{t("kpiWalletTitle", locale)}</KpiTitle>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="font-mono text-3xl font-semibold tabular-nums text-ink">
              {balance.toFixed(2)}
            </span>
            <span className="text-sm font-medium text-faint">{walletCurrency}</span>
          </div>
          <div className="mt-4 border-t border-hairline pt-4">
            <h3 className="text-sm font-medium text-ink">
              {t("topUpHeading", locale)}
            </h3>
            <p className="mb-3 mt-1 text-xs text-muted">{t("topUpHint", locale)}</p>
            <TopUpForm locale={locale} />
          </div>
        </section>

        {/* Orders */}
        <section
          className="animate-rise rounded-2xl border border-hairline bg-surface p-5 shadow-card"
          style={{ animationDelay: "160ms" }}
        >
          <KpiTitle>{t("kpiOrdersTitle", locale)}</KpiTitle>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums text-ink">
              {orderStats.active}
            </span>
            <span className="text-sm text-muted">{t("kpiActive", locale)}</span>
          </div>
          <dl className="mt-4 space-y-2 border-t border-hairline pt-4">
            <StatRow label={t("kpiInProduction", locale)} value={orderStats.inProduction} tone="prod" />
            <StatRow label={t("kpiShipped", locale)} value={orderStats.shipped} tone="info" />
            <StatRow label={t("kpiCompleted", locale)} value={orderStats.completed} tone="ok" />
          </dl>
        </section>

        {/* Designs */}
        <section
          className="animate-rise rounded-2xl border border-hairline bg-surface p-5 shadow-card"
          style={{ animationDelay: "220ms" }}
        >
          <KpiTitle>{t("kpiDesignsTitle", locale)}</KpiTitle>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-semibold tabular-nums text-ink">
              {designStats.orderable}
            </span>
            <span className="text-sm text-muted">{t("kpiOrderable", locale)}</span>
          </div>
          <dl className="mt-4 space-y-2 border-t border-hairline pt-4">
            <StatRow label={t("kpiFlagged", locale)} value={designStats.flagged} tone="warn" />
            <StatRow label={t("kpiInProgress", locale)} value={designStats.inProgress} tone="info" />
          </dl>
        </section>
      </div>

      {/* Recent orders + design status */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Recent orders (wide) */}
        <section
          className="animate-rise rounded-2xl border border-hairline bg-surface p-5 shadow-card lg:col-span-2"
          style={{ animationDelay: "280ms" }}
        >
          <PanelHeader
            title={t("recentOrders", locale)}
            href={`/merchant/orders?lang=${locale}`}
            linkLabel={t("viewAllOrders", locale)}
            locale={locale}
          />
          {recentOrders.length === 0 ? (
            <EmptyRow>{t("emptyOrdersShort", locale)}</EmptyRow>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {recentOrders.map((order) => (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-muted">
                        {order.id.slice(-8)}
                      </span>
                      <span aria-hidden className="text-hairline-strong">
                        ·
                      </span>
                      <span className="truncate font-medium text-ink">
                        {order.recipient_name}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {money(order.retail_total, order.currency)} ·{" "}
                      {order.fulfillments.length} {t("fulfillments", locale)}
                    </div>
                  </div>
                  <OrderStatusBadge status={order.status} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Design status (narrow) */}
        <section
          className="animate-rise rounded-2xl border border-hairline bg-surface p-5 shadow-card"
          style={{ animationDelay: "340ms" }}
        >
          <PanelHeader
            title={t("designStatus", locale)}
            href={`/merchant/designs?lang=${locale}`}
            linkLabel={t("viewAllDesigns", locale)}
            locale={locale}
          />
          {recentDesigns.length === 0 ? (
            <EmptyRow>{t("emptyDesignsShort", locale)}</EmptyRow>
          ) : (
            <ul className="mt-3 divide-y divide-hairline">
              {recentDesigns.map((d) => {
                const flagged = d.placements.some((p) => p.status === "FLAGGED");
                return (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">
                        {d.name}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">
                        {locale === "ar"
                          ? d.productType.name_ar
                          : d.productType.name_en}
                      </div>
                    </div>
                    <Badge
                      tone={d.orderable ? "ok" : flagged ? "warn" : "info"}
                    >
                      {d.orderable
                        ? t("kpiOrderable", locale)
                        : flagged
                          ? t("kpiFlagged", locale)
                          : t("kpiInProgress", locale)}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </MerchantShell>
  );
}

function KpiTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold uppercase tracking-wide text-faint">
      {children}
    </div>
  );
}

function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "prod" | "info" | "ok" | "warn";
}) {
  const dot = {
    prod: "bg-prod-fg",
    info: "bg-info-fg",
    ok: "bg-ok-fg",
    warn: "bg-warn-fg",
  }[tone];
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <dt className="flex items-center gap-2 text-muted">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </dt>
      <dd className="font-mono font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function PanelHeader({
  title,
  href,
  linkLabel,
  locale,
}: {
  title: string;
  href: string;
  linkLabel: string;
  locale: Locale;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <Link
        href={href}
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 transition-colors hover:text-brand-600"
      >
        {linkLabel}
        <span aria-hidden className="rtl:rotate-180">
          →
        </span>
      </Link>
    </div>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl border border-dashed border-hairline-strong bg-canvas px-4 py-8 text-center text-sm text-muted">
      {children}
    </p>
  );
}

function AlertIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M8 1.5 15 14H1L8 1.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 6.5v3.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
    </svg>
  );
}

// Shared merchant shell — the deep-teal top bar + nav that frames every merchant
// surface (dashboard, orders, designs). Presentation only: it renders chrome and
// the children passed by each page. Bilingual EN/AR with first-class RTL via
// logical utilities (ms-/me-, ps-/pe-, start/end) — the bar mirrors cleanly when
// `dir="rtl"`. Internal /ops and /printer surfaces never use this.

import Link from "next/link";
import type { Locale } from "@/lib/i18n";
import { getDirection } from "@/lib/i18n";
import { LogoutButton } from "@/components/logout-button";
import { t } from "./labels";

export type MerchantNav = "dashboard" | "orders" | "designs";

const NAV: { key: MerchantNav; href: string; labelKey: "navDashboard" | "navOrders" | "navDesigns" }[] = [
  { key: "dashboard", href: "/merchant", labelKey: "navDashboard" },
  { key: "orders", href: "/merchant/orders", labelKey: "navOrders" },
  { key: "designs", href: "/merchant/designs", labelKey: "navDesigns" },
];

export function MerchantShell({
  locale,
  active,
  basePath,
  wallet,
  children,
}: {
  locale: Locale;
  active: MerchantNav;
  /** This page's own path, used to build the language-toggle links. */
  basePath: string;
  /** Live wallet, shown as an always-visible chip. Null while none exists. */
  wallet: { balance: number; currency: string } | null;
  children: React.ReactNode;
}) {
  const dir = getDirection(locale);

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-canvas font-sans text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-brand-700 focus:shadow-card"
      >
        {t("skipToContent", locale)}
      </a>

      <header className="sticky top-0 z-20 bg-brand-700 text-white shadow-bar">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          {/* Wordmark */}
          <Link href="/merchant" className="flex shrink-0 items-center gap-2.5">
            <Wordmark />
            <span className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">
                {t("appName", locale)}
              </span>
              <span className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/55">
                {t("appTagline", locale)}
              </span>
            </span>
          </Link>

          {/* Primary nav */}
          <nav className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto">
            {NAV.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-white/15 text-white"
                      : "text-white/70 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {t(item.labelKey, locale)}
                </Link>
              );
            })}
          </nav>

          {/* Right cluster: wallet chip · language · sign out */}
          <div className="ms-auto flex items-center gap-2.5">
            {wallet && (
              <span className="hidden items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 ring-1 ring-inset ring-white/15 sm:inline-flex">
                <span className="text-[11px] font-medium uppercase tracking-wide text-white/60">
                  {t("walletBalance", locale)}
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {wallet.balance.toFixed(2)}
                </span>
                <span className="text-[11px] font-medium text-white/60">
                  {wallet.currency}
                </span>
              </span>
            )}
            <LangToggle locale={locale} basePath={basePath} />
            <LogoutButton
              label={t("logout", locale)}
              className="rounded-lg border border-white/25 bg-transparent px-3 py-1.5 text-sm font-medium text-white/90 transition-colors hover:bg-white/10"
            />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}

// Compact geometric mark — a rounded teal tile with a gold facet. Distinctive,
// script-neutral (reads the same in LTR and RTL), no external asset.
function Wordmark() {
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 place-items-center rounded-xl bg-white/12 ring-1 ring-inset ring-white/20"
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect x="1" y="1" width="16" height="16" rx="4" stroke="white" strokeOpacity="0.85" strokeWidth="1.5" />
        <path d="M9 4.5 13.5 9 9 13.5 4.5 9 9 4.5Z" fill="#E7B95C" />
      </svg>
    </span>
  );
}

function LangToggle({ locale, basePath }: { locale: Locale; basePath: string }) {
  const base = "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-white text-brand-700";
  const inactive = "text-white/80 ring-1 ring-inset ring-white/25 hover:bg-white/10";
  return (
    <div className="flex items-center gap-1.5">
      <Link
        href={`${basePath}?lang=en`}
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t("langEN", locale)}
      </Link>
      <Link
        href={`${basePath}?lang=ar`}
        className={`${base} ${locale === "ar" ? active : inactive}`}
      >
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

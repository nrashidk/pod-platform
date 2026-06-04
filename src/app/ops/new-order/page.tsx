// Operator "new order on behalf of a merchant" screen (server component).
// OPERATOR-only via requireRole at the DATA layer (not middleware) — same gate
// as /ops. Loads the merchants, the active catalog (products + variants + the
// methods each product type can actually be made in), and the designs, then
// hands them to the client form. Submitting feeds the EXISTING
// createOrderWithRouting + recordOrderBilling (see ./actions). Bilingual EN/AR
// with RTL — dir on the page container.

import Link from "next/link";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { LogoutButton } from "@/components/logout-button";
import { t } from "../labels";
import { nt } from "./labels";
import {
  NewOrderForm,
  type ClientProduct,
} from "./NewOrderForm";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  await requireRole("OPERATOR"); // DATA-LAYER gate, independent of middleware.

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);

  const [merchants, productRows, designs] = await Promise.all([
    prisma.merchant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.product.findMany({
      where: { active: true },
      orderBy: { name_en: "asc" },
      select: {
        id: true,
        name_en: true,
        name_ar: true,
        variants: {
          where: { active: true },
          orderBy: { sku: "asc" },
          select: { id: true, sku: true, size: true, color: true },
        },
        productType: {
          select: {
            capabilities: {
              where: { active: true },
              select: { method: true },
            },
          },
        },
      },
    }),
    // Only ORDERABLE designs are offered: ≥1 placement (`some: {}`) and every
    // placement PASSED (`none` that is non-PASSED). Mirrors isDesignOrderable;
    // the action re-checks at the data layer (defense-in-depth).
    prisma.design.findMany({
      where: {
        placements: { some: {}, none: { validation_status: { not: "PASSED" } } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, merchantId: true },
    }),
  ]);

  // Collapse each product's type capabilities into the distinct set of methods
  // it can be produced in (what the line's method dropdown should offer).
  const products: ClientProduct[] = productRows.map((p) => ({
    id: p.id,
    name_en: p.name_en,
    name_ar: p.name_ar,
    variants: p.variants,
    methods: [...new Set(p.productType.capabilities.map((c) => c.method))],
  }));

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {nt("title", locale)}
            </h1>
            <p className="mt-1 text-sm text-gray-600">{nt("subtitle", locale)}</p>
            <Link
              href={`/ops?lang=${locale}`}
              className="mt-2 inline-block text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              ← {nt("back", locale)}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle locale={locale} />
            <LogoutButton label={t("logout", locale)} />
          </div>
        </header>

        <NewOrderForm
          locale={locale}
          merchants={merchants}
          products={products}
          designs={designs}
        />
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
        href="/ops/new-order?lang=en"
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t("langEN", locale)}
      </Link>
      <Link
        href="/ops/new-order?lang=ar"
        className={`${base} ${locale === "ar" ? active : inactive}`}
      >
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

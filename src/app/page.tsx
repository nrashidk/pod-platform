// Bilingual (EN/AR + RTL) landing page. Links to the three back-office areas;
// each one enforces its own role check server-side (this page grants nothing).
import Link from "next/link";
import { getDirection, type Locale } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

type Bi = { en: string; ar: string };

const L = {
  title: { en: "POD Platform", ar: "منصة POD" },
  tagline: {
    en: "Print-on-demand, orchestrated.",
    ar: "الطباعة عند الطلب، بإدارة متكاملة.",
  },
  intro: {
    en: "Route orders to trusted UAE & GCC printers that blind-ship under your brand. Choose your area to sign in.",
    ar: "وجِّه الطلبات إلى مطابع موثوقة في الإمارات والخليج تشحن باسم علامتك التجارية. اختر قسمك لتسجيل الدخول.",
  },
  ops: { en: "Operations", ar: "العمليات" },
  opsDesc: {
    en: "Orders, billing and API keys for platform operators.",
    ar: "الطلبات والفوترة ومفاتيح الواجهة البرمجية لمشغّلي المنصة.",
  },
  merchant: { en: "Merchant", ar: "التاجر" },
  merchantDesc: {
    en: "Your designs, orders and wallet.",
    ar: "تصاميمك وطلباتك ومحفظتك.",
  },
  printer: { en: "Printer", ar: "المطبعة" },
  printerDesc: {
    en: "Your fulfillment queue.",
    ar: "قائمة عمليات التنفيذ الخاصة بك.",
  },
  langEN: { en: "English", ar: "English" },
  langAR: { en: "العربية", ar: "العربية" },
} satisfies Record<string, Bi>;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const sp = await searchParams;
  const locale: Locale = await getRequestLocale(sp.lang);
  const tr = (b: Bi) => (locale === "ar" ? b.ar : b.en);

  const areas = [
    { href: "/ops", title: L.ops, desc: L.opsDesc },
    { href: "/merchant", title: L.merchant, desc: L.merchantDesc },
    { href: "/printer", title: L.printer, desc: L.printerDesc },
  ];
  const base = "rounded-md px-3 py-1 text-sm font-medium";
  const active = "bg-gray-900 text-white";
  const inactive = "text-gray-600 hover:bg-gray-100";

  return (
    <main
      dir={getDirection(locale)}
      lang={locale}
      className="mx-auto max-w-3xl p-8 font-sans"
    >
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{tr(L.title)}</h1>
        <nav aria-label="Language" className="flex gap-1">
          <Link href="/?lang=en" prefetch={false} className={`${base} ${locale === "en" ? active : inactive}`}>
            {L.langEN.en}
          </Link>
          <Link href="/?lang=ar" prefetch={false} className={`${base} ${locale === "ar" ? active : inactive}`}>
            {L.langAR.ar}
          </Link>
        </nav>
      </div>
      <p className="mt-2 text-lg font-medium">{tr(L.tagline)}</p>
      <p className="mt-2 text-gray-600">{tr(L.intro)}</p>
      <ul className="mt-8 grid gap-4 sm:grid-cols-3">
        {areas.map((a) => (
          <li key={a.href}>
            <Link
              href={`${a.href}?lang=${locale}`}
              className="block h-full rounded-lg border border-gray-200 p-4 text-start hover:border-gray-400"
            >
              <span className="block font-semibold">{tr(a.title)}</span>
              <span className="mt-1 block text-sm text-gray-600">{tr(a.desc)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

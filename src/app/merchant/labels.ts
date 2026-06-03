// Bilingual EN/AR strings for the merchant-facing view. Page chrome lives here;
// the enum label helpers (order status, fulfillment status, print method) are
// REUSED from the ops view so the SCREAMING_CASE → human-readable tables exist
// in exactly one place (CLAUDE.md: EN/AR is day-one, not a later phase).

import type { Locale } from "@/lib/i18n";

export {
  orderStatusLabel,
  fulfillmentStatusLabel,
  methodLabel,
} from "../ops/labels";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "My orders", ar: "طلباتي" },
  subtitle: {
    // Read-only framing: a merchant WATCHES progress; advancing fulfillments is
    // printer/operator territory and is never offered here.
    en: "Track your orders as they move through production and shipping.",
    ar: "تابِع طلباتك وهي تمر عبر الإنتاج والشحن.",
  },
  langEN: { en: "English", ar: "English" },
  langAR: { en: "العربية", ar: "العربية" },
  logout: { en: "Sign out", ar: "تسجيل الخروج" },
  noOrders: {
    en: "You don't have any orders yet.",
    ar: "ليست لديك أي طلبات بعد.",
  },
  recipient: { en: "Recipient", ar: "المستلم" },
  retailTotal: { en: "Order total", ar: "إجمالي الطلب" },
  fulfillments: { en: "Fulfillments", ar: "عمليات التنفيذ" },
  printer: { en: "Printer", ar: "المطبعة" },
  method: { en: "Method", ar: "الطريقة" },
  qty: { en: "Qty", ar: "الكمية" },
  bulk: { en: "Bulk", ar: "كمية كبيرة" },
} satisfies Record<string, Bi>;

export type UiKey = keyof typeof UI;
export const t = (key: UiKey, locale: Locale): string => pick(UI[key], locale);

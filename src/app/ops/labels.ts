// Bilingual EN/AR strings for the internal ops view. Every human-facing label
// in this page resolves through here (CLAUDE.md: EN/AR is day-one, not a later
// phase). Enum labels cover the full Prisma enums so the UI never renders a raw
// SCREAMING_CASE token to a human.

import type {
  FulfillmentStatus,
  OrderStatus,
  PrintMethod,
} from "@prisma/client";
import type { Locale } from "@/lib/i18n";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

// ── Page chrome ───────────────────────────────────────────────
const UI = {
  title: { en: "Order operations", ar: "عمليات الطلبات" },
  subtitle: {
    en: "Internal view — drive the order engine by advancing fulfillments.",
    ar: "عرض داخلي — قُدْ محرك الطلبات عبر تقديم عمليات التنفيذ.",
  },
  langEN: { en: "English", ar: "English" },
  langAR: { en: "العربية", ar: "العربية" },
  logout: { en: "Sign out", ar: "تسجيل الخروج" },
  newOrder: { en: "New order", ar: "طلب جديد" },
  billing: { en: "Billing ledger", ar: "دفتر الفوترة" },
  noOrders: {
    en: "No orders yet. Run the demo seed (see README/instructions).",
    ar: "لا توجد طلبات بعد. شغّل بيانات العرض التجريبي.",
  },
  order: { en: "Order", ar: "الطلب" },
  recipient: { en: "Recipient", ar: "المستلم" },
  status: { en: "Status", ar: "الحالة" },
  retailTotal: { en: "Retail total", ar: "الإجمالي للبيع" },
  fulfillments: { en: "Fulfillments", ar: "عمليات التنفيذ" },
  printer: { en: "Printer", ar: "المطبعة" },
  lines: { en: "Lines", ar: "البنود" },
  wholesaleCost: { en: "Wholesale cost", ar: "تكلفة الجملة" },
  bulk: { en: "Bulk", ar: "كمية كبيرة" },
  yes: { en: "Yes", ar: "نعم" },
  no: { en: "No", ar: "لا" },
  method: { en: "Method", ar: "الطريقة" },
  qty: { en: "Qty", ar: "الكمية" },
  variant: { en: "Variant", ar: "النوع" },
  advanceTo: { en: "Advance to", ar: "التقدّم إلى" },
  noFurther: {
    en: "No further transition — lifecycle complete.",
    ar: "لا يوجد انتقال إضافي — اكتملت دورة الحياة.",
  },
  // The bulk first-article gate. Worded as a BLOCK (an expected business rule),
  // not an error: the run is waiting on mandatory first-article approval.
  blockedFirstArticle: {
    en: "Blocked: first-article approval required before production (bulk order).",
    ar: "محجوب: يلزم اعتماد العيّنة الأولى قبل الإنتاج (طلب بكمية كبيرة).",
  },
  // Surfaced only if an advance is somehow attempted against the lifecycle rules.
  errorInvalidTransition: {
    en: "That transition isn't allowed from the current status.",
    ar: "هذا الانتقال غير مسموح به من الحالة الحالية.",
  },
} satisfies Record<string, Bi>;

export type UiKey = keyof typeof UI;
export const t = (key: UiKey, locale: Locale): string => pick(UI[key], locale);

// ── Enum labels ───────────────────────────────────────────────
const ORDER_STATUS: Record<OrderStatus, Bi> = {
  DRAFT: { en: "Draft", ar: "مسودة" },
  AWAITING_APPROVAL: { en: "Awaiting approval", ar: "بانتظار الموافقة" },
  APPROVED: { en: "Approved", ar: "تمت الموافقة" },
  PAID: { en: "Paid", ar: "مدفوع" },
  ROUTED: { en: "Routed", ar: "موجَّه" },
  IN_PRODUCTION: { en: "In production", ar: "قيد الإنتاج" },
  PARTIALLY_SHIPPED: { en: "Partially shipped", ar: "شُحن جزئيًا" },
  SHIPPED: { en: "Shipped", ar: "تم الشحن" },
  PARTIALLY_DELIVERED: { en: "Partially delivered", ar: "سُلّم جزئيًا" },
  DELIVERED: { en: "Delivered", ar: "تم التسليم" },
  CLOSED: { en: "Closed", ar: "مغلق" },
  CANCELLED: { en: "Cancelled", ar: "ملغى" },
};

const FULFILLMENT_STATUS: Record<FulfillmentStatus, Bi> = {
  PENDING_ROUTING: { en: "Pending routing", ar: "بانتظار التوجيه" },
  ROUTED: { en: "Routed", ar: "موجَّه" },
  FIRST_ARTICLE_PENDING: { en: "First article pending", ar: "العيّنة الأولى معلّقة" },
  FIRST_ARTICLE_APPROVED: { en: "First article approved", ar: "اعتُمدت العيّنة الأولى" },
  IN_PRODUCTION: { en: "In production", ar: "قيد الإنتاج" },
  DIGITIZING: { en: "Digitizing", ar: "رقمنة التطريز" },
  SHIPPED: { en: "Shipped", ar: "تم الشحن" },
  DELIVERED: { en: "Delivered", ar: "تم التسليم" },
  CLOSED: { en: "Closed", ar: "مغلق" },
  REROUTED: { en: "Rerouted", ar: "أُعيد توجيهه" },
  CANCELLED: { en: "Cancelled", ar: "ملغى" },
};

const PRINT_METHOD: Record<PrintMethod, Bi> = {
  DTG: { en: "DTG", ar: "طباعة مباشرة على القماش" },
  DTF: { en: "DTF", ar: "طباعة بالأفلام" },
  SUBLIMATION: { en: "Sublimation", ar: "تساميّ" },
  EMBROIDERY: { en: "Embroidery", ar: "تطريز" },
  UV: { en: "UV", ar: "طباعة UV" },
  SCREEN: { en: "Screen", ar: "طباعة شاشية" },
  PAPER_PRINT: { en: "Paper print", ar: "طباعة ورقية" },
};

export const orderStatusLabel = (s: OrderStatus, locale: Locale): string =>
  pick(ORDER_STATUS[s], locale);
export const fulfillmentStatusLabel = (
  s: FulfillmentStatus,
  locale: Locale
): string => pick(FULFILLMENT_STATUS[s], locale);
export const methodLabel = (m: PrintMethod, locale: Locale): string =>
  pick(PRINT_METHOD[m], locale);

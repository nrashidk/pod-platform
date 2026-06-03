// Bilingual EN/AR strings for the operator "new order on behalf of a merchant"
// screen. Same pattern as ../labels: every human-facing string resolves through
// here (CLAUDE.md: EN/AR is day-one). PrintMethod labels are reused from the
// parent ops labels (single source) — see methodLabel there.

import type { Locale } from "@/lib/i18n";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "New order (operator entry)", ar: "طلب جديد (إدخال المشغّل)" },
  subtitle: {
    en: "Enter an order on behalf of a merchant. Routing and billing are recorded automatically.",
    ar: "أدخل طلبًا نيابة عن التاجر. يتم تسجيل التوجيه والفوترة تلقائيًا.",
  },
  back: { en: "Back to orders", ar: "العودة إلى الطلبات" },

  // Sections.
  merchant: { en: "Merchant", ar: "التاجر" },
  selectMerchant: { en: "Select a merchant…", ar: "اختر تاجرًا…" },
  design: { en: "Design", ar: "التصميم" },
  selectDesign: { en: "Select a design…", ar: "اختر تصميمًا…" },
  designHint: {
    en: "One design is applied to every line on this order.",
    ar: "يُطبَّق تصميم واحد على كل بنود هذا الطلب.",
  },
  noDesigns: {
    en: "This merchant has no designs yet — create one before ordering.",
    ar: "لا يملك هذا التاجر أي تصاميم بعد — أنشئ تصميمًا قبل الطلب.",
  },

  lines: { en: "Order lines", ar: "بنود الطلب" },
  product: { en: "Product", ar: "المنتج" },
  selectProduct: { en: "Product…", ar: "المنتج…" },
  variant: { en: "Variant", ar: "النوع" },
  selectVariant: { en: "Variant…", ar: "النوع…" },
  method: { en: "Method", ar: "الطريقة" },
  selectMethod: { en: "Method…", ar: "الطريقة…" },
  qty: { en: "Qty", ar: "الكمية" },
  addLine: { en: "+ Add line", ar: "+ إضافة بند" },
  removeLine: { en: "Remove", ar: "إزالة" },
  noLines: { en: "Add at least one line.", ar: "أضف بندًا واحدًا على الأقل." },

  recipient: { en: "Recipient", ar: "المستلم" },
  recipientName: { en: "Full name", ar: "الاسم الكامل" },
  recipientPhone: { en: "Phone (optional)", ar: "الهاتف (اختياري)" },
  line1: { en: "Address line 1", ar: "العنوان السطر 1" },
  line2: { en: "Address line 2 (optional)", ar: "العنوان السطر 2 (اختياري)" },
  city: { en: "City", ar: "المدينة" },
  emirate: { en: "Emirate (optional)", ar: "الإمارة (اختياري)" },

  submit: { en: "Create & record order", ar: "إنشاء وتسجيل الطلب" },

  // Error surfaces (mapped from the action's errorKind).
  errUnroutable: {
    en: "No eligible printer for one of the lines — adjust product, method, or quantity.",
    ar: "لا توجد مطبعة مؤهلة لأحد البنود — عدّل المنتج أو الطريقة أو الكمية.",
  },
  errNoMerchant: { en: "Select a merchant.", ar: "اختر تاجرًا." },
  errNoDesign: { en: "Select a design.", ar: "اختر تصميمًا." },
  errNoLines: {
    en: "Add at least one complete line (product, variant, method, qty).",
    ar: "أضف بندًا مكتملًا واحدًا على الأقل (منتج، نوع، طريقة، كمية).",
  },
  errBadLine: {
    en: "One of the lines is incomplete or invalid.",
    ar: "أحد البنود غير مكتمل أو غير صالح.",
  },
  errGeneric: {
    en: "Could not create the order. Check the entries and try again.",
    ar: "تعذّر إنشاء الطلب. تحقق من المدخلات وحاول مجددًا.",
  },
} as const;

export type NewOrderKey = keyof typeof UI;
export const nt = (key: NewOrderKey, locale: Locale): string =>
  pick(UI[key], locale);

// Map an action errorKind to its bilingual message key.
export function errorKeyFor(kind: string | undefined): NewOrderKey {
  switch (kind) {
    case "unroutable":
      return "errUnroutable";
    case "no_merchant":
      return "errNoMerchant";
    case "no_design":
      return "errNoDesign";
    case "no_lines":
      return "errNoLines";
    case "bad_line":
      return "errBadLine";
    default:
      return "errGeneric";
  }
}

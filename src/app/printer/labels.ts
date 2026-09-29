// Bilingual EN/AR strings for the printer-facing view. Page chrome lives here;
// the enum label helpers (fulfillment status, print method) are REUSED from the
// ops view so the SCREAMING_CASE → human-readable tables exist in exactly one
// place (CLAUDE.md: EN/AR is day-one, not a later phase).

import type { Locale } from "@/lib/i18n";

export {
  fulfillmentStatusLabel,
  methodLabel,
  orderStatusLabel,
  shipT,
} from "../ops/labels";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "My fulfillments", ar: "عمليات التنفيذ الخاصة بي" },
  subtitle: {
    en: "Your assigned work — advance each job as it moves through production and shipping.",
    ar: "العمل المُسنَد إليك — قدّم كل مهمة وهي تمر عبر الإنتاج والشحن.",
  },
  langEN: { en: "English", ar: "English" },
  langAR: { en: "العربية", ar: "العربية" },
  logout: { en: "Sign out", ar: "تسجيل الخروج" },
  noFulfillments: {
    en: "No fulfillments assigned to you yet.",
    ar: "لا توجد عمليات تنفيذ مُسنَدة إليك بعد.",
  },
  orderRef: { en: "Order", ar: "الطلب" },
  recipient: { en: "Recipient", ar: "المستلم" },
  qty: { en: "Qty", ar: "الكمية" },
  method: { en: "Method", ar: "الطريقة" },
  bulk: { en: "Bulk", ar: "كمية كبيرة" },
  advanceTo: { en: "Advance to", ar: "التقدّم إلى" },
  // A printer's queue ends at SHIPPED — DELIVERED/CLOSED are courier/operator
  // territory, so a shipped job shows this rather than a button it can't press.
  noFurther: {
    en: "No further action for you — handed off for delivery.",
    ar: "لا يوجد إجراء إضافي لك — جرى التسليم لمرحلة الشحن النهائي.",
  },
  // Bulk first-article gate (reused wording from ops): production is blocked
  // until the mandatory first article is approved.
  blockedFirstArticle: {
    en: "Blocked: first-article approval required before production (bulk order).",
    ar: "محجوب: يلزم اعتماد العيّنة الأولى قبل الإنتاج (طلب بكمية كبيرة).",
  },
  // First-article photo proof (bulk): uploading the photo also submits the
  // first article for ops approval.
  firstArticlePhotoLabel: {
    en: "Photo of the first unit (JPG, PNG or WebP, up to 4 MB)",
    ar: "صورة الوحدة الأولى (JPG أو PNG أو WebP، حتى 4 ميجابايت)",
  },
  firstArticlePhotoReplace: {
    en: "Replace the photo (awaiting approval)",
    ar: "استبدال الصورة (بانتظار الاعتماد)",
  },
  firstArticlePhotoSubmit: {
    en: "Upload photo and submit first article",
    ar: "رفع الصورة وإرسال العيّنة الأولى",
  },
  photoErrType: {
    en: "That file isn't a valid JPG, PNG or WebP image.",
    ar: "هذا الملف ليس صورة JPG أو PNG أو WebP صالحة.",
  },
  photoErrSize: {
    en: "The photo is too large (maximum 4 MB).",
    ar: "الصورة كبيرة جدًا (الحد الأقصى 4 ميجابايت).",
  },
  photoErrEmpty: {
    en: "The photo file is empty.",
    ar: "ملف الصورة فارغ.",
  },
  shipmentRequired: {
    en: "Enter the carrier and tracking number before marking as shipped.",
    ar: "أدخل شركة الشحن ورقم التتبّع قبل تسجيل الشحن.",
  },
  // Surfaced if an advance is somehow rejected at the engine (forged id, illegal
  // transition, or a target outside the printer-permitted subset).
  errorRejected: {
    en: "That action wasn't allowed and was rejected.",
    ar: "هذا الإجراء غير مسموح به وتم رفضه.",
  },
} satisfies Record<string, Bi>;

export type UiKey = keyof typeof UI;
export const t = (key: UiKey, locale: Locale): string => pick(UI[key], locale);

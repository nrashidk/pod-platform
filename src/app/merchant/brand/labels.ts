// Bilingual EN/AR strings for the merchant brand settings page (queue 10).
// Arabic copy is machine-drafted, owner to review (charter §2 rule 9 / P16).

import type { Locale } from "@/lib/i18n";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "Brand settings", ar: "إعدادات العلامة التجارية" },
  subtitle: {
    en: "These appear on the packing slip inside every parcel we ship for you. Your customers see your brand only — never ours or the printer's.",
    ar: "تظهر هذه البيانات على بطاقة التعبئة داخل كل طرد نشحنه لك. يرى عملاؤك علامتك التجارية فقط — وليس علامتنا ولا علامة المطبعة.",
  },

  logoHeading: { en: "Logo", ar: "الشعار" },
  logoHint: {
    en: "JPEG, PNG or WebP, up to 2 MB.",
    ar: "بصيغة JPEG أو PNG أو WebP، حتى 2 ميغابايت.",
  },
  logoNone: { en: "No logo uploaded yet.", ar: "لم يتم رفع شعار بعد." },
  logoAlt: { en: "Your logo", ar: "شعارك" },
  logoUpload: { en: "Upload logo", ar: "رفع الشعار" },
  logoRemove: { en: "Remove logo", ar: "إزالة الشعار" },

  textHeading: { en: "Packing slip", ar: "بطاقة التعبئة" },
  messageEn: { en: "Message (English)", ar: "الرسالة (بالإنجليزية)" },
  messageAr: { en: "Message (Arabic)", ar: "الرسالة (بالعربية)" },
  messageHint: {
    en: "A short thank-you or note printed on the slip.",
    ar: "رسالة شكر قصيرة أو ملاحظة تُطبع على البطاقة.",
  },
  returnEn: { en: "Return address (English)", ar: "عنوان الإرجاع (بالإنجليزية)" },
  returnAr: { en: "Return address (Arabic)", ar: "عنوان الإرجاع (بالعربية)" },
  packagingNote: { en: "Packaging note", ar: "ملاحظة التغليف" },
  packagingHint: {
    en: "Instructions for the printer when packing, e.g. \"fold the shirt in tissue paper\".",
    ar: "تعليمات للمطبعة عند التغليف، مثل «لُفّ القميص بورق حريري».",
  },
  save: { en: "Save", ar: "حفظ" },

  saved: { en: "Saved.", ar: "تم الحفظ." },
  errTooLong: {
    en: "One of the fields is too long. Please shorten it and try again.",
    ar: "أحد الحقول طويل جدًا. يرجى اختصاره والمحاولة مجددًا.",
  },
  errLogoType: {
    en: "The logo must be a JPEG, PNG or WebP image.",
    ar: "يجب أن يكون الشعار صورة بصيغة JPEG أو PNG أو WebP.",
  },
  errLogoSize: {
    en: "The logo is too large (2 MB maximum).",
    ar: "حجم الشعار كبير جدًا (الحد الأقصى 2 ميغابايت).",
  },
  errLogoEmpty: {
    en: "Choose a logo file first.",
    ar: "اختر ملف الشعار أولًا.",
  },
  errGeneric: {
    en: "Something went wrong. Please try again.",
    ar: "حدث خطأ ما. يرجى المحاولة مجددًا.",
  },
} satisfies Record<string, Bi>;

export type BrandUiKey = keyof typeof UI;
export const bt = (key: BrandUiKey, locale: Locale): string => pick(UI[key], locale);

/** Map an error kind carried in `?err=` to its label key. */
export function brandErrorKey(kind: string): BrandUiKey {
  switch (kind) {
    case "too_long":
      return "errTooLong";
    case "type":
      return "errLogoType";
    case "size":
      return "errLogoSize";
    case "empty":
      return "errLogoEmpty";
    default:
      return "errGeneric";
  }
}

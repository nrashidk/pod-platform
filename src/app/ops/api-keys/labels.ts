// Bilingual EN/AR strings for the operator API-key management screen. Same
// pattern as the sibling ops labels (CLAUDE.md: EN/AR is day-one).

import type { Locale } from "@/lib/i18n";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "Merchant API keys", ar: "مفاتيح واجهة برمجة التطبيقات للتجار" },
  subtitle: {
    en: "Generate and revoke the per-merchant keys that authenticate the order-intake API (/api/v1). Keys are hashed at rest — the secret is shown ONCE at creation and can never be retrieved again.",
    ar: "أنشئ وألغِ مفاتيح كل تاجر التي تُصادق واجهة استقبال الطلبات (‎/api/v1‎). تُخزَّن المفاتيح مُجزّأة — يظهر السر مرة واحدة عند الإنشاء ولا يمكن استرجاعه أبدًا.",
  },
  back: { en: "Back to orders", ar: "العودة إلى الطلبات" },

  generate: { en: "Generate a key", ar: "إنشاء مفتاح" },
  merchant: { en: "Merchant", ar: "التاجر" },
  selectMerchant: { en: "Select a merchant…", ar: "اختر تاجرًا…" },
  keyName: { en: "Key label", ar: "اسم المفتاح" },
  keyNamePlaceholder: { en: "e.g. prod store", ar: "مثال: متجر الإنتاج" },
  create: { en: "Generate", ar: "إنشاء" },

  oneTimeTitle: { en: "Copy this key now — it won't be shown again", ar: "انسخ هذا المفتاح الآن — لن يُعرض مرة أخرى" },
  oneTimeHint: {
    en: "Store it securely in the merchant's system. We keep only a hash; we cannot recover or resend it.",
    ar: "خزّنه بأمان في نظام التاجر. نحتفظ بنسخة مُجزّأة فقط؛ لا يمكننا استرجاعه أو إعادة إرساله.",
  },

  existing: { en: "Existing keys", ar: "المفاتيح الحالية" },
  noKeys: { en: "No API keys for this merchant yet.", ar: "لا توجد مفاتيح لهذا التاجر بعد." },
  noMerchants: {
    en: "No merchants exist yet. Seed a merchant before generating keys.",
    ar: "لا يوجد تجار بعد. أنشئ تاجرًا قبل توليد المفاتيح.",
  },

  colKey: { en: "Key", ar: "المفتاح" },
  colName: { en: "Label", ar: "الاسم" },
  colCreated: { en: "Created", ar: "أُنشئ" },
  colLastUsed: { en: "Last used", ar: "آخر استخدام" },
  colStatus: { en: "Status", ar: "الحالة" },
  colAction: { en: "Action", ar: "إجراء" },

  active: { en: "Active", ar: "نشط" },
  revoked: { en: "Revoked", ar: "ملغى" },
  never: { en: "Never", ar: "أبدًا" },
  revoke: { en: "Revoke", ar: "إلغاء" },

  errNoMerchant: { en: "Select a merchant.", ar: "اختر تاجرًا." },
  errNoName: { en: "Enter a label for the key.", ar: "أدخل اسمًا للمفتاح." },
  errGeneric: { en: "Could not generate the key. Try again.", ar: "تعذّر إنشاء المفتاح. حاول مجددًا." },
} as const;

export type ApiKeyUiKey = keyof typeof UI;
export const kt = (key: ApiKeyUiKey, locale: Locale): string => pick(UI[key], locale);

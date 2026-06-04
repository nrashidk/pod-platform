// Bilingual EN/AR strings for the operator billing rollup. Same pattern as
// ../labels (CLAUDE.md: EN/AR is day-one).

import type { Locale } from "@/lib/i18n";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "Billing ledger", ar: "دفتر الفوترة" },
  subtitle: {
    en: "Recorded debt only — no money is moved. Merchant owes wholesale + markup; platform owes printers wholesale; the spread is margin.",
    ar: "دين مُسجَّل فقط — لا يتم تحويل أي أموال. يدين التاجر بسعر الجملة + هامش الربح؛ وتدين المنصّة للمطابع بسعر الجملة؛ والفرق هو الهامش.",
  },
  back: { en: "Back to orders", ar: "العودة إلى الطلبات" },
  createdNotice: {
    en: "Order created and billing recorded.",
    ar: "تم إنشاء الطلب وتسجيل الفوترة.",
  },

  walletBalances: { en: "Wallet balances", ar: "أرصدة المحافظ" },
  balance: { en: "Balance", ar: "الرصيد" },
  noWallets: {
    en: "No wallets yet.",
    ar: "لا توجد محافظ بعد.",
  },
  merchantsOwed: { en: "Per merchant — total owed", ar: "لكل تاجر — إجمالي المستحق" },
  printersPayable: {
    en: "Per printer — total payable",
    ar: "لكل مطبعة — إجمالي المستحق للدفع",
  },
  perOrder: { en: "Per order", ar: "لكل طلب" },

  merchant: { en: "Merchant", ar: "التاجر" },
  printer: { en: "Printer", ar: "المطبعة" },
  order: { en: "Order", ar: "الطلب" },
  owed: { en: "Merchant owed", ar: "مستحق على التاجر" },
  payable: { en: "Printer payable", ar: "مستحق للمطبعة" },
  margin: { en: "Platform margin", ar: "هامش المنصّة" },
  reconciles: { en: "Reconciles", ar: "متوازن" },
  total: { en: "Total", ar: "الإجمالي" },

  none: {
    en: "No billing recorded yet. Create an order to populate the ledger.",
    ar: "لا توجد فوترة مُسجَّلة بعد. أنشئ طلبًا لملء الدفتر.",
  },

  reconcileOk: {
    en: "Aggregate reconciles: Σ owed − Σ payable = Σ margin.",
    ar: "الإجمالي متوازن: مجموع المستحق − مجموع المدفوع = مجموع الهامش.",
  },
  reconcileBad: {
    en: "Aggregate does NOT reconcile — investigate.",
    ar: "الإجمالي غير متوازن — يجب التحقق.",
  },
} as const;

export type BillingKey = keyof typeof UI;
export const bt = (key: BillingKey, locale: Locale): string =>
  pick(UI[key], locale);

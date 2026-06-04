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

  // ── 70/30 retention hold ──
  payableNow: { en: "Payable now", ar: "مستحق الآن" },
  held: { en: "Held (30%)", ar: "محتجز (٣٠٪)" },
  holdDetail: {
    en: "Bulk retention holds (70/30)",
    ar: "احتجازات الطلبات الكبيرة (٧٠/٣٠)",
  },
  holdSubtitle: {
    en: "Release is computed live: a delivered fulfillment past its claim window with no open claim shows as payable — no job runs.",
    ar: "يُحسب الإفراج فورياً: يظهر الطلب المُسلَّم بعد انتهاء نافذة المطالبات وبدون مطالبة مفتوحة كمستحق للدفع — دون تشغيل أي مهمة.",
  },
  noHolds: {
    en: "No bulk retention holds yet (no dispatched fulfillment ≥ AED 1,000).",
    ar: "لا توجد احتجازات حتى الآن (لا يوجد طلب مُرسَل بقيمة ≥ ١٠٠٠ درهم).",
  },
  fulfillment: { en: "Fulfillment", ar: "التنفيذ" },
  wholesale: { en: "Wholesale", ar: "سعر الجملة" },
  dispatch70: { en: "Dispatch (70%)", ar: "عند الإرسال (٧٠٪)" },
  held30: { en: "Held (30%)", ar: "محتجز (٣٠٪)" },
  holdState: { en: "Hold state", ar: "حالة الاحتجاز" },
  stateHeld: { en: "HELD", ar: "محتجز" },
  stateReleasable: { en: "RELEASABLE", ar: "قابل للإفراج" },
  windowCloses: { en: "Window closes", ar: "إغلاق النافذة" },
  notDelivered: { en: "Not delivered", ar: "لم يُسلَّم" },
  claimStatus: { en: "Claim", ar: "المطالبة" },
  noClaim: { en: "None", ar: "لا يوجد" },
  claimOpen: { en: "Open claim", ar: "مطالبة مفتوحة" },
  openClaimBtn: { en: "Open claim", ar: "فتح مطالبة" },
  closeClaimBtn: { en: "Close claim", ar: "إغلاق المطالبة" },
  claimDescPlaceholder: {
    en: "Defect description…",
    ar: "وصف العيب…",
  },
  claimErr: {
    en: "Could not open the claim — the claim window is closed or not yet started.",
    ar: "تعذّر فتح المطالبة — نافذة المطالبات مغلقة أو لم تبدأ بعد.",
  },
} as const;

export type BillingKey = keyof typeof UI;
export const bt = (key: BillingKey, locale: Locale): string =>
  pick(UI[key], locale);

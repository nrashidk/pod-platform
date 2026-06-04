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
  manageDesigns: { en: "Manage designs", ar: "إدارة التصاميم" },
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

  // ── Wallet / top-up ──
  ordersHeading: { en: "Orders", ar: "الطلبات" },
  walletTitle: { en: "Wallet", ar: "المحفظة" },
  walletBalance: { en: "Balance", ar: "الرصيد" },
  topUpHeading: { en: "Top up your wallet", ar: "اشحن محفظتك" },
  topUpHint: {
    en: "Add funds (AED) to your prepaid wallet. You'll be taken to a secure payment page.",
    ar: "أضف رصيدًا (درهم) إلى محفظتك المدفوعة مسبقًا. سيتم نقلك إلى صفحة دفع آمنة.",
  },
  amountLabel: { en: "Amount (AED)", ar: "المبلغ (درهم)" },
  topUpButton: { en: "Top up", ar: "اشحن" },
  topUpPending: { en: "Redirecting…", ar: "جارٍ التحويل…" },
  processingNotice: {
    en: "Payment processing — your balance updates automatically once the payment is confirmed.",
    ar: "جارٍ معالجة الدفع — سيتم تحديث رصيدك تلقائيًا بمجرد تأكيد الدفع.",
  },
  cancelledNotice: {
    en: "Top-up cancelled. No payment was taken.",
    ar: "تم إلغاء الشحن. لم يتم خصم أي مبلغ.",
  },
  // Top-up action error kinds (errorKeyFor maps to these).
  errBadAmount: { en: "Enter a valid amount.", ar: "أدخل مبلغًا صحيحًا." },
  errOutOfRange: {
    en: "Amount must be between 50 and 100,000 AED.",
    ar: "يجب أن يكون المبلغ بين 50 و100,000 درهم.",
  },
  errGateway: {
    en: "Couldn't start the payment. Please try again.",
    ar: "تعذّر بدء الدفع. يُرجى المحاولة مرة أخرى.",
  },
  errGeneric: { en: "Something went wrong.", ar: "حدث خطأ ما." },
} satisfies Record<string, Bi>;

export type UiKey = keyof typeof UI;
export const t = (key: UiKey, locale: Locale): string => pick(UI[key], locale);

// Map a top-up action errorKind to a label key.
export function topUpErrorKey(kind: string): UiKey {
  switch (kind) {
    case "bad_amount":
      return "errBadAmount";
    case "out_of_range":
      return "errOutOfRange";
    case "gateway":
      return "errGateway";
    default:
      return "errGeneric";
  }
}

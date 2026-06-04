// Bilingual EN/AR strings for the merchant design manager. EN/AR is day-one
// (CLAUDE.md), so every human-facing label has both. Placement + validation
// status labels live here so the SCREAMING_CASE enums render human-readable.

import type { Locale } from "@/lib/i18n";
import type { PlacementCode, DesignValidationStatus } from "@prisma/client";

type Bi = { en: string; ar: string };
const pick = (b: Bi, locale: Locale): string => (locale === "ar" ? b.ar : b.en);

const UI = {
  title: { en: "My designs", ar: "تصاميمي" },
  subtitle: {
    en: "Upload your print files. Each file is checked against the product's print spec — a design is orderable once every placement passes.",
    ar: "ارفع ملفات الطباعة. يتم فحص كل ملف وفق مواصفات الطباعة للمنتج — يصبح التصميم قابلًا للطلب بمجرد نجاح كل المواضع.",
  },
  backToOrders: { en: "← My orders", ar: "← طلباتي" },
  manageDesigns: { en: "Manage designs", ar: "إدارة التصاميم" },
  langEN: { en: "English", ar: "English" },
  langAR: { en: "العربية", ar: "العربية" },
  logout: { en: "Sign out", ar: "تسجيل الخروج" },

  // Create design
  createHeading: { en: "Create a design", ar: "إنشاء تصميم" },
  createHint: {
    en: "Name it and choose the product type. You'll then upload a print file per placement.",
    ar: "أعطِه اسمًا واختر نوع المنتج. بعدها ترفع ملف طباعة لكل موضع.",
  },
  nameLabel: { en: "Design name", ar: "اسم التصميم" },
  productTypeLabel: { en: "Product type", ar: "نوع المنتج" },
  createButton: { en: "Create design", ar: "إنشاء التصميم" },
  createPending: { en: "Creating…", ar: "جارٍ الإنشاء…" },

  // List
  noDesigns: {
    en: "You don't have any designs yet. Create one above.",
    ar: "ليست لديك أي تصاميم بعد. أنشئ واحدًا بالأعلى.",
  },
  orderable: { en: "Orderable", ar: "قابل للطلب" },
  notOrderable: { en: "Not orderable yet", ar: "غير قابل للطلب بعد" },
  placementsHeading: { en: "Placements", ar: "المواضع" },
  reasonsHeading: { en: "Issues to fix", ar: "مشكلات يجب إصلاحها" },

  // Upload
  uploadFile: { en: "Upload print file", ar: "ارفع ملف الطباعة" },
  replaceFile: { en: "Replace file", ar: "استبدال الملف" },
  uploadPending: { en: "Uploading…", ar: "جارٍ الرفع…" },

  // Distinct in-flight stage labels, so a stuck upload shows WHERE it is.
  phaseMinting: { en: "Authorizing upload…", ar: "جارٍ تفويض الرفع…" },
  phaseUploading: { en: "Uploading to storage…", ar: "جارٍ الرفع إلى التخزين…" },
  phaseValidating: { en: "Validating file…", ar: "جارٍ التحقق من الملف…" },
  fileHint: {
    en: "PNG or JPEG.",
    ar: "PNG أو JPEG.",
  },
  maxSize: { en: "Max", ar: "الحد الأقصى" },
  viewFile: { en: "View current file", ar: "عرض الملف الحالي" },
  uploadedPassed: {
    en: "Print file passed validation.",
    ar: "اجتاز ملف الطباعة التحقق.",
  },
  uploadedFlagged: {
    en: "Print file was flagged — see the issues and re-upload.",
    ar: "تم وضع علامة على ملف الطباعة — راجع المشكلات وأعد الرفع.",
  },

  // Status badges
  statusPassed: { en: "Passed", ar: "مقبول" },
  statusFlagged: { en: "Flagged", ar: "مرفوض" },
  statusPending: { en: "Pending", ar: "قيد الانتظار" },
  statusNone: { en: "No file", ar: "لا يوجد ملف" },

  // Errors
  errNoName: { en: "Enter a design name.", ar: "أدخل اسم التصميم." },
  errNoProductType: { en: "Choose a product type.", ar: "اختر نوع المنتج." },
  errNoFile: { en: "Choose a file to upload.", ar: "اختر ملفًا للرفع." },
  errBadContentType: {
    en: "Only PNG or JPEG files are accepted.",
    ar: "يُقبل فقط ملفات PNG أو JPEG.",
  },
  errTooLarge: {
    en: "That file is too large for this placement.",
    ar: "هذا الملف كبير جدًا لهذا الموضع.",
  },
  errDesignNotFound: {
    en: "Design not found.",
    ar: "التصميم غير موجود.",
  },
  errNoPrintArea: {
    en: "This product type has no print area for that placement.",
    ar: "لا يحتوي نوع المنتج على منطقة طباعة لهذا الموضع.",
  },
  errGeneric: { en: "Something went wrong. Please try again.", ar: "حدث خطأ ما. حاول مجددًا." },
  // Per-stage failure messages — replace the opaque catch-all so an unexpected
  // failure names the stage it died in. The raw cause is shown alongside.
  errMinting: {
    en: "Couldn't authorize the upload. Please try again.",
    ar: "تعذّر تفويض الرفع. حاول مجددًا.",
  },
  errUploading: {
    en: "The file couldn't be uploaded to storage.",
    ar: "تعذّر رفع الملف إلى التخزين.",
  },
  errValidating: {
    en: "The uploaded file couldn't be validated. Please try again.",
    ar: "تعذّر التحقق من الملف المرفوع. حاول مجددًا.",
  },
} satisfies Record<string, Bi>;

export type UiKey = keyof typeof UI;
export const dt = (key: UiKey, locale: Locale): string => pick(UI[key], locale);

const PLACEMENTS: Record<PlacementCode, Bi> = {
  FRONT: { en: "Front", ar: "الأمام" },
  BACK: { en: "Back", ar: "الخلف" },
  LEFT_SLEEVE: { en: "Left sleeve", ar: "الكم الأيسر" },
  RIGHT_SLEEVE: { en: "Right sleeve", ar: "الكم الأيمن" },
  WRAP: { en: "Wrap", ar: "محيطي" },
  FULL: { en: "Full", ar: "كامل" },
};
export const placementLabel = (p: PlacementCode, locale: Locale): string =>
  pick(PLACEMENTS[p], locale);

const STATUS: Record<DesignValidationStatus | "NONE", Bi> = {
  PASSED: { en: "Passed", ar: "مقبول" },
  FLAGGED: { en: "Flagged", ar: "مرفوض" },
  PENDING: { en: "Pending", ar: "قيد الانتظار" },
  NONE: { en: "No file", ar: "لا يوجد ملف" },
};
export const statusLabel = (
  s: DesignValidationStatus | "NONE",
  locale: Locale
): string => pick(STATUS[s], locale);

// Map an upload-action reject code to a label key.
export function uploadErrorKey(kind: string): UiKey {
  switch (kind) {
    case "no_file":
      return "errNoFile";
    case "bad_content_type":
      return "errBadContentType";
    case "too_large":
      return "errTooLarge";
    case "design_not_found":
      return "errDesignNotFound";
    case "no_print_area":
      return "errNoPrintArea";
    default:
      return "errGeneric";
  }
}

// In-flight progress label for a stage.
export function uploadPhaseKey(phase: "minting" | "uploading" | "validating"): UiKey {
  switch (phase) {
    case "minting":
      return "phaseMinting";
    case "uploading":
      return "phaseUploading";
    case "validating":
      return "phaseValidating";
  }
}

// Failure message for an UNEXPECTED error, scoped to the stage it died in.
export function uploadPhaseErrorKey(
  phase: "minting" | "uploading" | "validating" | undefined
): UiKey {
  switch (phase) {
    case "minting":
      return "errMinting";
    case "uploading":
      return "errUploading";
    case "validating":
      return "errValidating";
    default:
      return "errGeneric";
  }
}

// Map a create-design-action error kind to a label key.
export function createErrorKey(kind: string): UiKey {
  switch (kind) {
    case "no_name":
      return "errNoName";
    case "no_product_type":
      return "errNoProductType";
    default:
      return "errGeneric";
  }
}

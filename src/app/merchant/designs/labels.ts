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
  // Up-front "what to upload" requirements (shown before any file is chosen).
  reqLabel: { en: "What to upload", ar: "ما الذي ترفعه" },
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

// ── Up-front upload requirements, derived from the PrintArea spec ──
// Stated BEFORE a file is chosen so the merchant knows the target and the first
// attempt can succeed. Numbers come from the spec (designs.ts), never hardcoded.
export function placementRequirements(
  locale: Locale,
  opts: { formats: string[]; minWidthPx: number; minHeightPx: number; maxFileMb: number }
): string {
  const fmts = opts.formats.join(" / ");
  return locale === "ar"
    ? `ارفع ملف ${fmts} لا تقل أبعاده عن ${opts.minWidthPx} × ${opts.minHeightPx} بكسل وبحجم حتى ${opts.maxFileMb} ميجابايت. تضمن هذه الأبعاد طباعة واضحة بالحجم الكامل.`
    : `Upload a ${fmts} file at least ${opts.minWidthPx} × ${opts.minHeightPx} pixels and up to ${opts.maxFileMb} MB. That size keeps the print sharp at full product size.`;
}

// ── Friendly, non-technical translation of validation reason strings ──
// validatePrintFile returns precise, technical reasons (kept verbatim for
// tests/ops and persisted on the row). Merchants aren't printers, so at THIS
// display layer we recognize each reason, pull out its numbers, and re-state it
// as: what's wrong, what's needed, and what to DO — bilingual EN/AR. The exact
// figures are preserved (a merchant can hand them straight to a designer). An
// unrecognized reason falls through verbatim so nothing is ever hidden.
const placementWord = (code: string, locale: Locale): string => {
  const bi = (PLACEMENTS as Record<string, Bi>)[code];
  return bi ? pick(bi, locale) : code.toLowerCase().replace(/_/g, " ");
};

export function friendlyReason(reason: string, locale: Locale): string {
  let m: RegExpMatchArray | null;

  // Not enough pixels to fill the print area (the most common flag).
  if (
    (m = reason.match(
      /^dimensions (\d+)×(\d+)px too small for (\w+) print area \(needs ≥(\d+)×(\d+)px at (\d+) DPI\)$/
    ))
  ) {
    const [, w, h, place, reqW, reqH] = m;
    const p = placementWord(place, locale);
    return locale === "ar"
      ? `هذه الصورة أصغر من أن تُطبع بوضوح بالحجم الكامل. تحتاج طباعة «${p}» إلى صورة لا تقل عن ${reqW} × ${reqH} بكسل — أما صورتك فهي ${w} × ${h}. اطلب من مصمّمك ملفًا بدقة الطباعة، أو أعد تصدير التصميم بأبعاد أكبر.`
      : `This image is too small to print sharply at full product size. A ${p} print needs an image of at least ${reqW} × ${reqH} pixels — yours is ${w} × ${h}. Ask your designer for a print-resolution file, or re-export your design at a larger size.`;
  }

  // Embedded print resolution (DPI) too low.
  if ((m = reason.match(/^DPI (\d+) below minimum (\d+)$/))) {
    const [, got, min] = m;
    return locale === "ar"
      ? `دقة الطباعة المحفوظة داخل الملف منخفضة جدًا (${got} نقطة/بوصة، والمطلوب ${min} على الأقل). أعد تصدير الملف بدقة ${min} نقطة/بوصة أو أعلى — يتحكم بذلك إعداد «التصدير» أو «الحفظ للطباعة» في برنامج التصميم.`
      : `This file's saved print resolution is too low (${got} DPI; it needs at least ${min} DPI). Re-export it at ${min} DPI or higher — your design software's "export" or "save for print" setting controls this.`;
  }

  // Transparency required (e.g. DTG on dark garments) but the file is opaque.
  if (
    (m = reason.match(
      /^(\w+) requires transparency \(alpha channel\) but file is opaque$/
    ))
  ) {
    return locale === "ar"
      ? `تحتاج هذه الطباعة إلى خلفية شفافة كي يُطبع تصميمك وحده دون مستطيل حوله. أعد تصدير الملف بصيغة PNG بخلفية شفافة (أوقف طبقة الخلفية أو لون التعبئة قبل التصدير).`
      : `This print needs a transparent background so only your design prints — not a rectangle around it. Re-export as a PNG with a transparent background (turn off the background layer or fill before exporting).`;
  }

  // Wrong file type for this placement.
  if ((m = reason.match(/^format (\w+) not allowed \(allowed: (.+)\)$/))) {
    const [, got, allowed] = m;
    return locale === "ar"
      ? `لا يمكن استخدام نوع الملف هذا (${got}) لهذه الطباعة. يُرجى رفع أحد الأنواع التالية: ${allowed}. يمكنك إعادة التصدير أو «الحفظ بصيغة» بأحد هذه الأنواع من برنامج التصميم.`
      : `This file type (${got}) can't be used for this print. Please upload one of: ${allowed}. You can re-export or "save as" one of these formats from your design software.`;
  }

  // File over the per-placement size limit.
  if ((m = reason.match(/^file ([\d.]+)MB exceeds maximum ([\d.]+)MB$/))) {
    const [, got, max] = m;
    return locale === "ar"
      ? `حجم هذا الملف يتجاوز الحد الأقصى ${max} ميجابايت (حجمه ${got} ميجابايت). صدّره كملف PNG أو JPEG مسطّح، أو قلّل أبعاده بالبكسل قليلًا — يمكن أن يبقى أكبر بكثير من الحد الأدنى ومع ذلك ضمن الحد المسموح.`
      : `This file is over the ${max} MB limit (it's ${got} MB). Export it as a flattened PNG or JPEG, or reduce its pixel size a little — it can stay well above the minimum and still fit.`;
  }

  // Color mode mismatch (e.g. CMYK vs sRGB).
  if ((m = reason.match(/^color profile (.+) does not match required (.+)$/))) {
    const [, got, want] = m;
    return locale === "ar"
      ? `يستخدم هذا الملف نمط ألوان غير مناسب (${got})، بينما تتطلب هذه الطباعة ${want}. حوّل المستند إلى ${want} في برنامج التصميم قبل التصدير لتتطابق الألوان المطبوعة مع ما تراه.`
      : `This file uses the wrong color mode (${got}); this print needs ${want}. Convert the document to ${want} in your design software before exporting, so the printed colors match what you see.`;
  }

  // Bytes weren't a readable image at all.
  if (reason === "file is not a readable image (could not parse metadata)") {
    return locale === "ar"
      ? `تعذّر علينا قراءة هذا الملف كصورة. تأكد من رفع ملف الصورة نفسه (PNG أو JPEG)، وليس ملف PDF أو ZIP أو ملف مشروع من برنامج التصميم.`
      : `We couldn't read this file as an image. Make sure you're uploading the actual image file (PNG or JPEG) — not a PDF, a ZIP, or a design-software project file.`;
  }

  // Unknown reason — surface it as-is rather than hide it.
  return reason;
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

// Locale + text-direction foundation for the bilingual EN/AR requirement
// (docs/pod-platform-data-model.md: "Bilingual EN/AR with RTL throughout").
//
// This is the structural seam only. Locale *resolution* (a `[locale]` route
// segment, middleware, or a cookie/header negotiator) is a later build step;
// for now the root layout consumes `defaultLocale`.

export const locales = ["en", "ar"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export type Direction = "ltr" | "rtl";

/** Text direction for a given locale — Arabic is RTL, everything else LTR. */
export function getDirection(locale: Locale): Direction {
  return locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

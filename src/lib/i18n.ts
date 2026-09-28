// Locale + text-direction foundation for the bilingual EN/AR requirement
// (docs/pod-platform-data-model.md: "Bilingual EN/AR with RTL throughout").
//
// Locale is resolved ONCE per request in src/middleware.ts (?lang= → cookie →
// default) and forwarded to the root layout and pages via LOCALE_HEADER; see
// src/lib/locale.ts for the server-side reader.

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

/** Cookie that remembers the visitor's last explicit ?lang= choice. */
export const LOCALE_COOKIE = "pod_locale";

/** Request header the middleware sets to the resolved locale for this request. */
export const LOCALE_HEADER = "x-pod-locale";

/**
 * Pure resolution order: explicit `?lang=` → remembered cookie → default.
 * Anything that is not a supported locale is ignored (falls through).
 */
export function resolveLocale(
  query: string | null | undefined,
  cookie: string | null | undefined,
): Locale {
  if (query && isLocale(query)) return query;
  if (cookie && isLocale(cookie)) return cookie;
  return defaultLocale;
}

// Server-side reader for the locale the middleware resolved for this request.
import { headers } from "next/headers";
import { LOCALE_HEADER, isLocale, resolveLocale, type Locale } from "./i18n";

/**
 * Locale for the current request. A page's own `?lang=` wins (it is what the
 * middleware resolved too); otherwise the middleware-forwarded value (cookie →
 * default).
 */
export async function getRequestLocale(query?: string | null): Promise<Locale> {
  const forwarded = (await headers()).get(LOCALE_HEADER);
  return resolveLocale(query, forwarded && isLocale(forwarded) ? forwarded : null);
}

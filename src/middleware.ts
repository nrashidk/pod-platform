// ─────────────────────────────────────────────────────────────
// UX-ONLY route guard. NOT a security boundary.
//
// This middleware only checks for the PRESENCE of a session cookie and bounces
// anonymous visitors to /login so they don't see a flash of a protected page.
// It does NOT decode the session, check the role, or talk to the DB.
//
// Authorization is enforced at the DATA LAYER — every protected page and server
// action independently calls requireRole(...) (see src/lib/auth-context.ts and
// src/app/ops/*). That is deliberate: middleware can be bypassed
// (cf. CVE-2025-29927, the Next.js middleware-bypass class of bug), so it must
// NEVER be the only line of defense. If this file were deleted, the app would be
// less pretty but JUST AS SECURE — /ops would still reject non-operators.
// ─────────────────────────────────────────────────────────────

import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { LOCALE_COOKIE, LOCALE_HEADER, isLocale, resolveLocale } from "./lib/i18n";

// Locale resolution runs for every page: ?lang= → cookie → default. The result
// is forwarded to the root layout/pages as a request header (so <html lang dir>
// is right on the very first render) and an explicit ?lang= is remembered in a
// cookie so it survives links that do not carry the query string.
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const queryLang = searchParams.get("lang");
  const cookieLang = request.cookies.get(LOCALE_COOKIE)?.value;
  const locale = resolveLocale(queryLang, cookieLang);
  // <Link> prefetches (e.g. the inactive language toggle) must not change the
  // remembered language — only a real navigation does.
  const isPrefetch =
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch";
  const remember =
    !isPrefetch && queryLang !== null && isLocale(queryLang) && queryLang !== cookieLang;

  const withCookie = (res: NextResponse) => {
    if (remember) {
      res.cookies.set(LOCALE_COOKIE, locale, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }
    return res;
  };

  // Auth UX gate — /ops only. Cookie-presence check only (no decode/verify).
  // Must match the cookiePrefix configured in src/lib/auth.ts.
  if (pathname === "/ops" || pathname.startsWith("/ops/")) {
    const sessionCookie = getSessionCookie(request, {
      cookiePrefix: "pod_backoffice",
    });
    if (!sessionCookie) {
      // Keep the language through the bounce to /login.
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("lang", locale);
      return withCookie(NextResponse.redirect(loginUrl));
    }
  }

  // Forward the resolved locale to the server render.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_HEADER, locale);
  return withCookie(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Every page (locale) — /api, Next internals and static files are skipped.
  // The auth gate inside only applies to /ops; /login stays public.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

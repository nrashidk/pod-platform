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

export function middleware(request: NextRequest) {
  // Cookie-presence check only (no decode/verify). Must match the cookiePrefix
  // configured in src/lib/auth.ts so we look for the right cookie.
  const sessionCookie = getSessionCookie(request, {
    cookiePrefix: "pod_backoffice",
  });

  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Has a cookie → let it through. Role/ownership is still checked server-side.
  return NextResponse.next();
}

export const config = {
  // Gate the back-office surface only. /login and the auth API stay public.
  matcher: ["/ops", "/ops/:path*"],
};

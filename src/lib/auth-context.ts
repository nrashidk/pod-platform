// DATA-LAYER authorization context — the single, server-trusted source of "who
// is calling and what may they see". Every protected page, server action, and
// scoped query derives identity from HERE (the session cookie), never from
// client-supplied input. This is the core of the CVE-2025-29927 defense:
// middleware may redirect for UX, but authorization is decided in this layer,
// independently, on every request.
//
// Next-only (uses next/headers + next/navigation) — runs inside a request
// context (RSC / route handler / server action), not in plain Node.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { auth } from "./auth";

// The projection of a session every downstream check scopes on. role drives
// WHAT a caller may do; merchantId / printerId drive WHICH rows they may see.
// The DB CHECK constraint guarantees these are consistent with the role.
export type AuthContext = {
  userId: string;
  email: string;
  role: UserRole;
  merchantId: string | null;
  printerId: string | null;
};

// Resolve the caller's context from the request's session cookie. Returns null
// when there is no valid session. Does NOT redirect — use this when "no session"
// is a legitimate branch (e.g. deciding what to render). For a hard guard, use
// requireRole.
export async function getAuthContext(): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  // role/merchantId/printerId are Better Auth additionalFields (typed loosely as
  // string); narrow them here against the Prisma enum.
  const u = session.user as {
    id: string;
    email: string;
    role: UserRole;
    merchantId?: string | null;
    printerId?: string | null;
  };

  return {
    userId: u.id,
    email: u.email,
    role: u.role,
    merchantId: u.merchantId ?? null,
    printerId: u.printerId ?? null,
  };
}

// Hard guard for protected server components / actions. Redirects to /login when
// unauthenticated; redirects away when authenticated but lacking an allowed
// role. Returns the context when the caller is authorized.
//
// This is an INDEPENDENT re-check — it must be called inside every protected
// page AND every server action (a forged POST that skips the page still hits the
// action's own requireRole). Never rely on middleware alone.
export async function requireRole(...allowed: UserRole[]): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) {
    redirect("/login");
  }
  if (allowed.length > 0 && !allowed.includes(ctx.role)) {
    // Authenticated but wrong role: do not leak the resource. A dedicated 403
    // surface arrives with the login UI step; for now bounce to /login.
    redirect("/login?error=forbidden");
  }
  return ctx;
}

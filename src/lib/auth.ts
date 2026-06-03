// Better Auth server instance — the single source of truth for back-office
// authentication (OPERATOR / MERCHANT / PRINTER). Wired to the existing Neon
// database through the Prisma adapter (reuses the shared `prisma` singleton, so
// runtime traffic uses the pooled DATABASE_URL; migrations keep using DIRECT_URL).
//
// Security posture for this phase:
//  - Email + password only; password hashing is Better Auth's default (scrypt).
//  - disableSignUp: true — there is NO public registration. Back-office users
//    exist only via the seed/admin path; the sign-up endpoint is closed.
//  - DB-backed sessions (Better Auth default with the Prisma adapter): the
//    session row in `Session` is the source of truth, so logout/expiry truly
//    revokes. We deliberately do NOT use stateless JWT sessions.
//  - role / merchantId / printerId are exposed on the session user but are
//    `input: false` — a client can never set or change its own role or scope.
//    They are assigned server-side only (seed/admin). This is the data-layer
//    authorization foundation; the scoped queries that consume them come later.

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
// Relative import (not the @/ alias) so this module — and anything that imports
// it, like the auth seed — runs under the plain-Node smoke loader too.
import { prisma } from "./prisma";

// Origins Better Auth will accept on sign-in POSTs (its CSRF defence). Better
// Auth ALWAYS trusts the configured baseURL implicitly (getTrustedOrigins pushes
// new URL(baseURL).origin), so this list only ADDS to that — production needs
// nothing here to keep working, and we deliberately add nothing.
//
// DEV ONLY: the Next dev server hops between :3000 and :3001, and the browser
// may reach it via localhost OR 127.0.0.1 (distinct hosts to the same-origin
// check) OR the Codespaces forward — so a single fixed port/host breaks sign-in.
// We loosen to accept any port on the loopback hosts (and any forwarded port in
// a Codespace) using Better Auth's wildcard origin matcher, where "*" matches
// any run of non-"/" chars while the scheme and host stay literal/anchored.
// That means "http://localhost:*" matches localhost on any port but NOT
// localhost.evil.com, and the Codespaces pattern matches only the configured
// codespace's subdomains. None of this applies in production (see the gate).
function resolveTrustedOrigins(): string[] {
  // Gate: anything below is dev-only. `next dev` runs with NODE_ENV !==
  // "production"; Vercel/`next start` set it to "production", so production
  // stays strict (baseURL-only, trusted implicitly by Better Auth).
  if (process.env.NODE_ENV === "production") return [];

  const origins = [
    // Loopback on ANY port — covers :3000/:3001 hops and both host spellings.
    "http://localhost:*",
    "http://127.0.0.1:*",
  ];

  // Codespaces forwards each port to its own subdomain
  // (https://<name>-<port>.<domain>); wildcard the port segment so a port hop
  // doesn't need a config change. The literal <name>- prefix and <domain>
  // suffix keep this scoped to THIS codespace's forwards.
  const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } =
    process.env;
  if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    origins.push(
      `https://${CODESPACE_NAME}-*.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`,
    );
  }

  // Whatever baseURL is configured to, so an explicit BETTER_AUTH_URL override
  // is always trusted even if it isn't one of the above.
  if (process.env.BETTER_AUTH_URL) origins.push(process.env.BETTER_AUTH_URL);

  return [...new Set(origins)];
}

export const auth = betterAuth({
  // Reuse the app's Prisma client against Neon. provider must match the
  // datasource so Better Auth emits PostgreSQL-correct queries.
  database: prismaAdapter(prisma, { provider: "postgresql" }),

  // Pinned explicitly (Better Auth also reads these from env, but being explicit
  // keeps the wiring obvious and fails loudly if the env is missing).
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,

  // Better Auth rejects any sign-in POST whose Origin header isn't trusted
  // (CSRF defence) with a 403. baseURL is always trusted implicitly; in DEV we
  // additionally accept the loopback hosts on any port and the Codespaces
  // forward so port/host variation doesn't cause a misleading "Invalid origin"
  // 403. In production this returns [] — strict, baseURL-only. See
  // resolveTrustedOrigins for the gate and the wildcard-safety reasoning.
  trustedOrigins: resolveTrustedOrigins(),

  emailAndPassword: {
    enabled: true,
    disableSignUp: true, // no public registration — back-office only
  },

  // RBAC fields surfaced on the session user. input:false ⇒ not settable via any
  // client request (sign-up/update); only server-side code assigns them. The DB
  // CHECK constraint (migration add_auth_users_rbac) guarantees role↔link
  // consistency regardless of how a row is written.
  user: {
    additionalFields: {
      role: { type: "string", required: true, input: false },
      merchantId: { type: "string", required: false, input: false },
      printerId: { type: "string", required: false, input: false },
    },
  },

  // DB sessions: 7-day lifetime, refreshed at most once/day.
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  // Namespaced cookie so it never collides with a future storefront/buyer
  // auth surface. Better Auth sets httpOnly + sameSite=lax by default, and
  // marks the cookie Secure automatically when baseURL is https.
  advanced: {
    cookiePrefix: "pod_backoffice",
  },
});

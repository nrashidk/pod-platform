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

// The origins the dev server is reachable under. localhost and 127.0.0.1 are
// distinct hosts to the browser's same-origin check, so both must be trusted.
// In a Codespace the forwarded origin is https://<name>-<port>.<domain>.
function devTrustedOrigins(): string[] {
  const origins = ["http://localhost:3000", "http://127.0.0.1:3000"];

  const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN } =
    process.env;
  if (CODESPACE_NAME && GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    origins.push(
      `https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`,
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
  // (CSRF defence) with a 403. baseURL is trusted implicitly, but the dev
  // server is reachable under several origins that must each be listed or
  // sign-in fails with a misleading "Invalid origin" 403:
  //  - http://localhost:3000     (BETTER_AUTH_URL)
  //  - http://127.0.0.1:3000     (same server, different host — NOT covered
  //                               by localhost; this was the reported failure)
  //  - the Codespaces forwarded HTTPS origin, when running in a Codespace.
  trustedOrigins: devTrustedOrigins(),

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

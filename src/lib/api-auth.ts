// ─────────────────────────────────────────────────────────────
// PROGRAMMATIC-INTAKE AUTH — per-merchant API keys (Bearer).
//
// The machine-facing analogue of src/lib/auth-context.ts: instead of a session
// cookie, a merchant's system presents a long-lived API key in the
// Authorization header. Resolving the key yields the Merchant; ALL order
// creation downstream is scoped to that merchant, never to request-body input.
//
// Hashing posture (see also the MerchantApiKey model comment): we store only
// SHA-256(token). API keys are 256-bit CSPRNG output — nothing to brute-force —
// so a single fast unsalted hash is safe AND lets us resolve a presented key in
// ONE indexed lookup (token_hash @unique). A salted password hash (scrypt) would
// force a full-table scan per request and buys nothing for high-entropy secrets.
//
// Pure data layer (no next/headers): callers pass the raw Authorization header
// string, so this is unit-testable under the plain-Node smoke loader.
// ─────────────────────────────────────────────────────────────

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

// Stored in clear on the row for display ("which key is this?"). The raw token
// is PREFIX + a base64url body; only the prefix + last4 are ever shown again.
export const API_KEY_PREFIX = "pod_live_";

/** A freshly minted key. `token` is returned to the operator ONCE, never stored. */
export interface GeneratedKey {
  token: string; // full raw secret — show once, then it is unrecoverable
  token_hash: string; // SHA-256(token), hex — the only copy persisted
  token_prefix: string;
  last4: string;
}

/** SHA-256(token) as lowercase hex — the lookup key and the at-rest form. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint a new API key: PREFIX + 32 bytes of CSPRNG randomness (base64url). The
 * caller persists token_hash/token_prefix/last4; the raw `token` is shown to the
 * operator exactly once and then thrown away.
 */
export function generateApiKey(): GeneratedKey {
  const body = randomBytes(32).toString("base64url");
  const token = `${API_KEY_PREFIX}${body}`;
  return {
    token,
    token_hash: hashToken(token),
    token_prefix: API_KEY_PREFIX,
    last4: token.slice(-4),
  };
}

/** Extract the raw token from an `Authorization: Bearer <token>` header. */
export function parseBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/** The identity a resolved key grants: which merchant, via which key row. */
export interface ApiCaller {
  merchantId: string;
  keyId: string;
}

/**
 * Resolve a request's Authorization header to the owning Merchant, or null if
 * the header is missing/malformed, the key is unknown, or the key is revoked.
 *
 * SECURITY: we look the key up by its SHA-256 hash (constant-work indexed
 * lookup), never by comparing a stored secret, so there is no timing side
 * channel to defend. A revoked key (revoked_at set) never resolves. We do not
 * log the token. last_used_at is best-effort touched (failure to touch never
 * blocks a valid call).
 */
export async function resolveMerchantFromApiKey(
  authHeader: string | null | undefined
): Promise<ApiCaller | null> {
  const token = parseBearer(authHeader);
  if (!token) return null;

  const row = await prisma.merchantApiKey.findUnique({
    where: { token_hash: hashToken(token) },
    select: { id: true, merchantId: true, revoked_at: true },
  });
  if (!row || row.revoked_at) return null;

  // Best-effort usage stamp — never let a write failure reject a valid key.
  try {
    await prisma.merchantApiKey.update({
      where: { id: row.id },
      data: { last_used_at: new Date() },
    });
  } catch {
    /* non-fatal */
  }

  return { merchantId: row.merchantId, keyId: row.id };
}

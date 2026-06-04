"use server";

// Server Actions for operator API-key management. INDEPENDENT auth re-check
// (requireRole — a forged POST must be rejected here, never assume the page
// gated it), then mint/revoke a per-merchant key.
//
// The freshly minted RAW token is returned in the action result so the client
// can show it ONCE. It is deliberately NOT redirected through a URL (which would
// leak the secret into history/logs) and is never persisted — only its
// SHA-256 hash is stored.

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { generateApiKey } from "@/lib/api-auth";

export interface GenerateKeyState {
  error?: "no_merchant" | "no_name" | "generic";
  // Present only on success — the one-time secret to display.
  token?: string;
  merchantName?: string;
}

export async function generateKeyAction(
  _prev: GenerateKeyState,
  formData: FormData
): Promise<GenerateKeyState> {
  await requireRole("OPERATOR");

  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!merchantId) return { error: "no_merchant" };
  if (!name) return { error: "no_name" };

  const merchant = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true },
  });
  if (!merchant) return { error: "no_merchant" };

  const key = generateApiKey();
  await prisma.merchantApiKey.create({
    data: {
      merchantId,
      name,
      token_hash: key.token_hash,
      token_prefix: key.token_prefix,
      last4: key.last4,
    },
  });

  revalidatePath("/ops/api-keys");
  // Return the RAW token once; it is never stored and cannot be re-shown.
  return { token: key.token, merchantName: merchant.name };
}

export async function revokeKeyAction(formData: FormData) {
  await requireRole("OPERATOR");

  const keyId = String(formData.get("keyId") ?? "").trim();
  if (!keyId) return;

  // Idempotent: only stamp revoked_at if not already revoked.
  await prisma.merchantApiKey.updateMany({
    where: { id: keyId, revoked_at: null },
    data: { revoked_at: new Date() },
  });

  revalidatePath("/ops/api-keys");
}

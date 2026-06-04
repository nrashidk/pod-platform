"use server";

// Server Action behind the merchant wallet top-up form. INDEPENDENT auth
// re-check (requireRole — a forged POST must be rejected here), then: validate
// the AED amount → ensure the merchant's wallet exists → record a WalletTopUp
// (status INITIATED) → open a hosted Checkout Session via the PaymentProvider
// seam → redirect the merchant to the gateway's page.
//
// CRUCIAL: this does NOT credit the wallet. The INITIATED row carries no money;
// the wallet is credited ONLY later, from the VERIFIED webhook
// (/api/webhooks/stripe). The success-redirect just shows a "processing" state.

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { paymentProvider } from "@/lib/payments";

export interface TopUpState {
  errorKind?: string;
}

// AED top-up bounds (this phase). Min keeps fee-vs-amount sane; max is a sanity
// ceiling, not a business limit.
const MIN_TOPUP_AED = 50;
const MAX_TOPUP_AED = 100_000;

export async function createTopUpAction(
  _prev: TopUpState,
  formData: FormData
): Promise<TopUpState> {
  const ctx = await requireRole("MERCHANT");
  if (!ctx.merchantId) return { errorKind: "no_merchant" };

  // Parse + validate the amount. Reject anything not a positive 2dp number in range.
  const raw = String(formData.get("amount") ?? "").trim();
  const amount = Number(raw);
  if (!raw || !Number.isFinite(amount) || amount <= 0) {
    return { errorKind: "bad_amount" };
  }
  if (Math.round(amount * 100) !== amount * 100) {
    return { errorKind: "bad_amount" }; // more than 2 decimal places
  }
  if (amount < MIN_TOPUP_AED || amount > MAX_TOPUP_AED) {
    return { errorKind: "out_of_range" };
  }

  // Ensure the wallet exists (record-only — NOT a credit; balance is untouched).
  const wallet = await prisma.wallet.upsert({
    where: { merchantId: ctx.merchantId },
    create: { merchantId: ctx.merchantId, currency: "AED" },
    update: {},
  });

  // Record the INITIATED top-up. Its id round-trips through the gateway so the
  // verified webhook maps the payment back here.
  const topup = await prisma.walletTopUp.create({
    data: {
      walletId: wallet.id,
      merchantId: ctx.merchantId,
      provider: paymentProvider.name,
      amount: amount.toFixed(2),
      currency: wallet.currency,
      status: "INITIATED",
    },
    select: { id: true },
  });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  let checkoutUrl: string;
  try {
    const session = await paymentProvider.createTopUpCheckout({
      topUpId: topup.id,
      merchantId: ctx.merchantId,
      amount,
      currency: wallet.currency,
      successUrl: `${base}/merchant?topup=processing`,
      cancelUrl: `${base}/merchant?topup=cancelled`,
    });
    checkoutUrl = session.checkoutUrl;
    await prisma.walletTopUp.update({
      where: { id: topup.id },
      data: { provider_session_id: session.providerSessionId },
    });
  } catch (e) {
    // Gateway/config failure: leave the INITIATED row (never credited) and tell
    // the merchant to retry. Never crash the page.
    console.error("createTopUpAction: checkout creation failed:", e);
    return { errorKind: "gateway" };
  }

  // Hand off to the gateway's hosted page. redirect() throws by design — keep it
  // OUTSIDE the try/catch so it isn't swallowed.
  redirect(checkoutUrl);
}

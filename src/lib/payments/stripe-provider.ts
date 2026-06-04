// Stripe implementation of the PaymentProvider seam (TEST MODE in development).
//
// This is the ONLY file that imports the Stripe SDK. Everything else — the
// top-up action, the webhook-credit logic, the schema — speaks the gateway-
// agnostic types in ./provider. Replacing Stripe with a UAE gateway means
// writing one sibling class and changing ./index — nothing else moves.
//
// Why the SDK (vs hand-rolled crypto): webhook signature verification is the
// money-in security boundary. Stripe's scheme involves timing-safe comparison,
// signature-header parsing, and a replay-protection timestamp tolerance window —
// exactly the place subtle hand-rolled-crypto bugs live. stripe.webhooks.
// constructEvent is the battle-tested primitive; we delegate to it.

import Stripe from "stripe";
import {
  WebhookVerificationError,
  type CreateTopUpCheckoutInput,
  type CreateTopUpCheckoutResult,
  type NormalizedWebhookEvent,
  type PaymentProvider,
} from "./provider";

// The one event that credits a wallet. A completed Checkout Session whose
// payment_status is "paid" means Stripe captured the funds.
const TOPUP_EVENT = "checkout.session.completed";

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";

  // Lazy SDK init so merely IMPORTING the seam never requires keys (e.g. the
  // "redirect alone never credits" test exercises the ledger without Stripe).
  // Keys are read at call time, so a missing/placeholder key fails loudly only
  // when an operation actually needs the gateway.
  private _client: Stripe | null = null;
  private client(): Stripe {
    if (!this._client) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
      this._client = new Stripe(key);
    }
    return this._client;
  }

  private webhookSecret(): string {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set.");
    return secret;
  }

  async createTopUpCheckout(
    input: CreateTopUpCheckoutInput
  ): Promise<CreateTopUpCheckoutResult> {
    // AED is a 2-decimal currency → smallest unit is fils (×100). Stripe expects
    // the integer minor-unit amount.
    const unitAmount = Math.round(input.amount * 100);

    const session = await this.client().checkout.sessions.create({
      mode: "payment",
      // Round-trip our WalletTopUp.id through BOTH fields so the verified webhook
      // can recover it (metadata is the resilient path; client_reference_id is
      // the conventional one).
      client_reference_id: input.topUpId,
      metadata: { topUpId: input.topUpId, merchantId: input.merchantId },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: unitAmount,
            product_data: { name: "Wallet top-up" },
          },
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL.");
    }
    return { checkoutUrl: session.url, providerSessionId: session.id };
  }

  async parseWebhookEvent(
    rawBody: string,
    signature: string | null
  ): Promise<NormalizedWebhookEvent> {
    if (!signature) {
      throw new WebhookVerificationError("Missing Stripe-Signature header.");
    }

    let event: Stripe.Event;
    try {
      // Verifies HMAC-SHA256 over the raw payload, parses the signature header,
      // and enforces the timestamp tolerance (replay protection). Throws on any
      // failure — we translate that into our gateway-agnostic error type.
      event = this.client().webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret()
      );
    } catch (e) {
      throw new WebhookVerificationError(
        `Stripe signature verification failed: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }

    if (event.type !== TOPUP_EVENT) {
      // Verified but not a top-up → acknowledge with no side effects.
      return { eventId: event.id, type: "ignored" };
    }

    const session = event.data.object as Stripe.Checkout.Session;
    const topUpId =
      session.client_reference_id ?? session.metadata?.topUpId ?? null;

    // A completed session we can't map back, or whose funds aren't captured, is
    // treated as "ignored": acknowledged (so Stripe stops retrying) but it does
    // NOT credit a wallet.
    if (!topUpId || session.payment_status !== "paid") {
      return { eventId: event.id, type: "ignored" };
    }

    return {
      eventId: event.id,
      type: "topup_completed",
      topUp: {
        topUpId,
        providerSessionId: session.id,
        // Trust the VERIFIED amount from the event, never the browser.
        amount: (session.amount_total ?? 0) / 100,
        currency: (session.currency ?? "aed").toUpperCase(),
        paid: true,
      },
    };
  }
}

// Payment-gateway seam for the merchant→platform money-in rail.
//
// This is the single interface the rest of the system talks to. The ledger
// (wallet credit) and the UI know ONLY these types — never the concrete gateway.
// Today the one implementation is StripeProvider; when we swap to a UAE gateway
// (PayTabs / Telr), a new class implements THIS interface and nothing in the
// webhook-credit logic, the top-up action, or the schema changes. Same shape as
// the print-file store stub (src/lib/print-file-store.ts).
//
// SEAM: swap the active provider in src/lib/payments/index.ts. Do NOT reach past
// this interface into a gateway SDK from anywhere else.
//
// Money-model invariants baked into the contract:
//   • The platform never holds BUYER funds — this rail is the merchant funding
//     their OWN platform wallet (the Printful prepaid model).
//   • A wallet is credited ONLY from a VERIFIED webhook (parseWebhookEvent),
//     NEVER from the browser success-redirect.

/** Input to open a hosted-checkout session for a wallet top-up. */
export interface CreateTopUpCheckoutInput {
  // Our WalletTopUp.id. Round-tripped through the gateway (client_reference_id /
  // metadata) so the verified webhook maps the payment back to our row WITHOUT
  // trusting anything the browser carried.
  topUpId: string;
  merchantId: string;
  amount: number; // major units (AED), e.g. 250.00
  currency: string; // ISO 4217, e.g. "AED"
  successUrl: string; // browser returns here on success (shows "processing")
  cancelUrl: string; // browser returns here if the buyer backs out
}

/** What the caller needs to send the merchant to the gateway's hosted page. */
export interface CreateTopUpCheckoutResult {
  checkoutUrl: string; // hosted-page URL to redirect the merchant to
  providerSessionId: string; // gateway's checkout-session id (stored for reference)
}

// A normalized, gateway-agnostic view of a verified top-up payment. The webhook
// handler credits the wallet from THIS — it never sees Stripe types.
export interface NormalizedTopUp {
  topUpId: string; // our WalletTopUp.id (from client_reference_id)
  providerSessionId: string;
  amount: number; // VERIFIED amount from the gateway event (major units)
  currency: string;
  paid: boolean; // true only when the gateway confirms funds captured
}

// A verified inbound webhook, normalized. `eventId` is the gateway's own event
// id — the idempotency key persisted to ProcessedWebhookEvent. `type` is
// "topup_completed" only for the one event that should credit a wallet; every
// other (verified) event is "ignored" and acknowledged without side effects.
export interface NormalizedWebhookEvent {
  eventId: string;
  type: "topup_completed" | "ignored";
  topUp?: NormalizedTopUp; // present iff type === "topup_completed"
}

// Thrown by parseWebhookEvent when the payload is unsigned, the signature is
// invalid, or the timestamp is outside tolerance (replay protection). The route
// maps this to HTTP 400 and NOTHING is written — an attacker cannot credit a
// wallet by POSTing a forged body.
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export interface PaymentProvider {
  /** Stable name persisted on WalletTopUp.provider / ProcessedWebhookEvent.provider. */
  readonly name: string;

  /** Open a hosted-checkout session for a wallet top-up. */
  createTopUpCheckout(
    input: CreateTopUpCheckoutInput
  ): Promise<CreateTopUpCheckoutResult>;

  /**
   * Verify a raw webhook body + signature header and return a normalized event.
   * MUST throw WebhookVerificationError on a missing/invalid signature — never
   * return an event for an unverified payload. `rawBody` MUST be the exact bytes
   * received (no JSON round-trip), since signatures cover the raw payload.
   */
  parseWebhookEvent(
    rawBody: string,
    signature: string | null
  ): Promise<NormalizedWebhookEvent>;
}

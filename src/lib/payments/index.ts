// The active payment provider — the single swap point for the money-in gateway.
//
// SEAM: to migrate off Stripe (e.g. to a UAE gateway — PayTabs / Telr), write a
// sibling class implementing PaymentProvider and change ONLY this line. The
// top-up action, the webhook-credit logic, and the schema stay untouched. Same
// pattern as swapping StubPrintFileStore → VercelBlobStore.

import { StripeProvider } from "./stripe-provider";
import type { PaymentProvider } from "./provider";

export const paymentProvider: PaymentProvider = new StripeProvider();

export * from "./provider";

// POST /api/webhooks/stripe — inbound Stripe webhook (money-in).
//
// Thin HTTP shell, mirroring /api/v1/orders: read the RAW body + the
// `stripe-signature` header, hand off to the pure handleStripeWebhook (verify →
// idempotent credit), serialize its { status, body }. The body MUST be read as
// raw text (never JSON-parsed first) — Stripe's signature covers the exact
// bytes, so a round-trip through JSON would break verification. A backstop
// try/catch guarantees a JSON response even on an unexpected throw.
//
// This endpoint is the ONLY thing that credits a wallet. It must be registered
// with Stripe (test mode now, live before launch — see PRE-PRODUCTION.md).

import { handleStripeWebhook } from "@/lib/payments/webhook";

// node:crypto (signature verify) + Prisma ⇒ Node runtime, always dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("stripe-signature");
    const result = await handleStripeWebhook(rawBody, signature);
    return Response.json(result.body, { status: result.status });
  } catch (e) {
    console.error("POST /api/webhooks/stripe crashed:", e);
    return Response.json({ error: "internal_error" }, { status: 500 });
  }
}

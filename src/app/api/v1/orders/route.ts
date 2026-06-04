// POST /api/v1/orders — programmatic order intake.
//
// Thin HTTP shell: read the Authorization header + raw body, hand off to the
// pure apiCreateOrder orchestration (auth, validation, idempotency, routing),
// and serialize its { httpStatus, body } result as JSON. All error MODELING and
// the merchant scoping live in src/lib/api-orders.ts; this file only translates
// HTTP ⇄ that result. A backstop try/catch guarantees a JSON error (never an
// HTML Next error page) even on an unexpected throw.

import { apiCreateOrder } from "@/lib/api-orders";

// node:crypto (API-key hashing) + Prisma ⇒ Node runtime, always dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    const result = await apiCreateOrder(req.headers.get("authorization"), rawBody);
    return Response.json(result.body, { status: result.httpStatus });
  } catch (e) {
    console.error("POST /api/v1/orders crashed:", e);
    return Response.json(
      { error: { code: "internal_error", message: "An unexpected error occurred." } },
      { status: 500 }
    );
  }
}

// GET /api/v1/orders/:id — fetch one order's status, scoped to the API key's
// merchant. A foreign or non-existent id returns an IDENTICAL 404 (never 403),
// so the endpoint can't be used to probe which order ids exist. All scoping +
// error modeling live in apiGetOrder; this shell only translates HTTP.

import { apiGetOrder } from "@/lib/api-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await apiGetOrder(req.headers.get("authorization"), id);
    return Response.json(result.body, { status: result.httpStatus });
  } catch (e) {
    console.error("GET /api/v1/orders/:id crashed:", e);
    return Response.json(
      { error: { code: "internal_error", message: "An unexpected error occurred." } },
      { status: 500 }
    );
  }
}

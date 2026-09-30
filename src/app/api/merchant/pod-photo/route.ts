// GET /api/merchant/pod-photo?fulfillmentId=… — a merchant's ownership-gated
// door to the proof-of-delivery photo of one of its own orders (queue 11b).
// Identity comes from the session; the private-store URL is never exposed, a
// short-lived signed URL is minted per request, and any mismatch is one 404.

import { getAuthContext } from "@/lib/auth-context";
import { merchantPodPhotoUrl } from "@/lib/proof-of-delivery-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "MERCHANT" || !ctx.merchantId) {
    return new Response("unauthorized", { status: 401 });
  }
  const fulfillmentId = (new URL(req.url).searchParams.get("fulfillmentId") ?? "").trim();
  if (!fulfillmentId) return new Response("not found", { status: 404 });

  const signed = await merchantPodPhotoUrl(ctx.merchantId, fulfillmentId);
  if (!signed) return new Response("not found", { status: 404 });
  return Response.redirect(signed, 307);
}

// GET /api/printer/brand-logo?fulfillmentId=… — a printer's ownership-gated door
// to the merchant logo for one of its own fulfillments (queue 10b). Identity
// comes from the session; the private-store URL is never exposed, a short-lived
// signed URL is minted per request, and any mismatch is one undifferentiated 404.

import { getAuthContext } from "@/lib/auth-context";
import { printerBrandLogoUrl } from "@/lib/printer-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "PRINTER" || !ctx.printerId) {
    return new Response("unauthorized", { status: 401 });
  }
  const fulfillmentId = (new URL(req.url).searchParams.get("fulfillmentId") ?? "").trim();
  if (!fulfillmentId) return new Response("not found", { status: 404 });

  const signed = await printerBrandLogoUrl(ctx.printerId, fulfillmentId);
  if (!signed) return new Response("not found", { status: 404 });
  return Response.redirect(signed, 307);
}

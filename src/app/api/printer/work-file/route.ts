// GET /api/printer/work-file?fulfillmentId=…&designId=…&placement=… — a printer's
// ownership-gated door to one validated print file.
//
// Same pattern as /api/merchant/designs/file: identity comes from the session
// (never the client), the private-store URL is never exposed, and a short-lived
// signed URL is minted per click. Any mismatch is one undifferentiated 404.

import { PlacementCode } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { printerWorkFileUrl } from "@/lib/printer-work";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "PRINTER" || !ctx.printerId) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const fulfillmentId = (url.searchParams.get("fulfillmentId") ?? "").trim();
  const designId = (url.searchParams.get("designId") ?? "").trim();
  const placementRaw = (url.searchParams.get("placement") ?? "").trim();
  if (!fulfillmentId || !designId || !(Object.values(PlacementCode) as string[]).includes(placementRaw)) {
    return new Response("not found", { status: 404 });
  }

  const signed = await printerWorkFileUrl(ctx.printerId, {
    fulfillmentId,
    designId,
    placement: placementRaw as PlacementCode,
  });
  if (!signed) return new Response("not found", { status: 404 });
  return Response.redirect(signed, 307);
}

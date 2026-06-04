// GET /api/merchant/designs/file?designId=…&placement=… — ownership-gated read
// access to a stored print file.
//
// The Blob store is PRIVATE (print files are merchant design IP), so the raw
// blob URL 403s and must NEVER be handed to the browser. Instead this route is
// the only door to a stored file: it re-derives identity from the session
// (CVE-2025-29927 defense — never from the client), confirms THIS merchant owns
// the (design, placement), then mints a SHORT-LIVED, CDN-direct signed URL and
// redirects to it. The signed URL is fetched once, expires in minutes, and our
// credentials never leave the server. Minting happens per click, so a revoked
// owner can't reuse a link, and the file URL is never embedded in page HTML.

import { PlacementCode } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getPrintFileStore } from "@/lib/print-file-store";

// Prisma + session ⇒ Node runtime, always dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // INDEPENDENT auth — a non-merchant (or no) session is a hard reject.
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "MERCHANT" || !ctx.merchantId) {
    return new Response("unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const designId = (url.searchParams.get("designId") ?? "").trim();
  const placementRaw = (url.searchParams.get("placement") ?? "").trim();
  if (!designId || !(placementRaw in PlacementCode)) {
    return new Response("not found", { status: 404 });
  }
  const placement = placementRaw as PlacementCode;

  // Ownership: the placement must belong to a design THIS merchant owns. A miss
  // (wrong owner, no such placement, or no file yet) is an undifferentiated 404
  // so the route never confirms another merchant's design exists.
  const row = await prisma.designPlacement.findUnique({
    where: { designId_placement: { designId, placement } },
    select: { print_file_url: true, design: { select: { merchantId: true } } },
  });
  if (!row || row.design.merchantId !== ctx.merchantId || !row.print_file_url) {
    return new Response("not found", { status: 404 });
  }

  // 307: a temporary redirect to the freshly-minted, short-lived signed URL.
  const signedUrl = await getPrintFileStore().signedReadUrl(row.print_file_url);
  return Response.redirect(signedUrl, 307);
}

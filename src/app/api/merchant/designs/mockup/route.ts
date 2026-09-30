// GET /api/merchant/designs/mockup?designId=… — ownership-gated read access to a
// design's generated mockup preview. Same pattern as ../file/route.ts: the Blob
// store is private, so this route re-derives identity from the session, confirms
// THIS merchant owns the design, then redirects to a short-lived signed URL.

import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getPrintFileStore } from "@/lib/print-file-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.role !== "MERCHANT" || !ctx.merchantId) {
    return new Response("unauthorized", { status: 401 });
  }

  const designId = (new URL(req.url).searchParams.get("designId") ?? "").trim();
  if (!designId) return new Response("not found", { status: 404 });

  // Wrong owner, no such design, or no mockup yet → one undifferentiated 404.
  const design = await prisma.design.findFirst({
    where: { id: designId, merchantId: ctx.merchantId },
    select: { mockup_url: true },
  });
  if (!design?.mockup_url) return new Response("not found", { status: 404 });

  const signedUrl = await getPrintFileStore().signedReadUrl(design.mockup_url);
  return Response.redirect(signedUrl, 307);
}

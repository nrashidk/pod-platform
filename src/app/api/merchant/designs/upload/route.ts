// POST /api/merchant/designs/upload — issues a short-lived Vercel Blob upload
// token so the BROWSER uploads the print file straight to Blob storage.
//
// Why this exists: Next.js Server Actions cap the request body at 1MB and Vercel
// functions cap it at ~4.5MB, but print files run up to PrintArea.max_file_mb
// (spec allows 200MB). Buffering the bytes through a function is the wrong
// transport. Instead the client uploads directly to Blob with a scoped token;
// this route is the ONLY place that mints that token, so it is where ownership,
// the PNG/JPEG allowlist, and the per-placement size cap are enforced BEFORE any
// bytes are accepted. Server-side validation of the stored bytes then happens in
// the finalize server action (finalizePlacementUpload).
//
// Identity is derived INDEPENDENTLY here from the session (CVE-2025-29927
// defense) — never from the client payload, which carries only the designId +
// placement to authorize against.

import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { PlacementCode } from "@prisma/client";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { ACCEPTED_CONTENT_TYPES } from "@/lib/designs";

// Prisma + session ⇒ Node runtime, always dynamic.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // INDEPENDENT auth re-check — identity comes from the session, not the
        // client. No redirect (this is a JSON endpoint): a missing/non-merchant
        // session is a hard reject.
        const ctx = await getAuthContext();
        if (!ctx || ctx.role !== "MERCHANT" || !ctx.merchantId) {
          throw new Error("unauthorized");
        }

        const parsed = clientPayload
          ? (JSON.parse(clientPayload) as { designId?: string; placement?: string })
          : {};
        const designId = String(parsed.designId ?? "").trim();
        const placementRaw = String(parsed.placement ?? "").trim();
        if (!designId) throw new Error("design_not_found");
        if (!(placementRaw in PlacementCode)) throw new Error("no_print_area");
        const placement = placementRaw as PlacementCode;

        // Ownership + spec BEFORE issuing a token: a token is only ever minted
        // for a design THIS merchant owns and a placement that has a print area.
        const design = await prisma.design.findFirst({
          where: { id: designId, merchantId: ctx.merchantId },
          select: { productTypeId: true },
        });
        if (!design) throw new Error("design_not_found");
        const area = await prisma.printArea.findUnique({
          where: {
            productTypeId_placement: {
              productTypeId: design.productTypeId,
              placement,
            },
          },
          select: { max_file_mb: true },
        });
        if (!area) throw new Error("no_print_area");

        return {
          allowedContentTypes: [...ACCEPTED_CONTENT_TYPES],
          // Per-placement hard cap enforced by Blob at upload time — an oversized
          // file is rejected before its bytes are stored.
          maximumSizeInBytes: Math.ceil(area.max_file_mb * 1024 * 1024),
          addRandomSuffix: true,
        };
      },
      // NO onUploadCompleted. The completion webhook is delivered by Vercel Blob
      // to a callbackUrl it derives from the request — which is undeterminable on
      // localhost/Codespaces (VERCEL !== "1"), so @vercel/blob emits the
      // "no callbackUrl could be determined" warning and bakes NO callback into
      // the minted token. Persistence does NOT depend on the webhook anyway: the
      // client calls finalizePlacementAction after upload() resolves, and THAT is
      // the single, environment-independent persistence + validation path. So the
      // webhook is redundant by design; omitting onUploadCompleted removes both
      // the dead code and the misleading warning, in every environment.
    });
    return Response.json(json);
  } catch (e) {
    // handleUpload throws for an invalid/forged body or any onBeforeGenerateToken
    // rejection; surface the reason so the client can map it to a localized error.
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

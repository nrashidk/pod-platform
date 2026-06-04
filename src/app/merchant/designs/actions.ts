"use server";

// Server Actions behind the merchant design manager. Thin Next shell over the
// Next-independent engine in src/lib/designs.ts: each action does an INDEPENDENT
// requireRole("MERCHANT") re-check (a forged POST must be rejected here), reads
// the form, and calls in. The merchantId ALWAYS comes from the session, never
// the form. Upload uses the REAL Vercel Blob store via getPrintFileStore();
// only tests use the stub.

import { revalidatePath } from "next/cache";
import { PlacementCode } from "@prisma/client";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import {
  createDesign,
  finalizePlacementUpload,
  UploadRejectedError,
} from "@/lib/designs";
import { getPrintFileStore } from "@/lib/print-file-store";

export interface CreateDesignState {
  errorKind?: string;
  ok?: boolean;
}

export async function createDesignAction(
  _prev: CreateDesignState,
  formData: FormData
): Promise<CreateDesignState> {
  const ctx = await requireRole("MERCHANT");
  if (!ctx.merchantId) return { errorKind: "no_merchant" };

  const name = String(formData.get("name") ?? "").trim();
  const productTypeId = String(formData.get("productTypeId") ?? "").trim();
  if (!name) return { errorKind: "no_name" };
  if (!productTypeId) return { errorKind: "no_product_type" };

  // The product type must exist (FK would throw otherwise — return a friendly
  // error instead of crashing).
  const type = await prisma.productType.findUnique({
    where: { id: productTypeId },
    select: { id: true },
  });
  if (!type) return { errorKind: "no_product_type" };

  await createDesign({ merchantId: ctx.merchantId, name, productTypeId });
  revalidatePath("/merchant/designs");
  return { ok: true };
}

// Distinct stages of the client-upload flow, so a failure can say WHERE it died
// instead of hanging silently. Surfaced by UploadPlacementForm while in flight
// and attached to a generic error so the catch-all is no longer opaque.
export type UploadPhase = "minting" | "uploading" | "validating";

export interface UploadState {
  ok?: boolean;
  errorKind?: string;
  status?: "PASSED" | "FLAGGED";
  reasons?: string[];
  // Client-only: the stage currently in flight (drives the progress label).
  phase?: UploadPhase;
  // Client-only: which stage a generic failure happened in.
  errorPhase?: UploadPhase;
  // Client-only: the raw error message for an UNKNOWN failure, so the actual
  // cause (e.g. a Blob "public access on a private store" rejection) is visible
  // instead of being collapsed into "Something went wrong".
  errorDetail?: string;
}

// Finalize a client-uploaded print file. The browser has already uploaded the
// bytes straight to Vercel Blob (via the /api/merchant/designs/upload token);
// this action receives only the resulting blob URL + the (design, placement) and
// hands off to finalizePlacementUpload, which re-checks ownership, that the URL
// is a blob in OUR store, the size/content-type gates, and validates the ACTUAL
// stored bytes. Payload is tiny JSON — it never carries the (up-to-200MB) file,
// so the 1MB Server Action body cap is irrelevant here.
export async function finalizePlacementAction(input: {
  designId: string;
  placement: string;
  blobUrl: string;
}): Promise<UploadState> {
  const ctx = await requireRole("MERCHANT");
  if (!ctx.merchantId) return { errorKind: "no_merchant" };

  const designId = input.designId?.trim();
  const placementRaw = input.placement?.trim();
  if (!designId) return { errorKind: "design_not_found" };
  if (!placementRaw || !(placementRaw in PlacementCode)) {
    return { errorKind: "no_print_area" };
  }
  if (!input.blobUrl?.trim()) return { errorKind: "no_file" };

  try {
    const res = await finalizePlacementUpload({
      merchantId: ctx.merchantId,
      designId,
      placement: placementRaw as PlacementCode,
      blobUrl: input.blobUrl,
      store: getPrintFileStore(),
    });
    revalidatePath("/merchant/designs");
    return { ok: true, status: res.status, reasons: res.reasons };
  } catch (e) {
    if (e instanceof UploadRejectedError) {
      return { errorKind: e.code };
    }
    console.error("finalizePlacementAction failed:", e);
    return { errorKind: "generic" };
  }
}

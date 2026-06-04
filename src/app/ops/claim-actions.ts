"use server";

// Operator-gated DefectClaim open/close — the MINIMAL claim life that the 70/30
// hold needs to function (doc §5b). An OPEN claim blocks release of the held 30%
// (reflected by holdStatus() in src/lib/printer-hold.ts, which counts open
// claims). This is open/closed status ONLY: NO resolution flow — no reprint,
// refund, liability assignment, or deduction-from-hold mechanics (deferred).
//
// Both actions re-check OPERATOR independently: a server action is its own entry
// point, never assumed safe because the page hid the control.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { isLocale, type Locale } from "@/lib/i18n";

/**
 * Open a DefectClaim against a fulfillment. Allowed ONLY while the claim window
 * is open — the fulfillment must be delivered (claim_window_closes_at stamped on
 * its Shipment) and now must be on/before that close time. A claim opened in the
 * window persists and keeps blocking release even after the window elapses
 * (holdStatus counts open claims regardless of time — doc §224).
 */
export async function openDefectClaim(formData: FormData) {
  await requireRole("OPERATOR");

  const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
  const description = String(formData.get("description") ?? "").trim();
  const langRaw = String(formData.get("lang") ?? "en");
  const lang: Locale = isLocale(langRaw) ? langRaw : "en";

  if (!fulfillmentId || !description) {
    redirect(`/ops/billing?lang=${lang}&claimErr=${fulfillmentId || "x"}`);
  }

  // The claim window lives on the Shipment (stamped at DELIVERED). Latest one.
  const fulfillment = await prisma.fulfillment.findUnique({
    where: { id: fulfillmentId },
    select: {
      id: true,
      shipments: {
        select: { claim_window_closes_at: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const closesAt = fulfillment?.shipments[0]?.claim_window_closes_at ?? null;
  const windowOpen = closesAt != null && new Date().getTime() <= closesAt.getTime();
  if (!fulfillment || !windowOpen) {
    // Not delivered yet, or window already closed — opening is not permitted.
    redirect(`/ops/billing?lang=${lang}&claimErr=${fulfillmentId}`);
  }

  await prisma.defectClaim.create({
    data: {
      fulfillmentId,
      status: "OPEN",
      description,
      // photo_urls left empty: photo upload via the Blob pipeline is out of
      // scope this phase. description satisfies the required field.
    },
  });

  revalidatePath("/ops/billing");
  redirect(`/ops/billing?lang=${lang}`);
}

/**
 * Close a DefectClaim. Sets status RESOLVED used purely as a CLOSED flag — no
 * resolution payload (no refund/reprint/liability). Once closed it no longer
 * blocks release, so a delivered fulfillment past its window becomes RELEASABLE.
 */
export async function closeDefectClaim(formData: FormData) {
  await requireRole("OPERATOR");

  const claimId = String(formData.get("claimId") ?? "");
  const langRaw = String(formData.get("lang") ?? "en");
  const lang: Locale = isLocale(langRaw) ? langRaw : "en";

  if (!claimId) {
    redirect(`/ops/billing?lang=${lang}`);
  }

  await prisma.defectClaim.update({
    where: { id: claimId },
    data: { status: "RESOLVED" },
  });

  revalidatePath("/ops/billing");
  redirect(`/ops/billing?lang=${lang}`);
}

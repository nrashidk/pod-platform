"use server";

// Server Action behind the printer's "advance" control. Two independent,
// server-trusted gates — neither trusts the UI:
//
//  (1) requireRole("PRINTER") — a forged/replayed POST from a non-printer (or no
//      session) is rejected here, not assumed safe because the page rendered.
//  (2) ownership + transition subset — the fulfillmentId arrives from the form
//      (client-controllable), so we pass the SESSION's printerId as ownerPrinterId
//      to advanceFulfillment, which verifies ownership INSIDE its transaction
//      before mutating. A printer forging another printer's fulfillmentId is
//      rejected at the engine. We also confirm toStatus is in the
//      printer-permitted subset (IN_PRODUCTION / SHIPPED) — never DELIVERED/CLOSED.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FulfillmentStatus } from "@prisma/client";
import {
  advanceFulfillment,
  FirstArticleRequiredError,
  FulfillmentOwnershipError,
  InvalidTransitionError,
  PRINTER_ADVANCE_TARGETS,
} from "@/lib/fulfillment";
import { recordDispatchHold } from "@/lib/printer-hold";
import { requireRole } from "@/lib/auth-context";
import { isLocale, type Locale } from "@/lib/i18n";

export async function advanceAction(formData: FormData) {
  // (1) Independent role re-check + the session identity we scope ownership on.
  const ctx = await requireRole("PRINTER");

  const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
  const toStatus = String(formData.get("toStatus") ?? "") as FulfillmentStatus;
  const langRaw = String(formData.get("lang") ?? "en");
  const lang: Locale = isLocale(langRaw) ? langRaw : "en";

  if (!fulfillmentId || !toStatus) {
    redirect(`/printer?lang=${lang}`);
  }

  // Defense in depth: never advance without a concrete owner to scope on. A null
  // printerId (impossible for a PRINTER per the DB CHECK, but we don't assume)
  // must NOT degrade into an unguarded advance — passing undefined would skip the
  // ownership check entirely. Refuse instead.
  if (!ctx.printerId) {
    revalidatePath("/printer");
    redirect(`/printer?lang=${lang}&err=${fulfillmentId}`);
  }

  // (2a) Transition-subset gate. A printer may only ever drive a job INTO
  // production or out for shipping. Reject any other target (e.g. a forged
  // DELIVERED/CLOSED) before touching the engine — the UI is not trusted.
  if (!PRINTER_ADVANCE_TARGETS.includes(toStatus)) {
    revalidatePath("/printer");
    redirect(`/printer?lang=${lang}&err=${fulfillmentId}`);
  }

  try {
    // (2b) Ownership gate lives INSIDE advanceFulfillment's transaction: passing
    // ctx.printerId (session-derived, never client input) makes it verify the
    // persisted row's printerId matches before any mutation.
    await advanceFulfillment(fulfillmentId, toStatus, {
      ownerPrinterId: ctx.printerId,
    });
    // SHIPPED hook — same integration point as the operator action. On a BULK
    // fulfillment this splits the printer ledger 70/30; sub-threshold is a
    // no-op. Record-only — no money moves. Ownership was already verified above.
    if (toStatus === "SHIPPED") {
      await recordDispatchHold(fulfillmentId);
    }
  } catch (e) {
    // Expected rejections (not-yours, illegal transition, bulk first-article
    // block) surface as a per-fulfillment notice rather than a crash. Unknown
    // errors still propagate.
    if (
      e instanceof FulfillmentOwnershipError ||
      e instanceof InvalidTransitionError ||
      e instanceof FirstArticleRequiredError
    ) {
      revalidatePath("/printer");
      redirect(`/printer?lang=${lang}&err=${fulfillmentId}`);
    }
    throw e;
  }

  revalidatePath("/printer");
  redirect(`/printer?lang=${lang}`);
}

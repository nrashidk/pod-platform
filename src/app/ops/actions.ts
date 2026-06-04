"use server";

// Server Action behind the "advance" control. Calls the REAL lifecycle engine
// (advanceFulfillment) — which recomputes + persists the parent Order's
// composite status — then revalidates /ops so the list re-renders with the new
// status. No client state, no API route.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FulfillmentStatus } from "@prisma/client";
import {
  advanceFulfillment,
  FirstArticleRequiredError,
  InvalidTransitionError,
} from "@/lib/fulfillment";
import { recordDispatchHold } from "@/lib/printer-hold";
import { requireRole } from "@/lib/auth-context";
import { isLocale, type Locale } from "@/lib/i18n";

export async function advanceAction(formData: FormData) {
  // INDEPENDENT authorization re-check. The page already gates rendering, but a
  // server action is its own entry point — a forged/replayed POST from a
  // non-operator (or with no session at all) must be rejected HERE too, not
  // assumed safe because the UI hid the button. This is the defense-in-depth the
  // whole phase is about: never trust that an earlier gate ran.
  await requireRole("OPERATOR");

  const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
  const toStatus = String(formData.get("toStatus") ?? "") as FulfillmentStatus;
  const langRaw = String(formData.get("lang") ?? "en");
  const lang: Locale = isLocale(langRaw) ? langRaw : "en";

  if (!fulfillmentId || !toStatus) {
    redirect(`/ops?lang=${lang}`);
  }

  try {
    await advanceFulfillment(fulfillmentId, toStatus);
    // SHIPPED hook — layered on top of the lifecycle engine (not inside it),
    // exactly as recordOrderBilling is called beside createOrderWithRouting. On
    // a BULK fulfillment this splits the printer ledger 70/30; sub-threshold is
    // a no-op. Record-only — no money moves.
    if (toStatus === "SHIPPED") {
      await recordDispatchHold(fulfillmentId);
    }
  } catch (e) {
    // The page renders the bulk first-article BLOCK proactively (disabled
    // control), so the gate is normally never hit here. This catch is the
    // fallback for a stale/forged advance: surface a per-fulfillment notice
    // rather than a server crash. Unknown errors still propagate.
    if (
      e instanceof FirstArticleRequiredError ||
      e instanceof InvalidTransitionError
    ) {
      revalidatePath("/ops");
      redirect(`/ops?lang=${lang}&err=${fulfillmentId}`);
    }
    throw e;
  }

  revalidatePath("/ops");
  redirect(`/ops?lang=${lang}`);
}

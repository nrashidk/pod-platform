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
  decideFirstArticle,
  submitFirstArticle,
  FirstArticleRequiredError,
  InvalidTransitionError,
  parseProofOfDelivery,
  ProofOfDeliveryRequiredError,
} from "@/lib/fulfillment";
import {
  attachProofOfDeliveryPhoto,
  PodPhotoInvalidError,
  validatePodPhoto,
  type PodPhotoFile,
} from "@/lib/proof-of-delivery-photo";
import { recordDispatchHold } from "@/lib/printer-hold";
import { requireRole } from "@/lib/auth-context";
import { isLocale, type Locale } from "@/lib/i18n";

// The optional proof-of-delivery photo from a form; null when none was chosen.
async function podPhotoFromForm(formData: FormData): Promise<PodPhotoFile | null> {
  const photo = formData.get("podPhoto");
  if (!(photo instanceof File) || photo.size === 0) return null;
  return {
    buffer: Buffer.from(await photo.arrayBuffer()),
    filename: photo.name || "photo",
    contentType: photo.type,
  };
}

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

  // DELIVERED starts the 30-day claim window, so the engine is told to require
  // a proof-of-delivery reference (queue 11); missing/invalid → notice below.
  const proofOfDelivery =
    toStatus === "DELIVERED"
      ? parseProofOfDelivery(formData.get("proofOfDelivery"))
      : null;

  // A chosen photo is checked BEFORE delivery is recorded, so a bad file never
  // leaves a half-done step; it is stored right after the delivery is recorded.
  const podPhoto = toStatus === "DELIVERED" ? await podPhotoFromForm(formData) : null;
  if (podPhoto) {
    try {
      validatePodPhoto(podPhoto);
    } catch (e) {
      if (e instanceof PodPhotoInvalidError) {
        revalidatePath("/ops");
        redirect(`/ops?lang=${lang}&err=${fulfillmentId}&why=podphoto`);
      }
      throw e;
    }
  }

  let photoFailed = false;
  try {
    await advanceFulfillment(fulfillmentId, toStatus, {
      requireProofOfDelivery: true,
      ...(proofOfDelivery ? { proofOfDelivery } : {}),
    });
    // SHIPPED hook — layered on top of the lifecycle engine (not inside it),
    // exactly as recordOrderBilling is called beside createOrderWithRouting. On
    // a BULK fulfillment this splits the printer ledger 70/30; sub-threshold is
    // a no-op. Record-only — no money moves.
    if (toStatus === "SHIPPED") {
      await recordDispatchHold(fulfillmentId);
    }
    if (podPhoto) {
      try {
        await attachProofOfDeliveryPhoto(fulfillmentId, podPhoto);
      } catch (e) {
        if (!(e instanceof PodPhotoInvalidError)) throw e;
        photoFailed = true;
      }
    }
  } catch (e) {
    if (e instanceof ProofOfDeliveryRequiredError) {
      revalidatePath("/ops");
      redirect(`/ops?lang=${lang}&err=${fulfillmentId}&why=pod`);
    }
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
  if (photoFailed) redirect(`/ops?lang=${lang}&err=${fulfillmentId}&why=podphotolate`);
  redirect(`/ops?lang=${lang}`);
}

// Attach or replace the proof-of-delivery photo on an already-delivered
// fulfillment. OPERATOR-only, like every ops action.
export async function podPhotoAction(formData: FormData) {
  await requireRole("OPERATOR");

  const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
  const langRaw = String(formData.get("lang") ?? "en");
  const lang: Locale = isLocale(langRaw) ? langRaw : "en";
  const photo = await podPhotoFromForm(formData);

  if (!fulfillmentId || !photo) {
    redirect(`/ops?lang=${lang}&err=${fulfillmentId}&why=podphoto`);
  }
  try {
    await attachProofOfDeliveryPhoto(fulfillmentId, photo);
  } catch (e) {
    if (e instanceof PodPhotoInvalidError) {
      revalidatePath("/ops");
      redirect(`/ops?lang=${lang}&err=${fulfillmentId}&why=podphoto`);
    }
    throw e;
  }
  revalidatePath("/ops");
  revalidatePath("/merchant/orders");
  redirect(`/ops?lang=${lang}`);
}

// First-article step for a bulk fulfillment: "SUBMIT" (printer made the proof
// unit) / "APPROVE" / "REJECT" (back to the printer). Same authorization and
// stale-POST handling as advanceAction.
export async function firstArticleAction(formData: FormData) {
  await requireRole("OPERATOR");

  const fulfillmentId = String(formData.get("fulfillmentId") ?? "");
  const step = String(formData.get("step") ?? "");
  const langRaw = String(formData.get("lang") ?? "en");
  const lang: Locale = isLocale(langRaw) ? langRaw : "en";

  if (
    !fulfillmentId ||
    (step !== "SUBMIT" && step !== "APPROVE" && step !== "REJECT")
  ) {
    redirect(`/ops?lang=${lang}`);
  }

  try {
    if (step === "SUBMIT") await submitFirstArticle(fulfillmentId);
    else await decideFirstArticle(fulfillmentId, step);
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      revalidatePath("/ops");
      redirect(`/ops?lang=${lang}&err=${fulfillmentId}`);
    }
    throw e;
  }

  revalidatePath("/ops");
  redirect(`/ops?lang=${lang}`);
}

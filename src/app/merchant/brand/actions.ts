"use server";

// Server Actions behind the merchant brand settings page. Thin Next shell over
// src/lib/merchant-brand.ts: each does an INDEPENDENT requireRole("MERCHANT")
// re-check (a forged POST must be rejected here) and takes the merchantId from
// the session, never the form. Results travel back as ?saved=1 / ?err=<kind>
// so the page is a plain server component (no client state).

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth-context";
import {
  BrandInvalidError,
  removeMerchantLogo,
  updateMerchantBrandText,
  uploadMerchantLogo,
} from "@/lib/merchant-brand";

async function merchantIdOrRedirect(): Promise<string> {
  const ctx = await requireRole("MERCHANT");
  if (!ctx.merchantId) redirect("/merchant/brand?err=generic");
  return ctx.merchantId;
}

const field = (fd: FormData, name: string): string => String(fd.get(name) ?? "");

async function run(fn: () => Promise<unknown>): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof BrandInvalidError) redirect(`/merchant/brand?err=${e.reason}`);
    redirect("/merchant/brand?err=generic");
  }
  redirect("/merchant/brand?saved=1");
}

export async function saveBrandTextAction(formData: FormData): Promise<void> {
  const merchantId = await merchantIdOrRedirect();
  await run(() =>
    updateMerchantBrandText(merchantId, {
      packing_slip_message: field(formData, "packing_slip_message"),
      packing_slip_message_ar: field(formData, "packing_slip_message_ar"),
      return_address: field(formData, "return_address"),
      return_address_ar: field(formData, "return_address_ar"),
      custom_packaging_note: field(formData, "custom_packaging_note"),
    })
  );
}

export async function uploadLogoAction(formData: FormData): Promise<void> {
  const merchantId = await merchantIdOrRedirect();
  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/merchant/brand?err=empty");
  }
  await run(async () =>
    uploadMerchantLogo(merchantId, {
      buffer: Buffer.from(await file.arrayBuffer()),
      filename: file.name || "logo",
      contentType: file.type,
    })
  );
}

export async function removeLogoAction(): Promise<void> {
  const merchantId = await merchantIdOrRedirect();
  await run(() => removeMerchantLogo(merchantId));
}

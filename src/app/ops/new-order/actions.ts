"use server";

// Server Action behind the operator new-order form. INDEPENDENT auth re-check
// (requireRole — a forged POST must be rejected here, never assume the page
// gated it), then: parse → validate → call the EXISTING createOrderWithRouting
// (routing/splitting unchanged) → recordOrderBilling (record-only ledger) →
// redirect to /ops/billing. UnroutableLineError (and validation failures) are
// returned as a friendly { errorKind } for the form to localize — never a crash.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { PrintMethod } from "@prisma/client";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import {
  createOrderWithRouting,
  UnroutableLineError,
  type CreateOrderLineInput,
} from "@/lib/orders";
import { recordOrderBilling } from "@/lib/billing";

export interface NewOrderState {
  errorKind?: string;
}

// One line as the client serializes it (JSON in the hidden "lines" field).
interface RawLine {
  productId?: string;
  variantId?: string;
  method?: string;
  quantity?: number;
}

export async function createOrderAction(
  _prev: NewOrderState,
  formData: FormData
): Promise<NewOrderState> {
  await requireRole("OPERATOR");

  const merchantId = String(formData.get("merchantId") ?? "").trim();
  const designId = String(formData.get("designId") ?? "").trim();
  if (!merchantId) return { errorKind: "no_merchant" };
  if (!designId) return { errorKind: "no_design" };

  // Parse the dynamic line rows.
  let raw: RawLine[];
  try {
    raw = JSON.parse(String(formData.get("lines") ?? "[]"));
  } catch {
    return { errorKind: "bad_line" };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { errorKind: "no_lines" };
  }

  // Keep only fully-specified rows; if nothing complete remains, that's no_lines.
  const complete = raw.filter(
    (l) =>
      l.productId &&
      l.variantId &&
      l.method &&
      Number(l.quantity) > 0
  );
  if (complete.length === 0) return { errorKind: "no_lines" };

  // ── Integrity checks (defense-in-depth; FKs are the backstop). The design
  // must belong to the selected merchant; each variant must belong to its
  // product; the method must be an active capability of the product's type.
  const [design, products] = await Promise.all([
    prisma.design.findUnique({
      where: { id: designId },
      select: { merchantId: true },
    }),
    prisma.product.findMany({
      where: { id: { in: [...new Set(complete.map((l) => l.productId!))] } },
      select: {
        id: true,
        retail_price: true,
        variants: { select: { id: true } },
        productType: {
          select: { capabilities: { where: { active: true }, select: { method: true } } },
        },
      },
    }),
  ]);

  if (!design || design.merchantId !== merchantId) {
    return { errorKind: "no_design" };
  }

  const byProduct = new Map(products.map((p) => [p.id, p]));

  const lines: CreateOrderLineInput[] = [];
  for (const l of complete) {
    const product = byProduct.get(l.productId!);
    if (!product) return { errorKind: "bad_line" };
    if (!product.variants.some((v) => v.id === l.variantId)) {
      return { errorKind: "bad_line" };
    }
    const methods = new Set(product.productType.capabilities.map((c) => c.method));
    if (!methods.has(l.method as PrintMethod)) {
      return { errorKind: "bad_line" };
    }
    lines.push({
      productId: l.productId!,
      variantId: l.variantId!,
      designId,
      method: l.method as PrintMethod,
      quantity: Math.floor(Number(l.quantity)),
      // Store-set retail (platform never holds it). Defaults to the product's
      // listed price — operator entry doesn't re-price the storefront.
      unit_retail: Number(product.retail_price),
    });
  }

  const recipient = {
    name: String(formData.get("recipient_name") ?? "").trim(),
    phone: orNull(formData.get("recipient_phone")),
    line1: String(formData.get("shipping_line1") ?? "").trim(),
    line2: orNull(formData.get("shipping_line2")),
    city: String(formData.get("shipping_city") ?? "").trim(),
    emirate: orNull(formData.get("shipping_emirate")),
  };
  if (!recipient.name || !recipient.line1 || !recipient.city) {
    return { errorKind: "bad_line" };
  }

  let orderId: string;
  try {
    const order = await createOrderWithRouting({
      merchantId,
      recipient,
      lines,
    });
    // Record-only billing ledger for the freshly-routed order.
    await recordOrderBilling(order.id);
    orderId = order.id;
  } catch (e) {
    if (e instanceof UnroutableLineError) {
      return { errorKind: "unroutable" };
    }
    throw e;
  }

  // Success: the new order + its ledger are visible on the billing rollup.
  revalidatePath("/ops");
  revalidatePath("/ops/billing");
  redirect(`/ops/billing?created=${orderId}`);
}

function orNull(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

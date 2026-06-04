// ─────────────────────────────────────────────────────────────
// PROGRAMMATIC ORDER INTAKE — the orchestration behind /api/v1/orders.
//
// This is the machine-facing counterpart of src/app/ops/new-order/actions.ts.
// It RESOLVES the merchant from the API key, validates the JSON order, enforces
// idempotency race-safely, and then calls the EXISTING engine
// (createOrderWithRouting → recordOrderBilling) — it reimplements NEITHER.
// The merchant is ALWAYS derived from the key, never from the body.
//
// Deliberately Next-independent (no next/*): it takes the raw Authorization
// header + raw request body and returns a plain { httpStatus, body } result, so
// the route handlers stay trivial AND the whole path (401 / validation /
// idempotent retry / unroutable) is unit-testable under the plain-Node smoke
// loader, exactly like the other src/lib engines.
// ─────────────────────────────────────────────────────────────

import { Prisma, PrintMethod } from "@prisma/client";
import { prisma } from "./prisma";
import { resolveMerchantFromApiKey } from "./api-auth";
import {
  createOrderWithRouting,
  UnroutableLineError,
  type CreateOrderLineInput,
} from "./orders";
import { recordOrderBilling } from "./billing";

// ── Stable, machine-readable error codes. These are part of the API contract —
// do not rename without versioning. Each maps to a fixed HTTP status.
export type ApiErrorCode =
  | "unauthorized" // 401 — missing/malformed/unknown/revoked key
  | "invalid_request" // 400 — malformed JSON, missing required fields, bad qty
  | "unknown_sku" // 422 — SKU not found / inactive
  | "method_not_capable" // 422 — method isn't an active capability for that product
  | "invalid_design" // 422 — design_ref missing or not owned by this merchant
  | "unroutable_line" // 422 — no eligible printer (UnroutableLineError)
  | "request_in_progress" // 409 — concurrent in-flight same idempotency key
  | "not_found" // 404 — order not owned by caller (no existence leak)
  | "internal_error"; // 500 — unexpected

interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** What the route handler serializes: an HTTP status + a JSON body. */
export interface ApiResult {
  httpStatus: number;
  body: unknown;
}

function err(
  httpStatus: number,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>
): ApiResult {
  return { httpStatus, body: { error: { code, message, ...(details ? { details } : {}) } } };
}

// ── The response shape for an order. Printer identity is DELIBERATELY excluded
// (routing is automatic + hidden — doc §148: never expose the chosen printer to
// the store owner; protects margin and prevents leakage). unit_retail is echoed
// per line so a merchant's system can detect a retail mismatch vs what it sent.
async function loadOrderShape(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      fulfillments: {
        orderBy: { createdAt: "asc" },
        select: { id: true, status: true, is_bulk: true },
      },
      lines: {
        orderBy: { id: "asc" },
        include: { variant: { select: { sku: true } } },
      },
    },
  });
  if (!order) return null;
  return {
    id: order.id,
    status: order.status,
    currency: order.currency,
    retail_total: Number(order.retail_total),
    fulfillments: order.fulfillments.map((f) => ({
      id: f.id,
      status: f.status,
      is_bulk: f.is_bulk,
    })),
    lines: order.lines.map((l) => ({
      sku: l.variant.sku,
      method: l.method,
      quantity: l.quantity,
      unit_retail: Number(l.unit_retail),
    })),
  };
}

// ── Body shapes (validated defensively — nothing is trusted). ──
interface RawLine {
  sku?: unknown;
  method?: unknown;
  quantity?: unknown;
  design_ref?: unknown;
}
interface RawBody {
  idempotency_key?: unknown;
  currency?: unknown;
  recipient?: {
    name?: unknown;
    phone?: unknown;
    line1?: unknown;
    line2?: unknown;
    city?: unknown;
    emirate?: unknown;
    country?: unknown;
  };
  lines?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

const VALID_METHODS = new Set<string>(Object.values(PrintMethod));

/**
 * Create an order from a raw API request. Returns a structured ApiResult — never
 * throws for an expected condition (auth/validation/routing). The merchant comes
 * from the API key ONLY.
 */
export async function apiCreateOrder(
  authHeader: string | null | undefined,
  rawBody: string
): Promise<ApiResult> {
  // ── (1) AUTH: resolve the merchant from the key. Body merchantId is ignored.
  const caller = await resolveMerchantFromApiKey(authHeader);
  if (!caller) {
    return err(401, "unauthorized", "Missing or invalid API key.");
  }
  const merchantId = caller.merchantId;

  // ── (2) Parse JSON.
  let body: RawBody;
  try {
    body = JSON.parse(rawBody || "") as RawBody;
  } catch {
    return err(400, "invalid_request", "Request body must be valid JSON.");
  }
  if (typeof body !== "object" || body === null) {
    return err(400, "invalid_request", "Request body must be a JSON object.");
  }

  // ── (3) Top-level validation (cheap rejects BEFORE we claim an idempotency key).
  const idempotencyKey = str(body.idempotency_key);
  if (!idempotencyKey) {
    return err(400, "invalid_request", "idempotency_key is required.");
  }

  const r = body.recipient ?? {};
  const recipient = {
    name: str(r.name),
    phone: str(r.phone) || null,
    line1: str(r.line1),
    line2: str(r.line2) || null,
    city: str(r.city),
    emirate: str(r.emirate) || null,
    country: str(r.country) || undefined,
  };
  if (!recipient.name || !recipient.line1 || !recipient.city) {
    return err(
      400,
      "invalid_request",
      "recipient.name, recipient.line1 and recipient.city are required."
    );
  }

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return err(400, "invalid_request", "lines must be a non-empty array.");
  }

  // Per-line shape (defer SKU/method/design resolution to the DB pass below).
  const rawLines = body.lines as RawLine[];
  interface ParsedLine {
    sku: string;
    method: string;
    quantity: number;
    designRef: string;
  }
  const parsed: ParsedLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i] ?? {};
    const sku = str(l.sku);
    const method = str(l.method);
    const designRef = str(l.design_ref);
    const quantity = Number(l.quantity);
    if (!sku) {
      return err(400, "invalid_request", `lines[${i}].sku is required.`);
    }
    if (!method) {
      return err(400, "invalid_request", `lines[${i}].method is required.`);
    }
    if (!designRef) {
      return err(400, "invalid_request", `lines[${i}].design_ref is required.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return err(
        400,
        "invalid_request",
        `lines[${i}].quantity must be a positive integer.`
      );
    }
    if (!VALID_METHODS.has(method)) {
      return err(400, "invalid_request", `lines[${i}].method '${method}' is not a known print method.`, { sku, method });
    }
    parsed.push({ sku, method, quantity, designRef });
  }

  // ── (4) Resolve SKUs → variants/products, validate method capability + design
  // ownership. All scoped reads; nothing trusts the body beyond the SKU string.
  const skus = [...new Set(parsed.map((l) => l.sku))];
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: skus }, active: true },
    select: {
      sku: true,
      id: true,
      product: {
        select: {
          id: true,
          retail_price: true,
          productType: {
            select: {
              capabilities: {
                where: { active: true },
                select: { method: true },
              },
            },
          },
        },
      },
    },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));

  // design_ref ownership: each distinct ref must be a Design owned by THIS merchant.
  const designRefs = [...new Set(parsed.map((l) => l.designRef))];
  const designs = await prisma.design.findMany({
    where: { id: { in: designRefs }, merchantId },
    select: { id: true },
  });
  const ownedDesigns = new Set(designs.map((d) => d.id));

  const lines: CreateOrderLineInput[] = [];
  for (const l of parsed) {
    const variant = bySku.get(l.sku);
    if (!variant) {
      return err(422, "unknown_sku", `Unknown or inactive SKU '${l.sku}'.`, {
        sku: l.sku,
      });
    }
    const methods = new Set(
      variant.product.productType.capabilities.map((c) => c.method as string)
    );
    if (!methods.has(l.method)) {
      return err(
        422,
        "method_not_capable",
        `Method '${l.method}' is not an active capability for SKU '${l.sku}'.`,
        { sku: l.sku, method: l.method }
      );
    }
    if (!ownedDesigns.has(l.designRef)) {
      return err(
        422,
        "invalid_design",
        `design_ref '${l.designRef}' does not exist or does not belong to this merchant.`,
        { design_ref: l.designRef }
      );
    }
    lines.push({
      productId: variant.product.id,
      variantId: variant.id,
      designId: l.designRef,
      method: l.method as PrintMethod,
      quantity: l.quantity,
      // Store-set retail (platform never holds it). Defaults to the product's
      // listed price — the API doesn't re-price the storefront. Echoed back per
      // line so the merchant's system can detect a mismatch.
      unit_retail: Number(variant.product.retail_price),
    });
  }

  const currency = str(body.currency) || undefined;

  // ── (5) IDEMPOTENCY CLAIM — the race-safe serialization point. Two
  // simultaneous retries both attempt this insert; the @@unique guarantees
  // exactly one wins. The loser hits P2002 and returns the original order (or
  // 409 if the winner is still in flight) — never a second order, never a
  // double-bill.
  let claimId: string;
  try {
    const claim = await prisma.orderIdempotencyKey.create({
      data: { merchantId, idempotency_key: idempotencyKey, status: "PENDING" },
      select: { id: true },
    });
    claimId = claim.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // A record for (merchant, key) already exists → this is a retry.
      const existing = await prisma.orderIdempotencyKey.findUnique({
        where: {
          merchantId_idempotency_key: {
            merchantId,
            idempotency_key: idempotencyKey,
          },
        },
        select: { status: true, orderId: true },
      });
      if (existing?.status === "COMPLETED" && existing.orderId) {
        const shape = await loadOrderShape(existing.orderId);
        if (shape) return { httpStatus: 200, body: shape };
      }
      // Winner still creating (PENDING), or a transient inconsistent state:
      // tell the caller to retry — safe, and never creates a duplicate.
      return err(
        409,
        "request_in_progress",
        "An order with this idempotency_key is currently being processed. Retry shortly."
      );
    }
    throw e;
  }

  // ── (6) WINNER: create + bill via the EXISTING engine, then complete the claim.
  try {
    const order = await createOrderWithRouting({ merchantId, recipient, currency, lines });
    await recordOrderBilling(order.id);
    await prisma.orderIdempotencyKey.update({
      where: { id: claimId },
      data: { status: "COMPLETED", orderId: order.id },
    });
    const shape = await loadOrderShape(order.id);
    return { httpStatus: 201, body: shape };
  } catch (e) {
    // Creation failed → release the claim so the SAME key can be retried after
    // the caller fixes the order (otherwise a transient failure would lock the
    // key forever).
    await prisma.orderIdempotencyKey.delete({ where: { id: claimId } }).catch(() => {});

    if (e instanceof UnroutableLineError) {
      return err(422, "unroutable_line", "No eligible printer for one or more lines.", {
        product_type: e.productTypeId,
        method: e.method,
        quantity: e.quantity,
      });
    }
    // Unexpected — log server-side, return a generic structured 500 (no stack
    // leaked, no HTML page).
    console.error("apiCreateOrder failed:", e);
    return err(500, "internal_error", "An unexpected error occurred.");
  }
}

/**
 * Fetch one order for the calling merchant. Scoped to the key's merchant: an id
 * that doesn't exist OR belongs to another merchant returns an IDENTICAL 404
 * (never 403) so the endpoint can't be used to probe which order ids exist.
 */
export async function apiGetOrder(
  authHeader: string | null | undefined,
  orderId: string
): Promise<ApiResult> {
  const caller = await resolveMerchantFromApiKey(authHeader);
  if (!caller) {
    return err(401, "unauthorized", "Missing or invalid API key.");
  }

  // Scope FIRST: confirm ownership before loading the shape. findFirst with the
  // merchantId filter means a foreign order simply isn't found.
  const owned = await prisma.order.findFirst({
    where: { id: orderId, merchantId: caller.merchantId },
    select: { id: true },
  });
  if (!owned) {
    return err(404, "not_found", "Order not found.");
  }
  const shape = await loadOrderShape(owned.id);
  if (!shape) {
    return err(404, "not_found", "Order not found.");
  }
  return { httpStatus: 200, body: shape };
}

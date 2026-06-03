"use client";

// Client form for operator order entry. Holds the dynamic line rows + merchant
// selection in React state; the rest are plain named inputs. The current lines
// are mirrored into a hidden JSON field so the server action gets them in
// formData. Errors come back via useActionState (UnroutableLineError etc.) and
// render inline — no crash, no navigation. The server action owns auth +
// validation + createOrderWithRouting + recordOrderBilling.

import { useActionState, useMemo, useState } from "react";
import type { PrintMethod } from "@prisma/client";
import type { Locale } from "@/lib/i18n";
import { methodLabel } from "../labels";
import { createOrderAction, type NewOrderState } from "./actions";
import { nt, errorKeyFor } from "./labels";

export interface ClientVariant {
  id: string;
  sku: string;
  size: string | null;
  color: string | null;
}
export interface ClientProduct {
  id: string;
  name_en: string;
  name_ar: string;
  methods: PrintMethod[];
  variants: ClientVariant[];
}
export interface ClientDesign {
  id: string;
  name: string;
  merchantId: string;
}
export interface ClientMerchant {
  id: string;
  name: string;
}

interface LineRow {
  productId: string;
  variantId: string;
  method: string;
  quantity: number;
}

const emptyLine = (): LineRow => ({
  productId: "",
  variantId: "",
  method: "",
  quantity: 1,
});

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const labelCls = "block text-sm font-medium text-gray-700";

export function NewOrderForm({
  locale,
  merchants,
  products,
  designs,
}: {
  locale: Locale;
  merchants: ClientMerchant[];
  products: ClientProduct[];
  designs: ClientDesign[];
}) {
  const [state, formAction, pending] = useActionState<NewOrderState, FormData>(
    createOrderAction,
    {}
  );

  const [merchantId, setMerchantId] = useState("");
  const [designId, setDesignId] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);

  const productName = (p: ClientProduct) =>
    locale === "ar" ? p.name_ar : p.name_en;

  const merchantDesigns = useMemo(
    () => designs.filter((d) => d.merchantId === merchantId),
    [designs, merchantId]
  );

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  function patchLine(i: number, patch: Partial<LineRow>) {
    setLines((prev) =>
      prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l))
    );
  }

  function onProductChange(i: number, productId: string) {
    // Reset variant + method when the product changes (their options depend on it).
    patchLine(i, { productId, variantId: "", method: "" });
  }

  const variantText = (v: ClientVariant) =>
    [v.sku, [v.size, v.color].filter(Boolean).join(" / ")]
      .filter(Boolean)
      .join(" — ");

  const errorMsg = state.errorKind
    ? nt(errorKeyFor(state.errorKind), locale)
    : null;

  return (
    <form action={formAction} className="space-y-8">
      {errorMsg && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {errorMsg}
        </p>
      )}

      {/* Merchant + design */}
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <div>
          <label className={labelCls} htmlFor="merchantId">
            {nt("merchant", locale)}
          </label>
          <select
            id="merchantId"
            name="merchantId"
            required
            value={merchantId}
            onChange={(e) => {
              setMerchantId(e.target.value);
              setDesignId(""); // designs are merchant-scoped — reset on change
            }}
            className={`mt-1 ${inputCls}`}
          >
            <option value="">{nt("selectMerchant", locale)}</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls} htmlFor="designId">
            {nt("design", locale)}
          </label>
          <select
            id="designId"
            name="designId"
            required
            value={designId}
            onChange={(e) => setDesignId(e.target.value)}
            disabled={!merchantId}
            className={`mt-1 ${inputCls} disabled:bg-gray-100 disabled:text-gray-400`}
          >
            <option value="">{nt("selectDesign", locale)}</option>
            {merchantDesigns.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-gray-500">{nt("designHint", locale)}</p>
          {merchantId && merchantDesigns.length === 0 && (
            <p className="mt-1 text-xs text-amber-700">
              {nt("noDesigns", locale)}
            </p>
          )}
        </div>
      </section>

      {/* Order lines */}
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">
            {nt("lines", locale)}
          </h2>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
            className="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            {nt("addLine", locale)}
          </button>
        </div>

        <ul className="space-y-3">
          {lines.map((line, i) => {
            const product = line.productId
              ? productById.get(line.productId)
              : undefined;
            return (
              <li
                key={i}
                className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-[2fr_2fr_1.5fr_0.8fr_auto] sm:items-end"
              >
                <div>
                  <label className={labelCls}>{nt("product", locale)}</label>
                  <select
                    value={line.productId}
                    onChange={(e) => onProductChange(i, e.target.value)}
                    className={`mt-1 ${inputCls}`}
                  >
                    <option value="">{nt("selectProduct", locale)}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {productName(p)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>{nt("variant", locale)}</label>
                  <select
                    value={line.variantId}
                    onChange={(e) => patchLine(i, { variantId: e.target.value })}
                    disabled={!product}
                    className={`mt-1 ${inputCls} disabled:bg-gray-100 disabled:text-gray-400`}
                  >
                    <option value="">{nt("selectVariant", locale)}</option>
                    {product?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {variantText(v)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>{nt("method", locale)}</label>
                  <select
                    value={line.method}
                    onChange={(e) => patchLine(i, { method: e.target.value })}
                    disabled={!product}
                    className={`mt-1 ${inputCls} disabled:bg-gray-100 disabled:text-gray-400`}
                  >
                    <option value="">{nt("selectMethod", locale)}</option>
                    {product?.methods.map((m) => (
                      <option key={m} value={m}>
                        {methodLabel(m, locale)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>{nt("qty", locale)}</label>
                  <input
                    type="number"
                    min={1}
                    value={line.quantity}
                    onChange={(e) =>
                      patchLine(i, { quantity: Number(e.target.value) })
                    }
                    className={`mt-1 ${inputCls}`}
                  />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setLines((prev) =>
                      prev.length === 1
                        ? [emptyLine()]
                        : prev.filter((_, idx) => idx !== i)
                    )
                  }
                  className="rounded-md px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                >
                  {nt("removeLine", locale)}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Recipient */}
      <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-900">
          {nt("recipient", locale)}
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field name="recipient_name" label={nt("recipientName", locale)} required />
          <Field name="recipient_phone" label={nt("recipientPhone", locale)} />
          <Field name="shipping_line1" label={nt("line1", locale)} required />
          <Field name="shipping_line2" label={nt("line2", locale)} />
          <Field name="shipping_city" label={nt("city", locale)} required />
          <Field name="shipping_emirate" label={nt("emirate", locale)} />
        </div>
      </section>

      {/* Lines payload travels as JSON so the action gets the dynamic rows. */}
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />

      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-md bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {nt("submit", locale)}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  required,
}: {
  name: string;
  label: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className={labelCls} htmlFor={name}>
        {label}
      </label>
      <input
        id={name}
        name={name}
        required={required}
        className={`mt-1 ${inputCls}`}
      />
    </div>
  );
}

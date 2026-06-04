"use client";

// Client form for merchant wallet top-ups. A single AED amount field; the server
// action (createTopUpAction) owns auth + validation + creating the Checkout
// Session, then redirects to the gateway. Errors come back via useActionState
// and render inline — no crash, no navigation. This form NEVER credits the
// wallet; that happens only from the verified webhook.

import { useActionState } from "react";
import type { Locale } from "@/lib/i18n";
import { createTopUpAction, type TopUpState } from "./actions";
import { t, topUpErrorKey } from "./labels";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export function TopUpForm({ locale }: { locale: Locale }) {
  const [state, formAction, pending] = useActionState<TopUpState, FormData>(
    createTopUpAction,
    {}
  );

  const errorMsg = state.errorKind
    ? t(topUpErrorKey(state.errorKind), locale)
    : null;

  return (
    <form action={formAction} className="space-y-3">
      {errorMsg && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-4 py-3 text-sm font-medium text-red-700"
        >
          {errorMsg}
        </p>
      )}
      <div>
        <label htmlFor="topup-amount" className="block text-sm font-medium text-gray-700">
          {t("amountLabel", locale)}
        </label>
        <input
          id="topup-amount"
          name="amount"
          type="number"
          inputMode="decimal"
          min={50}
          max={100000}
          step="0.01"
          required
          className={`mt-1 ${inputCls}`}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? t("topUpPending", locale) : t("topUpButton", locale)}
      </button>
    </form>
  );
}

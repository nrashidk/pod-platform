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
  "w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700";

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
          className="rounded-lg bg-danger-bg px-4 py-3 text-sm font-medium text-danger-fg"
        >
          {errorMsg}
        </p>
      )}
      <div>
        <label htmlFor="topup-amount" className="block text-sm font-medium text-ink">
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
        className="inline-flex items-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
      >
        {pending ? t("topUpPending", locale) : t("topUpButton", locale)}
      </button>
    </form>
  );
}

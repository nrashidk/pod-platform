"use client";

// Client island for minting a key. Uses useActionState so the one-time raw
// token returned by generateKeyAction can be shown inline ONCE (never via a URL
// or persisted). On success the surrounding server list is revalidated by the
// action; here we only surface the secret + any validation error.

import { useActionState } from "react";
import { generateKeyAction, type GenerateKeyState } from "./actions";
import { kt, type ApiKeyUiKey } from "./labels";
import type { Locale } from "@/lib/i18n";

const initial: GenerateKeyState = {};

const ERROR_KEY: Record<NonNullable<GenerateKeyState["error"]>, ApiKeyUiKey> = {
  no_merchant: "errNoMerchant",
  no_name: "errNoName",
  generic: "errGeneric",
};

export function GenerateKeyForm({
  merchants,
  locale,
}: {
  merchants: { id: string; name: string }[];
  locale: Locale;
}) {
  const [state, formAction, pending] = useActionState(generateKeyAction, initial);

  return (
    <div className="space-y-4">
      {state.token && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">
            {kt("oneTimeTitle", locale)}
            {state.merchantName ? ` — ${state.merchantName}` : ""}
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 font-mono text-sm text-gray-900">
            {state.token}
          </code>
          <p className="mt-2 text-xs text-amber-800">{kt("oneTimeHint", locale)}</p>
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">{kt("merchant", locale)}</span>
          <select
            name="merchantId"
            required
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">{kt("selectMerchant", locale)}</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-gray-700">{kt("keyName", locale)}</span>
          <input
            type="text"
            name="name"
            required
            placeholder={kt("keyNamePlaceholder", locale)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {kt("create", locale)}
        </button>
      </form>

      {state.error && (
        <p className="text-sm font-medium text-red-600">
          {kt(ERROR_KEY[state.error], locale)}
        </p>
      )}
    </div>
  );
}

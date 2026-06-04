"use client";

// Client form to create a design (name + product type). The server action owns
// auth + creation; errors come back via useActionState and render inline. On
// success the list re-renders (the action revalidates the path).

import { useActionState, useEffect, useRef } from "react";
import type { Locale } from "@/lib/i18n";
import { createDesignAction, type CreateDesignState } from "./actions";
import { dt, createErrorKey } from "./labels";

const inputCls =
  "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

export function CreateDesignForm({
  locale,
  productTypes,
}: {
  locale: Locale;
  productTypes: { id: string; name_en: string; name_ar: string }[];
}) {
  const [state, formAction, pending] = useActionState<CreateDesignState, FormData>(
    createDesignAction,
    {}
  );
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the inputs after a successful create.
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  const errorMsg = state.errorKind ? dt(createErrorKey(state.errorKind), locale) : null;

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      {errorMsg && (
        <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMsg}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="design-name" className="block text-sm font-medium text-gray-700">
            {dt("nameLabel", locale)}
          </label>
          <input id="design-name" name="name" type="text" required className={`mt-1 ${inputCls}`} />
        </div>
        <div>
          <label htmlFor="design-type" className="block text-sm font-medium text-gray-700">
            {dt("productTypeLabel", locale)}
          </label>
          <select id="design-type" name="productTypeId" required defaultValue="" className={`mt-1 ${inputCls}`}>
            <option value="" disabled>
              —
            </option>
            {productTypes.map((pt) => (
              <option key={pt.id} value={pt.id}>
                {locale === "ar" ? pt.name_ar : pt.name_en}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {pending ? dt("createPending", locale) : dt("createButton", locale)}
      </button>
    </form>
  );
}

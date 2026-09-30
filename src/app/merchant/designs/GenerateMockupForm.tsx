"use client";

// Button to (re)generate a design's mockup. The server action owns auth +
// generation; errors come back via useActionState and render inline.

import { useActionState } from "react";
import type { Locale } from "@/lib/i18n";
import { generateMockupAction, type MockupState } from "./actions";
import { dt, mockupErrorKey } from "./labels";

export function GenerateMockupForm({
  locale,
  designId,
  hasMockup,
}: {
  locale: Locale;
  designId: string;
  hasMockup: boolean;
}) {
  const [state, formAction, pending] = useActionState<MockupState, FormData>(
    generateMockupAction,
    {}
  );
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="designId" value={designId} />
      {state.errorKind && (
        <p role="alert" className="mb-2 rounded-lg bg-danger-bg px-4 py-3 text-sm font-medium text-danger-fg">
          {dt(mockupErrorKey(state.errorKind), locale)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm font-semibold text-ink hover:bg-inset disabled:opacity-60"
      >
        {pending
          ? dt("mockupPending", locale)
          : hasMockup
            ? dt("mockupRegenerate", locale)
            : dt("mockupGenerate", locale)}
      </button>
    </form>
  );
}

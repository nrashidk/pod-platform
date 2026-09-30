"use client";

// Button to approve (lock) a design's mockup. The server action owns auth and
// every rule; errors come back via useActionState and render inline.

import { useActionState } from "react";
import type { Locale } from "@/lib/i18n";
import { approveMockupAction, type MockupState } from "./actions";
import { dt, mockupErrorKey } from "./labels";

export function ApproveMockupForm({
  locale,
  designId,
}: {
  locale: Locale;
  designId: string;
}) {
  const [state, formAction, pending] = useActionState<MockupState, FormData>(
    approveMockupAction,
    {}
  );
  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="designId" value={designId} />
      <p className="mb-2 text-sm text-muted">{dt("mockupApproveHint", locale)}</p>
      {state.errorKind && (
        <p role="alert" className="mb-2 rounded-lg bg-danger-bg px-4 py-3 text-sm font-medium text-danger-fg">
          {dt(mockupErrorKey(state.errorKind), locale)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-700 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {pending ? dt("mockupApprovePending", locale) : dt("mockupApprove", locale)}
      </button>
    </form>
  );
}

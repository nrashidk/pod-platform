"use client";

// Per-placement print-file upload — CLIENT-UPLOAD transport.
//
// Print files run up to PrintArea.max_file_mb (spec: 200MB), far past the 1MB
// Server Action body cap. So the browser uploads the file DIRECTLY to Vercel
// Blob via upload() with a short-lived token minted by /api/merchant/designs/
// upload (which enforces ownership + the PNG/JPEG + size gates before issuing
// it). Once the bytes are in Blob, we call the finalizePlacementAction server
// action with just the blob URL; the server reads the stored bytes back and
// validates them against the spec (PASSED/FLAGGED). The cheap client gates below
// are UX only — the token route and finalize action are authoritative.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import type { Locale } from "@/lib/i18n";
import { finalizePlacementAction, type UploadState, type UploadPhase } from "./actions";
import {
  dt,
  uploadErrorKey,
  uploadPhaseKey,
  uploadPhaseErrorKey,
  friendlyReason,
} from "./labels";

const ACCEPTED = ["image/png", "image/jpeg"];
// Reject codes the token route can throw; map them to the same localized labels.
const KNOWN_TOKEN_ERRORS = [
  "too_large",
  "bad_content_type",
  "design_not_found",
  "no_print_area",
];

export function UploadPlacementForm({
  locale,
  designId,
  placement,
  hasFile,
  maxFileMb,
}: {
  locale: Locale;
  designId: string;
  placement: string;
  hasFile: boolean;
  maxFileMb: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({});
  // `busy` covers the direct-to-Blob upload(); the transition covers refresh().
  const [busy, setBusy] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const pending = busy || refreshing;

  // A known reject code maps to its specific label; an unexpected failure shows
  // the stage it died in PLUS the raw cause (no more opaque "Something went
  // wrong"). An in-flight phase shows a stage-specific progress label.
  const errorMsg = state.errorKind
    ? state.errorKind === "generic"
      ? dt(uploadPhaseErrorKey(state.errorPhase), locale)
      : dt(uploadErrorKey(state.errorKind), locale)
    : null;
  const progressMsg =
    busy && state.phase ? dt(uploadPhaseKey(state.phase), locale) : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState({});
    const file = inputRef.current?.files?.[0];
    if (!file || file.size === 0) {
      setState({ errorKind: "no_file" });
      return;
    }
    // Cheap client gates (server stays authoritative): fail fast before uploading.
    if (!ACCEPTED.includes(file.type)) {
      setState({ errorKind: "bad_content_type" });
      return;
    }
    if (file.size > maxFileMb * 1024 * 1024) {
      setState({ errorKind: "too_large" });
      return;
    }

    setBusy(true);
    // Track the stage we're in so a thrown error can name WHERE it died. upload()
    // mints the token first (minting), then streams bytes to Blob (uploading) —
    // the first progress tick marks the transition; finalize is the (validating)
    // stage. A silent stall now reads as a stuck stage label, not a frozen button.
    let phase: UploadPhase = "minting";
    setState({ phase });
    try {
      // Browser → Blob directly. multipart handles large files robustly.
      const blob = await upload(`print-files/${file.name}`, file, {
        // Private store: print files are merchant design IP, never world-readable.
        access: "private",
        handleUploadUrl: "/api/merchant/designs/upload",
        clientPayload: JSON.stringify({ designId, placement }),
        contentType: file.type,
        multipart: true,
        onUploadProgress: () => {
          // First byte to Blob ⇒ token was minted, transfer has started.
          if (phase === "minting") {
            phase = "uploading";
            setState({ phase });
          }
        },
      });
      phase = "validating";
      setState({ phase });
      const res = await finalizePlacementAction({
        designId,
        placement,
        blobUrl: blob.url,
      });
      setState(res);
      if (res.ok) {
        if (inputRef.current) inputRef.current.value = "";
        startTransition(() => router.refresh());
      }
    } catch (err) {
      // Token rejection (ownership/type/size) maps to its specific label. Anything
      // else — a Blob/network failure such as an access-mode rejection — is
      // surfaced with the stage AND the raw message, so it never hangs opaquely.
      const msg = (err as Error)?.message ?? "";
      const known = KNOWN_TOKEN_ERRORS.find((k) => msg.includes(k));
      if (known) {
        setState({ errorKind: known });
      } else {
        setState({ errorKind: "generic", errorPhase: phase, errorDetail: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      {errorMsg && (
        <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          <p className="font-medium">{errorMsg}</p>
          {/* The raw cause for an unexpected failure — surfaced so a future break
              says exactly what went wrong instead of hiding behind a catch-all. */}
          {state.errorKind === "generic" && state.errorDetail && (
            <p className="mt-1 font-mono text-[11px] text-red-600 break-words">
              {state.errorDetail}
            </p>
          )}
        </div>
      )}
      {progressMsg && (
        <p className="rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
          {progressMsg}
        </p>
      )}
      {state.ok && state.status === "PASSED" && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-xs font-medium text-green-800">
          {dt("uploadedPassed", locale)}
        </p>
      )}
      {state.ok && state.status === "FLAGGED" && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">{dt("uploadedFlagged", locale)}</p>
          {state.reasons && state.reasons.length > 0 && (
            <ul className="mt-1 list-disc space-y-1 ps-4">
              {state.reasons.map((r, i) => (
                <li key={i}>{friendlyReason(r, locale)}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept="image/png,image/jpeg"
          required
          className="block w-full max-w-xs text-xs text-gray-600 file:me-3 file:rounded-md file:border-0 file:bg-gray-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-gray-800"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {pending
            ? dt("uploadPending", locale)
            : hasFile
              ? dt("replaceFile", locale)
              : dt("uploadFile", locale)}
        </button>
      </div>
    </form>
  );
}

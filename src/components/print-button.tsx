"use client";

// Opens the browser print dialog. Hidden on paper via Tailwind's `print:hidden`.

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 print:hidden"
    >
      {label}
    </button>
  );
}

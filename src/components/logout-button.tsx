"use client";

// Minimal client logout control. Clears the Better Auth session, then sends the
// user to /login. Used by /ops (operator) and the /login signed-in card.
// Logout is a UX action only — it does not enforce anything.

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function LogoutButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        router.push("/login");
        router.refresh();
      }}
      className={
        className ??
        "rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100"
      }
    >
      {label}
    </button>
  );
}

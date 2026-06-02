// Back-office login. Server wrapper only reads search params (initial language,
// and the ?error=forbidden flag set when requireRole bounces a wrong-role user)
// and hands them to the interactive client component. There is intentionally no
// public sign-up — back-office users are provisioned by seed/admin only.

import { isLocale, type Locale } from "@/lib/i18n";
import { LoginClient } from "./login-client";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const forbidden = sp.error === "forbidden";
  return <LoginClient initialLocale={locale} forbidden={forbidden} />;
}

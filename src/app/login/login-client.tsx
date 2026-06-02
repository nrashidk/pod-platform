"use client";

// Minimal bilingual (EN/AR + RTL) back-office login. Two states:
//  - no session  → email/password form (Better Auth signIn.email)
//  - session     → "signed in as …" card with role + sign-out, and a link to
//                  /ops for operators (merchant/printer dashboards are a later
//                  phase, so there is nowhere else to send them yet)
// Authorization is NOT decided here — this is UX. The /ops gate is what actually
// protects the operator surface.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDirection, type Locale } from "@/lib/i18n";
import { signIn, useSession } from "@/lib/auth-client";
import { LogoutButton } from "@/components/logout-button";

type Bi = { en: string; ar: string };
const L = {
  title: { en: "Back-office sign in", ar: "تسجيل الدخول للوحة الإدارة" },
  subtitle: {
    en: "Operators, merchants, and printers only.",
    ar: "للمشغّلين والتجّار والمطابع فقط.",
  },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  password: { en: "Password", ar: "كلمة المرور" },
  submit: { en: "Sign in", ar: "تسجيل الدخول" },
  signingIn: { en: "Signing in…", ar: "جارٍ تسجيل الدخول…" },
  invalid: {
    en: "Invalid email or password.",
    ar: "بريد إلكتروني أو كلمة مرور غير صحيحة.",
  },
  origin: {
    en: "Sign-in was rejected by the server (untrusted origin). This is a configuration issue, not your credentials — try opening the app at http://localhost:3000.",
    ar: "رفض الخادم تسجيل الدخول (مصدر غير موثوق). هذه مشكلة في الإعداد وليست في بياناتك — جرّب فتح التطبيق على http://localhost:3000.",
  },
  serverError: {
    en: "Sign-in failed due to a server error. Please try again.",
    ar: "فشل تسجيل الدخول بسبب خطأ في الخادم. يُرجى المحاولة مرة أخرى.",
  },
  forbidden: {
    en: "You don't have access to that page.",
    ar: "ليست لديك صلاحية الوصول إلى تلك الصفحة.",
  },
  signedInAs: { en: "Signed in as", ar: "مسجَّل الدخول باسم" },
  roleLabel: { en: "Role", ar: "الدور" },
  goToOps: { en: "Go to operations", ar: "الذهاب إلى العمليات" },
  logout: { en: "Sign out", ar: "تسجيل الخروج" },
  noView: {
    en: "Your dashboard isn't built yet — this phase only covers sign-in.",
    ar: "لوحتك غير جاهزة بعد — هذه المرحلة تغطّي تسجيل الدخول فقط.",
  },
} satisfies Record<string, Bi>;

const ROLE: Record<string, Bi> = {
  OPERATOR: { en: "Operator", ar: "مشغّل" },
  MERCHANT: { en: "Merchant", ar: "تاجر" },
  PRINTER: { en: "Printer", ar: "مطبعة" },
};

export function LoginClient({
  initialLocale,
  forbidden,
}: {
  initialLocale: Locale;
  forbidden: boolean;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const dir = getDirection(locale);
  const tr = (b: Bi) => (locale === "ar" ? b.ar : b.en);

  const router = useRouter();
  const { data: session, isPending } = useSession();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // null = no error. Otherwise which message to show: a 403 means the server
  // rejected the request itself (untrusted origin / CSRF), NOT bad credentials,
  // so we surface a distinct, diagnosable message instead of "invalid".
  const [error, setError] = useState<"invalid" | "origin" | "serverError" | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await signIn.email({ email, password });
    setSubmitting(false);
    if (res.error) {
      const status = res.error.status;
      if (status === 403) {
        // Origin/CSRF rejection — not a credentials problem. (Better Auth's
        // "Invalid origin" surfaces here as a 403.)
        setError("origin");
      } else if (status === 401 || status === 400) {
        setError("invalid");
      } else {
        setError("serverError");
      }
      return;
    }
    // Operators go straight to the ops console; others land on the signed-in
    // card (no dashboard yet).
    const role = (res.data?.user as { role?: string } | undefined)?.role;
    if (role === "OPERATOR") {
      router.push("/ops");
      router.refresh();
    } else {
      router.refresh();
    }
  }

  const user = session?.user as
    | { email: string; role?: string }
    | undefined;

  return (
    <div
      dir={dir}
      lang={locale}
      className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-gray-900"
    >
      <div className="w-full max-w-sm">
        <div className="mb-4 flex justify-end gap-2">
          <LangBtn active={locale === "en"} onClick={() => setLocale("en")}>
            English
          </LangBtn>
          <LangBtn active={locale === "ar"} onClick={() => setLocale("ar")}>
            العربية
          </LangBtn>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight">{tr(L.title)}</h1>
          <p className="mt-1 text-sm text-gray-500">{tr(L.subtitle)}</p>

          {isPending ? null : user ? (
            // ── Signed-in card ──
            <div className="mt-6 space-y-4">
              <div className="rounded-lg bg-gray-50 p-4 text-sm">
                <div className="text-gray-500">{tr(L.signedInAs)}</div>
                <div className="font-medium">{user.email}</div>
                <div className="mt-2 text-gray-500">{tr(L.roleLabel)}</div>
                <div className="font-medium">
                  {user.role && ROLE[user.role]
                    ? tr(ROLE[user.role])
                    : user.role}
                </div>
              </div>
              {user.role === "OPERATOR" ? (
                <Link
                  href="/ops"
                  className="block rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-700"
                >
                  {tr(L.goToOps)}
                </Link>
              ) : (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {tr(L.noView)}
                </p>
              )}
              <LogoutButton
                label={tr(L.logout)}
                className="w-full rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
              />
            </div>
          ) : (
            // ── Login form ──
            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              {forbidden && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {tr(L.forbidden)}
                </p>
              )}
              <Field
                label={tr(L.email)}
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                dir={dir}
              />
              <Field
                label={tr(L.password)}
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                dir={dir}
              />
              {error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                  {tr(L[error])}
                </p>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
              >
                {submitting ? tr(L.signingIn) : tr(L.submit)}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  dir,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  dir: "ltr" | "rtl";
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        dir={dir}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
      />
    </label>
  );
}

function LangBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white"
          : "border border-gray-200 bg-white text-gray-600 hover:bg-gray-100"
      }`}
    >
      {children}
    </button>
  );
}

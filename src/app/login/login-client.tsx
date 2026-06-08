"use client";

// Minimal bilingual (EN/AR + RTL) back-office login. Two states:
//  - no session  → email/password form (Better Auth signIn.email)
//  - session     → "signed in as …" card with role + sign-out, and a link to
//                  each role's surface (/ops, /merchant, /printer)
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
  appName: { en: "POD Platform", ar: "منصة POD" },
  brandTagline: {
    en: "Print-on-demand, orchestrated.",
    ar: "الطباعة عند الطلب، بإدارة متكاملة.",
  },
  brandSub: {
    en: "Route orders to trusted UAE & GCC printers that blind-ship under your brand.",
    ar: "وجِّه الطلبات إلى مطابع موثوقة في الإمارات والخليج تشحن باسم علامتك التجارية.",
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
  goToMerchant: { en: "Go to my orders", ar: "الذهاب إلى طلباتي" },
  goToPrinter: { en: "Go to my fulfillments", ar: "الذهاب إلى عمليات التنفيذ الخاصة بي" },
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
    // Route each role to its own surface: operators to the ops console,
    // merchants to their read-only order tracker, printers to their fulfillment
    // queue.
    const role = (res.data?.user as { role?: string } | undefined)?.role;
    if (role === "OPERATOR") {
      router.push("/ops");
      router.refresh();
    } else if (role === "MERCHANT") {
      router.push("/merchant");
      router.refresh();
    } else if (role === "PRINTER") {
      router.push("/printer");
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
      className="flex min-h-screen bg-canvas font-sans text-ink"
    >
      {/* Brand panel — deep-teal, desktop only. Mirrors with `dir` in RTL. */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-brand-700 p-10 text-white lg:flex xl:w-[55%]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(120% 90% at 100% 0%, rgba(168,124,48,0.28), transparent 55%), radial-gradient(90% 80% at 0% 100%, rgba(10,74,64,0.65), transparent 60%)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <Wordmark />
          <span className="text-base font-semibold tracking-tight">
            {tr(L.appName)}
          </span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-bold leading-tight tracking-tight">
            {tr(L.brandTagline)}
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            {tr(L.brandSub)}
          </p>
        </div>
        <div className="relative text-xs font-medium uppercase tracking-[0.18em] text-white/40">
          UAE · GCC
        </div>
      </aside>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center px-4 py-10 lg:w-1/2 xl:w-[45%]">
        <div className="w-full max-w-sm">
          <div className="mb-4 flex items-center justify-between gap-2">
            {/* Wordmark for small screens (brand panel is hidden there). */}
            <div className="flex items-center gap-2 lg:invisible">
              <Wordmark tone="brand" />
              <span className="text-sm font-semibold tracking-tight text-ink">
                {tr(L.appName)}
              </span>
            </div>
            <div className="flex gap-2">
              <LangBtn active={locale === "en"} onClick={() => setLocale("en")}>
                English
              </LangBtn>
              <LangBtn active={locale === "ar"} onClick={() => setLocale("ar")}>
                العربية
              </LangBtn>
            </div>
          </div>

          <div className="rounded-2xl border border-hairline bg-surface p-6 shadow-card">
            <h1 className="text-xl font-bold tracking-tight">{tr(L.title)}</h1>
            <p className="mt-1 text-sm text-muted">{tr(L.subtitle)}</p>

            {isPending ? null : user ? (
              // ── Signed-in card ──
              <div className="mt-6 space-y-4">
                <div className="rounded-xl bg-inset p-4 text-sm">
                  <div className="text-muted">{tr(L.signedInAs)}</div>
                  <div className="font-medium text-ink">{user.email}</div>
                  <div className="mt-2 text-muted">{tr(L.roleLabel)}</div>
                  <div className="font-medium text-ink">
                    {user.role && ROLE[user.role]
                      ? tr(ROLE[user.role])
                      : user.role}
                  </div>
                </div>
                {user.role === "OPERATOR" ? (
                  <Link
                    href="/ops"
                    className="block rounded-lg bg-brand-700 px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-600"
                  >
                    {tr(L.goToOps)}
                  </Link>
                ) : user.role === "MERCHANT" ? (
                  <Link
                    href="/merchant"
                    className="block rounded-lg bg-brand-700 px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-600"
                  >
                    {tr(L.goToMerchant)}
                  </Link>
                ) : user.role === "PRINTER" ? (
                  <Link
                    href="/printer"
                    className="block rounded-lg bg-brand-700 px-4 py-2 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-600"
                  >
                    {tr(L.goToPrinter)}
                  </Link>
                ) : (
                  <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-fg">
                    {tr(L.noView)}
                  </p>
                )}
                <LogoutButton
                  label={tr(L.logout)}
                  className="w-full rounded-lg border border-hairline bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-inset"
                />
              </div>
            ) : (
              // ── Login form ──
              <form onSubmit={onSubmit} className="mt-6 space-y-4">
                {forbidden && (
                  <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
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
                  <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger-fg">
                    {tr(L[error])}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
                >
                  {submitting ? tr(L.signingIn) : tr(L.submit)}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Compact geometric mark — matches the merchant shell wordmark. `tone="brand"`
// renders it on a light surface (small-screen header); default is for the teal
// brand panel.
function Wordmark({ tone = "light" }: { tone?: "light" | "brand" }) {
  const onLight = tone === "brand";
  return (
    <span
      aria-hidden
      className={`grid h-9 w-9 place-items-center rounded-xl ring-1 ring-inset ${
        onLight ? "bg-brand-50 ring-brand-700/20" : "bg-white/12 ring-white/20"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <rect
          x="1"
          y="1"
          width="16"
          height="16"
          rx="4"
          stroke={onLight ? "#0E5A4E" : "white"}
          strokeOpacity={onLight ? "0.85" : "0.85"}
          strokeWidth="1.5"
        />
        <path d="M9 4.5 13.5 9 9 13.5 4.5 9 9 4.5Z" fill="#E7B95C" />
      </svg>
    </span>
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
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required
        dir={dir}
        className="w-full rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-brand-700 focus:ring-1 focus:ring-brand-700"
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
          ? "bg-brand-700 text-white"
          : "border border-hairline bg-surface text-muted hover:bg-inset"
      }`}
    >
      {children}
    </button>
  );
}

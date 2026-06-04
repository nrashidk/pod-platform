// Operator API-key management (server component). OPERATOR-only via requireRole
// at the DATA layer (same gate as /ops). Lists every merchant's keys (by prefix
// + last4 + status — never the secret, which we don't store) and offers
// generate + revoke. The one-time secret reveal happens in the client island.
// Bilingual EN/AR with RTL.

import Link from "next/link";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { LogoutButton } from "@/components/logout-button";
import { t } from "../labels";
import { kt } from "./labels";
import { GenerateKeyForm } from "./GenerateKeyForm";
import { revokeKeyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  await requireRole("OPERATOR"); // DATA-LAYER gate, independent of middleware.

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);

  const merchants = await prisma.merchant.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      apiKeys: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          token_prefix: true,
          last4: true,
          createdAt: true,
          last_used_at: true,
          revoked_at: true,
        },
      },
    },
  });

  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{kt("title", locale)}</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">{kt("subtitle", locale)}</p>
            <Link
              href={`/ops?lang=${locale}`}
              className="mt-2 inline-block text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              ← {kt("back", locale)}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle locale={locale} />
            <LogoutButton label={t("logout", locale)} />
          </div>
        </header>

        {merchants.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            {kt("noMerchants", locale)}
          </p>
        ) : (
          <div className="space-y-8">
            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">
                {kt("generate", locale)}
              </h2>
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <GenerateKeyForm
                  merchants={merchants.map((m) => ({ id: m.id, name: m.name }))}
                  locale={locale}
                />
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">
                {kt("existing", locale)}
              </h2>
              <div className="space-y-6">
                {merchants.map((m) => (
                  <div
                    key={m.id}
                    className="overflow-hidden rounded-xl border border-gray-200 bg-white"
                  >
                    <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold">
                      {m.name}
                    </div>
                    {m.apiKeys.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-gray-500">
                        {kt("noKeys", locale)}
                      </p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                            <th className="px-4 py-2.5 text-start font-medium">
                              {kt("colKey", locale)}
                            </th>
                            <th className="px-4 py-2.5 text-start font-medium">
                              {kt("colName", locale)}
                            </th>
                            <th className="px-4 py-2.5 text-start font-medium">
                              {kt("colCreated", locale)}
                            </th>
                            <th className="px-4 py-2.5 text-start font-medium">
                              {kt("colLastUsed", locale)}
                            </th>
                            <th className="px-4 py-2.5 text-start font-medium">
                              {kt("colStatus", locale)}
                            </th>
                            <th className="px-4 py-2.5 text-start font-medium">
                              {kt("colAction", locale)}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.apiKeys.map((k) => {
                            const revoked = Boolean(k.revoked_at);
                            return (
                              <tr
                                key={k.id}
                                className="border-b border-gray-100 last:border-0"
                              >
                                <td className="px-4 py-2.5 font-mono text-gray-700">
                                  {k.token_prefix}…{k.last4}
                                </td>
                                <td className="px-4 py-2.5">{k.name}</td>
                                <td className="px-4 py-2.5">{fmt(k.createdAt)}</td>
                                <td className="px-4 py-2.5">
                                  {k.last_used_at ? fmt(k.last_used_at) : kt("never", locale)}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span
                                    className={
                                      revoked ? "text-red-600" : "text-green-700"
                                    }
                                  >
                                    {kt(revoked ? "revoked" : "active", locale)}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  {!revoked && (
                                    <form action={revokeKeyAction}>
                                      <input type="hidden" name="keyId" value={k.id} />
                                      <button
                                        type="submit"
                                        className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                      >
                                        {kt("revoke", locale)}
                                      </button>
                                    </form>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function LangToggle({ locale }: { locale: Locale }) {
  const base = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-gray-900 text-white";
  const inactive = "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200";
  return (
    <div className="flex items-center gap-2">
      <Link href="/ops/api-keys?lang=en" className={`${base} ${locale === "en" ? active : inactive}`}>
        {t("langEN", locale)}
      </Link>
      <Link href="/ops/api-keys?lang=ar" className={`${base} ${locale === "ar" ? active : inactive}`}>
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

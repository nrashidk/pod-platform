// Merchant design manager (server component). A signed-in MERCHANT sees ONLY
// their OWN designs — scoped in the data layer from the session's merchantId,
// never from client input. They create designs and upload a print file per
// placement; each file is validated against the PrintArea spec and recorded as
// PASSED/FLAGGED. A design is orderable only when every placement is PASSED.
// Bilingual EN/AR with RTL — framed by the shared merchant shell.

import { requireRole } from "@/lib/auth-context";
import { isLocale, type Locale } from "@/lib/i18n";
import { listMyDesigns, listDesignableProductTypes } from "@/lib/designs";
import { prisma } from "@/lib/prisma";
import { MerchantShell } from "../MerchantShell";
import { OrderableBadge, DesignStatusBadge } from "../badges";
import { CreateDesignForm } from "./CreateDesignForm";
import { UploadPlacementForm } from "./UploadPlacementForm";
import {
  dt,
  placementLabel,
  placementRequirements,
  friendlyReason,
} from "./labels";

// Designs + validation statuses change as files are uploaded; always fresh.
export const dynamic = "force-dynamic";

export default async function MerchantDesignsPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  // DATA-LAYER GATE: MERCHANT-only.
  const ctx = await requireRole("MERCHANT");

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";

  const [designs, productTypes, wallet] = await Promise.all([
    ctx.merchantId ? listMyDesigns(ctx.merchantId) : Promise.resolve([]),
    listDesignableProductTypes(),
    ctx.merchantId
      ? prisma.wallet.findUnique({
          where: { merchantId: ctx.merchantId },
          select: { balance: true, currency: true },
        })
      : Promise.resolve(null),
  ]);
  const walletChip = wallet
    ? { balance: Number(wallet.balance), currency: wallet.currency }
    : null;

  return (
    <MerchantShell
      locale={locale}
      active="designs"
      basePath="/merchant/designs"
      wallet={walletChip}
    >
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{dt("title", locale)}</h1>
          <p className="mt-1.5 text-sm text-muted">{dt("subtitle", locale)}</p>
        </header>

        {/* Create design */}
        <section className="mb-8 rounded-2xl border border-hairline bg-surface p-5 shadow-card">
          <h2 className="text-sm font-semibold text-ink">
            {dt("createHeading", locale)}
          </h2>
          <p className="mb-3 mt-1 text-sm text-muted">{dt("createHint", locale)}</p>
          <CreateDesignForm locale={locale} productTypes={productTypes} />
        </section>

        {/* List */}
        {designs.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-hairline-strong bg-surface p-10 text-center text-muted">
            {dt("noDesigns", locale)}
          </p>
        ) : (
          <ul className="space-y-4">
            {designs.map((d) => (
              <li
                key={d.id}
                className="overflow-hidden rounded-2xl border border-hairline bg-surface shadow-card"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{d.name}</div>
                    <div className="mt-0.5 text-sm text-muted">
                      {locale === "ar"
                        ? d.productType.name_ar
                        : d.productType.name_en}
                    </div>
                  </div>
                  <OrderableBadge orderable={d.orderable} locale={locale} />
                </div>

                <div className="border-t border-hairline bg-inset/50 px-5 py-4">
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-faint">
                    {dt("placementsHeading", locale)}
                  </h3>
                  <ul className="space-y-4">
                    {d.placements.map((p) => (
                      <li
                        key={p.placement}
                        className="rounded-xl border border-hairline bg-surface p-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-ink">
                            {placementLabel(p.placement, locale)}
                          </span>
                          <DesignStatusBadge status={p.status} locale={locale} />
                        </div>

                        {/* Up-front requirements, stated BEFORE a file is chosen
                            and derived from the PrintArea spec. */}
                        <div className="mt-2 rounded-lg bg-inset px-3 py-2 text-xs text-muted">
                          <span className="font-semibold text-ink">
                            {dt("reqLabel", locale)}:{" "}
                          </span>
                          {placementRequirements(locale, {
                            formats: p.allowed_formats,
                            minWidthPx: p.min_width_px,
                            minHeightPx: p.min_height_px,
                            maxFileMb: p.max_file_mb,
                          })}
                          {p.print_file_url && (
                            <>
                              {" "}
                              {/* Private store: link to the ownership-gated route,
                                  which mints a short-lived signed URL on click. */}
                              <a
                                href={`/api/merchant/designs/file?designId=${encodeURIComponent(
                                  d.id
                                )}&placement=${encodeURIComponent(p.placement)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-brand-700 underline decoration-brand-700/30 underline-offset-2 hover:text-brand-600"
                              >
                                {dt("viewFile", locale)}
                              </a>
                            </>
                          )}
                        </div>

                        {/* FLAGGED reasons, re-stated in plain bilingual language. */}
                        {p.status === "FLAGGED" && p.notes && (
                          <div className="mt-2 rounded-lg border border-warn-fg/15 bg-warn-bg px-3 py-2 text-xs text-warn-fg">
                            <p className="font-semibold">
                              {dt("reasonsHeading", locale)}
                            </p>
                            <ul className="mt-1 list-disc space-y-1 ps-4">
                              {p.notes.split("; ").map((r, i) => (
                                <li key={i}>{friendlyReason(r, locale)}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <UploadPlacementForm
                          locale={locale}
                          designId={d.id}
                          placement={p.placement}
                          hasFile={p.status !== "NONE"}
                          maxFileMb={p.max_file_mb}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MerchantShell>
  );
}

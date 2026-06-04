// Operator billing rollup (server component). OPERATOR-only via requireRole at
// the DATA layer (not middleware) — same gate as /ops. Read-only aggregation of
// the recorded ledger:
//   • per merchant — total owed   = Σ |WalletTransaction.amount| (FULFILLMENT_CHARGE)
//   • per printer  — total payable = Σ PrinterLedgerEntry.amount
//   • platform margin = owed − payable, shown per order and in aggregate, each
//     with a visible reconcile ✓/✗ (owed − payable === margin).
// Record-only: nothing here moves money. Bilingual EN/AR with RTL.

import Link from "next/link";
import { requireRole } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getDirection, isLocale, type Locale } from "@/lib/i18n";
import { holdStatus, REASON_HELD_30 } from "@/lib/printer-hold";
import { openDefectClaim, closeDefectClaim } from "../claim-actions";
import { LogoutButton } from "@/components/logout-button";
import { t } from "../labels";
import { bt } from "./labels";

export const dynamic = "force-dynamic";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number, currency = "AED") => `${n.toFixed(2)} ${currency}`;

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string; created?: string; claimErr?: string }>;
}) {
  await requireRole("OPERATOR"); // DATA-LAYER gate, independent of middleware.

  const sp = await searchParams;
  const locale: Locale = isLocale(sp.lang ?? "") ? (sp.lang as Locale) : "en";
  const dir = getDirection(locale);
  const justCreated = Boolean(sp.created);
  const claimError = Boolean(sp.claimErr);
  // Single "now" for the whole render — lazy hold evaluation reads it.
  const now = new Date();

  // One read of each ledger side + the orders they belong to; aggregate in JS
  // (ops scale). WalletTransaction carries orderId + wallet→merchant; the printer
  // ledger carries printerId + fulfillmentId, joined to orders via fulfillment.
  const [walletTxns, ledgerEntries, orders] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { type: "FULFILLMENT_CHARGE" },
      select: {
        amount: true,
        orderId: true,
        wallet: { select: { merchantId: true } },
      },
    }),
    prisma.printerLedgerEntry.findMany({
      select: { amount: true, printerId: true, fulfillmentId: true, reason: true },
    }),
    prisma.order.findMany({
      where: { fulfillments: { some: {} } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        currency: true,
        merchant: { select: { name: true } },
        fulfillments: { select: { id: true } },
      },
    }),
  ]);

  // ── Merchant + printer name lookups, and wallet balances (the real money-in
  // figure — net of top-ups and recorded charges, distinct from "total owed"). ──
  const [merchants, printers, wallets] = await Promise.all([
    prisma.merchant.findMany({ select: { id: true, name: true } }),
    prisma.printer.findMany({ select: { id: true, name: true } }),
    prisma.wallet.findMany({
      select: { merchantId: true, balance: true, currency: true },
    }),
  ]);
  const merchantName = new Map(merchants.map((m) => [m.id, m.name]));
  const printerName = new Map(printers.map((p) => [p.id, p.name]));

  // ── Fulfillments carrying a 70/30 hold (hold_status flipped off NONE at the
  // bulk SHIPPED transition). Pull each one's lifecycle status, its Shipment
  // claim window, and its open-claim count — the exact inputs holdStatus() needs
  // to compute availability LAZILY (no job has run). ──
  const heldFulfillments = await prisma.fulfillment.findMany({
    where: { hold_status: { not: "NONE" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      orderId: true,
      printerId: true,
      status: true,
      wholesale_cost: true,
      dispatch_paid: true,
      held_amount: true,
      shipments: {
        select: { claim_window_closes_at: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      claims: { select: { id: true, status: true } },
    },
  });

  // fulfillmentId → computed hold state + the inputs, so both the per-printer
  // split and the detail section share ONE evaluation per fulfillment.
  const holdByFulfillment = new Map<
    string,
    {
      state: "HELD" | "RELEASABLE";
      claimWindowClosesAt: Date | null;
      openClaim: { id: string } | null;
    }
  >();
  for (const f of heldFulfillments) {
    const closesAt = f.shipments[0]?.claim_window_closes_at ?? null;
    const openClaims = f.claims.filter(
      (c) => c.status === "OPEN" || c.status === "UNDER_REVIEW"
    );
    const state = holdStatus({
      fulfillmentStatus: f.status,
      claimWindowClosesAt: closesAt,
      openClaimCount: openClaims.length,
      now,
    });
    holdByFulfillment.set(f.id, {
      state,
      claimWindowClosesAt: closesAt,
      openClaim: openClaims[0] ? { id: openClaims[0].id } : null,
    });
  }
  const walletRows = wallets
    .map((w) => ({
      merchant: merchantName.get(w.merchantId) ?? w.merchantId,
      balance: round2(Number(w.balance)),
      currency: w.currency,
    }))
    .sort((a, b) => a.merchant.localeCompare(b.merchant));

  // ── Per merchant: total owed (charges are negative → take abs). ──
  const owedByMerchant = new Map<string, number>();
  for (const tx of walletTxns) {
    const mid = tx.wallet.merchantId;
    owedByMerchant.set(
      mid,
      round2((owedByMerchant.get(mid) ?? 0) + Math.abs(Number(tx.amount)))
    );
  }

  // ── Per printer: total payable (entries are positive = owed to printer). The
  // 70/30 hold PARTITIONS this same total into "payable now" vs "held" — it
  // never changes the total, so reconciliation stays intact by construction:
  //   payableNow + held === total payable === Σ entries.
  // A HELD_30 entry counts as payable-now ONLY if holdStatus() says RELEASABLE
  // (computed live); every other entry is payable now. ──
  const payableByPrinter = new Map<string, number>();
  const payableNowByPrinter = new Map<string, number>();
  const heldByPrinter = new Map<string, number>();
  const paidByFulfillment = new Map<string, number>();
  for (const e of ledgerEntries) {
    const amt = Number(e.amount);
    payableByPrinter.set(
      e.printerId,
      round2((payableByPrinter.get(e.printerId) ?? 0) + amt)
    );

    const isHeldBucket = e.reason.startsWith(REASON_HELD_30);
    const hold = e.fulfillmentId ? holdByFulfillment.get(e.fulfillmentId) : null;
    const stillHeld = isHeldBucket && hold?.state === "HELD";
    if (stillHeld) {
      heldByPrinter.set(
        e.printerId,
        round2((heldByPrinter.get(e.printerId) ?? 0) + amt)
      );
    } else {
      payableNowByPrinter.set(
        e.printerId,
        round2((payableNowByPrinter.get(e.printerId) ?? 0) + amt)
      );
    }

    if (e.fulfillmentId) {
      paidByFulfillment.set(
        e.fulfillmentId,
        round2((paidByFulfillment.get(e.fulfillmentId) ?? 0) + amt)
      );
    }
  }

  // ── Per order: owed (Σ|wallet txns by orderId|) vs payable (Σ ledger over its
  // fulfillments) → margin + reconcile check. ──
  const owedByOrder = new Map<string, number>();
  for (const tx of walletTxns) {
    if (!tx.orderId) continue;
    owedByOrder.set(
      tx.orderId,
      round2((owedByOrder.get(tx.orderId) ?? 0) + Math.abs(Number(tx.amount)))
    );
  }

  const orderRows = orders.map((o) => {
    const owed = owedByOrder.get(o.id) ?? 0;
    const payable = round2(
      o.fulfillments.reduce(
        (s, f) => s + (paidByFulfillment.get(f.id) ?? 0),
        0
      )
    );
    const margin = round2(owed - payable);
    return {
      id: o.id,
      currency: o.currency,
      merchant: o.merchant.name,
      owed,
      payable,
      margin,
      reconciles: round2(owed - payable) === margin,
    };
  });

  // ── Per-fulfillment hold detail (bulk holds only). state is the live
  // holdStatus() verdict; the claim controls operate the minimal open/close. ──
  const holdRows = heldFulfillments.map((f) => {
    const hold = holdByFulfillment.get(f.id)!;
    return {
      id: f.id,
      orderId: f.orderId,
      printer: printerName.get(f.printerId) ?? f.printerId,
      wholesale: round2(Number(f.wholesale_cost)),
      dispatch_paid: f.dispatch_paid != null ? round2(Number(f.dispatch_paid)) : 0,
      held_amount: f.held_amount != null ? round2(Number(f.held_amount)) : 0,
      state: hold.state,
      claimWindowClosesAt: hold.claimWindowClosesAt,
      openClaimId: hold.openClaim?.id ?? null,
    };
  });

  // ── Aggregate. ──
  const totalOwed = round2([...owedByMerchant.values()].reduce((s, n) => s + n, 0));
  const totalPayable = round2(
    [...payableByPrinter.values()].reduce((s, n) => s + n, 0)
  );
  const totalMargin = round2(totalOwed - totalPayable);
  const aggregateReconciles =
    round2(totalOwed - totalPayable) === totalMargin &&
    orderRows.every((r) => r.reconciles);

  const hasData = orderRows.length > 0;

  return (
    <div dir={dir} lang={locale} className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {bt("title", locale)}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              {bt("subtitle", locale)}
            </p>
            <Link
              href={`/ops?lang=${locale}`}
              className="mt-2 inline-block text-sm font-medium text-gray-500 hover:text-gray-900"
            >
              ← {bt("back", locale)}
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <LangToggle locale={locale} />
            <LogoutButton label={t("logout", locale)} />
          </div>
        </header>

        {justCreated && (
          <p className="mb-6 rounded-md bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
            {bt("createdNotice", locale)}
          </p>
        )}

        {claimError && (
          <p className="mb-6 rounded-md bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {bt("claimErr", locale)}
          </p>
        )}

        {/* Wallet balances — shown regardless of billing data (a merchant can
            top up before any order exists). The money-in rail surfaced here. */}
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold text-gray-900">
            {bt("walletBalances", locale)}
          </h2>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {walletRows.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-500">
                {bt("noWallets", locale)}
              </p>
            ) : (
              <Table
                head={[bt("merchant", locale), bt("balance", locale)]}
                rows={walletRows.map((w) => [
                  w.merchant,
                  money(w.balance, w.currency),
                ])}
              />
            )}
          </div>
        </section>

        {!hasData ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-gray-500">
            {bt("none", locale)}
          </p>
        ) : (
          <div className="space-y-8">
            {/* Aggregate reconcile banner */}
            <div
              className={`rounded-lg px-4 py-3 text-sm font-medium ${
                aggregateReconciles
                  ? "bg-green-50 text-green-800"
                  : "bg-red-50 text-red-700"
              }`}
            >
              {aggregateReconciles ? "✓ " : "✗ "}
              {bt(aggregateReconciles ? "reconcileOk" : "reconcileBad", locale)}{" "}
              <span className="font-mono">
                ({money(totalOwed)} − {money(totalPayable)} = {money(totalMargin)})
              </span>
            </div>

            {/* Per merchant */}
            <Section title={bt("merchantsOwed", locale)}>
              <Table
                head={[bt("merchant", locale), bt("owed", locale)]}
                rows={[...owedByMerchant.entries()].map(([mid, owed]) => [
                  merchantName.get(mid) ?? mid,
                  money(owed),
                ])}
              />
            </Section>

            {/* Per printer — total payable split into payable-now vs held. The
                two columns always sum to the same total payable (invariant). */}
            <Section title={bt("printersPayable", locale)}>
              <Table
                head={[
                  bt("printer", locale),
                  bt("payableNow", locale),
                  bt("held", locale),
                  bt("payable", locale),
                ]}
                rows={[...payableByPrinter.entries()].map(([pid, payable]) => [
                  printerName.get(pid) ?? pid,
                  money(payableNowByPrinter.get(pid) ?? 0),
                  money(heldByPrinter.get(pid) ?? 0),
                  money(payable),
                ])}
              />
            </Section>

            {/* Per-fulfillment 70/30 retention holds + claim controls. */}
            <section>
              <h2 className="mb-1 text-sm font-semibold text-gray-900">
                {bt("holdDetail", locale)}
              </h2>
              <p className="mb-3 max-w-2xl text-xs text-gray-500">
                {bt("holdSubtitle", locale)}
              </p>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                {holdRows.length === 0 ? (
                  <p className="p-6 text-center text-sm text-gray-500">
                    {bt("noHolds", locale)}
                  </p>
                ) : (
                  <Table
                    head={[
                      bt("fulfillment", locale),
                      bt("printer", locale),
                      bt("wholesale", locale),
                      bt("dispatch70", locale),
                      bt("held30", locale),
                      bt("holdState", locale),
                      bt("windowCloses", locale),
                      bt("claimStatus", locale),
                    ]}
                    rows={holdRows.map((h) => [
                      <span key="id" className="font-mono">
                        {h.id.slice(-8)}
                      </span>,
                      h.printer,
                      money(h.wholesale),
                      money(h.dispatch_paid),
                      money(h.held_amount),
                      <span
                        key="st"
                        className={
                          h.state === "RELEASABLE"
                            ? "font-medium text-green-700"
                            : "font-medium text-amber-700"
                        }
                      >
                        {bt(
                          h.state === "RELEASABLE"
                            ? "stateReleasable"
                            : "stateHeld",
                          locale
                        )}
                      </span>,
                      h.claimWindowClosesAt ? (
                        <span key="wc" className="font-mono text-xs">
                          {h.claimWindowClosesAt.toISOString().slice(0, 10)}
                        </span>
                      ) : (
                        <span key="wc" className="text-xs text-gray-400">
                          {bt("notDelivered", locale)}
                        </span>
                      ),
                      h.openClaimId ? (
                        <form key="cl" action={closeDefectClaim}>
                          <input type="hidden" name="claimId" value={h.openClaimId} />
                          <input type="hidden" name="lang" value={locale} />
                          <span className="me-2 text-xs font-medium text-red-600">
                            {bt("claimOpen", locale)}
                          </span>
                          <button
                            type="submit"
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-100"
                          >
                            {bt("closeClaimBtn", locale)}
                          </button>
                        </form>
                      ) : h.claimWindowClosesAt &&
                        now.getTime() <= h.claimWindowClosesAt.getTime() ? (
                        <form key="op" action={openDefectClaim} className="flex gap-1">
                          <input
                            type="hidden"
                            name="fulfillmentId"
                            value={h.id}
                          />
                          <input type="hidden" name="lang" value={locale} />
                          <input
                            type="text"
                            name="description"
                            required
                            placeholder={bt("claimDescPlaceholder", locale)}
                            className="w-28 rounded-md border border-gray-300 px-2 py-1 text-xs"
                          />
                          <button
                            type="submit"
                            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-100"
                          >
                            {bt("openClaimBtn", locale)}
                          </button>
                        </form>
                      ) : (
                        <span key="none" className="text-xs text-gray-400">
                          {bt("noClaim", locale)}
                        </span>
                      ),
                    ])}
                  />
                )}
              </div>
            </section>

            {/* Per order with reconcile check */}
            <Section title={bt("perOrder", locale)}>
              <Table
                head={[
                  bt("order", locale),
                  bt("merchant", locale),
                  bt("owed", locale),
                  bt("payable", locale),
                  bt("margin", locale),
                  bt("reconciles", locale),
                ]}
                rows={orderRows.map((r) => [
                  <span key="id" className="font-mono">
                    {r.id.slice(-8)}
                  </span>,
                  r.merchant,
                  money(r.owed, r.currency),
                  money(r.payable, r.currency),
                  money(r.margin, r.currency),
                  <span
                    key="ok"
                    className={r.reconciles ? "text-green-700" : "text-red-600"}
                  >
                    {r.reconciles ? "✓" : "✗"}
                  </span>,
                ])}
                footer={[
                  bt("total", locale),
                  "",
                  money(totalOwed),
                  money(totalPayable),
                  money(totalMargin),
                  <span
                    key="ok"
                    className={
                      aggregateReconciles ? "text-green-700" : "text-red-600"
                    }
                  >
                    {aggregateReconciles ? "✓" : "✗"}
                  </span>,
                ]}
              />
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {children}
      </div>
    </section>
  );
}

function Table({
  head,
  rows,
  footer,
}: {
  head: React.ReactNode[];
  rows: React.ReactNode[][];
  footer?: React.ReactNode[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-gray-200 bg-gray-50 text-start text-xs uppercase tracking-wide text-gray-500">
          {head.map((h, i) => (
            <th key={i} className="px-4 py-2.5 text-start font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-gray-100 last:border-0">
            {r.map((cell, j) => (
              <td key={j} className="px-4 py-2.5">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {footer && (
        <tfoot>
          <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
            {footer.map((cell, j) => (
              <td key={j} className="px-4 py-2.5">
                {cell}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

function LangToggle({ locale }: { locale: Locale }) {
  const base = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  const active = "bg-gray-900 text-white";
  const inactive =
    "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200";
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/ops/billing?lang=en"
        className={`${base} ${locale === "en" ? active : inactive}`}
      >
        {t("langEN", locale)}
      </Link>
      <Link
        href="/ops/billing?lang=ar"
        className={`${base} ${locale === "ar" ? active : inactive}`}
      >
        {t("langAR", locale)}
      </Link>
    </div>
  );
}

# POD Builder — Decisions

Two kinds of entry live here:

1. **Owner rulings** — decisions the owner made. Binding on every run, same
   force as `charter.md` §5 (which points here). Never edited after the fact;
   a later ruling supersedes an earlier one by saying so.
2. **Builder decisions** — choices the builder took without the owner
   (charter §3). The owner reviews these; any line he disagrees with becomes
   a fix item in `queue.md`.

Builder-decision format:

`- YYYY-MM-DD · <queue item> · <question> → <choice> (reason) · PR #n`

## Owner rulings — 28 Sep 2026 (answers to parked P1–P16)

Source: owner, interactive session of 28 Sep 2026. Recorded in the docs-only
PR "Apply owner rulings P1–P16".

### P1 · Licence + payment gateway — go-live gate, not a build gate
- The build uses **Stripe in TEST MODE ONLY**, always behind the existing
  provider seam (`src/lib/payments/index.ts`). No live-key path, live-mode
  switch or live-key detection logic anywhere in the code.
- The UAE licence/entity and the final gateway are a **go-live gate**
  (`PRE-PRODUCTION.md`), not a build gate. Money/checkout work (data model
  §10 step 4) may be built, test-mode only.
- The platform still never holds buyer funds (data model §0): the buyer pays
  the store's gateway; for the own store that is the owner's Stripe account.
- Supersedes: CLAUDE.md build-order step 5 "BLOCKED" and charter rule 11 as
  build blockers.
- Affects: queue 28, 29, 31. Parked P1 → resolved; licence/gateway moved to
  PRE-PRODUCTION.

### P2 · Split shipping — one blended rate
- Checkout shows **ONE BLENDED shipping rate** for the whole order. Never a
  per-parcel breakdown.
- Per the owner, the blended rate is what covers multiple parcels in the
  P3 tier-3 capacity-overflow case. (Open clarification on other multi-parcel
  cases — see parked P17; it does not block building, because one blended
  rate per order applies in every case.)
- Affects: queue 29.

### P3 · Routing — three tiers (replaces cheapest-first-only)
Hard gates still apply first (capability, capacity, blind-ship, plus P9 and
P15 below). Among the eligible printers:
1. **Default — a line stays whole and goes to ONE printer.** Cost is still the
   primary rank and proximity the tiebreaker (data model §3).
2. **Fairness — rotate whole lines across tied printers.** When two or more
   eligible printers are tied (same capability, same price, all ready with
   capacity), successive lines are **rotated** across them. A line is never
   split in this tier.
3. **Capacity overflow — split a line's quantity** across printers **only**
   when no single eligible printer can produce the full quantity.
- "Only 1 eligible printer → it gets 100%" is unchanged.
- **This supersedes data model §3 step 1 ("Quantity is never divided across
  printers") for the overflow case only.** The data model text itself is not
  edited by this ruling; charter rule 10 now names this exception.
- Affects: queue 6 (rewritten), 32 (unblocked).

### P5 · Design ownership — merchant-scoped in code
- Code keeps designs **merchant-scoped**, with no cross-merchant sharing (the
  current behaviour — already enforced in `src/lib/designs.ts` access checks).
- Buyer → merchant ownership / licence wording is a **terms-and-conditions
  matter, out of code scope**; it is a pre-launch owner action
  (`PRE-PRODUCTION.md`).
- Affects: queue 33 (unblocked). Parked P5 → resolved.

### P6 · Stripe wallet top-ups — keep
- The merchant wallet top-up rail stays: **Stripe test mode, behind the
  provider seam**. Resolved.
- Affects: parked P6 → resolved; queue 31 (partly, see P8).

### P7 · Pricing — keep the flat 30%
- Keep the flat markup: `MERCHANT_MARKUP_PCT = 0.3` in `src/lib/billing.ts`,
  as a **single constant** (no second copy anywhere).
- Stacked pricing (data model §7) is **deferred** — not built until a later
  ruling.
- Affects: queue 30 → deferred.

### P8 · Negative wallets — allow running debt, add a credit limit field
- **Allow running debt now. Do NOT block orders on wallet balance.**
- Add a `credit_limit` field on `Wallet` (nullable, default `null` =
  unlimited) as an additive migration, so prepaid/limit enforcement can be
  switched on later **as its own phase**. Adding the field must not change
  any behaviour.
- Affects: queue 31 split into 31 (field, todo) and 31b (enforcement,
  deferred).

### P9 · Printers that refuse the holdback — excluded from bulk
- A printer with `accepts_bulk_holdback = false` is **excluded from routing
  for bulk** work (Fulfillment production cost ≥ AED 1,000). It remains
  eligible for sub-threshold work. The flag is **not** informational.
- Affects: new queue item 34.

### P10 · Data model wording — drop "dual-clock"
- Update `docs/pod-platform-data-model.md` §10 step 6 to drop the second
  clock; only the 30-day defect-claim window remains. Done in this PR.
- Affects: parked P10 → resolved.

### P11 · Real printers — never in the repo
- Real printers are entered **through the ops screens** (queue 22/22b),
  **never** committed to the repository or the seed. Supplying their details
  is a pre-launch owner action (`PRE-PRODUCTION.md`).
- Supersedes: CLAUDE.md build-order step 2 "seed the two real printers".

### P15 · Printer contracts — required for routing
- Routing **requires `contract_signed = true`** for a printer to be eligible
  (a hard gate, like `blind_ship_confirmed`). Test seed printers must be
  marked signed so tests keep routing.
- Actual contract signing is a pre-launch owner action (`PRE-PRODUCTION.md`).
- Affects: new queue item 35.

### P12 · Product photos — placeholders for the build
- Build with **clearly-labelled placeholder / stock** product images
  (marked `[PLACEHOLDER]` in names/alt text/paths). Real photos are supplied
  pre-launch (`PRE-PRODUCTION.md`).
- Affects: queue 14 (no longer waiting on photos).

### P13 · Go-live secrets — owner supplies at launch
- Confirmed: production secrets and live settings are supplied by the owner
  at launch. Listed in `PRE-PRODUCTION.md` items 2, 3, 4, 7 and the new
  Vercel Blob item.

### P14 · Routine access — resolved
- GitHub write access is granted. The routine environment gets network access
  to `binaries.prisma.sh`, `registry.npmjs.org`, `fonts.googleapis.com`,
  `fonts.gstatic.com` (see `routine.md` §1b).

### P16 · Arabic copy review — owner, pre-launch
- The owner reviews Arabic UI copy before launch (`PRE-PRODUCTION.md`). The
  builder keeps writing Arabic and marking it "machine-drafted" in PRs; it is
  never blocked on review.

### P4 · Printer count — no ruling given
- P4 was not in the ruling list of 28 Sep 2026. It never blocked code; kept as a pre-launch
  business item in `PRE-PRODUCTION.md` (it never blocked code).

## Builder decisions

(none yet)

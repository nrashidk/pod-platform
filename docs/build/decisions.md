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
  P3 tier-3 capacity-overflow case. Extended to every multi-parcel case by
  ruling P17 below.
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
  printers") for the overflow case only.** Data model §3 was updated to
  state this single rule (see P3/P17 follow-up below).
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

## Owner rulings — 28 Sep 2026, follow-up (P3 alignment, P17)

Source: owner, interactive session of 28 Sep 2026. Recorded in the docs-only
PR "Align data model with P3; resolve P17".

### P3 (alignment) · One routing rule in the data model
- `docs/pod-platform-data-model.md` §3 now states the single rule: a line's
  quantity is **not** divided across printers, **except on capacity overflow**
  (P3 tier 3) — when no single eligible printer can produce the full
  quantity. Each resulting part is its own Fulfillment, which remains the unit
  of liability, shipping, tracking and claims for its parcel. §3 step 4 lists
  the three tiers. There is no longer a data-model/charter conflict to carry.

### P17 · Blended shipping applies to every multi-parcel order
- The buyer is **always charged ONE blended shipping rate for the whole
  order**, regardless of how many printers/parcels it fans into. This covers
  all three multi-parcel causes: (a) products no single printer makes,
  (b) P3 tier-2 rotation of lines across tied printers, (c) P3 tier-3
  capacity overflow. **Never per-parcel, in any case.**
- The platform absorbs the true multi-parcel shipping cost internally; the
  buyer-facing rate is one number.
- The rate's **value** is a pricing-calibration matter tied to the deferred
  pricing stack (P7). Not built now: queue 29 uses one configurable
  placeholder constant; the real value is set pre-launch (`PRE-PRODUCTION.md`
  15).
- Consequence for routing: tier-2 rotation scope is a free builder choice
  again (no shipping-price reason to keep one order's lines together); log it
  in `decisions.md` when queue 32 is built.
- Affects: queue 29, 32; data model §7 updated; parked P17 → resolved.

## Builder decisions

- 2026-09-28 · queue 1 (wallet lost update in billing) · how to make the smoke
  test actually exercise the race, given Node is single-threaded → fire the
  billing charge and a top-up webhook credit concurrently with
  `Promise.all` against the same wallet row (both are `await`-ing async
  Postgres round-trips, so their transactions genuinely interleave at the
  database), then assert the final balance is exactly
  `start + topup − charged` and replay every `WalletTransaction.balance_after`
  against the starting balance (simplest way to prove no update was lost,
  reversible, matches the existing wallet-topup-smoke.ts style); fresh-eyes
  review then flagged that `createdAt` ties (both billing-side rows share one
  `$transaction`, so Postgres's `now()` gives them the identical timestamp)
  made an order-by-`createdAt` replay unreliable → replaced with a
  permutation search that accepts any write order whose sequential replay
  reproduces every recorded `balance_after` · PR #6
- 2026-09-28 · queue 1b (harden the billing idempotency guard) · how to give
  `recordOrderBilling`'s "already recorded" check a real serialization point,
  given `WalletTransaction.orderId` can never carry a unique constraint (it
  holds one row PER FULFILLMENT for an order, not one per order, so two
  legitimate rows for the same order would collide) → added a small
  dedicated `BillingClaim` table (`orderId` unique), claimed with an insert
  first inside the same transaction as the ledger writes, mirroring the
  existing `ProcessedWebhookEvent` / `OrderIdempotencyKey` race-safe-claim
  pattern already used elsewhere in this codebase (reversible, consistent,
  additive migration only — a new table, no rewrite of existing rows, so not
  `needs-human` under charter rule 12); extended
  `prisma/billing-reconcile-smoke.ts` with a `Promise.allSettled` concurrent
  double-call test on a second order, since the pre-existing sequential
  re-record check never actually overlaps two calls in time and so could
  never have caught this race · PR #7
- 2026-09-28 · queue 2 (order creation and billing in one transaction) · how
  to make createOrderWithRouting (orders.ts) and recordOrderBilling
  (billing.ts) commit atomically without merging billing concerns INTO
  orders.ts (the file's own header comment says money/wallet movement is
  deliberately deferred out of routing) → split each function into a pure
  "compute" step (routing: `planRoutedOrder`, no writes) and a "write with a
  given `tx`" step (`persistRoutedOrder`, `writeOrderBilling`, both now take
  a `Prisma.TransactionClient` instead of opening their own
  `prisma.$transaction`), then added `createOrderWithRoutingAndBilling` in
  billing.ts — still "layered ON TOP of orders.ts, never inside it" per that
  file's existing framing — which opens ONE transaction and runs both write
  steps inside it. `createOrderWithRouting` and `recordOrderBilling` stay as
  standalone convenience wrappers (each opening its own transaction) for
  existing smoke tests and any future manual backfill/retry use; only the two
  production call sites (ops new-order action, API intake) were switched to
  the combined function. This also fixes a worse latent bug the same gap
  caused in the API path: on any failure after order creation it deleted the
  idempotency claim, so a retry with the same key would have created a
  SECOND order instead of recovering the orphaned first one — now impossible,
  since the whole write is one transaction and a failure leaves nothing
  behind for the claim to point at. No schema change (pure refactor, additive
  types only). New smoke test `prisma/order-billing-atomic-smoke.ts` proves
  the happy path bills in the same call, and that an unroutable line leaves
  zero orders/wallet-transactions/ledger-entries behind — same coverage style
  as the existing billing-reconcile/billing-race smokes · PR (this one)
- 2026-09-28 · queue 3 (locale resolution) · where to resolve the locale so the root layout can set `<html lang dir>` on the very first render → in `src/middleware.ts` (already the app's one middleware): `?lang=` → `pod_locale` cookie → `en`, forwarded to the server render as the `x-pod-locale` request header and read by `getRequestLocale()` (`src/lib/locale.ts`); an explicit valid `?lang=` is remembered in a 1-year `SameSite=Lax` cookie (a layout cannot set cookies, and reading the cookie alone would lag one request behind a `?lang=` switch). The middleware matcher widened from `/ops` to all pages; the session-cookie auth bounce still applies only to `/ops` (queue 24 covers `/merchant` and `/printer`), and it now redirects to `/login?lang=<locale>`. All pages replaced their per-page `isLocale(sp.lang) ? … : "en"` with `getRequestLocale(sp.lang)` so the cookie applies everywhere; the login page's language buttons now navigate to `/login?lang=…` (typed credentials survive: same route) so the cookie and `<html dir>` follow. Test-only: `prisma/resolve-hook.mjs` maps `next/server` → `next/server.js` so plain Node can import the middleware for the smoke test (no test weakened). Arabic copy on the new landing page is machine-drafted, owner to review (P16) · PR (this one)
- 2026-09-29 · queue 4 (first-article approval flow) · who drives each step and where a rejected proof unit goes → all three steps (proof unit produced / approve / reject) are OPERATOR actions on the ops page (the queue text says "ops action"; a printer-side submit button waits for queue 4b's photo upload); reject returns the fulfillment to `ROUTED` with `first_article_approved_at` left null, because `IN_PRODUCTION` is gated on that stamp and the printer must make a new proof unit (simplest, reversible, no new enum state). Implemented as `submitFirstArticle` / `decideFirstArticle` in `src/lib/fulfillment.ts` (conditional `updateMany` on the expected status so concurrent decisions lose cleanly) beside, not inside, `advanceFulfillment`, whose only change is allowing `FIRST_ARTICLE_APPROVED → IN_PRODUCTION`. The bulk gate itself is unchanged. No schema change · PR (this one)
- 2026-09-29 · queue 4b (first-article photo proof) · how the printer's photo relates to the ops "mark produced" step and whether ops approval requires a photo → the PRINTER's upload (owner-scoped, bulk only, ROUTED or FIRST_ARTICLE_PENDING) also performs the submit (`submitFirstArticleWithPhoto` in `src/lib/first-article-photo.ts`), replaceable while pending; the ops "mark produced" button from queue 4 stays as a fallback and ops approval does NOT require a photo (the queue asks only that ops SEE it when approving; requiring it would change queue-4 behaviour and strand existing rows) — the ops page shows a signed link or a "no photo" note. Photo: JPEG/PNG/WebP, ≤ 4 MB (under the serverless body ceiling), stored via the existing private print-file store seam; `serverActions.bodySizeLimit` raised to 5 MB in `next.config.mjs` (default 1 MB is too small). Additive migration: two nullable `Fulfillment` columns · PR (this one)
- 2026-09-29 · queue 5 (capacity gate becomes real) · where to keep the load rule and how to make release safe → new `src/lib/printer-load.ts` (`reservePrinterLoad` / `releasePrinterLoad`, both taking the caller's transaction client). **Load-release rule:** a Fulfillment reserves the sum of its lines' quantities on `Printer.current_load_units` in the same transaction that creates it (`persistRoutedOrder`); the load is released in the same transaction as the transition to SHIPPED (`advanceFulfillment`); CANCELLED and REROUTED must call `releasePrinterLoad` when those transitions are built (queue 19, 20). The units held are stored on the row (`Fulfillment.load_units`, additive migration, default 0) so a release returns exactly what was reserved and can only run once (conditional write on `load_units`). Reservation is a conditional `updateMany` (load + units ≤ capacity), so two orders racing for the last slots cannot both win — the loser rolls back with `PrinterCapacityError` and leaves nothing behind. Existing fulfillments get `load_units = 0` (no backfill, per charter rule 12): any in-flight load from before this change is never counted, which is harmless while only TEST printers exist. Capacity is treated as a running total of units not yet shipped, not a per-day counter — no daily reset is built (the field name says "daily", but the queue item defines release on SHIPPED). Test-suite side effect: smoke tests delete orders directly (bypassing release), so `test:reset-load` zeroes TEST printers' load between order-creating tests; the new smoke temporarily lowers TEST Apparel Co's capacity and restores it · PR #12
- 2026-09-29 · queue 6 · Which quantity picks a pricing tier when several lines share a capability? → the group total (all lines of one product type + method are priced at the tier the combined quantity reaches, each line then costed at that unit price) (data model §3 step 1 says the group is what is routed and gated; one price per group keeps the line-to-printer assignment consistent) · PR #13 Also: min/max quantity are judged on the group total, so a line below a printer's minimum is accepted when sibling lines of the same capability supply the rest (queue text + data model §3); `UnroutableLineError.quantity` (and the API `details.quantity`) is now the group total. Tier 2 rotation (queue 32) must rotate whole groups, not lines within a group.
- 2026-09-29 · queue 7 (shipment on dispatch) · where carrier + tracking are required and what an operator advance to SHIPPED does → the Shipment row is created inside `advanceFulfillment`'s transaction whenever a fulfillment moves to SHIPPED (DELIVERED already reuses an existing row, so no duplicate); `AdvanceOptions.shipment` supplies carrier + tracking. Carrier + tracking are REQUIRED only on the printer path (`advanceAction` refuses SHIPPED without both, via `parseShipmentDetails`: trimmed, non-empty, ≤ 100 chars); the engine and the ops advance button leave them optional so ops can still push a shipment through and existing callers/tests are unchanged — an operator-created Shipment shows "Not entered". No schema change (`Shipment.carrier` / `tracking_number` already existed). Ops and merchant order views show carrier + tracking read-only; shared EN/AR labels live in `src/app/ops/labels.ts` (`shipT`) · PR #14
- 2026-09-29 · queue 8 (printer work view) · how the printer gets the print files and what "the brand to apply" means → files are NOT linked from page HTML: each PASSED placement is a link to `GET /api/printer/work-file` (same pattern as the merchant design-file route) which re-derives the printer from the session, checks via `printerWorkFileUrl` (`src/lib/printer-work.ts`) that the design is on a line of one of THIS printer's fulfillments, and mints a short-lived signed URL per click; FLAGGED/PENDING files, other designs, other printers and REROUTED/CANCELLED fulfillments all get one undifferentiated 404. The page query (`getFulfillmentsForPrinter`) only selects placement id/code/status — never the file URL. "Brand to apply" = the merchant's name plus whichever of logo file, packing-slip message, return address, packaging note are set (data model §6 `branding_source`; all read from the existing `Merchant` columns, so no schema change); with none set the page says to ship unbranded. Logo is shown as a raw reference string, not rendered — logo upload/hosting is queue 10. Ship-to shows the full recipient address + phone (the printer needs it to ship); the printer query now selects only ship-to + brand fields of the Order, so the buyer's retail total and payment fields are no longer sent to the printer page. Files stay downloadable after SHIPPED (a printer may need them for a reprint under a defect claim; revisit with queue 17d) and are refused for REROUTED/CANCELLED. No schema change · PR #15
- 2026-09-29 · queue 9 (white-label packing slip) · who prints it and what it shows → the PRINTER prints it (it ships inside the parcel they pack): a link per fulfillment on `/printer` opens `/printer/packing-slip/[fulfillmentId]`, a print-friendly bilingual page (browser "Print" button, `print:hidden` chrome) that is PRINTER-only and ownership-scoped through `getPackingSlipForPrinter` (`src/lib/packing-slip.ts`; other printer / unknown id / REROUTED / CANCELLED → one 404). It shows the merchant's name as the header, ship-to, order ref, items (EN or AR product name by locale, size/colour, qty), the merchant's packing-slip message and return address; NO prices, printer identity or platform branding (the query selects none of them). The logo is not rendered — the schema holds only a raw reference and hosting/upload is queue 10, so the merchant name is the header until then; the message and return address are single-language free text (queue 10 adds EN/AR variants). Ops/merchant slip views are not built (not in the queue text). No schema change · PR #16
- 2026-09-29 · queue 10 (merchant brand settings) · how to add the Arabic variants, where the logo lives and what "EN/AR" covers → additive migration adding two nullable `Merchant` columns, `packing_slip_message_ar` and `return_address_ar`; the existing un-suffixed columns stay as the English text (no rename, no data rewrite — charter rule 12), and a missing variant falls back to the other language (`localizedBrandText`, `src/lib/merchant-brand.ts`). The packaging note stays single-language (it is an instruction to the printer, never shown to buyers, and the queue text asks for EN/AR only on the message). The slip and the printer's brand panel pick the variant by the viewer's locale (the printer's language, as the slip already did). New page `/merchant/brand` (MERCHANT-only, merchantId from the session) with plain forms → server actions and `?saved=1` / `?err=<kind>` feedback; text is trimmed, empty clears, caps 500 chars (message) / 300 (address, note), all-or-nothing on a bad field. The logo reuses the private print-file store seam: JPEG/PNG/WebP, ≤ 2 MB, judged by the real byte signature (`matchesSignature`, now exported from `first-article-photo.ts`), replaced by re-uploading, removable; the merchant sees it via a short-lived signed link. The logo is still NOT drawn on the packing slip or the printer's page (the printer would need its own ownership-scoped signed-link route, like the print-file route from queue 8) — left as a follow-up rather than widening this PR; the printer page still shows the raw reference. No new dependencies · PR #TBD

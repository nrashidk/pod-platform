# POD Builder — Queue

Take the first item with status `todo` whose `after` items are all `done`.
Skip anything `blocked — owner decision`, `deferred` or `parked`. One item = one PR; if an
item turns out too big, split it into lettered sub-items here (in the same PR)
and build only the first. When an item's PR merges, its line reads
`done (PR #n)` — updated in that same PR before merge.

Sources: **DM** = `docs/pod-platform-data-model.md` (§ = section);
**PP** = `PRE-PRODUCTION.md` (item number); **recon** = the builder-foundation
recon of 28 Sep 2026 (read the code, not commit messages — findings below).
`blocked` items name the `parked.md` entry that unblocks them; `P<n>` in the
Source column means an owner ruling recorded in `decisions.md`.

## Where things stand (recon, 28 Sep 2026)

Built and covered by smoke tests (verified by reading the code):

- **Step 1 catalog + capability matrix** — schema, test seed, routing lookup.
  Only `TEST` printers are seeded (no real printer data). No admin screens.
- **Step 2 design tool** — only **print-file validation** (format, DPI,
  pixel size, transparency, file size, colour space; `bleed_mm` not checked)
  and a merchant design manager with private Blob storage. **No mockup
  generation, no mockup approval/locking, no embroidery digitization.**
- **Step 3 order model + routing** — capability gate, capacity gate, cost
  first, proximity tiebreak; split into Fulfillments; composite order status.
  Gaps: routing checks quantity per line, not per capability group; the
  capacity gate never changes because `current_load_units` is never updated;
  `estimated_delivery` never set; Shipment rows only at DELIVERED (no carrier,
  tracking, packing slip, proof of delivery); API orders are always
  `OWN_STORE`.
- **Step 4 money** — a **record-only** billing ledger (wholesale × 1.30
  charged to the merchant wallet on every order; balance may go negative) and
  **Stripe test-mode wallet top-ups** (webhook-only crediting). No buyer
  checkout. Bug: billing overwrites the wallet balance (lost update).
- **Step 5 printer dashboard** — printer can move its own fulfillments
  ROUTED → IN_PRODUCTION → SHIPPED. Cannot see print file, address or packing
  slip; cannot enter tracking.
- **Step 6 delivery / defects** — ops can open/close a defect claim inside the
  30-day window (no photos, no outcome). 70/30 split recorded on dispatch for
  bulk; 30% "releasable" computed on delivery + closed window. **No
  first-article approval action — bulk orders cannot progress in the app.**
  No reroute, lost-in-transit, undeliverable, deduction or netting.
- **Step 7 admin/ops** — order list + advance, operator order entry, billing
  reconciliation, API keys. No printer/capability/catalog/merchant editing.
- **Step 8 Shopify adapter** — schema only.
- **Bilingual** — EN/AR labels exist for every page, but locale is chosen per
  page by `?lang=`; `<html lang dir>` is always `en`/`ltr`; the login
  redirect drops the language; the home page `/` is an English-only stub.

## Queue

| # | Item | Source | After | Status |
|---|------|--------|-------|--------|
| 1 | **Fix wallet lost update in billing.** `recordOrderBilling` reads the balance then writes an absolute value, so a Stripe top-up credited at the same moment is silently lost. Use atomic `decrement` and derive `balance_after` from the returned row; smoke test that interleaves a top-up credit with billing. | recon (`src/lib/billing.ts`) | — | done (PR #6) |
| 1b | **Harden the billing idempotency guard.** `recordOrderBilling`'s "already recorded" check (`src/lib/billing.ts`) is a plain `findFirst`, not a unique-constraint claim like the top-up webhook's `ProcessedWebhookEvent` — under READ COMMITTED, two concurrent calls for the same order could both pass it and double-charge. Not currently reachable (both known callers already serialize order creation via `OrderIdempotencyKey` before billing runs), so this is defense-in-depth, not an active bug. Add a real unique constraint (e.g. on `WalletTransaction.orderId`, or a small claim row) the transaction can conflict on. | fresh-eyes review, PR #6 | 1 | done (PR #7) |
| 2 | **Order creation and billing in one transaction** (or an idempotent retry): today a billing failure leaves an order with no charge. Keep record-only semantics. | recon (`src/lib/orders.ts`, `billing.ts`) | 1 | done (PR #8) |
| 3 | **Locale resolution.** Resolve locale once (`?lang=` → cookie → default) and drive `<html lang dir>` from it in the root layout; keep `lang` through the `/login` redirect; replace the English-only `/` stub with a bilingual landing that links to the three back-office areas. | CLAUDE.md (bilingual mandatory); recon | — | done (PR #9) |
| 4 | **First-article approval flow (bulk).** Ops action: ROUTED → FIRST_ARTICLE_PENDING (printer produced 1 unit) → FIRST_ARTICLE_APPROVED or back to production; FIRST_ARTICLE_APPROVED → IN_PRODUCTION allowed. Bulk fulfillments must pass it before IN_PRODUCTION (already enforced) — this adds the missing path through. Smoke test without direct DB writes. | DM §5b | — | done (PR #10) |
| 4b | First-article **photo proof**: printer uploads a photo of the first unit (existing Blob store seam; stub in tests); ops sees it when approving. | DM §5b | 4 | done (PR #11) |
| 5 | **Capacity gate becomes real.** Maintain `current_load_units` (add on routing, release on SHIPPED/CANCELLED/REROUTED) inside the same transaction as the state change; smoke test that a full printer drops out of routing. Log the load-release rule in decisions.md. (Reserve at routing + release at SHIPPED built; CANCELLED/REROUTED release hooks arrive with items 19/20.) | DM §3 step 3.2; recon | — | done (PR #12) |
| 6 | **Routing tier 1 — whole line to one printer.** Group lines by (product type + method); check min/max qty and capacity on the group total; assign each line whole to ONE eligible printer (cost first, proximity tiebreak). Only one eligible printer → it gets 100%. | DM §3 step 1–2; P3 | 5 | done (PR #13) |
| 7 | **Shipment on dispatch.** Printer enters carrier + tracking number when marking SHIPPED; Shipment row created then (not only at DELIVERED); shown to ops and merchant. | DM §3, §4 | — | done (PR #14) |
| 8 | **Printer work view.** Printer sees, per fulfillment: the validated print file(s) (short-lived private URL), ship-to address, and the brand to apply. Ownership-scoped. | DM §4, §6; recon | 7 | done (PR #15) |
| 9 | **White-label packing slip.** Bilingual printable packing slip per fulfillment carrying the merchant's brand (logo, message, return address), no platform/printer branding. | DM §6 | 8 | done (PR #TBD) |
| 10 | **Merchant brand settings.** Merchant edits own brand assets (logo upload, packing-slip message EN/AR, return address, packaging note). | DM §1 Merchant, §6 | 9 | todo |
| 11 | **Proof of delivery.** Record POD (photo/reference) when marking DELIVERED; delivery starts the 30-day claim window (already computed). | DM §3, §4 | 7 | todo |
| 12 | **Estimated delivery.** Add `Printer.production_lead_days` (default, additive migration) + a per-destination shipping-days table with defaults; set `Fulfillment.estimated_delivery` at routing; show it. | DM §1 Printer, §4 | 5 | todo |
| 13 | **Bleed check** in print-file validation (`PrintArea.bleed_mm`), with bilingual merchant-facing flag copy. | DM §2 | — | todo |
| 14 | **Mockup generator.** Render a preview mockup from a design's validated print file onto a per-product-type template (clearly-labelled `[PLACEHOLDER]` product images — owner ruling P12; real photos arrive pre-launch). Uses `sharp` (already a dependency). Stores `mockup_url`. | DM §2, §10 step 2 | 13 | todo |
| 14b | **Mockup approval + lock.** Merchant approves the mockup (timestamped `mockup_approved_at`); approved design's print files become immutable (new version needed to change). | DM §2, §4 | 14 | todo |
| 14c | **Order gate on approval.** An order line needs mockup approved AND print files PASSED (ops entry + API intake). Existing API behaviour change → note in PR. | DM §2 rule, §4 | 14b | todo |
| 15 | **Embroidery digitization step.** For `requires_digitization` capabilities: DIGITIZING state, stitch-file upload + digitization preview, preview becomes the approval artifact for that line. | DM §2 embroidery | 14b, 4 | todo |
| 16 | **Defect claim photos.** Claim cannot be opened without ≥1 photo (reuse Blob pipeline). | DM §5 | 11 | todo |
| 17 | **Claim outcome.** Ops records liability party (printer/buyer/carrier/platform) and remedy (reprint / refund) per §5 table; closes the claim. | DM §5 | 16 | todo |
| 17b | **Deduction from the 30% hold.** Approved printer-liability claim deducts its cost from the held 30% (HoldStatus DEDUCTED / PARTIALLY_DEDUCTED), per order; ledger records only. | DM §5b | 17 | todo |
| 17c | **Netting.** Defect cost above the held 30% is carried as a ledger debit against the printer's next fulfillment. Ledger records only. | DM §5b | 17b | todo |
| 17d | **Reprint.** Printer-liability claim creates a replacement fulfillment at no merchant charge, routed to the same printer (fallback: next eligible). | DM §5 | 17 | todo |
| 18 | **Hold split atomic + release stamped.** Record the 70/30 split in the same transaction as the SHIPPED transition; when release conditions are met, stamp RELEASED and write a PrinterPayment record (record only — no payout). | DM §5b; recon | 17b | todo |
| 19 | **Reroute.** Ops marks "printer can't fulfill" → fulfillment REROUTED, lines re-routed to the next eligible printer (same gates); if none, CANCELLED and flagged. | DM §5 | 5 | todo |
| 20 | **Cancel before production** (ops): fulfillment/order CANCELLED; releases capacity; reverses the record-only charge with a REFUND wallet transaction. | DM §4, §5 | 5, 2 | todo |
| 21 | **Lost in transit / undeliverable.** Lost (confirmed) → replacement reship at platform cost; undeliverable → returned-to-printer state held 30 days, reship paid. Record-level only. | DM §5 | 17d | todo |
| 22 | **Ops: printers.** Create/edit printers (location, blind-ship confirmed, contract signed, accepts bulk holdback, capacity, status incl. REMOVED). Bilingual. | DM §1, §5b; §10 step 7 | — | todo |
| 22b | **Ops: capabilities + pricing tiers** per printer. | DM §1 | 22 | todo |
| 22c | **Ops: catalog** — product types (EN/AR), print areas/specs, products, variants. Enforce "listable only if ≥1 active capability". | DM §1 | 22b | todo |
| 22d | **Ops: merchants** — create/edit merchants and their back-office users. | DM §1 | 10 | todo |
| 23 | **API intake origination.** Orders from a non-platform-owner merchant's API key are `CONNECTED_STORE`; merchant zero stays `OWN_STORE`. | DM §0, §8; recon | — | todo |
| 24 | **Middleware covers `/merchant` and `/printer`** (UX redirect only; server-side `requireRole` stays the real guard). | recon | 3 | todo |
| 25 | **PP 1 — gate dev trusted origins** behind `NODE_ENV !== "production"`; production origin comes only from `BETTER_AUTH_URL`. (Setting the real domain/secret is owner-only — parked.md.) | PP 1 | — | todo |
| 26 | **PP 4 — seed guards.** `seed-auth`/`seed-ops-demo`/`seed.mjs` refuse to run when `NODE_ENV=production` or the database host is not local, unless an explicit override flag is set. | PP 4 | — | todo |
| 27 | **README refresh** — it still describes an empty skeleton; describe what exists, how to run locally against a local Postgres, and point to docs/build/. | recon | — | todo |
| 28 | **Buyer checkout — Stripe TEST MODE ONLY**, behind the provider seam; no live-key path (P1). Buyer pays the store's gateway, never the platform. Likely needs a minimal own-store storefront first — split into lettered sub-items when started. | DM §4, §10 step 4; P1 | 2, 3, 14c | todo |
| 29 | **One blended shipping rate at checkout** for the whole order, never per-parcel, whatever causes a multi-parcel split (P2, P17). Rate = one configurable placeholder constant; its value is pricing calibration tied to the deferred pricing stack (P7), set pre-launch (PRE-PRODUCTION 15). Do not build shipping-cost calibration. | DM §7; P2, P17 | 28 | todo |
| 30 | **Pricing stack** (shipping, add-ons, VAT, tiers) replacing the flat 30% markup. | DM §7; P7 | — | deferred — owner ruling P7 keeps flat 30% (`MERCHANT_MARKUP_PCT`, single constant) |
| 31 | **`Wallet.credit_limit` field** — nullable, default `null` = unlimited; additive migration; **no behaviour change** (orders are never blocked on balance). Smoke test that billing still runs past zero. | P8 | 1 | todo |
| 31b | **Wallet limit enforcement / auto-recharge.** | DM §0, §1 Wallet; P8 | 31 | deferred — owner ruling P8 (its own later phase) |
| 32 | **Routing tiers 2 + 3.** Tier 2: when eligible printers are tied (same capability, same price, capacity available), rotate whole lines across them — never split a line (persisted rotation pointer). Tier 3: split a line's quantity across printers ONLY when no single eligible printer can make the full quantity (capacity overflow); each part becomes its own Fulfillment and is judged for bulk (≥ AED 1,000) on its own cost. Log the rotation-scope choice (per order vs per line) in decisions.md. | DM §3; P3 | 6 | todo |
| 33 | **Shopify adapter (v1.1).** StoreConnection, webhook → `createOrder`, product push; designs stay merchant-scoped (P5). Built and tested with signed fixture webhooks only — connecting a real Shopify store needs the owner's Shopify app credentials (a go-live step, `needs-human` if it requires a secret). | DM §8, §10 step 8; P5 | 23 | todo |
| 34 | **Holdback refusers excluded from bulk.** A printer with `accepts_bulk_holdback = false` is not eligible for a line whose production cost with that printer is ≥ AED 1,000; still eligible below it. Smoke test both sides of the threshold. | DM §5b; P9 | 6 | todo |
| 35 | **Signed contract required for routing.** `contract_signed = true` becomes a hard eligibility gate (like `blind_ship_confirmed`); TEST seed printers marked signed; smoke test that an unsigned printer is never routed to. | DM §5b; P15 | — | todo |

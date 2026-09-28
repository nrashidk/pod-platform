# POD Builder — Parked

Questions only the owner can answer. The builder builds around them and never
guesses. When the owner answers, the answer is copied into `charter.md` §5 as
a ruling, the entry moves to "Resolved" with a pointer to that ruling, and the
queue items it blocked become `todo`.

Format:

```
### P<n> · <short title>
- Raised: YYYY-MM-DD · source
- Why: …
- What is needed from owner: …
- Blocks: …
```

## Open

### P1 · UAE license + payment gateway
- Raised: 2026-09-28 · data model §9 item 1; CLAUDE.md build order step 5; PRE-PRODUCTION 5
- Why: running a store and billing store owners for fulfillment needs the right
  UAE entity and a gateway. The platform never holds buyer funds, but the
  architecture of checkout depends on which gateway and who the merchant of
  record is.
- What is needed from owner: the legal entity, and the payment gateway to use
  (for buyer checkout on the own store, and for charging store owners).
- Blocks: queue 28 (buyer checkout), 30 (pricing stack), 31 (wallet
  enforcement / auto-recharge); going live with wallet top-ups (see P6).

### P2 · Split-shipping rule
- Raised: 2026-09-28 · data model §7, §9 item 2
- Why: an order split across two printers ships as two parcels. Either show
  shipping per parcel at checkout (the data model's recommendation) or quote
  one blended rate and absorb the difference.
- What is needed from owner: pick "per-parcel shipping shown at checkout"
  (recommended) or "one blended rate".
- Blocks: queue 29.

### P3 · Routing weights
- Raised: 2026-09-28 · data model §3, §9 item 3
- Why: routing today is capability → capacity → cheapest → nearest (tiebreak).
  The data model asks for starting weights and warns that cheapest-first will
  concentrate volume on one printer.
- What is needed from owner: keep strict "cheapest wins, nearest breaks ties"
  for v1, or give weights (and whether to add a small load-balancing factor).
- Blocks: queue 32. (Everything else uses the current rule.)

### P4 · Printer count per product category
- Raised: 2026-09-28 · data model §5b, §9 item 4
- Why: with two printers, rerouting and "remove a bad printer" have no teeth.
- What is needed from owner: a plan/target for a 3rd and 4th printer per
  category before launch. No code needed.
- Blocks: nothing in code; the credibility of reroute (queue 19) and printer
  removal at launch.

### P5 · Design ownership
- Raised: 2026-09-28 · data model §9 item 5
- Why: when a buyer's design on the own store becomes a merchant's product on
  a connected store, who owns it and who may reuse it.
- What is needed from owner: the ownership/reuse rule (a sentence is enough).
- Blocks: queue 33 (Shopify adapter, v1.1).

### P6 · Stripe wallet top-ups were built while money was "blocked"
- Raised: 2026-09-28 · recon (`src/lib/payments/`, commit "Add Stripe
  test-mode wallet top-ups"); CLAUDE.md build order step 5; PRE-PRODUCTION 7
- Why: CLAUDE.md says the money phase is blocked until P1 is answered, but a
  Stripe (test-mode) rail for store owners to pre-fund their wallet exists.
  It never touches buyer money, so it may be fine — but it was not an explicit
  ruling. It is test-mode only; nothing is live.
- What is needed from owner: confirm the store-owner wallet top-up (via
  Stripe, test mode for now) is allowed to stay, or say it must be removed /
  swapped for the P1 gateway.
- Blocks: going live with top-ups; queue 31. The builder will not extend the
  Stripe rail until this is answered.

### P7 · The flat 30% markup
- Raised: 2026-09-28 · recon (`src/lib/billing.ts` `MERCHANT_MARKUP_PCT = 0.3`)
- Why: every order charges the store owner wholesale × 1.30. The data model
  describes a stacked price (base + add-ons + shipping + branding + VAT +
  spread), not a flat percentage. 30% was a placeholder.
- What is needed from owner: keep 30% flat for the pilot, or give the rule.
- Blocks: queue 30.

### P8 · Wallet going negative
- Raised: 2026-09-28 · recon (`src/lib/billing.ts`)
- Why: orders are recorded against the store owner's wallet even when the
  balance is zero, so the balance becomes "what they owe". The Printful model
  is prepaid (no balance, no order).
- What is needed from owner: prepaid only (block or hold orders when the
  balance is short) or allow a running debt (with a limit?).
- Blocks: queue 31.

### P9 · Printers that have not accepted the 30% holdback
- Raised: 2026-09-28 · recon (`src/lib/printer-hold.ts` ignores
  `Printer.accepts_bulk_holdback`); data model §5b
- Why: the 70/30 hold is applied to every bulk fulfillment, even for a
  printer whose `accepts_bulk_holdback` is false.
- What is needed from owner: should such printers be excluded from bulk
  orders in routing, or is the flag informational only?
- Blocks: nothing now (current behaviour: hold always applies on bulk, which
  is the safer side). Queue 18 builds around it.

### P10 · Stale "dual-clock" wording in the data model
- Raised: 2026-09-28 · data model §10 step 6 says "Delivery, dual-clock
  confirmation, defect/exception handling"
- Why: Clock A was removed (§4, §9, CLAUDE.md). Only the defect-claim window
  remains. The builder follows CLAUDE.md and builds no second clock, but will
  not edit the source-of-truth doc without the owner.
- What is needed from owner: OK to change that line to "Delivery
  confirmation (proof of delivery + 30-day claim window), defect/exception
  handling".
- Blocks: nothing.

### P11 · The two real printers
- Raised: 2026-09-28 · CLAUDE.md build order step 2 ("seed the two real
  printers"); recon (only `TEST` printers are seeded)
- Why: real supplier names, costs and capabilities should not be committed to
  the repository (charter rule 16). They belong in the production database,
  entered through the ops printer screens (queue 22, 22b).
- What is needed from owner: confirm real printers will be entered through the
  ops screens (not the seed), and supply their details when those screens
  exist.
- Blocks: nothing in code; going live.

### P12 · Product photos for mockups
- Raised: 2026-09-28 · queue 14
- Why: mockups need a blank-product photo per product type/colour and the
  print-area position on it.
- What is needed from owner: product photos (or permission to use a named
  stock source). The builder uses labelled placeholders until then.
- Blocks: mockup quality at launch; not the code.

### P13 · Go-live settings only the owner can make
- Raised: 2026-09-28 · PRE-PRODUCTION 2, 3, 4, 7
- Why: these are secrets and live-account settings the builder must never
  touch (charter rule 7).
- What is needed from owner (at go-live): fresh production
  `BETTER_AUTH_SECRET`; `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` = the real
  domain; confirm no `*@pod.local` users in production; live Stripe key +
  registered webhook + AED enabled (only if P6 says top-ups stay);
  `BLOB_READ_WRITE_TOKEN` in Vercel.
- Blocks: production launch. Code parts are queue 25 and 26.

### P14 · Setup needed before the routine can run
- Raised: 2026-09-28 · this foundation PR
- Why: in the session that created these files, (a) pushing to GitHub was
  refused (403: the Claude GitHub App lacked write access to
  `nrashidk/pod-platform`), and (b) the network policy blocked
  `binaries.prisma.sh`, so Prisma could not install and nothing could be
  built or tested locally.
- What is needed from owner: give the Claude GitHub App write access to the
  repo; allow `binaries.prisma.sh`, the npm registry and Google Fonts in the
  routine's environment network settings (see `routine.md` §1).
- Blocks: the POD builder routine doing any work.

### P15 · Printer contracts in writing
- Raised: 2026-09-28 · data model §5b "Contract must state"
- Why: the 70/30 hold, first-article rule, netting and removal only work if
  each printer has signed them. `Printer.contract_signed` exists but nothing
  enforces it.
- What is needed from owner: signed contracts; and whether routing should
  refuse printers with `contract_signed = false` (recommended).
- Blocks: nothing now; going live.

### P16 · Arabic copy review
- Raised: 2026-09-28 · charter rule 9
- Why: the builder writes Arabic labels itself; they are marked
  "machine-drafted" in each PR.
- What is needed from owner: an Arabic speaker to review UI copy before launch.
- Blocks: launch polish only.

## Resolved

(none yet)

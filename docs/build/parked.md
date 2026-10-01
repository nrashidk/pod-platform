# POD Builder — Parked

Questions only the owner can answer. The builder builds around them and never
guesses. Pre-launch owner actions (things to do before going live, not
questions) belong in `PRE-PRODUCTION.md`, not here. When the owner answers,
the answer is recorded as an owner ruling in `decisions.md` (binding via
`charter.md` §5), the entry moves to "Resolved", and the queue items it
blocked become `todo`.

Format:

```
### P<n> · <short title>
- Raised: YYYY-MM-DD · source
- Why: …
- What is needed from owner: …
- Blocks: …
```

## Open

### P18-a · Retire legacy order approval states
- Raised: 2026-10-01 · owner ruling P18
- Why: `OrderStatus.AWAITING_APPROVAL` / `APPROVED` no longer match the model (approval is a product-creation step). Removing enum values touches existing data (charter rule 12); harmless meanwhile.
- What is needed from owner: OK to retire them via a `needs-human` migration (or keep as dead values).
- Blocks: nothing.

### P4 · Printer count per product category
- Raised: 2026-09-28 · data model §5b, §9 item 4
- Why: with two printers, rerouting and "remove a bad printer" have no teeth.
- What is needed from owner: a plan/target for a 3rd and 4th printer per
  category before launch. No code needed.
- Blocks: nothing in code. Also listed as a pre-launch business action in
  `PRE-PRODUCTION.md`. The only 28 Sep 2026 question left without a ruling.

## Resolved

All resolved by the owner rulings of 28 Sep 2026 (P17 in the follow-up) — full text in
`docs/build/decisions.md` ("Owner rulings"). Pre-launch owner actions that
came out of them now live in `PRE-PRODUCTION.md`, not here.

| Parked | Topic | Outcome |
|---|---|---|
| P1 | Licence + gateway | Build Stripe test-mode only; licence/gateway = go-live gate → PRE-PRODUCTION 5 |
| P2 | Split shipping | One blended rate |
| P17 | Blended rate for every multi-parcel cause | Yes — always one blended rate per order, never per-parcel; data model §7 updated |
| P3 | Routing weights | Three-tier routing → queue 6, 32 |
| P5 | Design ownership | Merchant-scoped in code (already so); T&C → PRE-PRODUCTION 11 |
| P6 | Stripe top-ups | Keep, test mode, behind seam |
| P7 | Flat 30% | Keep; stacked pricing deferred |
| P8 | Negative wallets | Allow debt; add `credit_limit` → queue 31 |
| P9 | Holdback refusers | Excluded from bulk routing → queue 34 |
| P10 | "Dual-clock" wording | Data model §10 step 6 updated |
| P11 | Real printers | Via ops screens only → PRE-PRODUCTION 9 |
| P12 | Product photos | Placeholders now; real photos → PRE-PRODUCTION 10 |
| P13 | Go-live secrets | Owner at launch → PRE-PRODUCTION 2, 3, 4, 7, 8 |
| P14 | Routine access | Resolved (write access + network allow-list) |
| P15 | Printer contracts | `contract_signed` required for routing → queue 35; signing → PRE-PRODUCTION 12 |
| P16 | Arabic review | Owner pre-launch → PRE-PRODUCTION 13 |

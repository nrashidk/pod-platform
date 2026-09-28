# CLAUDE.md — Working instructions for this repo

## What this project is
A UAE/GCC print-on-demand orchestrator built on the Printful model. The platform
never produces or holds buyer funds — it routes orders to independent printers who
blind-ship under the store's brand. Margin = markup charged to the store owner over
the printer's wholesale cost.

## Source of truth
- `/docs/pod-platform-data-model.md` — the full model: money flow, order lifecycle,
  routing, defect/protection rules. **Read this before building anything.**
- `/docs/schema-foundation.prisma` — the catalog + capability-matrix schema (build
  step 1). `/docs/schema-orders.prisma` — the order/fulfillment layer spec.
  `prisma/schema.prisma` is the live schema built from both.
If anything you're about to build contradicts these docs, STOP — don't improvise
around them. Interactive sessions ask; autonomous runs park it
(`docs/build/parked.md`) and move on.

## How work happens here
- **Autonomous builder runs** (the "POD builder" routine) follow
  `docs/build/charter.md` and **never ask questions**. They take the next item
  from `docs/build/queue.md`, log judgement calls in `docs/build/decisions.md`,
  and park anything that needs the owner in `docs/build/parked.md`. The
  routine's full instructions are in `docs/build/routine.md`.
- **Interactive owner sessions** may still work step by step: do the single
  task asked, confirm before moving to a new phase or widening scope, and ask
  before installing dependencies, changing config, or doing anything
  destructive. Record any ruling the owner gives in `docs/build/decisions.md`
  ("Owner rulings") and summarise it in `charter.md` §5.
- Either way: small, reviewable PRs; never push to `main`; tests run against a
  local Postgres only, never Neon.

## Hard technical constraints
- **Bilingual EN/AR with full RTL support is mandatory** across every UI. Every
  human-facing label has `_en` and `_ar`. This is not optional and not a later phase.
- Stack: Next.js + Prisma + PostgreSQL (Neon). Deploy target: Vercel.
- Browser-only workflow (Codespaces). No assumptions about a local machine.

## Build order (from docs §10 — do not skip ahead)
Live status and the split into PR-sized items: `docs/build/queue.md`.
1. Scaffold Next.js + Prisma + Neon connection (skeleton only).
2. Apply the foundation schema; run first migration; seed TEST printers only
   (real printers are entered via ops screens, never committed — owner ruling P11).
3. Verify capability-matrix queries: given a product + method, return eligible printers.
4. (Next, once specced) Order → Fulfillment → Shipment layer + routing engine.
5. Money/checkout — may be built in **Stripe TEST MODE ONLY**, behind the
   provider seam; no live-key path. The UAE licence + final gateway are a
   go-live gate, not a build gate (owner ruling P1, `docs/build/decisions.md`).

## Money model reminders (so you don't reintroduce removed ideas)
- Platform NEVER holds buyer funds (no escrow). Buyer pays the store's gateway.
- Printers are paid BY the platform (downstream); they never pay the platform.
- Quality is protected by: locked print file + spec validation, mandatory
  first-article approval on bulk, and a 70/30 retention on bulk orders
  (Fulfillment ≥ AED 1,000), released only on delivery + closed claim window.
- Do NOT add a buyer payment-release/validation timer ("Clock A") — it was
  deliberately removed.

## When unsure
Don't guess on architecture, money flow, or anything that contradicts `/docs`.
Interactive sessions: ask a short, specific question. Autonomous runs: follow
`docs/build/charter.md` §3 (take the documented default, log it in
`decisions.md`, or park it).

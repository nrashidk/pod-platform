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
  step 1). The order/fulfillment layer is not yet specced.
If anything you're about to build contradicts these docs, STOP and ask — don't
improvise around them.

## How to work with me (non-negotiable)
- **One step at a time.** Do the single task asked, then stop and confirm before
  moving to the next. Do NOT scaffold the whole system in one shot.
- **Confirm before proceeding** to any new phase or any change that touches more than
  the current task.
- **Ask before installing dependencies, changing config, or creating files** outside
  the immediate task.
- Show me what you're about to do before doing anything destructive or wide-reaching.
- Prefer small, reviewable changes over large ones.

## Hard technical constraints
- **Bilingual EN/AR with full RTL support is mandatory** across every UI. Every
  human-facing label has `_en` and `_ar`. This is not optional and not a later phase.
- Stack: Next.js + Prisma + PostgreSQL (Neon). Deploy target: Vercel.
- Browser-only workflow (Codespaces). No assumptions about a local machine.

## Build order (from docs §10 — do not skip ahead)
1. Scaffold Next.js + Prisma + Neon connection (skeleton only).
2. Apply the foundation schema; run first migration; seed the two real printers.
3. Verify capability-matrix queries: given a product + method, return eligible printers.
4. (Next, once specced) Order → Fulfillment → Shipment layer + routing engine.
5. Money/checkout — **BLOCKED until the UAE license/gateway question is resolved.**
   Do not build the payment phase until I confirm the entity and gateway.

## Money model reminders (so you don't reintroduce removed ideas)
- Platform NEVER holds buyer funds (no escrow). Buyer pays the store's gateway.
- Printers are paid BY the platform (downstream); they never pay the platform.
- Quality is protected by: locked print file + spec validation, mandatory
  first-article approval on bulk, and a 70/30 retention on bulk orders
  (Fulfillment ≥ AED 1,000), released only on delivery + closed claim window.
- Do NOT add a buyer payment-release/validation timer ("Clock A") — it was
  deliberately removed.

## When unsure
Ask a short, specific question. Don't guess on architecture, money flow, or anything
that contradicts `/docs`.

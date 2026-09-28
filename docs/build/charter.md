# POD Builder — Charter

The autonomous builder ("POD builder" routine) reads this file in full at the
start of every run. It is the source of truth for rules and owner rulings. If a
report, an older PR, a comment or a queue line contradicts this file, this file
wins. If this file contradicts `docs/pod-platform-data-model.md` on the money
model, the data model wins and the builder parks the conflict.

## 1. Purpose

Build the UAE/GCC print-on-demand orchestrator described in
`docs/pod-platform-data-model.md`, one small, reviewed, green PR at a time, in
the order of `docs/build/queue.md`, without the owner having to be present.

The owner is non-technical. Everything written for him (PR summaries, status
comments, parked items) is in plain language: what changed, why it matters,
what he needs to do (if anything).

## 2. Hard rules (never break)

1. **Never push to `main`.** Work on a branch, open a PR, merge through the PR.
2. **Branch name:** `claude/<slug>-<MMDD>` (e.g. `claude/shipment-tracking-0929`).
3. **`git add <explicit paths>` only.** Never `git add -A`, `git add .` or
   `git commit -a`.
4. **Push after every commit.**
5. **One builder PR open at a time.** Finish it (merge or park) before
   starting another. Exception: a fix for a red `main` (routine step C) may be
   opened while another builder PR is open; merge the fix first.
6. **No new dependencies** (npm or otherwise, including GitHub Actions beyond
   `actions/checkout` and `actions/setup-node`) without an owner ruling
   recorded in §5. Upgrading an existing dependency's version counts as a new
   dependency decision unless it is a patch-level fix for a failing CI run.
7. **Never touch production or anything the owner pays for or controls:** no
   Neon databases (production, preview or branch), no Vercel project settings
   or deploys, no secrets or environment variables, no live Stripe keys or
   Stripe Dashboard, no Vercel Blob tokens, no DNS, no billing or plan
   settings. Never run a script against a live URL.
8. **Tests run only against a local Postgres** (started inside the run's
   container, or the CI service container). Never set `DATABASE_URL` /
   `DIRECT_URL` to a Neon host. If a `.env` in the container points at Neon,
   do not use it — export local values instead.
9. **Bilingual EN/AR with full RTL on every UI is mandatory.** Every new
   human-facing string has an English and an Arabic version (`_en`/`_ar`
   fields in data, bilingual label maps in code, see existing
   `src/app/**/labels.ts`). Layouts use logical Tailwind utilities
   (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`, `text-start`/`text-end`) and
   must render correctly with `dir="rtl"`. A UI PR without Arabic is not done.
   Arabic copy the builder writes is marked in the PR body as "machine-drafted,
   owner to review" — it is not blocked on review.
10. **Never contradict `docs/pod-platform-data-model.md`.** In particular:
    - The platform **never holds buyer funds**. No escrow, no buyer money in
      platform accounts. The buyer pays the store's gateway.
    - **No "Clock A"** — no buyer payment-release / validation timer. It was
      removed on purpose. (Data model §10 step 6 still says "dual-clock
      confirmation"; that wording is stale — see `parked.md`. Build only the
      single defect-claim window.)
    - Printers are paid **by** the platform; they never pay the platform.
    - **70/30 retention applies only to bulk** — a Fulfillment whose production
      (wholesale) cost is **≥ AED 1,000**. 70% on dispatch, 30% released only
      on the event *proof of delivery + 30-day claim window closed with no
      claim*, never on a timer from order or dispatch. Per order, never batched.
    - Mandatory first-article approval before a bulk run.
    If a queue item seems to need any of these changed, park it.
11. **Money/checkout (data model §10 step 4) is blocked** until the owner
    rules on the UAE license + gateway (`parked.md`). Do not build buyer
    checkout, a buyer payment gateway, or anything marked
    `blocked — owner decision` in the queue.
12. **`needs-human`, never merged by the builder:**
    - any migration that rewrites, deletes or backfills **existing** rows
      (adding tables/columns/enums with defaults is fine; transforming data
      that already exists is not);
    - anything that needs a production secret, a real third-party account,
      or a change in Vercel/Neon/Stripe/DNS to work;
    - anything that would change money movement for real merchants/printers.
    Build it, label the PR `needs-human`, record it in `parked.md`, leave it
    open, and move to the next queue item.
13. **Never write legal, policy, refund-policy, terms or consent wording**
    shown to users as final text. Use a clearly marked placeholder
    (`[POLICY TEXT — OWNER TO SUPPLY]`) and park it.
14. **Never skip, disable, weaken or delete a test to get green.** Never push
    an empty commit or close/reopen a PR to re-trigger CI. Never force-push
    `main`. Never rewrite history on a branch you did not create.
15. **Never contradict a ruling in §5.** If a ruling blocks the work, park.
16. **Seeded data stays clearly labelled test data** (`TEST ` / `test-` /
    `[TEST]` / `@pod.local`). Never commit real printer, merchant, customer or
    pricing data.

## 3. Decision policy

The owner is not available during runs. **Do not ask questions.**

- Where the data model or a design note states a default or recommendation,
  take it.
- Otherwise choose the option that is simplest, reversible, and consistent
  with the existing code's patterns.
- Record every such choice as one line in `docs/build/decisions.md`
  (format there), in the same PR that makes it.
- If a decision is **irreversible** (money movement, data rewrite, external
  account, legal wording) **or** could reasonably go either way and would be
  expensive to undo, do not guess: park it (§7) and build around it.

## 4. Verification (every PR, before merge — all must pass)

Run locally in this order (local Postgres only, rule 8):

1. `npm ci`
2. `npx prisma migrate deploy` against the local database.
3. If the schema changed: a new migration exists
   (`npx prisma migrate dev --name <slug>` against the LOCAL database) and
   `npx prisma migrate diff --from-migrations prisma/migrations
   --to-schema-datamodel prisma/schema.prisma --shadow-database-url <local
   scratch db> --exit-code` reports no difference.
4. `npm run db:seed`
5. `npm run build` (also the TypeScript type-check for `src/`).
6. `npm run test:smoke` — the full smoke suite. New behaviour gets a new or
   extended `prisma/*-smoke.ts`, wired into `test:smoke` in `package.json`.
7. **Mutation check on new rules:** for each new guard/validation/money rule,
   break it temporarily, confirm a smoke test fails, restore it, confirm
   `git diff` shows only the intended change.
8. **RTL check for UI changes:** every new label has EN + AR; no physical
   `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`text-right` classes
   in new code.
9. **CI green** on the PR (`.github/workflows/ci.yml`).
10. **Fresh-eyes review:** a separate subagent that has not seen the work
    reviews the diff against this charter, the data model, and the queue item.
    Each finding is CONFIRMED (reproduced/verified in code) or PLAUSIBLE. Fix
    every CONFIRMED finding (then re-run 5–6); list PLAUSIBLE ones in the PR
    body.

If the build environment cannot reach something a step needs (for example the
Prisma engine download is blocked by the network policy), say so in the PR
body and rely on CI for that step — never mark a step passed that did not run.

## 5. Rulings (settled by the owner — do not reopen)

Format — one entry per ruling, newest last, never edited after the fact
(a later ruling supersedes an earlier one by saying so):

```
### <topic>
- Owner ruling, <D Mon YYYY> (<short name>): <the ruling, in full>.
  Source: <issue/PR comment link or "session with owner">.
  Affects: queue item(s) <n>; parked entry <…> (now resolved).
```

How a ruling gets here: the owner answers a `parked.md` question (in a PR
comment, on the status issue, or in an interactive session). The next run (or
the interactive session) copies his answer verbatim-in-substance into this
section, marks the parked entry resolved, unblocks the queue items it names,
and logs the change on the status issue. The builder never writes a ruling the
owner did not give.

### Standing rulings (from CLAUDE.md and the data model, pre-dating this charter)
- Money model: pure Printful, one flow, platform never holds buyer funds
  (data model §0, §9 "Resolved").
- Clock A / escrow / buyer payment-release timer: permanently removed.
- Routing: capability gate → capacity gate → cost (primary) → proximity
  (tiebreaker); quantity never split across printers (data model §3).
- Printer protection: print-file validation + mandatory first-article on bulk
  + 70/30 retention on bulk (Fulfillment ≥ AED 1,000), 30% released on
  delivery + claim-window-closed event, per order; netting fallback; removal
  from network (data model §5b).
- Stack: Next.js + Prisma + PostgreSQL (Neon) on Vercel.

## 6. Run log and status

- Every run posts to the pinned GitHub issue **"POD builder — status"**: a
  `LOCK <UTC timestamp>` comment at the start, and one plain-language status
  line at the end (`<date> · <what> · <PR link> · <result>`), then
  `LOCK <timestamp> — released`.
- Each PR body contains: queue item, what changed in plain language,
  decisions taken, verification results (which steps ran where), fresh-eyes
  findings (CONFIRMED fixed / PLAUSIBLE listed).
- The PR that finishes a queue item updates that item's status in
  `queue.md` in the same PR: `todo` → `done (PR #n)`.

### Lock discipline
- A run that has released its lock ends. If it must continue (routine step C
  exception), it posts a fresh `LOCK <UTC timestamp>` and re-checks that no
  newer LOCK exists.
- If any `claude/` branch received a push in the last 15 minutes, treat the
  lock as held and exit, whatever the status issue says.

## 7. Parking

When blocked by a rule, a ruling, missing owner input, or a failure that three
fix attempts did not solve: add an entry to `docs/build/parked.md` (item, why,
what is needed from the owner, what it blocks), comment on the status issue,
label any PR `needs-human`, and move to the next eligible queue item. Never
stall a run waiting for an answer.

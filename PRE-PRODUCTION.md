# Pre-Production Checklist

Security and configuration items that **must** be addressed before this platform
goes live. These are deliberately tracked here so they are not forgotten when
moving from development/Codespaces to a production deployment.

> Do not deploy to production until every item below is resolved.

## Security & Authentication

### 1. Gate `trustedOrigins` behind non-production and add the real domain
`src/lib/auth.ts` currently trusts dev origins — `http://localhost:3000`,
`http://127.0.0.1:3000`, and the Codespaces forwarded HTTPS origin —
**unconditionally**, for every environment including production. These are CSRF
protections; trusting localhost/127.0.0.1 in production weakens them.

- [ ] Only include the dev/127.0.0.1/Codespaces origins when
      `NODE_ENV !== "production"`.
- [ ] Add the real production domain to `trustedOrigins` for production builds.

### 2. Fresh `BETTER_AUTH_SECRET` for production
The development `BETTER_AUTH_SECRET` must never be reused in production.

- [ ] Generate a fresh, high-entropy `BETTER_AUTH_SECRET` for production.
- [ ] Store it in the production secret manager (e.g. Vercel env vars), never in
      the repo or `.env.example`.

### 3. Set the real `BETTER_AUTH_URL`
- [ ] Set `BETTER_AUTH_URL` to the production origin (the public HTTPS domain),
      not a dev/localhost/Codespaces URL.

### 4. Remove / never seed dev test users
The development seed creates back-office test users under the `*@pod.local`
domain with the password `PodPass2026!`. These accounts must **never** exist in
a production database.

- [ ] Ensure no `*@pod.local` accounts exist in the production database.
- [ ] Do not run the dev auth seed against production.
- [ ] Rotate the dev password if it was ever shared beyond the team.

## Business & Compliance

### 5. UAE business license / entity + final payment gateway — GO-LIVE gate
Owner ruling 28 Sep 2026 (P1, `docs/build/decisions.md`): this is a **go-live
gate, not a build gate**. The build — including checkout — uses **Stripe in
test mode only**, behind the provider seam (`src/lib/payments/index.ts`); there
is no live-key path in the code. The platform never holds buyer funds — the
buyer pays the store's gateway.

- [ ] Confirm the UAE business license / entity.
- [ ] Confirm the final payment gateway (keep Stripe, or swap the provider at
      the `src/lib/payments/index.ts` seam).
- [ ] Only then put any checkout or top-up rail into live mode (item 7).

### 7. Stripe wallet top-ups — go live (keys + webhook registration)
The merchant→platform wallet top-up rail (`src/lib/payments/`) ships in **test
mode**. Before launch it must be switched to live mode. This is the money-in
rail (merchants funding their own prepaid wallet); it does **not** touch the
buyer→store gateway. Kept by owner ruling P6 (28 Sep 2026); live mode only
after item 5.

- [ ] Replace the test `STRIPE_SECRET_KEY` (`sk_test_…`) with the live key
      (`sk_live_…`) in the production secret manager — never in the repo.
- [ ] Register the production webhook endpoint in the Stripe Dashboard pointing
      at `https://<prod-domain>/api/webhooks/stripe`, subscribed to
      `checkout.session.completed`, and put its signing secret in
      `STRIPE_WEBHOOK_SECRET` (`whsec_…`). The webhook is the ONLY thing that
      credits a wallet, so an unregistered/misconfigured endpoint means top-ups
      silently never credit.
- [ ] Set `NEXT_PUBLIC_APP_URL` to the production HTTPS origin (used to build
      Checkout success/cancel return URLs).
- [ ] Confirm **AED** is enabled on the live Stripe account.
- [ ] Confirm this rail is permitted under the resolved UAE entity/gateway
      decision (item 5) — or swap `StripeProvider` for the chosen UAE gateway at
      the `src/lib/payments/index.ts` seam.

### 8. Vercel Blob token for print files
- [ ] Create the production Blob store and set `BLOB_READ_WRITE_TOKEN` in the
      Vercel production environment (never in the repo). Tests use an
      in-memory stub and never need it.

## Content, Contracts & Operations

Owner actions before launch that came out of the 28 Sep 2026 rulings
(`docs/build/decisions.md`). None of them block the build.

### 9. Enter the real printers through the ops screens (P11)
- [ ] Enter each real printer (and its capabilities and prices) in production
      through the ops printer screens. **Never** commit real printer data to
      the repository or the seed.

### 10. Real product photos (P12)
- [ ] Supply real product photos for mockups, to replace the clearly-labelled
      `[PLACEHOLDER]` images the build uses.

### 11. Terms & conditions — design ownership (P5)
- [ ] Write the T&C wording for who owns / may reuse a buyer's design when it
      becomes a merchant's product. The code already keeps designs
      merchant-scoped with no cross-merchant sharing.

### 12. Signed printer contracts (P15)
- [ ] Sign a contract with each printer covering the data model §5b terms
      (defect = printer's cost, 70/30 holdback on bulk, netting, first-article
      approval, removal from network).
- [ ] Mark `contract_signed` (and `accepts_bulk_holdback` where agreed) on the
      printer in the ops screens — routing ignores unsigned printers, and
      printers that refuse the holdback get no bulk work.

### 13. Arabic copy review (P16)
- [ ] Have an Arabic speaker review all Arabic UI copy (the builder's Arabic is
      marked "machine-drafted" in each PR).

### 14. Printer count per product category (P4 — RESOLVED, no gate)
- No minimum-printer gate: a category goes live at ≥1 capable printer (owner
  ruling, 30 Sep 2026). Depth grows as printers are onboarded.
- [ ] Decide whether to fund the §5b self-insurance reserve (~2–4%) — the only
      recovery backstop for an unrecoverable single-printer defect.

### 15. The blended shipping rate (P2)
- [ ] Set the real blended shipping rate. The build ships with one
      configurable placeholder constant (queue item 29).

## Build & Deployment

### 6. `npm run build` fails at type-check on `prisma/*-smoke.ts` — RESOLVED
`npm run build` previously failed at the type-check step on `prisma/*-smoke.ts`
because those `.ts`-extension test scripts were pulled into tsconfig's build
scope. Vercel runs `npm run build`, so deploy would have failed until resolved.

- [x] Fixed — `prisma/**/*.ts` is now excluded in `tsconfig.json`, so the
      loader-run test/seed scripts no longer enter the production type-check
      pass. The scripts still run via the `npm run test:*` Node loader (the
      `--experimental-loader` runtime ignores tsconfig include/exclude), so
      `npm run test:smoke` is unaffected. Verified: `npm run build` succeeds and
      `npm run test:smoke` passes.

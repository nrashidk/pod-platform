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

### 5. Resolve UAE business license / payment gateway before checkout
Per the project constraints, the money/checkout phase is **blocked** until the
UAE entity and payment gateway question is resolved. The platform never holds
buyer funds — the buyer pays the store's gateway — so the correct legal entity
and gateway must be confirmed before any checkout flow ships.

- [ ] Confirm the UAE business license / entity.
- [ ] Confirm the payment gateway.
- [ ] Only then build and enable the checkout/payment phase.

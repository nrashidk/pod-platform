# POD Platform

UAE/GCC print-on-demand orchestrator (Printful-model). See [`docs/`](./docs) for
the v1 data model spec and the build-step-1 foundation schema.

## Stack

- **Next.js** (App Router, TypeScript)
- **Tailwind CSS** — RTL-ready (built-in `rtl:`/`ltr:` variants + logical-property utilities)
- **Prisma** ORM
- **Neon** PostgreSQL (serverless)

> This repository is currently a **skeleton** — Prisma is wired to Neon, Tailwind
> and a locale-driven layout are in place, but the schema has no models and there
> are no application features. Models begin with build step 1
> (`docs/schema-foundation.prisma`).

## Bilingual EN/AR (day-one constraint)

Per the data model, bilingual EN/AR with RTL is non-negotiable. The skeleton sets
up the seam:

- `src/lib/i18n.ts` — `locales`, `defaultLocale`, `getDirection(locale)`.
- `src/app/layout.tsx` — drives `<html lang dir>` from the locale.
- Tailwind — use logical utilities (`ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
  `text-start`/`text-end`) and `rtl:`/`ltr:` variants so both directions render
  correctly. Locale *resolution* (middleware / `[locale]` segment) is a later step.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a Neon project and copy the connection strings into `.env`:
   ```bash
   cp .env.example .env
   # then fill in DATABASE_URL (pooled) and DIRECT_URL (direct)
   ```
3. Generate the Prisma client:
   ```bash
   npm run db:generate
   ```
4. Run the dev server:
   ```bash
   npm run dev
   ```

## Scripts

| Script                | Purpose                              |
| --------------------- | ------------------------------------ |
| `npm run dev`         | Start the Next.js dev server         |
| `npm run build`       | Production build                     |
| `npm run start`       | Serve the production build           |
| `npm run db:generate` | Generate the Prisma client           |
| `npm run db:migrate`  | Create/apply a dev migration         |
| `npm run db:deploy`   | Apply migrations (CI/production)     |
| `npm run db:studio`   | Open Prisma Studio                   |

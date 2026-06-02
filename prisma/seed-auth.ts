// ─────────────────────────────────────────────────────────────
// BACK-OFFICE AUTH SEED — one test user per role (OPERATOR / MERCHANT /
// PRINTER). Passwords are hashed with Better Auth's OWN hasher
// (ctx.password.hash) and stored on a "credential" Account exactly as a real
// sign-up would, so these users authenticate through the normal login path.
//
// RUN ORDER (dependencies):
//   1. npm run db:seed       → product types + TEST printers (TEST Apparel Co)
//   2. npm run db:seed:ops   → the DEMO Merchant (ops-demo@demo.local)
//   3. npm run db:seed:auth  → THIS seed (links MERCHANT→DEMO Merchant,
//                              PRINTER→TEST Apparel Co)
// If a linked record is missing this seed fails LOUDLY with the exact command
// to run — never a cryptic FK error.
//
// Re-run note: User→Merchant/Printer is onDelete: Restrict, so re-running an
// upstream seed that deletes a linked record fails while an auth user points at
// it:
//   • db:seed      deletes TEST printers (incl. TEST Apparel Co → PRINTER user)
//   • db:seed:ops  deletes+recreates the DEMO Merchant (→ MERCHANT user)
// This seed deletes its OWN users first, so the fix is always: run db:seed:auth
// LAST. To re-run an upstream seed, first remove the auth users (re-running this
// seed afterwards re-links them cleanly). test:smoke is unaffected — no smoke
// deletes TEST Apparel Co or the DEMO Merchant.
// ─────────────────────────────────────────────────────────────
import { auth } from "../src/lib/auth.ts";
import { prisma } from "../src/lib/prisma.ts";

// Shared dev password for all three test users. Meets Better Auth's default
// minimum length (8). NOT for any non-dev environment.
const PASSWORD = "PodPass2026!";

const DEMO_MERCHANT_EMAIL = "ops-demo@demo.local";
const TEST_PRINTER_NAME = "TEST Apparel Co";

const USERS = [
  { email: "operator@pod.local", name: "Test Operator", role: "OPERATOR" as const },
  { email: "merchant@pod.local", name: "Test Merchant", role: "MERCHANT" as const },
  { email: "printer@pod.local", name: "Test Printer", role: "PRINTER" as const },
];

async function main() {
  console.log("⚠️  Seeding BACK-OFFICE AUTH users (operator/merchant/printer).\n");

  // Resolve the linked records FIRST, with actionable errors.
  const demoMerchant = await prisma.merchant.findUnique({
    where: { email: DEMO_MERCHANT_EMAIL },
  });
  if (!demoMerchant) {
    throw new Error(
      `Cannot seed the MERCHANT user: no Merchant with email "${DEMO_MERCHANT_EMAIL}".\n` +
        "→ Run `npm run db:seed:ops` first (it creates the DEMO Merchant)."
    );
  }
  const testPrinter = await prisma.printer.findFirst({
    where: { name: TEST_PRINTER_NAME },
  });
  if (!testPrinter) {
    throw new Error(
      `Cannot seed the PRINTER user: no Printer named "${TEST_PRINTER_NAME}".\n` +
        "→ Run `npm run db:seed` first (it creates the TEST printers)."
    );
  }

  // Idempotent: remove our own users first (Account/Session cascade off User).
  // Deleting the User (the child of the Merchant/Printer FK) is safe under the
  // onDelete: Restrict relation — we never delete the linked records here.
  await prisma.user.deleteMany({
    where: { email: { in: USERS.map((u) => u.email) } },
  });

  // Better Auth context → its password hasher (matches the sign-in verifier).
  const ctx = await auth.$context;

  for (const u of USERS) {
    const merchantId = u.role === "MERCHANT" ? demoMerchant.id : null;
    const printerId = u.role === "PRINTER" ? testPrinter.id : null;

    const user = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        emailVerified: true,
        role: u.role,
        merchantId,
        printerId,
      },
    });

    const hash = await ctx.password.hash(PASSWORD);
    await prisma.account.create({
      data: {
        userId: user.id,
        accountId: user.id, // Better Auth's convention for credential accounts
        providerId: "credential",
        password: hash,
      },
    });

    const link =
      u.role === "MERCHANT"
        ? ` → Merchant "${demoMerchant.name}"`
        : u.role === "PRINTER"
          ? ` → Printer "${testPrinter.name}"`
          : " (no link)";
    console.log(`  ✓ ${u.role.padEnd(8)} ${u.email}${link}`);
  }

  console.log(
    `\nDone. Sign in at /login with any of the above and password: ${PASSWORD}`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("\n✖ Auth seed failed:\n" + (e?.message ?? e) + "\n");
  await prisma.$disconnect();
  process.exit(1);
});

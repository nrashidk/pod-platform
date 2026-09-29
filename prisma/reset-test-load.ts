// Test-suite hygiene (queue 5): smoke tests delete their orders directly, which
// bypasses the load release, so seeded TEST printers would slowly fill up.
// Zero their load between tests. Touches only printers named "TEST …".
// Run: node --experimental-loader ./prisma/resolve-hook.mjs prisma/reset-test-load.ts
import { prisma } from "../src/lib/prisma.ts";

prisma.printer
  .updateMany({ where: { name: { startsWith: "TEST " } }, data: { current_load_units: 0 } })
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("reset-test-load failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });

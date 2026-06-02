// Throwaway smoke test for findEligiblePrinters against the seed data.
// Read-only. Run: node prisma/routing-smoke.ts
import { findEligiblePrinters } from "../src/lib/routing.ts";
import { prisma } from "../src/lib/prisma.ts";

type Case = {
  label: string;
  slug: string;
  method: Parameters<typeof findEligiblePrinters>[0]["method"];
  quantity: number;
  expect: string;
};

const cases: Case[] = [
  {
    label: "T-Shirt + DTG + 10",
    slug: "test-tshirt",
    method: "DTG",
    quantity: 10,
    expect: "TEST Apparel Co eligible @ 35 ea",
  },
  {
    label: "T-Shirt + EMBROIDERY + 5",
    slug: "test-tshirt",
    method: "EMBROIDERY",
    quantity: 5,
    expect: "TEST Apparel Co eligible @ 55 ea",
  },
  {
    label: "Mug + UV + 20",
    slug: "test-mug",
    method: "UV",
    quantity: 20,
    expect: "TEST HardGoods Co eligible @ 18 ea",
  },
  {
    label: "Business Card + PAPER_PRINT + 100 (meets min_qty 50)",
    slug: "test-business-card",
    method: "PAPER_PRINT",
    quantity: 100,
    expect: "TEST HardGoods Co eligible @ 0.8 ea",
  },
  {
    label: "Business Card + PAPER_PRINT + 10 (BELOW min_qty 50)",
    slug: "test-business-card",
    method: "PAPER_PRINT",
    quantity: 10,
    expect: "EMPTY — capability gate (min_qty) excludes",
  },
  {
    label: "Mug + UV + 1000 (OVER capacity 800)",
    slug: "test-mug",
    method: "UV",
    quantity: 1000,
    expect: "EMPTY — capacity gate excludes",
  },
  {
    label: "T-Shirt + UV (method not offered)",
    slug: "test-tshirt",
    method: "UV",
    quantity: 5,
    expect: "EMPTY — no capability for method",
  },
];

async function main() {
  for (const c of cases) {
    const rows = await findEligiblePrinters({
      slug: c.slug,
      method: c.method,
      quantity: c.quantity,
    });
    console.log(`\n■ ${c.label}`);
    console.log(`  expect: ${c.expect}`);
    if (rows.length === 0) {
      console.log("  result: (no eligible printers)");
    } else {
      rows.forEach((r, i) =>
        console.log(
          `  #${i + 1} ${r.printerName} (${r.emirate}) — ` +
            `${r.effectiveUnitCost} ea × ${r.quantity} = ${r.totalCost}` +
            (r.appliedTierMinQty ? ` [tier ${r.appliedTierMinQty}+]` : "") +
            (r.distanceKm !== null ? ` ~${r.distanceKm.toFixed(0)}km` : "")
        )
      );
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

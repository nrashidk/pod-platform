// Throwaway verification script for the seed. Counts every table and
// inspects the two TEST printers + their capabilities. Safe (read-only).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const counts = {
    ProductType: await prisma.productType.count(),
    PrintArea: await prisma.printArea.count(),
    Product: await prisma.product.count(),
    ProductVariant: await prisma.productVariant.count(),
    Printer: await prisma.printer.count(),
    PrinterCapability: await prisma.printerCapability.count(),
    PricingTier: await prisma.pricingTier.count(),
  };
  console.log("ROW COUNTS:");
  for (const [t, c] of Object.entries(counts)) console.log(`  ${t}: ${c}`);

  const printers = await prisma.printer.findMany({
    where: { name: { startsWith: "TEST " } },
    include: {
      capabilities: {
        include: { productType: { select: { name_en: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  console.log(`\nTEST PRINTERS (${printers.length}):`);
  for (const p of printers) {
    console.log(`  • ${p.name} — ${p.emirate}, ${p.country}`);
    for (const c of p.capabilities) {
      console.log(
        `      ${c.productType.name_en} via ${c.method} @ ${c.unit_wholesale_cost} AED (min_qty ${c.min_qty}, digitization=${c.requires_digitization})`
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

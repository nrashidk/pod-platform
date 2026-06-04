-- Design must carry its product type: validation is keyed on productType +
-- placement (see PrintArea), so each uploaded print file is checked against the
-- matching PrintArea spec.
--
-- The column is required, but the table may already hold rows (dev/demo seed
-- data). Add it nullable, backfill existing rows with an arbitrary existing
-- ProductType, then enforce NOT NULL. Seeds recreate designs with the correct
-- type, so the backfill only keeps pre-existing demo rows valid.

-- AlterTable: add nullable first.
ALTER TABLE "Design" ADD COLUMN "productTypeId" TEXT;

-- Backfill any existing rows with some valid ProductType id.
UPDATE "Design"
SET "productTypeId" = (SELECT "id" FROM "ProductType" ORDER BY "createdAt" ASC LIMIT 1)
WHERE "productTypeId" IS NULL;

-- Enforce NOT NULL now that no nulls remain.
ALTER TABLE "Design" ALTER COLUMN "productTypeId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

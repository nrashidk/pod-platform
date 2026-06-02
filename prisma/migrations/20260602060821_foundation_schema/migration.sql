-- CreateEnum
CREATE TYPE "PrintMethod" AS ENUM ('DTG', 'DTF', 'SUBLIMATION', 'EMBROIDERY', 'UV', 'SCREEN', 'PAPER_PRINT');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('APPAREL', 'DRINKWARE', 'PAPER', 'ACCESSORIES', 'HOME');

-- CreateEnum
CREATE TYPE "PrinterStatus" AS ENUM ('ACTIVE', 'PAUSED', 'REMOVED');

-- CreateEnum
CREATE TYPE "PlacementCode" AS ENUM ('FRONT', 'BACK', 'LEFT_SLEEVE', 'RIGHT_SLEEVE', 'WRAP', 'FULL');

-- CreateTable
CREATE TABLE "ProductType" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrintArea" (
    "id" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "placement" "PlacementCode" NOT NULL,
    "width_mm" DOUBLE PRECISION NOT NULL,
    "height_mm" DOUBLE PRECISION NOT NULL,
    "min_dpi" INTEGER NOT NULL DEFAULT 150,
    "recommended_dpi" INTEGER NOT NULL DEFAULT 300,
    "allowed_formats" TEXT[] DEFAULT ARRAY['PNG', 'JPEG']::TEXT[],
    "color_profile" TEXT NOT NULL DEFAULT 'sRGB',
    "requires_transparency" BOOLEAN NOT NULL DEFAULT false,
    "bleed_mm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "max_file_mb" INTEGER NOT NULL DEFAULT 200,

    CONSTRAINT "PrintArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_ar" TEXT NOT NULL,
    "description_en" TEXT,
    "description_ar" TEXT,
    "retail_price" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Printer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PrinterStatus" NOT NULL DEFAULT 'ACTIVE',
    "emirate" TEXT,
    "country" TEXT NOT NULL DEFAULT 'AE',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "blind_ship_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "return_address" TEXT,
    "contract_signed" BOOLEAN NOT NULL DEFAULT false,
    "accepts_bulk_holdback" BOOLEAN NOT NULL DEFAULT false,
    "daily_capacity_units" INTEGER,
    "current_load_units" INTEGER NOT NULL DEFAULT 0,
    "quality_score" DOUBLE PRECISION,
    "payout_terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Printer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrinterCapability" (
    "id" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "productTypeId" TEXT NOT NULL,
    "method" "PrintMethod" NOT NULL,
    "unit_wholesale_cost" DECIMAL(10,2) NOT NULL,
    "min_qty" INTEGER NOT NULL DEFAULT 1,
    "max_qty" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requires_digitization" BOOLEAN NOT NULL DEFAULT false,
    "spec_override" JSONB,

    CONSTRAINT "PrinterCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingTier" (
    "id" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "min_qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductType_slug_key" ON "ProductType"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PrintArea_productTypeId_placement_key" ON "PrintArea"("productTypeId", "placement");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_sku_key" ON "ProductVariant"("sku");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE INDEX "PrinterCapability_productTypeId_method_active_idx" ON "PrinterCapability"("productTypeId", "method", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PrinterCapability_printerId_productTypeId_method_key" ON "PrinterCapability"("printerId", "productTypeId", "method");

-- CreateIndex
CREATE INDEX "PricingTier_capabilityId_idx" ON "PricingTier"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingTier_capabilityId_min_qty_key" ON "PricingTier"("capabilityId", "min_qty");

-- AddForeignKey
ALTER TABLE "PrintArea" ADD CONSTRAINT "PrintArea_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrinterCapability" ADD CONSTRAINT "PrinterCapability_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrinterCapability" ADD CONSTRAINT "PrinterCapability_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "PrinterCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

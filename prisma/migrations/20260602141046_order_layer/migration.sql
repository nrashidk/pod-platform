-- CreateEnum
CREATE TYPE "OrderOrigination" AS ENUM ('OWN_STORE', 'CONNECTED_STORE');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'AWAITING_APPROVAL', 'APPROVED', 'PAID', 'ROUTED', 'IN_PRODUCTION', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('PENDING_ROUTING', 'ROUTED', 'FIRST_ARTICLE_PENDING', 'FIRST_ARTICLE_APPROVED', 'IN_PRODUCTION', 'DIGITIZING', 'SHIPPED', 'DELIVERED', 'CLOSED', 'REROUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DesignValidationStatus" AS ENUM ('PENDING', 'PASSED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('NONE', 'HELD', 'RELEASED', 'DEDUCTED', 'PARTIALLY_DEDUCTED');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LiabilityParty" AS ENUM ('PRINTER', 'BUYER', 'CARRIER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "StorePlatform" AS ENUM ('OWN', 'SHOPIFY', 'SALLA', 'ZID', 'WOOCOMMERCE');

-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('TOPUP', 'FULFILLMENT_CHARGE', 'REFUND', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "Merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_platform_owner" BOOLEAN NOT NULL DEFAULT false,
    "email" TEXT NOT NULL,
    "vat_trn" TEXT,
    "brand_logo_url" TEXT,
    "packing_slip_message" TEXT,
    "return_address" TEXT,
    "custom_packaging_note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "auto_recharge_enabled" BOOLEAN NOT NULL DEFAULT false,
    "auto_recharge_threshold" DECIMAL(12,2),
    "auto_recharge_amount" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "orderId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreConnection" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "platform" "StorePlatform" NOT NULL,
    "store_name" TEXT NOT NULL,
    "credentials" JSONB,
    "webhook_secret" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Design" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mockup_url" TEXT,
    "mockup_approved_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Design_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DesignPlacement" (
    "id" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "placement" "PlacementCode" NOT NULL,
    "print_file_url" TEXT NOT NULL,
    "validation_status" "DesignValidationStatus" NOT NULL DEFAULT 'PENDING',
    "validation_notes" TEXT,
    "digitized_file_url" TEXT,

    CONSTRAINT "DesignPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "origination" "OrderOrigination" NOT NULL,
    "merchantId" TEXT NOT NULL,
    "storeId" TEXT,
    "external_order_ref" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT,
    "shipping_line1" TEXT NOT NULL,
    "shipping_line2" TEXT,
    "shipping_city" TEXT NOT NULL,
    "shipping_emirate" TEXT,
    "shipping_country" TEXT NOT NULL DEFAULT 'AE',
    "retail_total" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "paid_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "designId" TEXT NOT NULL,
    "method" "PrintMethod" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_retail" DECIMAL(10,2) NOT NULL,
    "fulfillmentId" TEXT,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Fulfillment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "capabilityId" TEXT,
    "status" "FulfillmentStatus" NOT NULL DEFAULT 'PENDING_ROUTING',
    "wholesale_cost" DECIMAL(12,2) NOT NULL,
    "estimated_delivery_days" INTEGER,
    "is_bulk" BOOLEAN NOT NULL DEFAULT false,
    "hold_status" "HoldStatus" NOT NULL DEFAULT 'NONE',
    "dispatch_paid" DECIMAL(12,2),
    "held_amount" DECIMAL(12,2),
    "hold_release_at" TIMESTAMP(3),
    "first_article_required" BOOLEAN NOT NULL DEFAULT false,
    "first_article_approved_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fulfillment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT NOT NULL,
    "carrier" TEXT,
    "tracking_number" TEXT,
    "packing_slip_brand" TEXT,
    "proof_of_delivery_url" TEXT,
    "delivered_at" TIMESTAMP(3),
    "claim_window_closes_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectClaim" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "liable_party" "LiabilityParty",
    "description" TEXT NOT NULL,
    "photo_urls" TEXT[],
    "resolution_note" TEXT,
    "refund_amount" DECIMAL(12,2),
    "reprint_ordered" BOOLEAN NOT NULL DEFAULT false,
    "recovered_from_hold" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefectClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrinterPayment" (
    "id" TEXT NOT NULL,
    "fulfillmentId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "kind" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrinterPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrinterLedgerEntry" (
    "id" TEXT NOT NULL,
    "printerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "fulfillmentId" TEXT,
    "settled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrinterLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_email_key" ON "Merchant"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_merchantId_key" ON "Wallet"("merchantId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "StoreConnection_merchantId_platform_idx" ON "StoreConnection"("merchantId", "platform");

-- CreateIndex
CREATE INDEX "Design_merchantId_idx" ON "Design"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "DesignPlacement_designId_placement_key" ON "DesignPlacement"("designId", "placement");

-- CreateIndex
CREATE INDEX "Order_merchantId_createdAt_idx" ON "Order"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_storeId_idx" ON "Order"("storeId");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE INDEX "OrderLine_fulfillmentId_idx" ON "OrderLine"("fulfillmentId");

-- CreateIndex
CREATE INDEX "Fulfillment_orderId_idx" ON "Fulfillment"("orderId");

-- CreateIndex
CREATE INDEX "Fulfillment_printerId_status_idx" ON "Fulfillment"("printerId", "status");

-- CreateIndex
CREATE INDEX "Shipment_fulfillmentId_idx" ON "Shipment"("fulfillmentId");

-- CreateIndex
CREATE INDEX "DefectClaim_fulfillmentId_status_idx" ON "DefectClaim"("fulfillmentId", "status");

-- CreateIndex
CREATE INDEX "PrinterPayment_fulfillmentId_idx" ON "PrinterPayment"("fulfillmentId");

-- CreateIndex
CREATE INDEX "PrinterLedgerEntry_printerId_settled_idx" ON "PrinterLedgerEntry"("printerId", "settled");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreConnection" ADD CONSTRAINT "StoreConnection_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Design" ADD CONSTRAINT "Design_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignPlacement" ADD CONSTRAINT "DesignPlacement_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_designId_fkey" FOREIGN KEY ("designId") REFERENCES "Design"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_printerId_fkey" FOREIGN KEY ("printerId") REFERENCES "Printer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fulfillment" ADD CONSTRAINT "Fulfillment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "PrinterCapability"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectClaim" ADD CONSTRAINT "DefectClaim_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrinterPayment" ADD CONSTRAINT "PrinterPayment_fulfillmentId_fkey" FOREIGN KEY ("fulfillmentId") REFERENCES "Fulfillment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

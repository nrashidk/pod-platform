-- Queue 12: estimated delivery. Additive only — one defaulted column, one new
-- table with starter default rows. No existing row is rewritten.
ALTER TABLE "Printer" ADD COLUMN "production_lead_days" INTEGER NOT NULL DEFAULT 3;

CREATE TABLE "ShippingLeadTime" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "emirate" TEXT NOT NULL DEFAULT '',
    "days" INTEGER NOT NULL,

    CONSTRAINT "ShippingLeadTime_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShippingLeadTime_country_emirate_key" ON "ShippingLeadTime"("country", "emirate");

-- Starter defaults (placeholders for ops to tune): UAE 2 days, other GCC 4.
INSERT INTO "ShippingLeadTime" ("id", "country", "emirate", "days") VALUES
  ('default-ship-ae', 'AE', '', 2),
  ('default-ship-sa', 'SA', '', 4),
  ('default-ship-kw', 'KW', '', 4),
  ('default-ship-qa', 'QA', '', 4),
  ('default-ship-bh', 'BH', '', 4),
  ('default-ship-om', 'OM', '', 4);

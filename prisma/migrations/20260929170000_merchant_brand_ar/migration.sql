-- Queue 10: Arabic variants of the merchant's packing-slip message and return
-- address. Additive, nullable — no existing row is touched.
ALTER TABLE "Merchant" ADD COLUMN "packing_slip_message_ar" TEXT,
ADD COLUMN "return_address_ar" TEXT;

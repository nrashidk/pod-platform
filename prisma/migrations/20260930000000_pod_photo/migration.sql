-- Queue 11b: optional photo/scan of the courier's delivery confirmation, kept
-- beside the text reference. Additive, nullable — no existing row is touched.
ALTER TABLE "Shipment" ADD COLUMN "proof_of_delivery_photo_url" TEXT;

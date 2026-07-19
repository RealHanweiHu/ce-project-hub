ALTER TABLE "product_technical_baselines"
  DROP CONSTRAINT IF EXISTS "product_technical_baselines_productId_products_id_fk";--> statement-breakpoint
ALTER TABLE "product_technical_baselines"
  ADD CONSTRAINT "product_technical_baselines_productId_products_id_fk"
  FOREIGN KEY ("productId") REFERENCES "public"."products"("id")
  ON DELETE restrict ON UPDATE no action;

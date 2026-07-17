ALTER TABLE "projects"
  ADD COLUMN "baseTechnicalBaselineId" varchar(32);--> statement-breakpoint
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_baseTechnicalBaselineId_product_technical_baselines_id_fk"
  FOREIGN KEY ("baseTechnicalBaselineId") REFERENCES "public"."product_technical_baselines"("id")
  ON DELETE restrict ON UPDATE no action;

ALTER TABLE "project_gate_reviews" ADD COLUMN "productId" varchar(32);--> statement-breakpoint
ALTER TABLE "project_gate_reviews" ADD COLUMN "baseRevisionId" integer;--> statement-breakpoint
ALTER TABLE "project_gate_reviews" ADD COLUMN "resultRevisionId" integer;--> statement-breakpoint
ALTER TABLE "project_gate_reviews" ADD COLUMN "traceSnapshot" jsonb;--> statement-breakpoint
CREATE INDEX "idx_gate_reviews_product" ON "project_gate_reviews" USING btree ("productId");
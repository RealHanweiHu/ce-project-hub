ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "productOwnerUserId" integer;
--> statement-breakpoint
UPDATE "projects"
SET "productOwnerUserId" = "createdBy"
WHERE "productOwnerUserId" IS NULL;

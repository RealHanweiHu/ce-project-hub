ALTER TABLE "project_deletion_leases"
  ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
--> statement-breakpoint
UPDATE "project_deletion_leases"
  SET "expiresAt" = COALESCE("expiresAt", "createdAt" + interval '30 minutes');
--> statement-breakpoint
ALTER TABLE "project_deletion_leases"
  ALTER COLUMN "expiresAt" SET NOT NULL;

ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "statusChangedAt" timestamp;--> statement-breakpoint
UPDATE "project_tasks" SET "statusChangedAt" = "updatedAt" WHERE "statusChangedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "project_tasks" ALTER COLUMN "statusChangedAt" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "project_tasks" ALTER COLUMN "statusChangedAt" SET NOT NULL;

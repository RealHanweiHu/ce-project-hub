CREATE TYPE "public"."project_lifecycle" AS ENUM('active', 'paused', 'terminated');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lifecycle" "project_lifecycle" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lifecycleReason" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lifecycleChangedAt" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "lifecycleChangedBy" integer;

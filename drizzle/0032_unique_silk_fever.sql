ALTER TYPE "public"."task_status" ADD VALUE IF NOT EXISTS 'pending_approval';--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."task_approval_status" AS ENUM('none', 'pending', 'approved', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "requiresApproval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approverUserId" integer;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalStatus" "task_approval_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalNote" text;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalRequestedBy" integer;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalRequestedAt" timestamp;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalDecidedBy" integer;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD COLUMN IF NOT EXISTS "approvalDecidedAt" timestamp;

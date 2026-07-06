ALTER TYPE "public"."project_member_role" ADD VALUE 'project_manager' BEFORE 'pm';--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'external_customer' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'supplier' BEFORE 'viewer';--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "productManagerUserId" integer;--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN "visibility" varchar(32) DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_issues" ADD COLUMN "verifiedBy" integer;--> statement-breakpoint
ALTER TABLE "project_issues" ADD COLUMN "verifiedAt" timestamp;
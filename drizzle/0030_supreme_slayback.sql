DO $$ BEGIN
 CREATE TYPE "public"."risk_item_severity" AS ENUM('low', 'medium', 'high');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."risk_item_status" AS ENUM('open', 'mitigating', 'watching', 'closed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_risks" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"severity" "risk_item_severity" DEFAULT 'medium' NOT NULL,
	"status" "risk_item_status" DEFAULT 'open' NOT NULL,
	"owner" varchar(256),
	"mitigationPlan" text,
	"contingencyPlan" text,
	"targetDate" varchar(32),
	"closedAt" timestamp,
	"creatorId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_requirements" ADD COLUMN IF NOT EXISTS "businessGoal" text;--> statement-breakpoint
ALTER TABLE "project_requirements" ADD COLUMN IF NOT EXISTS "projectGoal" text;--> statement-breakpoint
ALTER TABLE "project_requirements" ADD COLUMN IF NOT EXISTS "successMetric" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "riskOverrideRisk" "project_risk";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "riskOverrideReason" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "riskOverrideUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "riskOverrideUpdatedBy" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_risks_project_status_severity" ON "project_risks" USING btree ("projectId","status","severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_risks_project_target" ON "project_risks" USING btree ("projectId","targetDate");

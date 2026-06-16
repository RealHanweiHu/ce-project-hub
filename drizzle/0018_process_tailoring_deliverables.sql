CREATE TYPE "public"."deliverable_override_action" AS ENUM('add', 'remove');--> statement-breakpoint
CREATE TYPE "public"."tailoring_reason" AS ENUM('customer_id', 'customer_structure', 'reuse_mature', 'other');--> statement-breakpoint
CREATE TYPE "public"."tailoring_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "project_deliverable_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"nodePhaseId" varchar(32) NOT NULL,
	"deliverableName" varchar(256) NOT NULL,
	"action" "deliverable_override_action" NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tailoring" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"reasonType" "tailoring_reason" NOT NULL,
	"reasonNote" text DEFAULT '' NOT NULL,
	"targets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "tailoring_status" DEFAULT 'pending' NOT NULL,
	"proposedBy" integer NOT NULL,
	"proposedAt" timestamp DEFAULT now() NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_deliverable_override" ON "project_deliverable_overrides" USING btree ("projectId","nodePhaseId","deliverableName");--> statement-breakpoint
CREATE INDEX "idx_project_deliverable_overrides_project" ON "project_deliverable_overrides" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "idx_project_tailoring_project" ON "project_tailoring" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "idx_project_tailoring_project_status" ON "project_tailoring" USING btree ("projectId","status");

CREATE TYPE "public"."requirement_priority" AS ENUM('P0', 'P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."requirement_source" AS ENUM('customer', 'sales', 'market', 'internal', 'regulatory', 'manufacturing', 'quality', 'supplier', 'other');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('new', 'triaged', 'planned', 'in_progress', 'accepted', 'deferred', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('functional', 'performance', 'compliance', 'cost', 'schedule', 'quality', 'manufacturing', 'ux', 'packaging', 'other');--> statement-breakpoint
CREATE TABLE "project_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"source" "requirement_source" DEFAULT 'internal' NOT NULL,
	"sourceDetail" varchar(256),
	"type" "requirement_type" DEFAULT 'functional' NOT NULL,
	"priority" "requirement_priority" DEFAULT 'P2' NOT NULL,
	"status" "requirement_status" DEFAULT 'new' NOT NULL,
	"owner" varchar(256),
	"targetPhaseId" varchar(32),
	"linkedTaskId" varchar(32),
	"acceptanceCriteria" text,
	"decisionNote" text,
	"creatorId" integer,
	"productId" varchar(32),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_requirements_project_status_priority" ON "project_requirements" USING btree ("projectId","status","priority");--> statement-breakpoint
CREATE INDEX "idx_requirements_project_created" ON "project_requirements" USING btree ("projectId","createdAt");
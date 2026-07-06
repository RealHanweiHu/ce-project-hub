CREATE TYPE "public"."npi_readiness_category" AS ENUM('dfm', 'process_flow', 'sop_wi', 'fixture', 'test_program', 'trial_run', 'yield', 'packaging', 'other');--> statement-breakpoint
CREATE TYPE "public"."npi_readiness_status" AS ENUM('pending', 'ready', 'blocked', 'waived');--> statement-breakpoint
CREATE TYPE "public"."sample_signoff_audience" AS ENUM('customer', 'supplier', 'internal');--> statement-breakpoint
CREATE TYPE "public"."sample_signoff_status" AS ENUM('pending', 'approved', 'rejected', 'waived');--> statement-breakpoint
CREATE TYPE "public"."sample_signoff_type" AS ENUM('evt_sample', 'dvt_sample', 'pvt_sample', 'golden_sample', 'first_article', 'other');--> statement-breakpoint
CREATE TABLE "project_npi_readiness_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"title" varchar(256) NOT NULL,
	"category" "npi_readiness_category" DEFAULT 'other' NOT NULL,
	"status" "npi_readiness_status" DEFAULT 'pending' NOT NULL,
	"ownerUserId" integer,
	"dueDate" date,
	"evidenceFileId" integer,
	"relatedIssueId" integer,
	"notes" text,
	"createdBy" integer NOT NULL,
	"updatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_sample_signoffs" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"title" varchar(256) NOT NULL,
	"signoffType" "sample_signoff_type" DEFAULT 'other' NOT NULL,
	"audience" "sample_signoff_audience" DEFAULT 'customer' NOT NULL,
	"status" "sample_signoff_status" DEFAULT 'pending' NOT NULL,
	"sampleSerials" jsonb,
	"fileId" integer,
	"dueDate" date,
	"requestedBy" integer NOT NULL,
	"respondedBy" integer,
	"respondedAt" timestamp,
	"notes" text,
	"responseNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_npi_readiness_project_phase_status" ON "project_npi_readiness_checks" USING btree ("projectId","phaseId","status");--> statement-breakpoint
CREATE INDEX "idx_npi_readiness_issue" ON "project_npi_readiness_checks" USING btree ("relatedIssueId");--> statement-breakpoint
CREATE INDEX "idx_npi_readiness_file" ON "project_npi_readiness_checks" USING btree ("evidenceFileId");--> statement-breakpoint
CREATE INDEX "idx_sample_signoffs_project_phase_audience_status" ON "project_sample_signoffs" USING btree ("projectId","phaseId","audience","status");--> statement-breakpoint
CREATE INDEX "idx_sample_signoffs_file" ON "project_sample_signoffs" USING btree ("fileId");
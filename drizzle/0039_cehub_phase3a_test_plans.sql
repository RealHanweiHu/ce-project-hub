CREATE TYPE "public"."test_plan_status" AS ENUM('draft', 'active', 'completed');--> statement-breakpoint
CREATE TYPE "public"."test_report_result" AS ENUM('pass', 'fail', 'conditional');--> statement-breakpoint
CREATE TYPE "public"."test_report_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "project_test_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"title" varchar(256) NOT NULL,
	"scope" text,
	"sampleSize" varchar(64),
	"ownerUserId" integer,
	"status" "test_plan_status" DEFAULT 'active' NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_test_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"planId" integer,
	"title" varchar(256) NOT NULL,
	"reportNo" varchar(64),
	"result" "test_report_result" DEFAULT 'conditional' NOT NULL,
	"reviewStatus" "test_report_review_status" DEFAULT 'pending' NOT NULL,
	"summary" text,
	"fileId" integer,
	"submittedBy" integer NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_test_plans_project_phase_status" ON "project_test_plans" USING btree ("projectId","phaseId","status");--> statement-breakpoint
CREATE INDEX "idx_test_reports_project_phase_review" ON "project_test_reports" USING btree ("projectId","phaseId","reviewStatus","result");--> statement-breakpoint
CREATE INDEX "idx_test_reports_plan" ON "project_test_reports" USING btree ("planId");
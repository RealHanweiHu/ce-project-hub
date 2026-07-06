CREATE TYPE "public"."test_case_status" AS ENUM('planned', 'passed', 'failed', 'blocked', 'waived');--> statement-breakpoint
CREATE TABLE "project_test_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"planId" integer,
	"title" varchar(256) NOT NULL,
	"category" varchar(64) DEFAULT 'functional' NOT NULL,
	"acceptanceCriteria" text,
	"method" text,
	"sampleSerials" jsonb,
	"severity" "issue_severity" DEFAULT 'P2' NOT NULL,
	"status" "test_case_status" DEFAULT 'planned' NOT NULL,
	"resultNotes" text,
	"evidenceFileId" integer,
	"relatedIssueId" integer,
	"ownerUserId" integer,
	"createdBy" integer NOT NULL,
	"updatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_test_cases_project_phase_status" ON "project_test_cases" USING btree ("projectId","phaseId","status");--> statement-breakpoint
CREATE INDEX "idx_test_cases_plan" ON "project_test_cases" USING btree ("planId");--> statement-breakpoint
CREATE INDEX "idx_test_cases_issue" ON "project_test_cases" USING btree ("relatedIssueId");
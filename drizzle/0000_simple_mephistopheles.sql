CREATE TYPE "public"."change_status" AS ENUM('proposed', 'approved', 'rejected', 'implemented', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."change_type" AS ENUM('decision', 'tradeoff', 'eco', 'ecn', 'spec', 'cost', 'schedule', 'supplier', 'other');--> statement-breakpoint
CREATE TYPE "public"."gate_decision" AS ENUM('approved', 'conditional', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."issue_category" AS ENUM('hardware', 'software', 'mechanical', 'thermal', 'reliability', 'safety', 'performance', 'other');--> statement-breakpoint
CREATE TYPE "public"."issue_severity" AS ENUM('P0', 'P1', 'P2', 'P3');--> statement-breakpoint
CREATE TYPE "public"."issue_status" AS ENUM('open', 'in_progress', 'resolved', 'closed', 'wont_fix');--> statement-breakpoint
CREATE TYPE "public"."project_member_role" AS ENUM('owner', 'manager', 'pm', 'rd_hw', 'rd_sw', 'rd_mech', 'qa', 'scm', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."project_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'blocked', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"userId" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"entityType" varchar(32),
	"entityId" varchar(64),
	"meta" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"ownerId" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "project_changelog" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"number" varchar(64) DEFAULT '' NOT NULL,
	"type" "change_type" DEFAULT 'other' NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"reason" text,
	"decisionMaker" varchar(256),
	"affectedPhases" jsonb DEFAULT '[]'::jsonb,
	"status" "change_status" DEFAULT 'proposed' NOT NULL,
	"costImpact" varchar(128),
	"scheduleImpact" varchar(128),
	"notes" text,
	"createdDate" varchar(32),
	"implementedDate" varchar(32),
	"creatorId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32),
	"taskId" varchar(32),
	"name" varchar(256) NOT NULL,
	"mimeType" varchar(128) DEFAULT 'application/octet-stream' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"storageKey" varchar(512) NOT NULL,
	"storageUrl" varchar(512) NOT NULL,
	"uploadedBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_gate_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"phaseName" varchar(256) DEFAULT '' NOT NULL,
	"gateName" varchar(256) DEFAULT '' NOT NULL,
	"reviewDate" varchar(32) NOT NULL,
	"participants" text,
	"decision" "gate_decision" DEFAULT 'conditional' NOT NULL,
	"conditions" text,
	"notes" text,
	"roundNumber" integer DEFAULT 1 NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"severity" "issue_severity" DEFAULT 'P2' NOT NULL,
	"status" "issue_status" DEFAULT 'open' NOT NULL,
	"category" "issue_category" DEFAULT 'other' NOT NULL,
	"owner" varchar(256),
	"reporter" varchar(256),
	"foundDate" varchar(32),
	"targetDate" varchar(32),
	"closedDate" varchar(32),
	"rootCause" text,
	"solution" text,
	"relatedTaskId" varchar(32),
	"creatorId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"userId" integer NOT NULL,
	"role" "project_member_role" DEFAULT 'viewer' NOT NULL,
	"jobTitle" varchar(64),
	"invitedBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_phases" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"startDate" varchar(32),
	"endDate" varchar(32),
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"taskId" varchar(32) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"instructions" text,
	"visibleRoles" jsonb DEFAULT '[]'::jsonb,
	"assigneeUserId" integer,
	"dueDate" date,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"completedAt" timestamp,
	"updatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"projectNumber" varchar(64) DEFAULT '' NOT NULL,
	"category" varchar(64) DEFAULT 'npd' NOT NULL,
	"pmUserId" integer,
	"risk" "project_risk" DEFAULT 'low' NOT NULL,
	"currentPhase" varchar(32) DEFAULT 'concept' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"startDate" varchar(32),
	"targetDate" varchar(32),
	"createdBy" integer NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"orgId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(64) NOT NULL,
	"username" varchar(64),
	"passwordHash" varchar(256),
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"canCreateProject" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE INDEX "idx_activity_logs_project" ON "activity_logs" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "idx_activity_logs_user" ON "activity_logs" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_activity_logs_project_time" ON "activity_logs" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_changelog_project_type_status" ON "project_changelog" USING btree ("projectId","type","status");--> statement-breakpoint
CREATE INDEX "idx_project_files_project" ON "project_files" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "idx_project_files_project_phase" ON "project_files" USING btree ("projectId","phaseId");--> statement-breakpoint
CREATE INDEX "idx_gate_reviews_project_phase" ON "project_gate_reviews" USING btree ("projectId","phaseId");--> statement-breakpoint
CREATE INDEX "idx_issues_project_phase_status_severity" ON "project_issues" USING btree ("projectId","phaseId","status","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_member" ON "project_members" USING btree ("projectId","userId");--> statement-breakpoint
CREATE INDEX "idx_project_members_project" ON "project_members" USING btree ("projectId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_phase" ON "project_phases" USING btree ("projectId","phaseId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_phase_task" ON "project_tasks" USING btree ("projectId","phaseId","taskId");

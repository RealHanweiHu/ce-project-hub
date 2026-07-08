CREATE TYPE "public"."action_item_kind" AS ENUM('task_approval', 'task_rework', 'deliverable_review', 'deliverable_rework', 'critical_issue');--> statement-breakpoint
CREATE TYPE "public"."action_item_status" AS ENUM('open', 'sent', 'read', 'done', 'closed', 'escalated', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."action_item_level" AS ENUM('owner', 'pm', 'manager');--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "action_item_kind" NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"entityType" varchar(32) NOT NULL,
	"entityId" varchar(128) NOT NULL,
	"dedupeKey" varchar(256) NOT NULL,
	"recipientUserId" integer NOT NULL,
	"level" "action_item_level" DEFAULT 'owner' NOT NULL,
	"title" varchar(256) NOT NULL,
	"body" text,
	"actionUrl" varchar(1024) NOT NULL,
	"status" "action_item_status" DEFAULT 'open' NOT NULL,
	"priority" varchar(16) DEFAULT 'normal' NOT NULL,
	"dueAt" timestamp,
	"snoozedUntil" timestamp,
	"sourceActivityLogId" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"firstSentAt" timestamp,
	"lastSentAt" timestamp,
	"readAt" timestamp,
	"handledAt" timestamp,
	"closedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_action_items_dedupe_key" UNIQUE("dedupeKey")
);
--> statement-breakpoint
CREATE TABLE "automation_heartbeats" (
	"schedulerKey" varchar(64) PRIMARY KEY NOT NULL,
	"lastStartedAt" timestamp,
	"lastFinishedAt" timestamp,
	"status" varchar(24) DEFAULT 'idle' NOT NULL,
	"durationMs" integer,
	"lastError" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_action_items_recipient_status" ON "action_items" USING btree ("recipientUserId","status");--> statement-breakpoint
CREATE INDEX "idx_action_items_project_created" ON "action_items" USING btree ("projectId","createdAt");--> statement-breakpoint
CREATE INDEX "idx_action_items_entity" ON "action_items" USING btree ("entityType","entityId");

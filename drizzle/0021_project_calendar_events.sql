CREATE TABLE "project_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"title" varchar(256) NOT NULL,
	"description" text,
	"eventDate" date NOT NULL,
	"startTime" varchar(5) NOT NULL,
	"durationMin" integer DEFAULT 60 NOT NULL,
	"organizerUserId" integer NOT NULL,
	"dingtalkEventId" varchar(128),
	"dingtalkSyncStatus" varchar(24) DEFAULT 'not_synced' NOT NULL,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_project_calendar_events_project_date" ON "project_calendar_events" USING btree ("projectId","eventDate");--> statement-breakpoint
CREATE INDEX "idx_project_calendar_events_date" ON "project_calendar_events" USING btree ("eventDate");
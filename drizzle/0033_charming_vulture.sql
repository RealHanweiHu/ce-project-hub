ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "dingtalkMeetingSyncStatus" varchar(24) DEFAULT 'not_synced' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "dingtalkMeetingLastError" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "dingtalkMeetingLastSyncedAt" timestamp;

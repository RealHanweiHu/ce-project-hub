ALTER TABLE "projects" ADD COLUMN "meetingConfig" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "dingtalkEventId" varchar(128);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mobile" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dingtalkUserId" varchar(64);
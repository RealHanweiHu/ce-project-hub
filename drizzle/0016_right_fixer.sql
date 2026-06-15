ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "customer" varchar(256);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "background" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "value" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "dingtalkChatId" varchar(128);
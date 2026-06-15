ALTER TABLE "mp_releases" ADD COLUMN "overridden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "overrideReason" text;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "acceptedBy" integer;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "acceptedAt" timestamp;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "conditionsSnapshot" text;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "followUpOwner" integer;--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN "dueDate" varchar(32);
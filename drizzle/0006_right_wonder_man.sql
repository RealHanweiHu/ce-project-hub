CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityType" varchar(24) NOT NULL,
	"entityId" varchar(64) NOT NULL,
	"projectId" varchar(32),
	"authorId" integer NOT NULL,
	"body" text NOT NULL,
	"mentions" jsonb DEFAULT '[]'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(24) NOT NULL,
	"title" varchar(256) NOT NULL,
	"body" text,
	"entityType" varchar(24),
	"entityId" varchar(64),
	"read" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_comments_entity" ON "comments" USING btree ("entityType","entityId");--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("userId","read");
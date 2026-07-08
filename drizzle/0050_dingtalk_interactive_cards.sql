CREATE TABLE IF NOT EXISTS "dingtalk_interactive_cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"outTrackId" varchar(128) NOT NULL,
	"actionItemId" integer,
	"recipientUserId" integer NOT NULL,
	"projectId" varchar(32),
	"eventKey" varchar(64) NOT NULL,
	"entityType" varchar(32),
	"entityId" varchar(128),
	"title" varchar(256) NOT NULL,
	"body" text,
	"actionUrl" varchar(1024),
	"status" varchar(24) DEFAULT 'sent' NOT NULL,
	"cardData" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lastError" text,
	"handledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_dingtalk_interactive_card_out_track" UNIQUE("outTrackId")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dingtalk_interactive_cards_action_item" ON "dingtalk_interactive_cards" USING btree ("actionItemId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dingtalk_interactive_cards_recipient_status" ON "dingtalk_interactive_cards" USING btree ("recipientUserId","status");

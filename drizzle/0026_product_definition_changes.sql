CREATE TYPE "public"."product_definition_change_area" AS ENUM('market', 'customer', 'scenario', 'competitor', 'positioning', 'selling_point', 'spec', 'cost', 'price', 'margin', 'sku', 'certification', 'packaging', 'schedule', 'other');--> statement-breakpoint
CREATE TABLE "product_definition_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" varchar(32) NOT NULL,
	"sourceProjectId" varchar(32),
	"area" "product_definition_change_area" DEFAULT 'other' NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"reason" text,
	"requestedByCustomer" varchar(256),
	"baselineValue" text,
	"requestedValue" text,
	"impactScope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"costImpact" varchar(128),
	"priceImpact" varchar(128),
	"scheduleImpact" varchar(128),
	"status" "change_status" DEFAULT 'proposed' NOT NULL,
	"decisionNotes" text,
	"createdBy" integer NOT NULL,
	"approvedBy" integer,
	"approvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_product_definition_changes_product_status" ON "product_definition_changes" USING btree ("productId","status");--> statement-breakpoint
CREATE INDEX "idx_product_definition_changes_source_project" ON "product_definition_changes" USING btree ("sourceProjectId");
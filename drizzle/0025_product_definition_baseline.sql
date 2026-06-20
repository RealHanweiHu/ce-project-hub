CREATE TYPE "public"."product_definition_status" AS ENUM('draft', 'confirmed');--> statement-breakpoint
CREATE TABLE "product_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" varchar(32) NOT NULL,
	"title" varchar(256) DEFAULT '' NOT NULL,
	"opportunityName" varchar(256) DEFAULT '' NOT NULL,
	"opportunitySource" varchar(128) DEFAULT '' NOT NULL,
	"targetCustomers" text,
	"targetMarkets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"applicationScenarios" text,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priceBand" varchar(128) DEFAULT '' NOT NULL,
	"positioning" text,
	"sellingPoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"differentiationStrategy" text,
	"prdSummary" text,
	"specs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"targetCost" varchar(64) DEFAULT '' NOT NULL,
	"targetPrice" varchar(64) DEFAULT '' NOT NULL,
	"targetGrossMargin" varchar(64) DEFAULT '' NOT NULL,
	"skuPlan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "product_definition_status" DEFAULT 'draft' NOT NULL,
	"confirmedBy" integer,
	"confirmedAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_definition_product" ON "product_definitions" USING btree ("productId");--> statement-breakpoint
CREATE INDEX "idx_product_definition_status" ON "product_definitions" USING btree ("status");
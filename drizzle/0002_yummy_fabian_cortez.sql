ALTER TYPE "public"."project_member_role" ADD VALUE 'pe' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'mfg' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'sales' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'cert' BEFORE 'viewer';--> statement-breakpoint
ALTER TYPE "public"."project_member_role" ADD VALUE 'battery_safety' BEFORE 'viewer';--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"category" varchar(64) DEFAULT '' NOT NULL,
	"description" text,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_revisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" varchar(32) NOT NULL,
	"revisionLabel" varchar(16) NOT NULL,
	"parentRevisionId" integer,
	"createdByProjectId" varchar(32),
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"releasedAt" timestamp,
	"releasedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" varchar(32) PRIMARY KEY NOT NULL,
	"productNumber" varchar(64) DEFAULT '' NOT NULL,
	"name" varchar(256) NOT NULL,
	"type" varchar(16) DEFAULT 'finished' NOT NULL,
	"category" varchar(64) DEFAULT '' NOT NULL,
	"platformId" varchar(32),
	"targetMarkets" jsonb DEFAULT '[]'::jsonb,
	"lifecycleState" varchar(32) DEFAULT 'concept' NOT NULL,
	"currentRevisionId" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "productId" varchar(32);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "mode" varchar(32) DEFAULT 'npd' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "objectType" varchar(16) DEFAULT 'finished' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "baseRevisionId" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "resultRevisionId" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_revision" ON "product_revisions" USING btree ("productId","revisionLabel");--> statement-breakpoint
CREATE INDEX "idx_product_revisions_product" ON "product_revisions" USING btree ("productId");
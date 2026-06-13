CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'date', 'select', 'boolean');--> statement-breakpoint
CREATE TABLE "custom_field_defs" (
	"id" serial PRIMARY KEY NOT NULL,
	"entityType" varchar(24) DEFAULT 'project' NOT NULL,
	"fieldKey" varchar(64) NOT NULL,
	"label" varchar(128) NOT NULL,
	"fieldType" "custom_field_type" DEFAULT 'text' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "customFields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_custom_field_key" ON "custom_field_defs" USING btree ("entityType","fieldKey");
CREATE TABLE "bom_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"revisionId" integer,
	"projectId" varchar(32),
	"partNumber" varchar(64) DEFAULT '' NOT NULL,
	"name" varchar(256) NOT NULL,
	"spec" varchar(256) DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"refDesignator" varchar(128) DEFAULT '' NOT NULL,
	"componentProductId" varchar(32),
	"componentRevisionId" integer,
	"supplierName" varchar(128) DEFAULT '' NOT NULL,
	"unitCost" varchar(64) DEFAULT '' NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_bom_revision" ON "bom_items" USING btree ("revisionId");--> statement-breakpoint
CREATE INDEX "idx_bom_project" ON "bom_items" USING btree ("projectId");--> statement-breakpoint
CREATE INDEX "idx_bom_component" ON "bom_items" USING btree ("componentProductId");
CREATE TABLE "product_definition_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" varchar(32) NOT NULL,
	"definitionId" integer NOT NULL,
	"versionNumber" integer NOT NULL,
	"title" varchar(256) DEFAULT '' NOT NULL,
	"snapshot" jsonb NOT NULL,
	"confirmedBy" integer NOT NULL,
	"confirmedAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_definition_snapshot_version" ON "product_definition_snapshots" USING btree ("productId","versionNumber");--> statement-breakpoint
CREATE INDEX "idx_product_definition_snapshots_product" ON "product_definition_snapshots" USING btree ("productId");
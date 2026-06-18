CREATE TABLE "customer_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"variantCode" varchar(64) NOT NULL,
	"customerSku" varchar(64),
	"parentProductId" varchar(32) NOT NULL,
	"baseRevision" varchar(16) DEFAULT '' NOT NULL,
	"customerId" varchar(64) DEFAULT '' NOT NULL,
	"customerName" varchar(256) DEFAULT '' NOT NULL,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"deltas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certReuseParent" boolean DEFAULT true NOT NULL,
	"certAffectedMarks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"certNotes" text,
	"goldenSampleRef" varchar(256),
	"customerApproved" boolean DEFAULT false NOT NULL,
	"approvedDate" varchar(32),
	"sourceType" varchar(16) DEFAULT 'plm_change' NOT NULL,
	"sourceRefId" varchar(64),
	"introducedAt" varchar(32),
	"eolAt" varchar(32),
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_customer_variant_code" ON "customer_variants" USING btree ("variantCode");--> statement-breakpoint
CREATE INDEX "idx_customer_variants_parent" ON "customer_variants" USING btree ("parentProductId");--> statement-breakpoint
CREATE INDEX "idx_customer_variants_customer" ON "customer_variants" USING btree ("customerId");
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "maintenanceOwnerUserId" integer;
ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "afterSalesOwnerUserId" integer;

CREATE TABLE IF NOT EXISTS "project_close_handoffs" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "productId" varchar(32) NOT NULL,
  "revisionId" integer,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "maintenanceOwnerUserId" integer NOT NULL,
  "afterSalesOwnerUserId" integer NOT NULL,
  "scopeSummary" text NOT NULL,
  "submittedBy" integer,
  "submittedAt" timestamp,
  "acceptedBy" integer,
  "acceptedAt" timestamp,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_close_handoffs_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "project_close_handoffs_productId_products_id_fk"
    FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_close_handoff_project"
  ON "project_close_handoffs" USING btree ("projectId");
CREATE INDEX IF NOT EXISTS "idx_project_close_handoff_product_status"
  ON "project_close_handoffs" USING btree ("productId", "status");
CREATE INDEX IF NOT EXISTS "idx_project_close_handoff_owner_status"
  ON "project_close_handoffs" USING btree ("maintenanceOwnerUserId", "status");

CREATE TABLE IF NOT EXISTS "project_close_handoff_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "handoffId" integer NOT NULL,
  "itemKey" varchar(48) NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "evidenceReference" text,
  "completedBy" integer,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_close_handoff_items_handoffId_project_close_handoffs_id_fk"
    FOREIGN KEY ("handoffId") REFERENCES "public"."project_close_handoffs"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_close_handoff_item"
  ON "project_close_handoff_items" USING btree ("handoffId", "itemKey");

CREATE TABLE IF NOT EXISTS "product_service_cases" (
  "id" serial PRIMARY KEY NOT NULL,
  "caseNumber" varchar(64) NOT NULL,
  "productId" varchar(32) NOT NULL,
  "revisionId" integer,
  "sourceProjectId" varchar(32),
  "title" varchar(256) NOT NULL,
  "description" text NOT NULL,
  "severity" varchar(8) DEFAULT 'P2' NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "ownerUserId" integer NOT NULL,
  "linkedEcoProjectId" varchar(32),
  "resolutionNote" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_service_cases_productId_products_id_fk"
    FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "product_service_cases_sourceProjectId_projects_id_fk"
    FOREIGN KEY ("sourceProjectId") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_service_case_number"
  ON "product_service_cases" USING btree ("caseNumber");
CREATE INDEX IF NOT EXISTS "idx_product_service_cases_product_status"
  ON "product_service_cases" USING btree ("productId", "status");
CREATE INDEX IF NOT EXISTS "idx_product_service_cases_owner_status"
  ON "product_service_cases" USING btree ("ownerUserId", "status");

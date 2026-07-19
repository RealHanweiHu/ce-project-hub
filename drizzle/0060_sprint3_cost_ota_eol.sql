CREATE TABLE IF NOT EXISTS "project_expenses" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "category" varchar(24) NOT NULL,
  "title" varchar(256) NOT NULL,
  "supplier" varchar(256),
  "currency" varchar(3) DEFAULT 'CNY' NOT NULL,
  "budgetAmountMinor" integer DEFAULT 0 NOT NULL,
  "actualAmountMinor" integer DEFAULT 0 NOT NULL,
  "status" varchar(24) DEFAULT 'planned' NOT NULL,
  "ownerUserId" integer NOT NULL,
  "occurredDate" date,
  "evidenceReference" text,
  "notes" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_expenses_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "idx_project_expenses_project_status"
  ON "project_expenses" USING btree ("projectId", "status");
CREATE INDEX IF NOT EXISTS "idx_project_expenses_owner_status"
  ON "project_expenses" USING btree ("ownerUserId", "status");

CREATE TABLE IF NOT EXISTS "product_software_releases" (
  "id" serial PRIMARY KEY NOT NULL,
  "releaseNumber" varchar(64) NOT NULL,
  "productId" varchar(32) NOT NULL,
  "baseRevisionId" integer NOT NULL,
  "version" varchar(64) NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "scopeSummary" text NOT NULL,
  "releaseNotes" text NOT NULL,
  "compatibilityNotes" text NOT NULL,
  "safetyRelated" boolean DEFAULT false NOT NULL,
  "bomOrManufacturingImpact" boolean DEFAULT false NOT NULL,
  "regressionEvidenceReference" text NOT NULL,
  "rolloutPlan" text NOT NULL,
  "rollbackPlan" text NOT NULL,
  "rolloutPercent" integer DEFAULT 0 NOT NULL,
  "qaOwnerUserId" integer NOT NULL,
  "submittedBy" integer,
  "submittedAt" timestamp,
  "validatedBy" integer,
  "validatedAt" timestamp,
  "releasedBy" integer,
  "releasedAt" timestamp,
  "rolledBackBy" integer,
  "rolledBackAt" timestamp,
  "rollbackReason" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_software_releases_productId_products_id_fk"
    FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_software_release_number"
  ON "product_software_releases" USING btree ("releaseNumber");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_software_release_version"
  ON "product_software_releases" USING btree ("productId", "version");
CREATE INDEX IF NOT EXISTS "idx_product_software_releases_product_status"
  ON "product_software_releases" USING btree ("productId", "status");
CREATE INDEX IF NOT EXISTS "idx_product_software_releases_qa_status"
  ON "product_software_releases" USING btree ("qaOwnerUserId", "status");

CREATE TABLE IF NOT EXISTS "product_eol_plans" (
  "id" serial PRIMARY KEY NOT NULL,
  "productId" varchar(32) NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "reason" text NOT NULL,
  "lastOrderDate" date NOT NULL,
  "lastShipDate" date NOT NULL,
  "serviceEndDate" date NOT NULL,
  "sparePartsYears" integer NOT NULL,
  "inventoryDisposition" text NOT NULL,
  "customerCommunicationPlan" text NOT NULL,
  "supplierExitPlan" text NOT NULL,
  "replacementProductId" varchar(32),
  "ownerUserId" integer NOT NULL,
  "approverUserId" integer NOT NULL,
  "submittedBy" integer,
  "submittedAt" timestamp,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "completedBy" integer,
  "completedAt" timestamp,
  "cancelledBy" integer,
  "cancelledAt" timestamp,
  "cancellationReason" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_eol_plans_productId_products_id_fk"
    FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_eol_plan_product"
  ON "product_eol_plans" USING btree ("productId");
CREATE INDEX IF NOT EXISTS "idx_product_eol_plans_owner_status"
  ON "product_eol_plans" USING btree ("ownerUserId", "status");
CREATE INDEX IF NOT EXISTS "idx_product_eol_plans_approver_status"
  ON "product_eol_plans" USING btree ("approverUserId", "status");

CREATE TABLE IF NOT EXISTS "product_eol_plan_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "planId" integer NOT NULL,
  "itemKey" varchar(48) NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "evidenceReference" text,
  "completedBy" integer,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_eol_plan_items_planId_product_eol_plans_id_fk"
    FOREIGN KEY ("planId") REFERENCES "public"."product_eol_plans"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_eol_plan_item"
  ON "product_eol_plan_items" USING btree ("planId", "itemKey");

CREATE TABLE IF NOT EXISTS "product_governance_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "productId" varchar(32) NOT NULL,
  "entityType" varchar(32) NOT NULL,
  "entityId" varchar(64) NOT NULL,
  "action" varchar(64) NOT NULL,
  "actorUserId" integer NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_governance_events_productId_products_id_fk"
    FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "idx_product_governance_events_product_created"
  ON "product_governance_events" USING btree ("productId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_product_governance_events_entity"
  ON "product_governance_events" USING btree ("entityType", "entityId");

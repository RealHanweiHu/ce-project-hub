ALTER TABLE "project_gate_reviews"
  ADD COLUMN IF NOT EXISTS "conditionOwnerUserId" integer;
ALTER TABLE "project_gate_reviews"
  ADD COLUMN IF NOT EXISTS "conditionDueDate" date;
ALTER TABLE "mp_releases"
  ADD COLUMN IF NOT EXISTS "followUpConditionId" integer;

CREATE TABLE IF NOT EXISTS "product_certificates" (
  "id" serial PRIMARY KEY NOT NULL,
  "productId" varchar(32) NOT NULL,
  "projectId" varchar(32),
  "revisionId" integer,
  "type" varchar(48) NOT NULL,
  "scopeType" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "certificateNumber" varchar(256),
  "issuingBody" varchar(256),
  "targetMarkets" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "validFrom" date,
  "validUntil" date,
  "evidenceFileId" integer,
  "evidenceReference" text,
  "reuseApproved" boolean DEFAULT false NOT NULL,
  "reuseBasis" text,
  "reviewedBy" integer,
  "reviewedAt" timestamp,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_certificates_productId_products_id_fk"
    FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "product_certificates_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action
);
CREATE INDEX IF NOT EXISTS "idx_product_certificates_product_status"
  ON "product_certificates" USING btree ("productId", "status");
CREATE INDEX IF NOT EXISTS "idx_product_certificates_project"
  ON "product_certificates" USING btree ("projectId");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_certificate_number"
  ON "product_certificates" USING btree ("productId", "type", "certificateNumber");

CREATE TABLE IF NOT EXISTS "project_conditions" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "sourceType" varchar(24) NOT NULL,
  "sourceId" varchar(64),
  "title" varchar(256) NOT NULL,
  "description" text NOT NULL,
  "ownerUserId" integer NOT NULL,
  "dueDate" date NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "linkedEcoProjectId" varchar(32),
  "resolutionNote" text,
  "resolvedBy" integer,
  "resolvedAt" timestamp,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_conditions_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_condition_source"
  ON "project_conditions" USING btree ("sourceType", "sourceId");
CREATE INDEX IF NOT EXISTS "idx_project_conditions_project_status"
  ON "project_conditions" USING btree ("projectId", "status");
CREATE INDEX IF NOT EXISTS "idx_project_conditions_owner_status"
  ON "project_conditions" USING btree ("ownerUserId", "status");

-- Reuse the existing release follow-up snapshot as the source of truth for
-- pre-Sprint-1 conditional releases. Extension is intentionally not a closed state.
INSERT INTO "project_conditions" (
  "projectId", "sourceType", "sourceId", "title", "description",
  "ownerUserId", "dueDate", "status", "createdBy", "createdAt", "updatedAt"
)
SELECT
  r."projectId",
  'release',
  r."id"::text,
  '量产发布条件跟进',
  coalesce(nullif(r."conditionsSnapshot", ''), nullif(r."overrideReason", ''), '历史条件发布跟进'),
  r."followUpOwner",
  CASE
    WHEN r."dueDate" ~ '^\d{4}-\d{2}-\d{2}$' THEN r."dueDate"::date
    ELSE r."releasedAt"::date + 14
  END,
  'open',
  coalesce(r."acceptedBy", r."releasedBy"),
  r."releasedAt",
  now()
FROM "mp_releases" r
WHERE r."overridden" = true
  AND r."followUpOwner" IS NOT NULL
ON CONFLICT ("sourceType", "sourceId") DO NOTHING;

UPDATE "mp_releases" r
SET "followUpConditionId" = c."id"
FROM "project_conditions" c
WHERE c."sourceType" = 'release'
  AND c."sourceId" = r."id"::text
  AND r."followUpConditionId" IS NULL;

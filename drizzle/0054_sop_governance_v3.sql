ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "sopTemplateVersion" varchar(32) DEFAULT '2026-07-v1' NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "sopTemplateVersion" SET DEFAULT '2026-07-v2';

CREATE TABLE IF NOT EXISTS "project_change_scope_declarations" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "declaration" jsonb NOT NULL,
  "assessment" jsonb NOT NULL,
  "ruleVersion" varchar(64) NOT NULL,
  "declaredBy" integer NOT NULL,
  "engineeringConfirmedBy" integer,
  "engineeringConfirmedAt" timestamp,
  "qaOrCertConfirmedBy" integer,
  "qaOrCertConfirmedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_change_scope_declarations_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_change_scope_project_version"
  ON "project_change_scope_declarations" USING btree ("projectId", "version");
CREATE INDEX IF NOT EXISTS "idx_change_scope_project"
  ON "project_change_scope_declarations" USING btree ("projectId", "version");

CREATE TABLE IF NOT EXISTS "project_gate_signoff_rounds" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "phaseId" varchar(32) NOT NULL,
  "roundNumber" integer NOT NULL,
  "status" varchar(24) DEFAULT 'open' NOT NULL,
  "requirements" jsonb NOT NULL,
  "riskSnapshot" jsonb NOT NULL,
  "sopTemplateVersion" varchar(32) NOT NULL,
  "openedBy" integer,
  "openedAt" timestamp DEFAULT now() NOT NULL,
  "supersededBy" integer,
  "supersededAt" timestamp,
  "supersedeReason" text,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_gate_signoff_rounds_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_gate_signoff_round"
  ON "project_gate_signoff_rounds" USING btree ("projectId", "phaseId", "roundNumber");
CREATE INDEX IF NOT EXISTS "idx_gate_signoff_round_open"
  ON "project_gate_signoff_rounds" USING btree ("projectId", "phaseId", "status");

CREATE TABLE IF NOT EXISTS "project_gate_signoff_additions" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "phaseId" varchar(32) NOT NULL,
  "slot" varchar(32) NOT NULL,
  "requirement" varchar(24) NOT NULL,
  "reason" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "addedBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_gate_signoff_additions_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_gate_signoff_addition_slot"
  ON "project_gate_signoff_additions" USING btree ("projectId", "phaseId", "slot");
CREATE INDEX IF NOT EXISTS "idx_gate_signoff_additions_project_phase"
  ON "project_gate_signoff_additions" USING btree ("projectId", "phaseId");

CREATE TABLE IF NOT EXISTS "project_stability_reports" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "revisionId" integer,
  "periodStart" date NOT NULL,
  "periodEnd" date NOT NULL,
  "outputQuantity" integer DEFAULT 0 NOT NULL,
  "targetOutputQuantity" integer DEFAULT 0 NOT NULL,
  "fpyBasisPoints" integer DEFAULT 0 NOT NULL,
  "targetFpyBasisPoints" integer DEFAULT 0 NOT NULL,
  "capacityAttainmentBasisPoints" integer DEFAULT 0 NOT NULL,
  "qualityEvents" text,
  "summary" text,
  "createdBy" integer NOT NULL,
  "qaConfirmedBy" integer,
  "qaConfirmedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_stability_reports_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_stability_report_period"
  ON "project_stability_reports" USING btree ("projectId", "periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "idx_stability_reports_project"
  ON "project_stability_reports" USING btree ("projectId", "periodEnd");

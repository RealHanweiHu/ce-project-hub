ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "safetyRiskLevel" varchar(16) DEFAULT 'standard' NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "regulatoryRiskLevel" varchar(16) DEFAULT 'standard' NOT NULL;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "customerInputVersion" varchar(128);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "customerPartNumber" varchar(128);
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "commercialBoundary" text;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "customerSignoffOwnerUserId" integer;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "inputBaselineFrozenAt" timestamp;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "inputBaselineFrozenBy" integer;

CREATE TABLE IF NOT EXISTS "project_gate_signoffs" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "phaseId" varchar(32) NOT NULL,
  "roundNumber" integer DEFAULT 1 NOT NULL,
  "slot" varchar(32) NOT NULL,
  "requirement" varchar(24) NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "signedBy" integer,
  "signedAt" timestamp,
  "note" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_gate_signoffs_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action
);

CREATE UNIQUE INDEX IF NOT EXISTS "uniq_gate_signoff_round_slot"
  ON "project_gate_signoffs" USING btree ("projectId", "phaseId", "roundNumber", "slot");
CREATE INDEX IF NOT EXISTS "idx_gate_signoffs_project_phase_round"
  ON "project_gate_signoffs" USING btree ("projectId", "phaseId", "roundNumber");

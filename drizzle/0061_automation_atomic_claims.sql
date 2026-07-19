ALTER TABLE "automation_runs"
  ALTER COLUMN "entityId" TYPE varchar(128);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_claims" (
  "claimKey" varchar(256) PRIMARY KEY NOT NULL,
  "ruleKey" varchar(64) NOT NULL,
  "projectId" varchar(32),
  "entityId" varchar(128),
  "sourceActivityLogId" integer,
  "token" varchar(64) NOT NULL,
  "status" varchar(16) DEFAULT 'running' NOT NULL,
  "claimedAt" timestamp DEFAULT now() NOT NULL,
  "lastFiredAt" timestamp,
  "lastError" text,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_claims_rule_project"
  ON "automation_claims" USING btree ("ruleKey", "projectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_claims_source_log"
  ON "automation_claims" USING btree ("sourceActivityLogId");

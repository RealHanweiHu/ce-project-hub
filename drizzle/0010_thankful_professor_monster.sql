CREATE TABLE IF NOT EXISTS "automation_rules" (
  "id" serial PRIMARY KEY NOT NULL,
  "ruleKey" varchar(64) NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "config" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updatedBy" integer,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "ruleKey" varchar(64) NOT NULL,
  "projectId" varchar(32),
  "eventType" varchar(64) NOT NULL,
  "entityType" varchar(32) NOT NULL,
  "entityId" varchar(64),
  "status" varchar(16) NOT NULL,
  "recipients" jsonb DEFAULT '[]'::jsonb,
  "detail" text,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_automation_rules_rule_key" ON "automation_rules" USING btree ("ruleKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_runs_rule_entity_created" ON "automation_runs" USING btree ("ruleKey","entityId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_automation_runs_project_created" ON "automation_runs" USING btree ("projectId","createdAt");--> statement-breakpoint
INSERT INTO "automation_rules" ("ruleKey","enabled","config")
VALUES
  ('overdue_reminder', true, '{"graceDays":0,"cadenceHours":24,"scope":"both","notifyRoles":["assignee","pm"],"pushGroup":false}'::jsonb),
  ('high_severity_issue', true, '{"severities":["P0","P1"],"pushGroup":true}'::jsonb),
  ('status_change_notify', false, '{"transitions":{"issue":["resolved","closed"],"task":[],"gate":["approved","rejected"]},"pushGroup":false}'::jsonb),
  ('mp_release_broadcast', true, '{"pushGroup":true}'::jsonb)
ON CONFLICT ("ruleKey") DO NOTHING;

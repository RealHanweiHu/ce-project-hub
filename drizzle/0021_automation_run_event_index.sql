CREATE INDEX IF NOT EXISTS "idx_automation_runs_rule_event_entity_created" ON "automation_runs" USING btree ("ruleKey","eventType","entityId","createdAt");

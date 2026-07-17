CREATE TABLE "key_module_audit_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "moduleId" varchar(32) NOT NULL,
  "action" varchar(32) NOT NULL,
  "fromStatus" "key_module_status",
  "toStatus" "key_module_status",
  "actorId" integer NOT NULL,
  "reason" text,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "key_module_audit_events_valid_action"
    CHECK ("action" IN (
      'create',
      'update_draft',
      'technical_confirm',
      'return_to_draft',
      'approve',
      'restrict',
      'obsolete',
      'derive'
    ))
);--> statement-breakpoint
CREATE INDEX "idx_key_module_audit_module_timeline"
  ON "key_module_audit_events" USING btree ("moduleId", "createdAt", "id");--> statement-breakpoint
CREATE INDEX "idx_key_module_audit_actor"
  ON "key_module_audit_events" USING btree ("actorId");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_key_module_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'key module audit events are append-only'
    USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "key_module_audit_events_immutable"
  BEFORE UPDATE OR DELETE ON "key_module_audit_events"
  FOR EACH ROW
  EXECUTE FUNCTION reject_key_module_audit_event_mutation();

DO $$ BEGIN
  ALTER TABLE "project_calendar_events"
    ADD CONSTRAINT "project_calendar_events_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
    ON DELETE cascade NOT VALID;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

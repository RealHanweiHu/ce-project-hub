ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "projectId" varchar(32);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
    ON DELETE cascade;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notifications_project"
  ON "notifications" USING btree ("projectId");

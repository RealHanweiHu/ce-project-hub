ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "completion_note" text;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "actualStartedAt" timestamp;

-- Intentionally no backfill: legacy in_progress could be inferred solely from
-- schedule/assignment/due date, so it is not trustworthy evidence of a human start.

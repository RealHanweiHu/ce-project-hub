ALTER TABLE "automation_heartbeats"
  ADD COLUMN IF NOT EXISTS "lastCursorId" integer DEFAULT 0 NOT NULL;

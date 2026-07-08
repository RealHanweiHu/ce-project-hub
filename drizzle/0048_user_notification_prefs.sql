ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "notificationPrefs" jsonb DEFAULT '{}'::jsonb NOT NULL;

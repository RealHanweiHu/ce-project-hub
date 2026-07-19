ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "dingtalkGroupOperationStatus" varchar(24) DEFAULT 'idle' NOT NULL,
  ADD COLUMN IF NOT EXISTS "dingtalkGroupIntent" jsonb,
  ADD COLUMN IF NOT EXISTS "dingtalkGroupLastError" text,
  ADD COLUMN IF NOT EXISTS "dingtalkGroupUpdatedAt" timestamp;
--> statement-breakpoint
UPDATE "projects"
SET "dingtalkGroupOperationStatus" = 'bound',
    "dingtalkGroupUpdatedAt" = COALESCE("dingtalkGroupUpdatedAt", now())
WHERE "dingtalkChatId" IS NOT NULL
  AND "dingtalkChatId" <> ''
  AND "dingtalkGroupOperationStatus" = 'idle';

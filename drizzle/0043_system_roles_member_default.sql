ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member';--> statement-breakpoint
UPDATE "users" SET "role" = 'member' WHERE "role"::text = 'user';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typname = 'user_role'
      AND e.enumlabel = 'user'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typnamespace = 'public'::regnamespace
      AND t.typname = 'user_role'
      AND e.enumlabel = 'member'
  ) THEN
    ALTER TYPE "public"."user_role" RENAME VALUE 'user' TO 'member';
  END IF;
END $$;--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'owner' BEFORE 'admin';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'external' AFTER 'member';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'viewer' AFTER 'external';

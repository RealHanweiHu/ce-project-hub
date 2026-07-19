ALTER TABLE "project_members"
  ADD COLUMN IF NOT EXISTS "extraRoles" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_role_delegations" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "role" "project_member_role" NOT NULL,
  "fromUserId" integer,
  "toUserId" integer NOT NULL,
  "startDate" date NOT NULL,
  "endDate" date NOT NULL,
  "reason" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "createdBy" integer NOT NULL,
  "revokedBy" integer,
  "revokedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_role_delegations_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_role_delegations_project_role_dates"
  ON "project_role_delegations" USING btree ("projectId", "role", "startDate", "endDate");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_role_delegations_delegate_active"
  ON "project_role_delegations" USING btree ("toUserId", "active");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_role_fallback_reviewers" (
  "id" serial PRIMARY KEY NOT NULL,
  "role" "project_member_role" NOT NULL,
  "userId" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_role_fallback_reviewer"
  ON "project_role_fallback_reviewers" USING btree ("role", "userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_role_fallback_reviewers_role_active"
  ON "project_role_fallback_reviewers" USING btree ("role", "active");
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "staffingGapRole" "project_member_role";
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "completedBy" integer;
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "approvalActedAsRole" "project_member_role";
--> statement-breakpoint
ALTER TABLE "project_tasks"
  ADD COLUMN IF NOT EXISTS "approvalViaDelegationId" integer;
--> statement-breakpoint
ALTER TABLE "project_deliverable_reviews"
  ADD COLUMN IF NOT EXISTS "actedAsRole" "project_member_role";
--> statement-breakpoint
ALTER TABLE "project_deliverable_reviews"
  ADD COLUMN IF NOT EXISTS "viaDelegationId" integer;
--> statement-breakpoint
ALTER TABLE "project_gate_signoffs"
  ADD COLUMN IF NOT EXISTS "viaDelegationId" integer;
--> statement-breakpoint
-- 约束名必须 ≤63 字符（Postgres 标识符上限，超长会被静默截断，导致下方按名守卫
-- 永不匹配、重跑时 duplicate_object）。守卫用 LIKE 前缀匹配，兼容早期环境里
-- 已按截断名创建的同一约束。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"project_tasks"'::regclass AND contype = 'f'
      AND conname LIKE 'project_tasks_approvalViaDelegationId%'
  ) THEN
    ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_approvalViaDelegationId_fk"
      FOREIGN KEY ("approvalViaDelegationId") REFERENCES "public"."project_role_delegations"("id") ON DELETE set null;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"project_deliverable_reviews"'::regclass AND contype = 'f'
      AND conname LIKE 'project_deliverable_reviews_viaDelegationId%'
  ) THEN
    ALTER TABLE "project_deliverable_reviews" ADD CONSTRAINT "project_deliverable_reviews_viaDelegationId_fk"
      FOREIGN KEY ("viaDelegationId") REFERENCES "public"."project_role_delegations"("id") ON DELETE set null;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"project_gate_signoffs"'::regclass AND contype = 'f'
      AND conname LIKE 'project_gate_signoffs_viaDelegationId%'
  ) THEN
    ALTER TABLE "project_gate_signoffs" ADD CONSTRAINT "project_gate_signoffs_viaDelegationId_fk"
      FOREIGN KEY ("viaDelegationId") REFERENCES "public"."project_role_delegations"("id") ON DELETE set null;
  END IF;
END $$;

-- No backfill: existing rows keep their single-role and pre-four-eyes semantics.

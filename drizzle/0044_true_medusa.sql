CREATE TYPE "public"."customer_variant_status" AS ENUM('draft', 'active', 'on_hold', 'eol');--> statement-breakpoint
CREATE TYPE "public"."external_approval_status" AS ENUM('pending', 'approved', 'rejected', 'terminated', 'sync_failed', 'business_blocked');--> statement-breakpoint
CREATE TYPE "public"."product_revision_status" AS ENUM('draft', 'released', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."project_category" AS ENUM('npd', 'eco', 'idr', 'jdm', 'obt');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'::text;--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member', 'external', 'viewer');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'member'::"public"."user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role" USING "role"::"public"."user_role";--> statement-breakpoint
ALTER TABLE "customer_variants" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."customer_variant_status";--> statement-breakpoint
ALTER TABLE "customer_variants" ALTER COLUMN "status" SET DATA TYPE "public"."customer_variant_status" USING "status"::"public"."customer_variant_status";--> statement-breakpoint
ALTER TABLE "external_approval_instances" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."external_approval_status";--> statement-breakpoint
ALTER TABLE "external_approval_instances" ALTER COLUMN "status" SET DATA TYPE "public"."external_approval_status" USING "status"::"public"."external_approval_status";--> statement-breakpoint
ALTER TABLE "product_revisions" ALTER COLUMN "status" SET DEFAULT 'draft'::"public"."product_revision_status";--> statement-breakpoint
ALTER TABLE "product_revisions" ALTER COLUMN "status" SET DATA TYPE "public"."product_revision_status" USING "status"::"public"."product_revision_status";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "category" SET DEFAULT 'npd'::"public"."project_category";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "category" SET DATA TYPE "public"."project_category" USING "category"::"public"."project_category";--> statement-breakpoint
-- 加外键前清理历史孤儿行（此前无 FK 约束，删除靠应用层清单，漏删的子行已不可达；
-- 审查时本地库实测：孤儿任务 352 / 孤儿阶段行 1057 / 悬挂 BOM 行 285）
DELETE FROM "bom_items" b WHERE b."revisionId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "product_revisions" r WHERE r."id" = b."revisionId");--> statement-breakpoint
DELETE FROM "bom_items" b WHERE b."projectId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = b."projectId");--> statement-breakpoint
DELETE FROM "project_gate_reviews" g WHERE NOT EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = g."projectId");--> statement-breakpoint
DELETE FROM "project_members" m WHERE NOT EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = m."projectId");--> statement-breakpoint
DELETE FROM "project_phases" ph WHERE NOT EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = ph."projectId");--> statement-breakpoint
DELETE FROM "project_tasks" t WHERE NOT EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = t."projectId");--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_revisionId_product_revisions_id_fk" FOREIGN KEY ("revisionId") REFERENCES "public"."product_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items" ADD CONSTRAINT "bom_items_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_gate_reviews" ADD CONSTRAINT "project_gate_reviews_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_phases" ADD CONSTRAINT "project_phases_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
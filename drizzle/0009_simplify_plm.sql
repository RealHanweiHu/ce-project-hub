DROP TABLE "module_library" CASCADE;--> statement-breakpoint
DROP TABLE "module_tasks" CASCADE;--> statement-breakpoint
DROP TABLE "project_modules" CASCADE;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "objectType";
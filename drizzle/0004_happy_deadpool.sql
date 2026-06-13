CREATE TABLE "module_library" (
	"id" serial PRIMARY KEY NOT NULL,
	"moduleKey" varchar(48) NOT NULL,
	"name" varchar(128) NOT NULL,
	"scope" varchar(16) DEFAULT 'shared' NOT NULL,
	"category" varchar(64) DEFAULT '' NOT NULL,
	"ownerRoles" jsonb DEFAULT '[]'::jsonb,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "module_library_moduleKey_unique" UNIQUE("moduleKey")
);
--> statement-breakpoint
CREATE TABLE "module_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"moduleKey" varchar(48) NOT NULL,
	"phase" varchar(32) NOT NULL,
	"task" varchar(256) NOT NULL,
	"executor" varchar(16) DEFAULT 'internal' NOT NULL,
	"ownerRoles" jsonb DEFAULT '[]'::jsonb,
	"gateName" varchar(64),
	"checklist" jsonb DEFAULT '[]'::jsonb,
	"sortOrder" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"moduleKey" varchar(48) NOT NULL,
	"changeLevel" varchar(16) DEFAULT 'redesign' NOT NULL,
	"reusedRevisionId" integer
);
--> statement-breakpoint
ALTER TABLE "project_changelog" ADD COLUMN "productId" varchar(32);--> statement-breakpoint
ALTER TABLE "project_issues" ADD COLUMN "productId" varchar(32);--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_module" ON "project_modules" USING btree ("projectId","moduleKey");
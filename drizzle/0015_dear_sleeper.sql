ALTER TABLE "project_requirements" ALTER COLUMN "projectId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_requirements" ADD COLUMN "convertedType" varchar(16);--> statement-breakpoint
ALTER TABLE "project_requirements" ADD COLUMN "convertedId" varchar(64);
CREATE TYPE "public"."deliverable_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "project_deliverable_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"deliverableName" varchar(256) NOT NULL,
	"status" "deliverable_review_status" DEFAULT 'pending' NOT NULL,
	"reviewerUserId" integer NOT NULL,
	"submittedBy" integer NOT NULL,
	"submittedAt" timestamp DEFAULT now() NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_deliverable_review" ON "project_deliverable_reviews" USING btree ("projectId","phaseId","deliverableName");--> statement-breakpoint
CREATE INDEX "idx_deliverable_review_reviewer" ON "project_deliverable_reviews" USING btree ("reviewerUserId","status");
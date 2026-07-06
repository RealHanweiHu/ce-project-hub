CREATE TYPE "public"."gate_blocker_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."gate_blocker_type" AS ENUM('quality', 'npi');--> statement-breakpoint
CREATE TABLE "project_gate_blockers" (
	"id" serial PRIMARY KEY NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"phaseId" varchar(32) NOT NULL,
	"blockerType" "gate_blocker_type" NOT NULL,
	"title" varchar(512) NOT NULL,
	"description" text,
	"status" "gate_blocker_status" DEFAULT 'open' NOT NULL,
	"createdBy" integer NOT NULL,
	"resolvedBy" integer,
	"resolvedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_gate_blockers_project_phase_status" ON "project_gate_blockers" USING btree ("projectId","phaseId","status");
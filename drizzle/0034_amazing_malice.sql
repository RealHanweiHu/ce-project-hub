CREATE TABLE IF NOT EXISTS "dingtalk_approval_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"businessType" varchar(64) NOT NULL,
	"processCode" varchar(128),
	"enabled" boolean DEFAULT false NOT NULL,
	"defaultDeptId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_approval_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" varchar(32) DEFAULT 'dingtalk' NOT NULL,
	"businessType" varchar(64) NOT NULL,
	"entityType" varchar(64) NOT NULL,
	"entityId" varchar(128) NOT NULL,
	"projectId" varchar(32),
	"processCode" varchar(128),
	"processInstanceId" varchar(128),
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"title" varchar(256),
	"submittedBy" integer NOT NULL,
	"originatorUserId" integer,
	"dingtalkOriginatorUserId" varchar(128),
	"formSnapshot" jsonb DEFAULT '{}'::jsonb,
	"requestSnapshot" jsonb DEFAULT '{}'::jsonb,
	"responseSnapshot" jsonb DEFAULT '{}'::jsonb,
	"lastError" text,
	"approvedAt" timestamp,
	"rejectedAt" timestamp,
	"terminatedAt" timestamp,
	"syncedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mp_releases" ADD COLUMN IF NOT EXISTS "externalApprovalInstanceId" integer;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_dingtalk_approval_config_business" ON "dingtalk_approval_configs" USING btree ("businessType");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_external_approval_process_instance" ON "external_approval_instances" USING btree ("processInstanceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_approval_entity" ON "external_approval_instances" USING btree ("businessType","entityType","entityId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_external_approval_project" ON "external_approval_instances" USING btree ("projectId"); 

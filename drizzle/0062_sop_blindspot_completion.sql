ALTER TABLE "project_issues" ADD COLUMN IF NOT EXISTS "sourceIssueId" integer;
--> statement-breakpoint
ALTER TABLE "project_files" ADD COLUMN IF NOT EXISTS "sourceFileId" integer;
--> statement-breakpoint
ALTER TABLE "product_certificates" ADD COLUMN IF NOT EXISTS "renewalOwnerUserId" integer;
--> statement-breakpoint
ALTER TABLE "product_certificates" ADD COLUMN IF NOT EXISTS "renewalStatus" varchar(24) DEFAULT 'not_started' NOT NULL;
--> statement-breakpoint
ALTER TABLE "product_certificates" ADD COLUMN IF NOT EXISTS "renewalNotes" text;
--> statement-breakpoint
ALTER TABLE "product_certificates" ADD COLUMN IF NOT EXISTS "replacementCertificateId" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_transitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "sourceProjectId" varchar(32) NOT NULL,
  "targetProjectId" varchar(32) NOT NULL,
  "fromCategory" varchar(32) NOT NULL,
  "toCategory" varchar(32) NOT NULL,
  "reason" text NOT NULL,
  "migrationSummary" jsonb DEFAULT '{"issues":0,"files":0,"members":0}'::jsonb NOT NULL,
  "status" varchar(24) DEFAULT 'completed' NOT NULL,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_transitions_sourceProjectId_projects_id_fk" FOREIGN KEY ("sourceProjectId") REFERENCES "public"."projects"("id") ON DELETE restrict,
  CONSTRAINT "project_transitions_targetProjectId_projects_id_fk" FOREIGN KEY ("targetProjectId") REFERENCES "public"."projects"("id") ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_transition_source" ON "project_transitions" USING btree ("sourceProjectId");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_transition_target" ON "project_transitions" USING btree ("targetProjectId");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_termination_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "reason" text NOT NULL,
  "sunkCostSummary" text NOT NULL,
  "customerCommunication" text NOT NULL,
  "ownerUserId" integer NOT NULL,
  "approverUserId" integer NOT NULL,
  "createdBy" integer NOT NULL,
  "submittedBy" integer,
  "submittedAt" timestamp,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "rejectionReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_termination_reviews_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_termination_review_project" ON "project_termination_reviews" USING btree ("projectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_project_termination_approver_status" ON "project_termination_reviews" USING btree ("approverUserId", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_termination_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "reviewId" integer NOT NULL,
  "itemKey" varchar(48) NOT NULL,
  "disposition" text NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "evidenceReference" text,
  "completedBy" integer,
  "completedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_termination_items_reviewId_project_termination_reviews_id_fk" FOREIGN KEY ("reviewId") REFERENCES "public"."project_termination_reviews"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_termination_item" ON "project_termination_items" USING btree ("reviewId", "itemKey");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "product_waivers" (
  "id" serial PRIMARY KEY NOT NULL,
  "waiverNumber" varchar(64) NOT NULL,
  "productId" varchar(32) NOT NULL,
  "projectId" varchar(32),
  "revisionId" integer,
  "title" varchar(256) NOT NULL,
  "deviationDescription" text NOT NULL,
  "impactAssessment" text NOT NULL,
  "containmentPlan" text NOT NULL,
  "scopeType" varchar(24) NOT NULL,
  "lotOrBatch" varchar(256),
  "quantityLimit" integer,
  "affectedPartNumbers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "effectiveFrom" date NOT NULL,
  "expiresOn" date NOT NULL,
  "riskLevel" varchar(16) DEFAULT 'medium' NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "ownerUserId" integer NOT NULL,
  "approverUserId" integer NOT NULL,
  "evidenceReference" text,
  "linkedEcoProjectId" varchar(32),
  "resolutionNote" text,
  "createdBy" integer NOT NULL,
  "submittedBy" integer,
  "submittedAt" timestamp,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "resolvedBy" integer,
  "resolvedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "product_waivers_productId_products_id_fk" FOREIGN KEY ("productId") REFERENCES "public"."products"("id") ON DELETE cascade,
  CONSTRAINT "product_waivers_projectId_projects_id_fk" FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_product_waiver_number" ON "product_waivers" USING btree ("waiverNumber");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_waiver_status_expiry" ON "product_waivers" USING btree ("productId", "status", "expiresOn");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_product_waiver_approver_status" ON "product_waivers" USING btree ("approverUserId", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificate_renewal_alerts" (
  "id" serial PRIMARY KEY NOT NULL,
  "certificateId" integer NOT NULL,
  "validUntil" date NOT NULL,
  "leadDays" integer NOT NULL,
  "recipientUserId" integer NOT NULL,
  "sentAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "certificate_renewal_alerts_certificateId_product_certificates_id_fk" FOREIGN KEY ("certificateId") REFERENCES "public"."product_certificates"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_certificate_renewal_alert" ON "certificate_renewal_alerts" USING btree ("certificateId", "validUntil", "leadDays");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sop_change_requests" (
  "id" serial PRIMARY KEY NOT NULL,
  "requestNumber" varchar(64) NOT NULL,
  "title" varchar(256) NOT NULL,
  "currentVersion" varchar(32) NOT NULL,
  "proposedVersion" varchar(32) NOT NULL,
  "affectedTracks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "changeSummary" text NOT NULL,
  "rationale" text NOT NULL,
  "impactAnalysis" text NOT NULL,
  "migrationStrategy" text NOT NULL,
  "rollbackPlan" text NOT NULL,
  "effectiveDate" date NOT NULL,
  "status" varchar(24) DEFAULT 'draft' NOT NULL,
  "requesterUserId" integer NOT NULL,
  "approverUserId" integer NOT NULL,
  "approvalNote" text,
  "submittedAt" timestamp,
  "approvedAt" timestamp,
  "publishedAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sop_change_request_number" ON "sop_change_requests" USING btree ("requestNumber");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_sop_published_version" ON "sop_change_requests" USING btree ("proposedVersion") WHERE "status" = 'published';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sop_change_approver_status" ON "sop_change_requests" USING btree ("approverUserId", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sop_change_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "requestId" integer NOT NULL,
  "action" varchar(48) NOT NULL,
  "actorUserId" integer NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "sop_change_events_requestId_sop_change_requests_id_fk" FOREIGN KEY ("requestId") REFERENCES "public"."sop_change_requests"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sop_change_event_request_created" ON "sop_change_events" USING btree ("requestId", "createdAt");

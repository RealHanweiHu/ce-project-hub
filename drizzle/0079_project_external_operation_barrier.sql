CREATE TABLE "project_deletion_leases" (
  "projectId" varchar(32) PRIMARY KEY NOT NULL,
  "token" varchar(64) NOT NULL,
  "previousLifecycle" varchar(24) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_deletion_leases_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE "project_external_operations" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "token" varchar(64) NOT NULL,
  "kind" varchar(64) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_external_operations_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_external_operation_token_project"
  ON "project_external_operations" USING btree ("token", "projectId");
--> statement-breakpoint
CREATE INDEX "idx_project_external_operations_project_expiry"
  ON "project_external_operations" USING btree ("projectId", "expiresAt");

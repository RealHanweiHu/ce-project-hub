CREATE TABLE IF NOT EXISTS "project_collections" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "name" varchar(128) NOT NULL,
  "description" text,
  "createdBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_project_collection_name"
  ON "project_collections" USING btree ("name");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_collection_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "collectionId" varchar(32) NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "addedBy" integer NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_collection_items_collectionId_project_collections_id_fk"
    FOREIGN KEY ("collectionId") REFERENCES "public"."project_collections"("id") ON DELETE cascade,
  CONSTRAINT "project_collection_items_projectId_projects_id_fk"
    FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_collection_project"
  ON "project_collection_items" USING btree ("collectionId", "projectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collection_items_project"
  ON "project_collection_items" USING btree ("projectId");

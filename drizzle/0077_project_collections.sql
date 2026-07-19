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
DELETE FROM "project_collection_items" AS older
USING "project_collection_items" AS newer
WHERE older."projectId" = newer."projectId"
  AND (
    older."createdAt" < newer."createdAt"
    OR (older."createdAt" = newer."createdAt" AND older."id" < newer."id")
  );
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_collection_project";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_collection_items_project";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_project_collection_membership"
  ON "project_collection_items" USING btree ("projectId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_collection_items_collection"
  ON "project_collection_items" USING btree ("collectionId");

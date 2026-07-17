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

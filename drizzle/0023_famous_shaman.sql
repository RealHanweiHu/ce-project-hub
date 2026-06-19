ALTER TABLE "mp_releases" ADD COLUMN "snapshotChangelog" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "project_changelog" ADD COLUMN "revisionId" integer;--> statement-breakpoint
CREATE INDEX "idx_changelog_revision" ON "project_changelog" USING btree ("revisionId");
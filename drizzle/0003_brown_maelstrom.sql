CREATE TABLE "mp_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"productId" varchar(32) NOT NULL,
	"revisionId" integer NOT NULL,
	"projectId" varchar(32) NOT NULL,
	"snapshotBom" jsonb DEFAULT '[]'::jsonb,
	"snapshotDocs" jsonb DEFAULT '[]'::jsonb,
	"openIssues" jsonb DEFAULT '[]'::jsonb,
	"specs" jsonb DEFAULT '{}'::jsonb,
	"notes" text,
	"releasedBy" integer NOT NULL,
	"releasedAt" timestamp DEFAULT now() NOT NULL
);

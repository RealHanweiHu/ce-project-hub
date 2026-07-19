CREATE TYPE "public"."project_module_key" AS ENUM(
  'battery',
  'core_function',
  'electronics',
  'software_connectivity',
  'structure_mold',
  'id_cmf'
);--> statement-breakpoint
CREATE TYPE "public"."module_reuse_state" AS ENUM(
  'reused',
  'not_reused'
);--> statement-breakpoint
CREATE TABLE "product_technical_baselines" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "productId" varchar(32) NOT NULL,
  "baselineLabel" varchar(64) NOT NULL,
  "sourceProjectId" varchar(32) NOT NULL,
  "keyModulesSnapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "bomSnapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "specSnapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "releasedBy" integer NOT NULL,
  "releasedAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "product_module_assignments" (
  "id" serial PRIMARY KEY NOT NULL,
  "technicalBaselineId" varchar(32) NOT NULL,
  "moduleType" "key_module_type" NOT NULL,
  "moduleId" varchar(32) NOT NULL,
  "moduleSnapshot" jsonb NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "project_module_baselines" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "drvModuleKey" "project_module_key" NOT NULL,
  "reuseState" "module_reuse_state" NOT NULL,
  "keyModuleId" varchar(32),
  "sourceProductId" varchar(32),
  "sourceTechnicalBaselineId" varchar(32),
  "moduleSnapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "confirmedBy" integer NOT NULL,
  "confirmedAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_module_baselines_reference_consistency" CHECK (
    (
      "drvModuleKey" IN ('battery', 'core_function', 'electronics')
      AND (
        ("reuseState" = 'reused' AND "keyModuleId" IS NOT NULL)
        OR ("reuseState" = 'not_reused' AND "keyModuleId" IS NULL)
      )
    )
    OR (
      "drvModuleKey" IN ('software_connectivity', 'structure_mold', 'id_cmf')
      AND "keyModuleId" IS NULL
    )
  )
);--> statement-breakpoint
ALTER TABLE "products"
  ADD COLUMN "currentTechnicalBaselineId" varchar(32);--> statement-breakpoint
ALTER TABLE "bom_items"
  ADD COLUMN "keyModuleId" varchar(32);--> statement-breakpoint
ALTER TABLE "bom_items"
  ADD COLUMN "keyModuleSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "product_technical_baselines"
  ADD CONSTRAINT "product_technical_baselines_productId_products_id_fk"
  FOREIGN KEY ("productId") REFERENCES "public"."products"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_technical_baselines"
  ADD CONSTRAINT "product_technical_baselines_sourceProjectId_projects_id_fk"
  FOREIGN KEY ("sourceProjectId") REFERENCES "public"."projects"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_technical_baselines"
  ADD CONSTRAINT "product_technical_baselines_releasedBy_users_id_fk"
  FOREIGN KEY ("releasedBy") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_module_assignments"
  ADD CONSTRAINT "product_module_assignments_technicalBaselineId_product_technical_baselines_id_fk"
  FOREIGN KEY ("technicalBaselineId") REFERENCES "public"."product_technical_baselines"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_module_assignments"
  ADD CONSTRAINT "product_module_assignments_moduleId_key_modules_id_fk"
  FOREIGN KEY ("moduleId") REFERENCES "public"."key_modules"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_module_baselines"
  ADD CONSTRAINT "project_module_baselines_projectId_projects_id_fk"
  FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_module_baselines"
  ADD CONSTRAINT "project_module_baselines_keyModuleId_key_modules_id_fk"
  FOREIGN KEY ("keyModuleId") REFERENCES "public"."key_modules"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_module_baselines"
  ADD CONSTRAINT "project_module_baselines_sourceProductId_products_id_fk"
  FOREIGN KEY ("sourceProductId") REFERENCES "public"."products"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_module_baselines"
  ADD CONSTRAINT "project_module_baselines_sourceTechnicalBaselineId_product_technical_baselines_id_fk"
  FOREIGN KEY ("sourceTechnicalBaselineId") REFERENCES "public"."product_technical_baselines"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_module_baselines"
  ADD CONSTRAINT "project_module_baselines_confirmedBy_users_id_fk"
  FOREIGN KEY ("confirmedBy") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_currentTechnicalBaselineId_product_technical_baselines_id_fk"
  FOREIGN KEY ("currentTechnicalBaselineId") REFERENCES "public"."product_technical_baselines"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_items"
  ADD CONSTRAINT "bom_items_keyModuleId_key_modules_id_fk"
  FOREIGN KEY ("keyModuleId") REFERENCES "public"."key_modules"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_technical_baseline_label"
  ON "product_technical_baselines" USING btree ("productId", "baselineLabel");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_technical_baseline_source_project"
  ON "product_technical_baselines" USING btree ("sourceProjectId");--> statement-breakpoint
CREATE INDEX "idx_product_technical_baselines_product_released"
  ON "product_technical_baselines" USING btree ("productId", "releasedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_product_module_assignment_type"
  ON "product_module_assignments" USING btree ("technicalBaselineId", "moduleType");--> statement-breakpoint
CREATE INDEX "idx_product_module_assignments_module"
  ON "product_module_assignments" USING btree ("moduleId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_module_baseline_key"
  ON "project_module_baselines" USING btree ("projectId", "drvModuleKey");--> statement-breakpoint
CREATE INDEX "idx_project_module_baselines_key_module"
  ON "project_module_baselines" USING btree ("keyModuleId");--> statement-breakpoint
CREATE INDEX "idx_project_module_baselines_source_product"
  ON "project_module_baselines" USING btree ("sourceProductId");--> statement-breakpoint
CREATE INDEX "idx_bom_key_module"
  ON "bom_items" USING btree ("keyModuleId");

CREATE TABLE "project_product_module_bindings" (
  "id" serial PRIMARY KEY NOT NULL,
  "projectId" varchar(32) NOT NULL,
  "moduleType" "key_module_type" NOT NULL,
  "moduleId" varchar(32) NOT NULL,
  "moduleSnapshot" jsonb NOT NULL,
  "boundBy" integer NOT NULL,
  "boundAt" timestamp NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "project_product_module_bindings"
  ADD CONSTRAINT "project_product_module_bindings_projectId_projects_id_fk"
  FOREIGN KEY ("projectId") REFERENCES "public"."projects"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_product_module_bindings"
  ADD CONSTRAINT "project_product_module_bindings_moduleId_key_modules_id_fk"
  FOREIGN KEY ("moduleId") REFERENCES "public"."key_modules"("id")
  ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_product_module_bindings"
  ADD CONSTRAINT "project_product_module_bindings_boundBy_users_id_fk"
  FOREIGN KEY ("boundBy") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_project_product_module_type"
  ON "project_product_module_bindings" USING btree ("projectId", "moduleType");--> statement-breakpoint
CREATE INDEX "idx_project_product_module_binding_module"
  ON "project_product_module_bindings" USING btree ("moduleId");

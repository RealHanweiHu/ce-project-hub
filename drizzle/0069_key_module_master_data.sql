CREATE TYPE "public"."key_module_status" AS ENUM(
  'draft',
  'technical_confirmed',
  'approved',
  'restricted',
  'obsolete'
);--> statement-breakpoint
CREATE TYPE "public"."key_module_type" AS ENUM(
  'battery_energy',
  'core_function',
  'electronics_hardware'
);--> statement-breakpoint
CREATE TABLE "key_modules" (
  "id" varchar(32) PRIMARY KEY NOT NULL,
  "moduleNumber" varchar(64) NOT NULL,
  "moduleType" "key_module_type" NOT NULL,
  "name" varchar(256) NOT NULL,
  "category" varchar(64) DEFAULT '' NOT NULL,
  "model" varchar(128),
  "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "key_module_status" DEFAULT 'draft' NOT NULL,
  "derivedFromModuleId" varchar(32),
  "evidenceRefs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "createdBy" integer NOT NULL,
  "technicalConfirmedBy" integer,
  "technicalConfirmedAt" timestamp,
  "approvedBy" integer,
  "approvedAt" timestamp,
  "restrictionReason" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "key_module_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "moduleId" varchar(32) NOT NULL,
  "partNumber" varchar(64) NOT NULL,
  "name" varchar(256) NOT NULL,
  "spec" text DEFAULT '' NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "refDesignator" varchar(128) DEFAULT '' NOT NULL,
  "componentProductId" varchar(32),
  "sortOrder" integer DEFAULT 0 NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "key_module_items_quantity_positive" CHECK ("quantity" > 0)
);--> statement-breakpoint
ALTER TABLE "key_modules"
  ADD CONSTRAINT "key_modules_derivedFromModuleId_key_modules_id_fk"
  FOREIGN KEY ("derivedFromModuleId") REFERENCES "public"."key_modules"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_modules"
  ADD CONSTRAINT "key_modules_createdBy_users_id_fk"
  FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_modules"
  ADD CONSTRAINT "key_modules_technicalConfirmedBy_users_id_fk"
  FOREIGN KEY ("technicalConfirmedBy") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_modules"
  ADD CONSTRAINT "key_modules_approvedBy_users_id_fk"
  FOREIGN KEY ("approvedBy") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_module_items"
  ADD CONSTRAINT "key_module_items_moduleId_key_modules_id_fk"
  FOREIGN KEY ("moduleId") REFERENCES "public"."key_modules"("id")
  ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "key_module_items"
  ADD CONSTRAINT "key_module_items_componentProductId_products_id_fk"
  FOREIGN KEY ("componentProductId") REFERENCES "public"."products"("id")
  ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_key_modules_number"
  ON "key_modules" USING btree ("moduleNumber");--> statement-breakpoint
CREATE INDEX "idx_key_modules_type_status_category"
  ON "key_modules" USING btree ("moduleType", "status", "category");--> statement-breakpoint
CREATE INDEX "idx_key_modules_derived_from"
  ON "key_modules" USING btree ("derivedFromModuleId");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_key_module_item_position"
  ON "key_module_items" USING btree ("moduleId", "partNumber", "refDesignator");--> statement-breakpoint
CREATE INDEX "idx_key_module_items_module"
  ON "key_module_items" USING btree ("moduleId");--> statement-breakpoint
CREATE INDEX "idx_key_module_items_component_product"
  ON "key_module_items" USING btree ("componentProductId");

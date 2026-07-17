ALTER TABLE "project_product_module_bindings"
  ADD COLUMN "customerConfirmationRef" text;--> statement-breakpoint
ALTER TABLE "project_product_module_bindings"
  ADD CONSTRAINT "project_product_module_confirmation_nonblank"
  CHECK (
    "customerConfirmationRef" IS NULL
    OR btrim("customerConfirmationRef") <> ''
  );

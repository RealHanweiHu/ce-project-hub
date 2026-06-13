import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  getCustomFieldDefs,
  createCustomFieldDef,
  updateCustomFieldDef,
  deleteCustomFieldDef,
} from "../db";
import { CUSTOM_FIELD_TYPES } from "../../drizzle/schema";

const defInputSchema = z.object({
  entityType: z.string().default("project"),
  fieldKey: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_]+$/, "只能含字母、数字、下划线"),
  label: z.string().min(1).max(128),
  fieldType: z.enum(CUSTOM_FIELD_TYPES),
  options: z.array(z.string()).default([]),
  required: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const defPatchSchema = z.object({
  label: z.string().min(1).max(128).optional(),
  fieldType: z.enum(CUSTOM_FIELD_TYPES).optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  archived: z.boolean().optional(),
});

export const customFieldsRouter = router({
  /** List active custom field definitions (any logged-in user, to render/edit values). */
  listDefs: protectedProcedure
    .input(z.object({ entityType: z.string().default("project"), includeArchived: z.boolean().default(false) }).optional())
    .query(({ input }) => getCustomFieldDefs(input?.entityType ?? "project", input?.includeArchived ?? false)),

  /** Create a definition (system admin only). */
  createDef: adminProcedure
    .input(defInputSchema)
    .mutation(async ({ input }) => {
      const id = await createCustomFieldDef(input);
      return { id };
    }),

  /** Update a definition (system admin only). */
  updateDef: adminProcedure
    .input(z.object({ id: z.number().int(), patch: defPatchSchema }))
    .mutation(async ({ input }) => {
      await updateCustomFieldDef(input.id, input.patch);
      return { success: true } as const;
    }),

  /** Delete a definition (system admin only). Values left in projects.customFields are simply ignored. */
  deleteDef: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      await deleteCustomFieldDef(input.id);
      return { success: true } as const;
    }),
});

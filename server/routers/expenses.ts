import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createActivityLog,
  createProjectExpense,
  deleteProjectExpense,
  getProjectById,
  getProjectExpenseSummary,
  getProjectMembers,
  listProjectExpenses,
  updateProjectExpense,
} from "../db";
import { getEffectiveProjectRoleById as getEffectiveRole } from "../project-access";
import { ROLE_PERMISSIONS } from "./members";
import { PROJECT_EXPENSE_CATEGORIES, PROJECT_EXPENSE_STATUSES } from "../../drizzle/schema";
import { isSystemAdminRole } from "../../shared/system-roles";
import { isISODate } from "../../shared/scheduling";

const amountMinor = z.number().int().min(0).max(2_000_000_000);
const currency = z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
const optionalDate = z.string().refine(isISODate, "日期必须是 YYYY-MM-DD").nullable().optional();

const expenseFields = {
  category: z.enum(PROJECT_EXPENSE_CATEGORIES),
  title: z.string().trim().min(1).max(256),
  supplier: z.string().trim().max(256).nullable().optional(),
  currency,
  budgetAmountMinor: amountMinor,
  actualAmountMinor: amountMinor,
  status: z.enum(PROJECT_EXPENSE_STATUSES),
  ownerUserId: z.number().int().positive(),
  occurredDate: optionalDate,
  evidenceReference: z.string().trim().max(5000).nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
};

async function expenseAccess(projectId: string, userId: number, systemRole: string) {
  const role = await getEffectiveRole(projectId, userId);
  if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
  const canView = isSystemAdminRole(systemRole) || ROLE_PERMISSIONS[role].canViewCommercials;
  if (!canView) throw new TRPCError({ code: "FORBIDDEN", message: "没有查看项目费用的权限" });
  const canEdit = isSystemAdminRole(systemRole) || ROLE_PERMISSIONS[role].canEditProjectInfo || ROLE_PERMISSIONS[role].canEditChangelog;
  return { role, canEdit };
}

async function assertExpenseOwner(projectId: string, userId: number) {
  const project = await getProjectById(projectId);
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "项目不存在" });
  if (project.createdBy === userId || project.pmUserId === userId) return;
  const member = (await getProjectMembers(projectId)).find((item) => item.userId === userId);
  if (!member || ["external_customer", "supplier"].includes(member.role)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "费用责任人必须是项目内部成员" });
  }
}

function assertExpenseEvidence(input: { actualAmountMinor: number; status: string; evidenceReference?: string | null }) {
  if ((input.actualAmountMinor > 0 || input.status === "paid") && !input.evidenceReference?.trim()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "已有实际支出或已付款时必须填写凭证/受控证据引用" });
  }
}

export const expensesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await expenseAccess(input.projectId, ctx.user.id, ctx.user.role);
      return listProjectExpenses(input.projectId);
    }),

  summary: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await expenseAccess(input.projectId, ctx.user.id, ctx.user.role);
      return getProjectExpenseSummary(input.projectId);
    }),

  create: protectedProcedure
    .input(z.object({ projectId: z.string(), ...expenseFields }))
    .mutation(async ({ ctx, input }) => {
      const access = await expenseAccess(input.projectId, ctx.user.id, ctx.user.role);
      if (!access.canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "没有登记项目费用的权限" });
      await assertExpenseOwner(input.projectId, input.ownerUserId);
      assertExpenseEvidence(input);
      const row = await createProjectExpense({
        ...input,
        supplier: input.supplier ?? null,
        occurredDate: input.occurredDate ?? null,
        evidenceReference: input.evidenceReference ?? null,
        notes: input.notes ?? null,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "expense.create",
        entityType: "project_expense",
        entityId: String(row.id),
        meta: { category: row.category, currency: row.currency, budgetAmountMinor: row.budgetAmountMinor, actualAmountMinor: row.actualAmountMinor },
      });
      return row;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), projectId: z.string(), ...expenseFields }))
    .mutation(async ({ ctx, input }) => {
      const access = await expenseAccess(input.projectId, ctx.user.id, ctx.user.role);
      if (!access.canEdit) throw new TRPCError({ code: "FORBIDDEN", message: "没有更新项目费用的权限" });
      await assertExpenseOwner(input.projectId, input.ownerUserId);
      assertExpenseEvidence(input);
      const { id, projectId, ...patch } = input;
      const row = await updateProjectExpense({
        id,
        projectId,
        patch: {
          ...patch,
          supplier: patch.supplier ?? null,
          occurredDate: patch.occurredDate ?? null,
          evidenceReference: patch.evidenceReference ?? null,
          notes: patch.notes ?? null,
        },
      });
      await createActivityLog({ projectId, userId: ctx.user.id, action: "expense.update", entityType: "project_expense", entityId: String(id), meta: { status: row.status, budgetAmountMinor: row.budgetAmountMinor, actualAmountMinor: row.actualAmountMinor } });
      return row;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const access = await expenseAccess(input.projectId, ctx.user.id, ctx.user.role);
      if (!isSystemAdminRole(ctx.user.role) && !ROLE_PERMISSIONS[access.role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有项目管理者可以删除未发生的费用计划" });
      }
      try {
        await deleteProjectExpense(input.id, input.projectId);
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "费用删除失败" });
      }
      await createActivityLog({ projectId: input.projectId, userId: ctx.user.id, action: "expense.delete", entityType: "project_expense", entityId: String(input.id) });
      return { success: true };
    }),
});

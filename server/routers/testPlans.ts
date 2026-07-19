import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createActivityLog,
  createProjectIssue,
  createProjectTestCase,
  createProjectTestPlan,
  createProjectTestReport,
  getProjectFileById,
  getProjectTestCaseById,
  getProjectTestCases,
  getProjectTestPlanById,
  getProjectTestPlans,
  getProjectTestReportById,
  getProjectTestReports,
  linkProjectTestCaseIssue,
  reviewProjectTestReport,
  updateProjectTestCase,
  updateProjectTestPlan,
  updateProjectTestReport,
} from "../db";
import { protectedProcedure, router } from "../_core/trpc";
import { canRoleViewInternalWorkspace } from "../file-visibility";
import { assertProjectAccess, type ProjectAccess } from "../project-access";
import { getEffectivePhasesForProjectLike } from "../../shared/npd-v3";
import {
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  TEST_CASE_STATUSES,
  TEST_PLAN_STATUSES,
  TEST_REPORT_RESULTS,
  TEST_REPORT_REVIEW_STATUSES,
  type IssueCategory,
} from "../../drizzle/schema";
import { emitAutomationEvent } from "../automation/events";

const FORMAL_TEST_PHASES = new Set(["verification", "evt", "dvt", "pvt"]);

function assertQaAuthority(access: ProjectAccess) {
  if (!access.isAdmin && !access.permissions.canQualityGateBlock) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 QA/管理层可以维护测试计划和测试报告" });
  }
}

function assertIssueAuthority(access: ProjectAccess) {
  if (!access.isAdmin && !access.permissions.canEditIssues && !access.permissions.canQualityGateBlock) {
    throw new TRPCError({ code: "FORBIDDEN", message: "只有 QA/工程/管理层可以把测试失败项转为 Issue" });
  }
}

function assertInternalWorkspace(access: ProjectAccess) {
  if (!canRoleViewInternalWorkspace(access.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "外部协作者不能访问内部测试计划和测试报告" });
  }
}

function assertFormalTestPhase(access: ProjectAccess, phaseId: string) {
  const exists = getEffectivePhasesForProjectLike(access.project).some((phase) => phase.id === phaseId);
  if (!exists) throw new TRPCError({ code: "BAD_REQUEST", message: "项目阶段不存在" });
  if (!FORMAL_TEST_PHASES.has(phaseId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "正式测试计划/报告仅适用于验证、EVT、DVT、PVT 阶段" });
  }
}

function toIssueCategory(category: string): IssueCategory {
  return (ISSUE_CATEGORIES as readonly string[]).includes(category) ? category as IssueCategory : "other";
}

export const testPlansRouter = router({
  plans: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectTestPlans(input.projectId, input.phaseId);
    }),

  reports: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectTestReports(input.projectId, input.phaseId);
    }),

  cases: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string().optional(),
      planId: z.number().int().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      if (!canRoleViewInternalWorkspace(access.role)) return [];
      return getProjectTestCases(input.projectId, input.phaseId, input.planId);
    }),

  createPlan: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      title: z.string().trim().min(1).max(256),
      scope: z.string().trim().max(5000).nullable().optional(),
      sampleSize: z.string().trim().max(64).nullable().optional(),
      ownerUserId: z.number().int().nullable().optional(),
      status: z.enum(TEST_PLAN_STATUSES).default("active"),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      assertFormalTestPhase(access, input.phaseId);

      const id = await createProjectTestPlan({
        projectId: input.projectId,
        phaseId: input.phaseId,
        title: input.title,
        scope: input.scope ?? null,
        sampleSize: input.sampleSize ?? null,
        ownerUserId: input.ownerUserId ?? null,
        status: input.status,
        createdBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "test_plan.create",
        entityType: "test_plan",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, status: input.status },
      });
      return { success: true, id };
    }),

  updatePlan: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(256).optional(),
      scope: z.string().trim().max(5000).nullable().optional(),
      sampleSize: z.string().trim().max(64).nullable().optional(),
      ownerUserId: z.number().int().nullable().optional(),
      status: z.enum(TEST_PLAN_STATUSES).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      const plan = await getProjectTestPlanById(input.id);
      if (!plan || plan.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "测试计划不存在" });
      }
      const { id, projectId, ...patch } = input;
      await updateProjectTestPlan(id, patch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "test_plan.update",
        entityType: "test_plan",
        entityId: String(id),
        meta: { phaseId: plan.phaseId, patch },
      });
      return { success: true };
    }),

  createCase: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      planId: z.number().int().nullable().optional(),
      title: z.string().trim().min(1).max(256),
      category: z.string().trim().min(1).max(64).default("functional"),
      acceptanceCriteria: z.string().trim().max(5000).nullable().optional(),
      method: z.string().trim().max(5000).nullable().optional(),
      sampleSerials: z.array(z.string().trim().min(1).max(128)).max(50).default([]),
      severity: z.enum(ISSUE_SEVERITIES).default("P2"),
      ownerUserId: z.number().int().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      assertFormalTestPhase(access, input.phaseId);

      if (input.planId != null) {
        const plan = await getProjectTestPlanById(input.planId);
        if (!plan || plan.projectId !== input.projectId || plan.phaseId !== input.phaseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "测试项关联的计划不属于当前阶段" });
        }
      }

      const id = await createProjectTestCase({
        projectId: input.projectId,
        phaseId: input.phaseId,
        planId: input.planId ?? null,
        title: input.title,
        category: input.category,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        method: input.method ?? null,
        sampleSerials: input.sampleSerials,
        severity: input.severity,
        status: "planned",
        ownerUserId: input.ownerUserId ?? null,
        createdBy: ctx.user.id,
        updatedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "test_case.create",
        entityType: "test_case",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, severity: input.severity, sampleSerials: input.sampleSerials },
      });
      return { success: true, id };
    }),

  updateCase: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(256).optional(),
      category: z.string().trim().min(1).max(64).optional(),
      acceptanceCriteria: z.string().trim().max(5000).nullable().optional(),
      method: z.string().trim().max(5000).nullable().optional(),
      sampleSerials: z.array(z.string().trim().min(1).max(128)).max(50).optional(),
      severity: z.enum(ISSUE_SEVERITIES).optional(),
      status: z.enum(TEST_CASE_STATUSES).optional(),
      resultNotes: z.string().trim().max(10000).nullable().optional(),
      evidenceFileId: z.number().int().nullable().optional(),
      ownerUserId: z.number().int().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      const testCase = await getProjectTestCaseById(input.id);
      if (!testCase || testCase.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "测试项不存在" });
      }
      if (input.evidenceFileId != null) {
        const file = await getProjectFileById(input.evidenceFileId);
        if (!file || file.projectId !== input.projectId || file.phaseId !== testCase.phaseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "测试项证据文件不属于当前阶段" });
        }
      }
      const { id, projectId, ...patch } = input;
      await updateProjectTestCase(id, { ...patch, updatedBy: ctx.user.id });
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "test_case.update",
        entityType: "test_case",
        entityId: String(id),
        meta: { phaseId: testCase.phaseId, patch },
      });
      return { success: true };
    }),

  createReport: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      phaseId: z.string(),
      planId: z.number().int().nullable().optional(),
      title: z.string().trim().min(1).max(256),
      reportNo: z.string().trim().max(64).nullable().optional(),
      result: z.enum(TEST_REPORT_RESULTS).default("conditional"),
      summary: z.string().trim().max(10000).nullable().optional(),
      fileId: z.number().int(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      assertFormalTestPhase(access, input.phaseId);

      if (input.planId != null) {
        const plan = await getProjectTestPlanById(input.planId);
        if (!plan || plan.projectId !== input.projectId || plan.phaseId !== input.phaseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "测试报告关联的计划不属于当前阶段" });
        }
      }
      const file = await getProjectFileById(input.fileId);
      if (!file || file.projectId !== input.projectId || file.phaseId !== input.phaseId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "测试报告必须绑定当前阶段的正式文件" });
      }

      const id = await createProjectTestReport({
        projectId: input.projectId,
        phaseId: input.phaseId,
        planId: input.planId ?? null,
        title: input.title,
        reportNo: input.reportNo ?? null,
        result: input.result,
        reviewStatus: "pending",
        summary: input.summary ?? null,
        fileId: input.fileId,
        submittedBy: ctx.user.id,
      });
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "test_report.create",
        entityType: "test_report",
        entityId: String(id),
        meta: { phaseId: input.phaseId, title: input.title, result: input.result },
      });
      return { success: true, id };
    }),

  updateReport: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      projectId: z.string(),
      title: z.string().trim().min(1).max(256).optional(),
      reportNo: z.string().trim().max(64).nullable().optional(),
      result: z.enum(TEST_REPORT_RESULTS).optional(),
      summary: z.string().trim().max(10000).nullable().optional(),
      fileId: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const access = await assertProjectAccess(input.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      const report = await getProjectTestReportById(input.id);
      if (!report || report.projectId !== input.projectId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "测试报告不存在" });
      }
      if (input.fileId != null) {
        const file = await getProjectFileById(input.fileId);
        if (!file || file.projectId !== input.projectId || file.phaseId !== report.phaseId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "测试报告关联的文件不属于当前阶段" });
        }
      }
      const { id, projectId, ...patch } = input;
      const nextPatch: Parameters<typeof updateProjectTestReport>[1] = { ...patch };
      if (patch.fileId != null && report.reviewStatus === "approved") {
        nextPatch.reviewStatus = "pending";
        nextPatch.reviewedBy = null;
        nextPatch.reviewedAt = null;
      }
      await updateProjectTestReport(id, nextPatch);
      await createActivityLog({
        projectId,
        userId: ctx.user.id,
        action: "test_report.update",
        entityType: "test_report",
        entityId: String(id),
        meta: { phaseId: report.phaseId, patch },
      });
      return { success: true };
    }),

  reviewReport: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      reviewStatus: z.enum(TEST_REPORT_REVIEW_STATUSES).refine((status) => status !== "pending", {
        message: "复核结果必须为 approved 或 rejected",
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const report = await getProjectTestReportById(input.id);
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "测试报告不存在" });
      const access = await assertProjectAccess(report.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertQaAuthority(access);
      if (input.reviewStatus === "approved" && report.fileId == null) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "测试报告未绑定正式文件，不能 QA 确认" });
      }

      await reviewProjectTestReport(input.id, ctx.user.id, input.reviewStatus as "approved" | "rejected");
      await createActivityLog({
        projectId: report.projectId,
        userId: ctx.user.id,
        action: "test_report.review",
        entityType: "test_report",
        entityId: String(input.id),
        meta: { phaseId: report.phaseId, reviewStatus: input.reviewStatus, title: report.title },
      });
      return { success: true };
    }),

  createIssueFromCase: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      owner: z.string().trim().max(256).nullable().optional(),
      targetDate: z.string().trim().max(32).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const testCase = await getProjectTestCaseById(input.id);
      if (!testCase) throw new TRPCError({ code: "NOT_FOUND", message: "测试项不存在" });
      const access = await assertProjectAccess(testCase.projectId, ctx.user);
      assertInternalWorkspace(access);
      assertIssueAuthority(access);
      if (testCase.status !== "failed" && testCase.status !== "blocked") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "只有失败或阻塞测试项需要转 Issue" });
      }
      if (testCase.relatedIssueId) {
        return { success: true, id: testCase.relatedIssueId, existed: true };
      }

      const description = [
        `来源测试项：${testCase.title}`,
        testCase.sampleSerials?.length ? `样机/SN：${testCase.sampleSerials.join(", ")}` : null,
        testCase.acceptanceCriteria ? `判定标准：${testCase.acceptanceCriteria}` : null,
        testCase.method ? `测试方法：${testCase.method}` : null,
        testCase.resultNotes ? `测试结论：${testCase.resultNotes}` : null,
      ].filter(Boolean).join("\n");
      const issueId = await createProjectIssue({
        projectId: testCase.projectId,
        phaseId: testCase.phaseId,
        title: `[测试失败] ${testCase.title}`,
        description,
        severity: testCase.severity,
        status: "open",
        category: toIssueCategory(testCase.category),
        owner: input.owner ?? null,
        reporter: ctx.user.name ?? null,
        foundDate: new Date().toISOString().slice(0, 10),
        targetDate: input.targetDate ?? null,
        relatedTaskId: null,
        creatorId: ctx.user.id,
        productId: access.project.productId ?? null,
      });
      const afterIssue = {
        id: issueId,
        projectId: testCase.projectId,
        phaseId: testCase.phaseId,
        title: `[测试失败] ${testCase.title}`,
        description,
        severity: testCase.severity,
        status: "open",
        category: toIssueCategory(testCase.category),
        owner: input.owner ?? null,
        reporter: ctx.user.name ?? null,
        targetDate: input.targetDate ?? null,
        creatorId: ctx.user.id,
      };
      await linkProjectTestCaseIssue(testCase.id, issueId, ctx.user.id);
      await createActivityLog({
        projectId: testCase.projectId,
        userId: ctx.user.id,
        action: "test_case.issue_create",
        entityType: "test_case",
        entityId: String(testCase.id),
        meta: { phaseId: testCase.phaseId, issueId, title: testCase.title },
      });
      await createActivityLog({
        projectId: testCase.projectId,
        userId: ctx.user.id,
        action: "issue.create",
        entityType: "issue",
        entityId: String(issueId),
        meta: { phaseId: testCase.phaseId, title: afterIssue.title, severity: testCase.severity, after: afterIssue },
      });
      await emitAutomationEvent({
        action: "issue.create",
        projectId: testCase.projectId,
        entityType: "issue",
        entityId: issueId,
        actorId: ctx.user.id,
        after: afterIssue,
      });
      return { success: true, id: issueId, existed: false };
    }),
});

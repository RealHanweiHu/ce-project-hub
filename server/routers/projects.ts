import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getAllActiveProjects,
  getProjectsByMember,
  getProjectById,
  getProductById,
  createProjectWithSeed,
  updateProject,
  deleteProject,
  getPortfolio,
  createActivityLog,
  ensureProjectMember,
  assignTasksByRole,
  getProjectTasks,
  upsertProjectTask,
  updateProjectMeetingConfig,
  getProductDefinitionByProductId,
  confirmProductDefinition,
  getLatestProductDefinitionSnapshot,
  getProductDefinitionSnapshotById,
  listProductDefinitionChanges,
} from "../db";
import { PROJECT_CATEGORIES } from "../../drizzle/schema";
import { applyProjectSchedule } from "../services/schedule-service";
import { TRPCError } from "@trpc/server";
import { ROLE_PERMISSIONS } from "./members";
import { notifyUsersViaDingtalk, resolveCorpIdsForUsers } from "../_core/dingtalkMessage";
import { createGroupChat, disbandGroupChat, sendToGroupChat } from "../_core/dingtalkGroup";
import { storageDelete } from "../storage";
import { getProjectMembers, getProjectRolesForUser } from "../db";
import { taskDisplayTitle } from "../task-title";
import { getPhasesForCategory } from "../../shared/sop-templates";
import { isSystemAdminRole, systemRoleCanCreateProject } from "../../shared/system-roles";
import { PROJECT_MEMBER_ROLES, type ProjectMemberRole } from "../../drizzle/schema";
import { getEffectiveProjectRoleById as getEffectiveRole, pickHigherProjectRole } from "../project-access";
import { isISODate } from "../../shared/scheduling";
import { cancelAndRecordProjectMeeting, syncAndRecordProjectMeeting } from "../services/project-meeting-lifecycle";

const DEFAULT_MEETING = { enabled: true, weekday: 3, time: "15:00", durationMin: 60, title: "项目周会" };
const isoDateInput = z.string().refine(isISODate, "日期必须是有效的 YYYY-MM-DD");

function getStoredMeetingConfig(project: { meetingConfig?: unknown }): typeof DEFAULT_MEETING | null {
  const cfg = project.meetingConfig;
  if (!cfg || typeof cfg !== "object") return null;
  return cfg as typeof DEFAULT_MEETING;
}

/** 按角色分配未分配任务 + (可选)逐人发钉钉通知。assignByRole / kickoff 共用。 */
async function assignAndNotify(
  project: { id: string; name: string; category: string; dingtalkChatId?: string | null },
  actorId: number,
  notify: boolean
): Promise<{ assigned: number; recipients: number; notified: number }> {
  const assignments = await assignTasksByRole(project.id, actorId);
  const byUser = new Map<number, Array<{ taskId: string; phaseId: string; dueDate: string | null; instructions: string | null }>>();
  for (const a of assignments) {
    const arr = byUser.get(a.userId) ?? [];
    arr.push({ taskId: a.taskId, phaseId: a.phaseId, dueDate: a.dueDate, instructions: a.instructions });
    byUser.set(a.userId, arr);
  }
  let notified = 0;
  if (notify) {
    for (const [userId, items] of Array.from(byUser.entries())) {
      const lines = items
        .map((i) => {
          const title = taskDisplayTitle({
            taskId: i.taskId,
            phaseId: i.phaseId,
            projectCategory: project.category,
            instructions: i.instructions,
          });
          return `- ${title}${i.dueDate ? `（截止 ${i.dueDate}）` : ""}`;
        })
        .join("\n");
      const md = `### 项目「${project.name}」任务分配\n你被指派以下 ${items.length} 项任务：\n${lines}`;
      try {
        const result = await notifyUsersViaDingtalk([userId], "项目任务分配", md);
        if (result.delivered > 0) notified += 1;
        else if (result.failed > 0) console.warn("[assign] dingtalk notify failed (non-fatal):", result.error);
      }
      catch (e) { console.warn("[assign] dingtalk notify failed (non-fatal):", e); }
    }
    // 同步发一份汇总到项目群(若已建群)
    if (project.dingtalkChatId && assignments.length > 0) {
      const summary = `### 项目「${project.name}」任务已分配\n共 ${assignments.length} 项任务分给 ${byUser.size} 位负责人,详情见各自钉钉工作通知。`;
      try { await sendToGroupChat(project.dingtalkChatId, "任务分配", summary); } catch { /* 非阻断 */ }
    }
  }
  return { assigned: assignments.length, recipients: byUser.size, notified };
}

const riskLevelEnum = z.enum(["low", "medium", "high"]);
const riskEnum = riskLevelEnum.default("low");

const projectInputSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectNumber: z.string().default(""),
  category: z.enum(PROJECT_CATEGORIES).default("npd"),
  /** PM user id (FK to users.id) */
  pmUserId: z.number().int().nullable().optional(),
  /** 关联产品(产品库 id);NPD 新产品可暂空 */
  productId: z.string().nullable().optional(),
  risk: riskEnum,
  currentPhase: z.string().default("concept"),
  progress: z.number().default(0),
  startDate: isoDateInput.nullable().optional(),
  targetDate: isoDateInput.nullable().optional(),
  /** 立项基础信息 */
  description: z.string().nullable().optional(),
  customer: z.string().nullable().optional(),
  background: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  /** 手动覆盖健康度；null/undefined 表示回到自动 */
  riskOverrideRisk: riskLevelEnum.nullable().optional(),
  riskOverrideReason: z.string().trim().max(1000).nullable().optional(),
  /** 自定义字段值 fieldKey -> value */
  customFields: z.record(z.string(), z.unknown()).optional(),
});

async function getConfirmedProductDefinitionSnapshotIfAvailable(productId: string, actorId: number) {
  const definition = await getProductDefinitionByProductId(productId);
  if (!definition || definition.status !== "confirmed") {
    return null;
  }
  let snapshot = await getLatestProductDefinitionSnapshot(productId);
  if (!snapshot) {
    await confirmProductDefinition(productId, actorId);
    snapshot = await getLatestProductDefinitionSnapshot(productId);
  }
  return snapshot ?? null;
}

const HANDOFF_ROLE_LABELS: Record<string, string> = {
  rd_mech: "结构 / ID",
  rd_hw: "电子 / 硬件",
  rd_sw: "软件",
  qa: "品质 / 测试",
  scm: "采购 / 供应链",
  cert: "认证",
  battery_safety: "电池安全",
  pe: "工艺 / PE",
  mfg: "制造",
  sales: "销售 / 客户",
  pm: "产品经理",
  project_manager: "项目经理 / PMO",
  other: "未分配",
};

function inferHandoffRole(...parts: Array<string | null | undefined>): string {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (/结构|机械|外壳|id|mech|mechanical|housing/.test(text)) return "rd_mech";
  if (/电子|硬件|电控|pcba|pcb|motor|hardware|\bhw\b/.test(text)) return "rd_hw";
  if (/软件|固件|app|firmware|software|\bsw\b/.test(text)) return "rd_sw";
  if (/电池|锂电|battery|bms/.test(text)) return "battery_safety";
  if (/品质|质量|测试|验证|可靠性|qa|qc|test|reliability/.test(text)) return "qa";
  if (/采购|供应|供应链|供应商|bom|成本|scm|supplier|sourcing|cost/.test(text)) return "scm";
  if (/认证|安规|法规|ce|fcc|etl|ul|rohs|reach|cert/.test(text)) return "cert";
  if (/工艺|pe|制程|夹具|治具|process/.test(text)) return "pe";
  if (/制造|生产|装配|量产|mfg|manufactur/.test(text)) return "mfg";
  if (/客户|销售|市场|渠道|sales|customer|market/.test(text)) return "sales";
  if (/项目|进度|里程碑|资源|关键路径|排期|计划|project|schedule|milestone|kickoff|pmo/.test(text)) return "project_manager";
  if (/产品|prd|定位|卖点|product|positioning/.test(text)) return "pm";
  return "other";
}

function buildHandoffRoleBuckets(
  snapshot: Awaited<ReturnType<typeof getLatestProductDefinitionSnapshot>> | undefined,
  changes: Awaited<ReturnType<typeof listProductDefinitionChanges>>,
) {
  const buckets = new Map<string, {
    role: string;
    label: string;
    specs: Array<{ label: string; target: string; tolerance?: string; verification?: string; ownerRole?: string }>;
    changes: Array<{ id: number; title: string; area: string; status: string; costImpact: string | null; scheduleImpact: string | null }>;
  }>();
  const ensure = (role: string) => {
    if (!buckets.has(role)) {
      buckets.set(role, {
        role,
        label: HANDOFF_ROLE_LABELS[role] ?? role,
        specs: [],
        changes: [],
      });
    }
    return buckets.get(role)!;
  };

  for (const spec of snapshot?.snapshot.specs ?? []) {
    const role = inferHandoffRole(spec.ownerRole, spec.label, spec.verification, spec.target);
    ensure(role).specs.push({
      label: spec.label,
      target: spec.target,
      tolerance: spec.tolerance,
      verification: spec.verification,
      ownerRole: spec.ownerRole,
    });
  }

  for (const change of changes) {
    const scopes = change.impactScope?.length ? change.impactScope : [];
    const role = inferHandoffRole(...scopes, change.area, change.title, change.reason ?? undefined);
    ensure(role).changes.push({
      id: change.id,
      title: change.title,
      area: change.area,
      status: change.status,
      costImpact: change.costImpact ?? null,
      scheduleImpact: change.scheduleImpact ?? null,
    });
  }

  return Array.from(buckets.values())
    .map((bucket) => ({ ...bucket, itemCount: bucket.specs.length + bucket.changes.length }))
    .filter((bucket) => bucket.itemCount > 0)
    .sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label, "zh-CN"));
}

function getHandoffTaskPhaseId(category: string, role: string): string {
  const phases = getPhasesForCategory(category);
  const planning = phases.find((phase) => phase.id === "planning")?.id ?? phases[1]?.id ?? phases[0]?.id ?? "planning";
  const design = phases.find((phase) => phase.id === "design")?.id ?? phases[2]?.id ?? planning;
  return ["rd_hw", "rd_sw", "rd_mech", "qa", "pe", "mfg", "battery_safety"].includes(role)
    ? design
    : planning;
}

function buildHandoffTaskInstructions(input: {
  productName: string;
  snapshotVersion: number;
  bucket: ReturnType<typeof buildHandoffRoleBuckets>[number];
}) {
  const lines = [
    `# 产品定义交接 - ${input.bucket.label}`,
    "",
    `来源：${input.productName} · PRD v${input.snapshotVersion}`,
    `输入项：${input.bucket.specs.length} 条规格，${input.bucket.changes.length} 条变更影响`,
    "",
  ];
  if (input.bucket.specs.length > 0) {
    lines.push("规格输入：");
    for (const spec of input.bucket.specs) {
      lines.push(`- ${spec.label}: ${spec.target}${spec.tolerance ? `（${spec.tolerance}）` : ""}${spec.verification ? `；验证：${spec.verification}` : ""}`);
    }
    lines.push("");
  }
  if (input.bucket.changes.length > 0) {
    lines.push("变更影响：");
    for (const change of input.bucket.changes) {
      lines.push(`- [${change.status}] ${change.title}${change.costImpact ? `；成本：${change.costImpact}` : ""}${change.scheduleImpact ? `；进度：${change.scheduleImpact}` : ""}`);
    }
    lines.push("");
  }
  lines.push("请确认本角色是否已理解并承接以上产品定义输入；如有不可达、成本超标或验证风险，请登记 Issue 或产品定义变更。");
  return lines.join("\n");
}

export const projectsRouter = router({
  /** 跨项目组合看板：用户可见项目 + 健康度聚合 */
  portfolio: protectedProcedure.query(async ({ ctx }) => {
    const { getPortfolio } = await import("../db");
    return getPortfolio(ctx.user.id);
  }),

  /** 里程碑日历：时间窗内的阶段截止/Gate/目标日事件 */
  calendar: protectedProcedure
    .input(z.object({ fromDate: z.string(), toDate: z.string() }))
    .query(async ({ ctx, input }) => {
      const { getCalendar } = await import("../db");
      return getCalendar(ctx.user.id, input.fromDate, input.toDate);
    }),

  /** List all projects for the current user (owned + member) */
  list: protectedProcedure.query(async ({ ctx }) => {
    const isAdmin = isSystemAdminRole(ctx.user.role);
    const all = isAdmin ? await getAllActiveProjects() : await getProjectsByMember(ctx.user.id);
    const portfolio = await getPortfolio(ctx.user.id);
    const autoRiskByProject = new Map(portfolio.map((p) => [p.id, p.risk]));
    // Resolve every project's effective role from a single membership query +
    // in-memory pm/owner/admin overrides, instead of an N+1 of getEffectiveRole
    // (each of which re-fetched the project and ran a per-project member query).
    const memberRoles = await getProjectRolesForUser(ctx.user.id);
    return all.map((row) => {
      let role: ProjectMemberRole | null = memberRoles.get(row.id) ?? null;
      if (row.pmUserId === ctx.user.id) role = pickHigherProjectRole(role, "project_manager");
      if (row.createdBy === ctx.user.id) role = pickHigherProjectRole(role, "owner");
      if (!role && isAdmin) role = "manager";
      const effectiveRole = role ?? "viewer";
      const isExternal = effectiveRole === "external_customer" || effectiveRole === "supplier";
      return {
        ...row,
        risk: isExternal ? "low" : autoRiskByProject.get(row.id) ?? "low",
        riskOverrideRisk: isExternal ? null : row.riskOverrideRisk,
        riskOverrideReason: isExternal ? null : row.riskOverrideReason,
        riskOverrideUpdatedAt: isExternal ? null : row.riskOverrideUpdatedAt,
        riskOverrideUpdatedBy: isExternal ? null : row.riskOverrideUpdatedBy,
        background: isExternal ? null : row.background,
        value: isExternal ? null : row.value,
        customFields: isExternal ? {} : row.customFields,
        accessRole: effectiveRole,
        canDeleteProject: isAdmin || ROLE_PERMISSIONS[effectiveRole].canDeleteProject,
        canEditProjectInfo: ROLE_PERMISSIONS[effectiveRole].canEditProjectInfo,
      };
    });
  }),

  /** Get a single project by id (owner or member with canView) */
  get: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await getProjectById(input.id);
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      const portfolio = await getPortfolio(ctx.user.id);
      const health = portfolio.find((item) => item.id === input.id);
      const isExternal = role === "external_customer" || role === "supplier";
      const safeRow = isExternal ? {
        ...row,
        risk: "low" as const,
        riskOverrideRisk: null,
        riskOverrideReason: null,
        riskOverrideUpdatedAt: null,
        riskOverrideUpdatedBy: null,
        background: null,
        value: null,
        customFields: {},
      } : row;
      return health && !isExternal ? { ...safeRow, risk: health.risk } : safeRow;
    }),

  productHandoff: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canView) throw new TRPCError({ code: "FORBIDDEN" });
      if (!project.productId) {
        return { product: null, snapshot: null, snapshotSource: "none" as const, changes: [], roleBuckets: [] };
      }

      const product = await getProductById(project.productId);
      const lockedSnapshot = project.productDefinitionSnapshotId
        ? await getProductDefinitionSnapshotById(project.productDefinitionSnapshotId)
        : undefined;
      const snapshot = lockedSnapshot?.productId === project.productId
        ? lockedSnapshot
        : await getLatestProductDefinitionSnapshot(project.productId);
      const changes = await listProductDefinitionChanges(project.productId);
      const roleBuckets = buildHandoffRoleBuckets(snapshot, changes);
      return {
        product: product ? {
          id: product.id,
          productNumber: product.productNumber,
          name: product.name,
          category: product.category,
          targetMarkets: product.targetMarkets,
        } : { id: project.productId, productNumber: "", name: project.productId, category: "", targetMarkets: [] },
        snapshot,
        snapshotSource: lockedSnapshot?.productId === project.productId ? "locked" as const : "latest" as const,
        changes,
        roleBuckets,
      };
    }),

  generateHandoffTasks: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可生成产品定义交接任务" });
      }
      if (!project.productId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目未关联产品，无法生成产品定义交接任务" });
      }

      const product = await getProductById(project.productId);
      const lockedSnapshot = project.productDefinitionSnapshotId
        ? await getProductDefinitionSnapshotById(project.productDefinitionSnapshotId)
        : undefined;
      const snapshot = lockedSnapshot?.productId === project.productId
        ? lockedSnapshot
        : await getLatestProductDefinitionSnapshot(project.productId);
      if (!snapshot) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "项目缺少已确认 PRD 快照，无法生成交接任务" });
      }

      const changes = await listProductDefinitionChanges(project.productId);
      const roleBuckets = buildHandoffRoleBuckets(snapshot, changes);
      if (roleBuckets.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "没有可生成任务的角色交接输入" });
      }

      const existingTasks = await getProjectTasks(project.id);
      const existingKeys = new Set(existingTasks.map((task) => `${task.phaseId}:${task.taskId}`));
      const members = await getProjectMembers(project.id);
      const roleToUser = new Map<string, number>();
      for (const member of members) {
        if (!roleToUser.has(member.role)) roleToUser.set(member.role, member.userId);
      }

      let created = 0;
      let updated = 0;
      let assigned = 0;
      const generated: Array<{ phaseId: string; taskId: string; role: string; label: string }> = [];

      for (const bucket of roleBuckets) {
        const phaseId = getHandoffTaskPhaseId(project.category, bucket.role);
        const taskId = `pd_${bucket.role}`.slice(0, 32);
        const assigneeUserId = roleToUser.get(bucket.role) ?? null;
        const visibleRoles = Array.from(new Set([bucket.role, "pm", "project_manager", "manager", "owner"]));
        await upsertProjectTask(project.id, phaseId, taskId, {
          instructions: buildHandoffTaskInstructions({
            productName: product?.name ?? project.productId,
            snapshotVersion: snapshot.versionNumber,
            bucket,
          }),
          visibleRoles,
          assigneeUserId,
          priority: bucket.changes.some((change) => change.status === "approved" || change.status === "implemented") ? "high" : "medium",
          status: "todo",
          updatedBy: ctx.user.id,
        });
        if (existingKeys.has(`${phaseId}:${taskId}`)) updated += 1;
        else created += 1;
        if (assigneeUserId) assigned += 1;
        generated.push({ phaseId, taskId, role: bucket.role, label: bucket.label });
      }

      await createActivityLog({
        projectId: project.id,
        userId: ctx.user.id,
        action: "project.generate_handoff_tasks",
        entityType: "project",
        entityId: project.id,
        meta: { created, updated, assigned, generated },
      });

      return { success: true, created, updated, assigned, generated };
    }),

  /** Create a new project (requires canCreateProject or admin role) */
  create: protectedProcedure
    .input(projectInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Check if user has permission to create projects
      const canCreate = systemRoleCanCreateProject(ctx.user);
      if (!canCreate) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: '您没有创建项目的权限。请联系管理员授权。',
        });
      }
      const handoffSnapshot = input.productId
        ? await getConfirmedProductDefinitionSnapshotIfAvailable(input.productId, ctx.user.id)
        : null;
      await createProjectWithSeed({
        id: input.id,
        name: input.name,
        projectNumber: input.projectNumber,
        category: input.category,
        pmUserId: input.pmUserId ?? null,
        productId: input.productId ?? null,
        productDefinitionSnapshotId: handoffSnapshot?.id ?? null,
        description: input.description ?? null,
        customer: input.customer ?? null,
        background: input.background ?? null,
        value: input.value ?? null,
        risk: "low",
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: input.startDate ?? null,
        targetDate: input.targetDate ?? null,
        createdBy: ctx.user.id,
        archived: false,
      }, input.category, ctx.user.id);
      // 选了项目经理且不是创建者本人 → 自动加入项目成员并赋 project_manager 角色（否则对方看不到项目）
      if (input.pmUserId && input.pmUserId !== ctx.user.id) {
        try { await ensureProjectMember(input.id, input.pmUserId, "project_manager", ctx.user.id); }
        catch (e) { console.warn("[member] add pm on create failed (non-fatal):", e); }
      }
      // 有开始日 → 按 IPD 依赖图自动生成整套任务起止日（非阻断）
      if (input.startDate) {
        try { await applyProjectSchedule(input.id); }
        catch (e) { console.warn("[schedule] generate failed (non-fatal):", e); }
      }
      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.create",
        entityType: "project",
        entityId: input.id,
        meta: {
          name: input.name,
          category: input.category,
          projectNumber: input.projectNumber,
        },
      });
      // 默认周会配置 + 尝试建钉钉日程（降级安全，绝不阻断建项目）
      try {
        await updateProjectMeetingConfig(input.id, DEFAULT_MEETING);
        const project = await getProjectById(input.id);
        if (project) await syncAndRecordProjectMeeting({
          project,
          config: DEFAULT_MEETING,
          // 建项目阶段静默尝试，不刷群；PM 之后在周会编辑器显式保存时才会走群推降级。
          allowGroupFallback: false,
        });
      } catch (e) {
        console.warn("[meeting] create sync failed (non-fatal):", e);
      }
      return { success: true };
    }),

  /** Update an existing project metadata (requires canEditProjectInfo) */
  update: protectedProcedure
    .input(projectInputSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) throw new TRPCError({ code: "FORBIDDEN" });
      const hasRiskOverrideRisk = Object.prototype.hasOwnProperty.call(input, "riskOverrideRisk");
      const hasRiskOverrideReason = Object.prototype.hasOwnProperty.call(input, "riskOverrideReason");
      const riskOverrideTouched = hasRiskOverrideRisk || hasRiskOverrideReason;
      const nextRiskOverrideRisk = hasRiskOverrideRisk ? (input.riskOverrideRisk ?? null) : (existing.riskOverrideRisk ?? null);
      const nextRiskOverrideReason = hasRiskOverrideReason
        ? (input.riskOverrideReason?.trim() ?? "")
        : (existing.riskOverrideReason?.trim() ?? "");
      if (riskOverrideTouched && nextRiskOverrideRisk && !nextRiskOverrideReason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "手动覆盖健康度时必须填写原因" });
      }

      let productDefinitionSnapshotId = existing.productDefinitionSnapshotId ?? null;
      if (input.productId) {
        if (input.productId !== existing.productId || !existing.productDefinitionSnapshotId) {
          const snapshot = await getConfirmedProductDefinitionSnapshotIfAvailable(input.productId, ctx.user.id);
          productDefinitionSnapshotId = snapshot?.id ?? null;
        }
      } else if (!input.productId) {
        productDefinitionSnapshotId = null;
      }

      const nextPmUserId = input.pmUserId ?? null;
      const nextStartDate = input.startDate ?? null;
      const nextTargetDate = input.targetDate ?? null;
      const pmChanged = nextPmUserId !== (existing.pmUserId ?? null);
      const meetingRelevantChanged =
        pmChanged ||
        nextStartDate !== (existing.startDate ?? null) ||
        nextTargetDate !== (existing.targetDate ?? null);
      const meetingConfig = getStoredMeetingConfig(existing);

      if (pmChanged && existing.dingtalkEventId) {
        try { await cancelAndRecordProjectMeeting(existing); }
        catch (e) { console.warn("[meeting] cancel old pm event failed (non-fatal):", e); }
      }

      await updateProject(input.id, {
        name: input.name,
        projectNumber: input.projectNumber,
        category: input.category,
        pmUserId: nextPmUserId,
        productId: input.productId ?? null,
        productDefinitionSnapshotId,
        description: input.description ?? null,
        customer: input.customer ?? null,
        background: input.background ?? null,
        value: input.value ?? null,
        currentPhase: input.currentPhase,
        progress: input.progress,
        startDate: nextStartDate,
        targetDate: nextTargetDate,
        ...(pmChanged ? { dingtalkEventId: null } : {}),
        ...(riskOverrideTouched ? {
          riskOverrideRisk: nextRiskOverrideRisk,
          riskOverrideReason: nextRiskOverrideRisk ? nextRiskOverrideReason : null,
          riskOverrideUpdatedAt: nextRiskOverrideRisk ? new Date() : null,
          riskOverrideUpdatedBy: nextRiskOverrideRisk ? ctx.user.id : null,
        } : {}),
        ...(input.customFields !== undefined ? { customFields: input.customFields } : {}),
      });
      // 项目经理变更 → 确保新项目经理是成员(否则换了负责人后对方看不到项目)
      if (input.pmUserId && input.pmUserId !== existing.pmUserId && input.pmUserId !== existing.createdBy) {
        try { await ensureProjectMember(input.id, input.pmUserId, "project_manager", ctx.user.id); }
        catch (e) { console.warn("[member] add pm on update failed (non-fatal):", e); }
      }
      if (meetingConfig?.enabled && meetingRelevantChanged) {
        try {
          const project = await getProjectById(input.id);
          if (project) await syncAndRecordProjectMeeting({ project, config: meetingConfig });
        } catch (e) { console.warn("[meeting] resync on project update failed (non-fatal):", e); }
      }
      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.update",
        entityType: "project",
        entityId: input.id,
        meta: {
          name: input.name,
          projectNumber: input.projectNumber,
          category: input.category,
          currentPhase: input.currentPhase,
        },
      });
      return { success: true };
    }),

  /**
   * 轻量 patch mutation：仅修改阶段/负责人/产品线，不触碰 progress/category 等字段。
   * 供看板拖拽使用；需 admin 或 canEditProjectInfo。
   */
  move: protectedProcedure
    .input(z.object({
      id: z.string(),
      currentPhase: z.string().optional(),
      pmUserId: z.number().int().nullable().optional(),
      productId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.id, ctx.user.id);
      const allowed = isSystemAdminRole(ctx.user.role) || (role && ROLE_PERMISSIONS[role].canEditProjectInfo);
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });

      // 阶段守卫：move 只承担「回退」；前进推进必须走 gateReviews.confirmAndAdvance
      // （评审记录、gate task 完成、自动化事件都挂在那条路径上）。系统管理员也不例外。
      if (input.currentPhase !== undefined && input.currentPhase !== existing.currentPhase) {
        const phases = getPhasesForCategory(existing.category);
        const toIdx = phases.findIndex((p) => p.id === input.currentPhase);
        if (toIdx < 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "非法阶段：不在该项目类型的 SOP 阶段列表中" });
        }
        const fromIdx = phases.findIndex((p) => p.id === existing.currentPhase);
        // fromIdx < 0 说明现值已是脏数据，放行任何合法阶段作为修复通道
        if (fromIdx >= 0 && toIdx > fromIdx) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "不能直接前进阶段：请通过 Gate 评审推进" });
        }
      }

      const patch: Record<string, unknown> = {};
      if (input.currentPhase !== undefined) patch.currentPhase = input.currentPhase;
      if (input.pmUserId !== undefined) patch.pmUserId = input.pmUserId;
      if (input.productId !== undefined) patch.productId = input.productId;
      const pmChanged = input.pmUserId !== undefined && input.pmUserId !== (existing.pmUserId ?? null);
      const meetingConfig = getStoredMeetingConfig(existing);
      if (pmChanged) patch.dingtalkEventId = null;
      if (Object.keys(patch).length === 0) return { success: true };

      if (pmChanged && existing.dingtalkEventId) {
        try { await cancelAndRecordProjectMeeting(existing); }
        catch (e) { console.warn("[meeting] cancel old pm event on move failed (non-fatal):", e); }
      }

      await updateProject(input.id, patch);

      if (input.pmUserId != null && input.pmUserId !== existing.pmUserId && input.pmUserId !== existing.createdBy) {
        try { await ensureProjectMember(input.id, input.pmUserId, "project_manager", ctx.user.id); }
        catch (e) { console.warn("[move] add pm failed (non-fatal):", e); }
      }
      if (pmChanged && meetingConfig?.enabled) {
        try {
          const project = await getProjectById(input.id);
          if (project) await syncAndRecordProjectMeeting({ project, config: meetingConfig });
        } catch (e) { console.warn("[meeting] resync on project move failed (non-fatal):", e); }
      }

      await createActivityLog({
        projectId: input.id,
        userId: ctx.user.id,
        action: "project.move",
        entityType: "project",
        entityId: input.id,
        meta: {
          fromPhase: existing.currentPhase, toPhase: input.currentPhase ?? existing.currentPhase,
          fromPm: existing.pmUserId, toPm: input.pmUserId === undefined ? existing.pmUserId : input.pmUserId,
          fromProduct: existing.productId, toProduct: input.productId === undefined ? existing.productId : input.productId,
        },
      });
      return { success: true };
    }),

  /**
   * 按角色把未分配任务自动指派给对应成员,并给每位负责人发钉钉通知(含任务+截止日)。
   * 立项后由创建者/PM 在指定好各角色成员后触发。需 canEditProjectInfo。
   */
  assignByRole: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可分配负责人" });
      }

      const r = await assignAndNotify(project, ctx.user.id, true);
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "project.assign_by_role",
        entityType: "project",
        entityId: input.projectId,
        meta: { assigned: r.assigned, recipients: r.recipients },
      });
      return { success: true, ...r };
    }),

  /**
   * 立项向导:一步完成「设置开始日(生成排期) + 各角色配人 + 按角色分配任务 + 钉钉通知」。
   * 需 canEditProjectInfo。
   */
  kickoff: protectedProcedure
    .input(z.object({
      projectId: z.string(),
      startDate: isoDateInput.nullable().optional(),
      staffing: z.array(z.object({
        role: z.enum(PROJECT_MEMBER_ROLES),
        userId: z.number().int(),
      })).default([]),
      notify: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可执行立项向导" });
      }

      // 1) 开始日 → 生成整套排期(非阻断)
      if (input.startDate && input.startDate !== project.startDate) {
        try {
          await updateProject(input.projectId, { startDate: input.startDate });
          await applyProjectSchedule(input.projectId);
        } catch (e) { console.warn("[kickoff] schedule failed (non-fatal):", e); }
      }

      // 2) 各角色配人(去重;跳过创建者本人,避免覆盖 owner)
      let staffed = 0;
      const seen = new Set<string>();
      for (const s of input.staffing) {
        const key = `${s.role}:${s.userId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (s.userId === project.createdBy) continue;
        try { if (await ensureProjectMember(input.projectId, s.userId, s.role, ctx.user.id)) staffed += 1; }
        catch (e) { console.warn("[kickoff] staffing failed (non-fatal):", e); }
      }

      // 3) 按角色分配任务 + 通知
      const r = await assignAndNotify(
        { id: project.id, name: project.name, category: project.category, dingtalkChatId: project.dingtalkChatId },
        ctx.user.id,
        input.notify,
      );
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "project.kickoff",
        entityType: "project",
        entityId: input.projectId,
        meta: { staffed, assigned: r.assigned, recipients: r.recipients, startDate: input.startDate ?? null },
      });
      return { success: true, staffed, ...r };
    }),

  /**
   * 为项目创建/绑定钉钉对接群:群主取 PM(无则创建者),成员取项目成员。
   * 成功后回填 dingtalkChatId,后续项目提醒发到此群。需 canEditProjectInfo + 已建群权限。
   */
  createDingtalkGroup: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectById(input.projectId);
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      const role = await getEffectiveRole(input.projectId, ctx.user.id);
      if (!role || !ROLE_PERMISSIONS[role].canEditProjectInfo) {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅 Owner/管理层/PM 可创建项目群" });
      }
      if (project.dingtalkChatId) {
        return { success: true, chatId: project.dingtalkChatId, already: true };
      }

      const ownerUserId = project.pmUserId ?? project.createdBy;
      const [ownerCorp] = await resolveCorpIdsForUsers([ownerUserId]);
      if (!ownerCorp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "群主(PM/创建者)需先在「成员/系统管理」里配置手机号" });
      }
      const members = await getProjectMembers(input.projectId);
      const memberCorps = await resolveCorpIdsForUsers(
        members.map((m) => m.userId).filter((id) => id !== ownerUserId)
      );

      const res = await createGroupChat(`【${project.name}】项目群`, ownerCorp, memberCorps);
      if (!res.ok) throw new TRPCError({ code: "BAD_REQUEST", message: res.error });

      await updateProject(input.projectId, { dingtalkChatId: res.chatId });
      await sendToGroupChat(
        res.chatId,
        "项目群已创建",
        `### 【${project.name}】项目对接群\n本群用于该项目对接,逾期/Gate/任务/周会等提醒会自动发到这里。`
      );
      await createActivityLog({
        projectId: input.projectId,
        userId: ctx.user.id,
        action: "project.create_group",
        entityType: "project",
        entityId: input.projectId,
        meta: { chatId: res.chatId, members: memberCorps.length + 1 },
      });
      return { success: true, chatId: res.chatId, already: false };
    }),

  /**
   * Permanently delete an unreleased project and all project-scoped rows.
   * Released projects are archived for PLM traceability and cannot be hard-deleted.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getProjectById(input.id);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.resultRevisionId !== null) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "已发布项目保留在产品版本追溯中，不能永久删除",
        });
      }
      // System admins can delete any project regardless of membership
      const isSystemAdmin = isSystemAdminRole(ctx.user.role);
      if (!isSystemAdmin) {
        const role = await getEffectiveRole(input.id, ctx.user.id);
        if (!role || !ROLE_PERMISSIONS[role].canDeleteProject) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "只有项目创建者、管理员或系统管理员可以删除项目",
          });
        }
      }
      let result: Awaited<ReturnType<typeof deleteProject>>;
      let dingtalkGroupDeleted = false;
      try {
        if (existing.dingtalkEventId) {
          try { await cancelAndRecordProjectMeeting(existing); }
          catch (e) { console.warn("[meeting] cancel before project delete failed (non-fatal):", e); }
        }
        if (existing.dingtalkChatId) {
          // 群解散 best-effort：钉钉不可用不能把项目删除挡住（群可事后手动清理）
          try {
            const groupResult = await disbandGroupChat(existing.dingtalkChatId);
            if (groupResult.ok) dingtalkGroupDeleted = true;
            else console.warn("[project.delete] disband dingtalk group failed (non-fatal):", groupResult.error);
          } catch (e) {
            console.warn("[project.delete] disband dingtalk group failed (non-fatal):", e);
          }
        }
        result = await deleteProject(input.id);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof Error && /released project/i.test(error.message)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "已发布项目保留在产品版本追溯中，不能永久删除",
          });
        }
        throw error;
      }

      await Promise.allSettled(result.storageKeys.map(async (storageKey) => {
        try {
          await storageDelete(storageKey);
        } catch (error) {
          console.warn("[project.delete] storage delete failed (non-fatal):", storageKey, error);
        }
      }));

      return {
        success: true,
        projectName: existing.name,
        deletedFiles: result.storageKeys.length,
        dingtalkGroupDeleted,
      };
    }),
});

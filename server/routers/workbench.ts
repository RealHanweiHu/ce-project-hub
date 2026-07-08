import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDb,
  getMyTasks,
  getPortfolio,
  listOpenActionItemsForUser,
  listSnoozedActionItemsForUser,
} from "../db";
import {
  automationRules,
  automationRuns,
  customFieldDefs,
  projectDeliverableReviews,
  projectGateBlockers,
  projectIssues,
  projectMembers,
  projectTasks,
  projects,
  users,
  type ProjectMemberRole,
} from "../../drizzle/schema";
import { isSystemAdminRole } from "../../shared/system-roles";

type WorkbenchRole = {
  projectId: string;
  projectName: string;
  projectNumber: string;
  category: string;
  currentPhase: string;
  targetDate: string | null;
  role: ProjectMemberRole;
  pmUserId: number | null;
};

const EXTERNAL_ROLES = new Set<ProjectMemberRole>(["external_customer", "supplier"]);
const ROLE_TASK_ALIASES: Partial<Record<ProjectMemberRole, ProjectMemberRole[]>> = {
  rd_hw: ["rd_hw"],
  rd_sw: ["rd_sw"],
  rd_mech: ["rd_mech"],
  qa: ["qa", "cert", "battery_safety"],
  cert: ["cert", "qa"],
  battery_safety: ["battery_safety", "qa", "rd_hw"],
  pe: ["pe", "mfg"],
  mfg: ["mfg", "pe"],
  scm: ["scm"],
  sales: ["sales"],
  pm: ["pm"],
};

function roleMatchesTask(role: ProjectMemberRole | undefined, visibleRoles: string[] | null): boolean {
  if (!role || EXTERNAL_ROLES.has(role)) return false;
  const roles = visibleRoles ?? [];
  if (roles.length === 0) return false;
  const aliases = ROLE_TASK_ALIASES[role] ?? [role];
  return aliases.some((alias) => roles.includes(alias));
}

export const workbenchRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const [tasks, portfolio, actionItems, snoozedActionItems] = await Promise.all([
      getMyTasks(ctx.user.id),
      getPortfolio(ctx.user.id),
      listOpenActionItemsForUser(ctx.user.id),
      listSnoozedActionItemsForUser(ctx.user.id),
    ]);
    const db = await getDb();
    if (!db) {
      return {
        systemRole: ctx.user.role,
        roles: [] as WorkbenchRole[],
        tasks,
        actionItems,
        snoozedActionItems,
        roleTasks: [],
        reviews: [],
        issues: [],
        gateBlockers: [],
        portfolio,
        admin: null,
      };
    }

    const memberRows = await db
      .select({
        projectId: projectMembers.projectId,
        role: projectMembers.role,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        category: projects.category,
        currentPhase: projects.currentPhase,
        targetDate: projects.targetDate,
        pmUserId: projects.pmUserId,
      })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, ctx.user.id), eq(projects.archived, false)));

    const ownedRows = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        category: projects.category,
        currentPhase: projects.currentPhase,
        targetDate: projects.targetDate,
        pmUserId: projects.pmUserId,
      })
      .from(projects)
      .where(and(eq(projects.createdBy, ctx.user.id), eq(projects.archived, false)));

    const roleByProject = new Map<string, WorkbenchRole>();
    for (const row of memberRows) {
      roleByProject.set(row.projectId, row);
    }
    for (const row of ownedRows) {
      if (!roleByProject.has(row.projectId)) {
        roleByProject.set(row.projectId, { ...row, role: "owner" });
      }
    }
    const roles = Array.from(roleByProject.values());
    const projectIds = roles.map((role) => role.projectId);
    const roleByProjectId = new Map(roles.map((role) => [role.projectId, role.role]));
    const internalProjectIds = roles
      .filter((role) => !EXTERNAL_ROLES.has(role.role))
      .map((role) => role.projectId);

    const reviews = await db
      .select({
        id: projectDeliverableReviews.id,
        projectId: projectDeliverableReviews.projectId,
        phaseId: projectDeliverableReviews.phaseId,
        deliverableName: projectDeliverableReviews.deliverableName,
        status: projectDeliverableReviews.status,
        reviewerUserId: projectDeliverableReviews.reviewerUserId,
        submittedBy: projectDeliverableReviews.submittedBy,
        submittedAt: projectDeliverableReviews.submittedAt,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectDeliverableReviews)
      .innerJoin(projects, eq(projectDeliverableReviews.projectId, projects.id))
      .where(and(
        eq(projectDeliverableReviews.reviewerUserId, ctx.user.id),
        eq(projectDeliverableReviews.status, "pending"),
        eq(projects.archived, false),
      ))
      .orderBy(desc(projectDeliverableReviews.submittedAt))
      .limit(80);

    const issues = projectIds.length === 0 ? [] : await db
      .select({
        id: projectIssues.id,
        projectId: projectIssues.projectId,
        phaseId: projectIssues.phaseId,
        title: projectIssues.title,
        severity: projectIssues.severity,
        status: projectIssues.status,
        category: projectIssues.category,
        owner: projectIssues.owner,
        reporter: projectIssues.reporter,
        targetDate: projectIssues.targetDate,
        relatedTaskId: projectIssues.relatedTaskId,
        createdAt: projectIssues.createdAt,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectIssues)
      .innerJoin(projects, eq(projectIssues.projectId, projects.id))
      .where(and(
        inArray(projectIssues.projectId, projectIds),
        inArray(projectIssues.status, ["open", "in_progress", "resolved"] as const),
      ))
      .orderBy(
        drizzleSql`CASE ${projectIssues.severity} WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END`,
        drizzleSql`CASE ${projectIssues.status} WHEN 'resolved' THEN 0 WHEN 'open' THEN 1 ELSE 2 END`,
        desc(projectIssues.createdAt),
      )
      .limit(120);

    const roleTaskRows = internalProjectIds.length === 0 ? [] : await db
      .select({
        id: projectTasks.id,
        projectId: projectTasks.projectId,
        phaseId: projectTasks.phaseId,
        taskId: projectTasks.taskId,
        completed: projectTasks.completed,
        instructions: projectTasks.instructions,
        visibleRoles: projectTasks.visibleRoles,
        assigneeUserId: projectTasks.assigneeUserId,
        dueDate: projectTasks.dueDate,
        status: projectTasks.status,
        priority: projectTasks.priority,
        completedAt: projectTasks.completedAt,
        statusChangedAt: projectTasks.statusChangedAt,
        updatedBy: projectTasks.updatedBy,
        createdAt: projectTasks.createdAt,
        updatedAt: projectTasks.updatedAt,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
        projectCategory: projects.category,
      })
      .from(projectTasks)
      .innerJoin(projects, eq(projectTasks.projectId, projects.id))
      .where(and(
        inArray(projectTasks.projectId, internalProjectIds),
        eq(projects.archived, false),
        drizzleSql`${projectTasks.status} != 'done'`,
        drizzleSql`${projectTasks.status} != 'skipped'`,
      ))
      .orderBy(
        drizzleSql`CASE ${projectTasks.priority} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`,
        drizzleSql`${projectTasks.dueDate} IS NULL`,
        projectTasks.dueDate,
      )
      .limit(200);

    const roleTasks = roleTaskRows
      .filter((task) =>
        task.assigneeUserId == null &&
        roleMatchesTask(roleByProjectId.get(task.projectId), task.visibleRoles as string[] | null)
      )
      .slice(0, 80);

    const gateBlockers = internalProjectIds.length === 0 ? [] : await db
      .select({
        id: projectGateBlockers.id,
        projectId: projectGateBlockers.projectId,
        phaseId: projectGateBlockers.phaseId,
        blockerType: projectGateBlockers.blockerType,
        title: projectGateBlockers.title,
        description: projectGateBlockers.description,
        status: projectGateBlockers.status,
        createdAt: projectGateBlockers.createdAt,
        projectName: projects.name,
        projectNumber: projects.projectNumber,
      })
      .from(projectGateBlockers)
      .innerJoin(projects, eq(projectGateBlockers.projectId, projects.id))
      .where(and(
        inArray(projectGateBlockers.projectId, internalProjectIds),
        eq(projectGateBlockers.status, "open"),
        eq(projects.archived, false),
      ))
      .orderBy(
        drizzleSql`CASE ${projectGateBlockers.blockerType} WHEN 'quality' THEN 0 ELSE 1 END`,
        desc(projectGateBlockers.createdAt),
      )
      .limit(80);

    const admin = isSystemAdminRole(ctx.user.role)
      ? await getAdminWorkbenchSignals(db)
      : null;

    return {
      systemRole: ctx.user.role,
      roles,
      tasks,
      actionItems,
      snoozedActionItems,
      roleTasks,
      reviews,
      issues,
      gateBlockers,
      portfolio,
      admin,
    };
  }),
});

async function getAdminWorkbenchSignals(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  const [ruleRows, recentRuns, failedRuns, userRows, customFields] = await Promise.all([
    db.select({
      id: automationRules.id,
      enabled: automationRules.enabled,
    }).from(automationRules),
    db.select({ id: automationRuns.id }).from(automationRuns).limit(50),
    db.select({ id: automationRuns.id })
      .from(automationRuns)
      .where(inArray(automationRuns.status, ["failed", "error"]))
      .limit(50),
    db.select({ id: users.id }).from(users),
    db.select({ id: customFieldDefs.id }).from(customFieldDefs),
  ]);

  return {
    rulesTotal: ruleRows.length,
    rulesEnabled: ruleRows.filter((row) => row.enabled).length,
    recentRuns: recentRuns.length,
    failedRuns: failedRuns.length,
    usersTotal: userRows.length,
    customFields: customFields.length,
  };
}

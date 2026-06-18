import { and, desc, eq, inArray, sql as drizzleSql } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getMyTasks, getPortfolio } from "../db";
import {
  automationRules,
  automationRuns,
  customFieldDefs,
  projectDeliverableReviews,
  projectIssues,
  projectMembers,
  projects,
  users,
  type ProjectMemberRole,
} from "../../drizzle/schema";

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

export const workbenchRouter = router({
  mine: protectedProcedure.query(async ({ ctx }) => {
    const [tasks, portfolio] = await Promise.all([
      getMyTasks(ctx.user.id),
      getPortfolio(ctx.user.id),
    ]);
    const db = await getDb();
    if (!db) {
      return {
        systemRole: ctx.user.role,
        roles: [] as WorkbenchRole[],
        tasks,
        reviews: [],
        issues: [],
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

    const admin = ctx.user.role === "admin"
      ? await getAdminWorkbenchSignals(db)
      : null;

    return {
      systemRole: ctx.user.role,
      roles,
      tasks,
      reviews,
      issues,
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
      .where(eq(automationRuns.status, "failed"))
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

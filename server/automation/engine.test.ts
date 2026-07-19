import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import {
  getDb, upsertUser, getUserByOpenId, createProjectWithSeed,
  updateAutomationRuleRow, listAutomationRuns, getAutomationDueTasks, getAutomationDueIssues,
  getUnassignedActiveTasks, addProjectMember,
} from "../db";
import { runAutomation } from "./engine";

const SUF = "autoeng";
const PROJECT_ID = `proj_${SUF}`;
const ARCHIVED_PROJECT_ID = `proj_${SUF}_archived`;
const PM_OPEN = `pm_${SUF}`;
const ASG_OPEN = `asg_${SUF}`;
const MGR_OPEN = `mgr_${SUF}`;

let pmId = 0;
let asgId = 0;
let mgrId = 0;

const OVERDUE_DEFAULT_CONFIG = {
  graceDays: 0,
  cadenceHours: 24,
  scope: "both" as const,
  notifyRoles: ["assignee"] as const,
  pushGroup: false,
};
const EXCEPTION_DEFAULT_CONFIG = {
  assigneeAfterDays: 2,
  pmAfterDays: 2,
  managerAfterDays: 7,
  cadenceHours: 24,
  include: { overdueTasks: true, blockedTasks: true, criticalIssues: true, pendingReviews: true },
  pushGroup: false,
};

// 捕获派发，避免真写通知/真发钉钉
function makeDeps() {
  const notes: Array<{ userId: number; title: string }> = [];
  const pushes: Array<{ title?: string }> = [];
  const groups: Array<{ chatId: string; title: string }> = [];
  return {
    notes,
    pushes,
    groups,
    deps: {
      now: new Date("2026-06-16T02:00:00Z"),
      createNotification: async (n: { userId: number; title: string }) => { notes.push({ userId: n.userId, title: n.title }); },
      pushWebhook: async (_text: string, opts?: { title?: string }) => { pushes.push({ title: opts?.title }); },
      notifyDingtalk: async () => {}, // 测试不真发钉钉工作通知
      getDeliveryProfiles: async (userIds: number[]) => new Map(userIds.map((userId) => [
        userId,
        { userId, prefs: {}, immediateSent24h: 0 },
      ])),
      notifyGroup: async (chatId: string, title: string) => { groups.push({ chatId, title }); return true; },
      allowAutomationTestProjects: true,
    },
  };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM automation_claims WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM automation_claims WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_members WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_members WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_issues WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${ARCHIVED_PROJECT_ID}`);
}

beforeAll(async () => {
  await cleanup();
  await upsertUser({ openId: PM_OPEN, name: "PM 用户" });
  await upsertUser({ openId: ASG_OPEN, name: "负责人" });
  await upsertUser({ openId: MGR_OPEN, name: "管理层" });
  pmId = (await getUserByOpenId(PM_OPEN))!.id;
  asgId = (await getUserByOpenId(ASG_OPEN))!.id;
  mgrId = (await getUserByOpenId(MGR_OPEN))!.id;
  await createProjectWithSeed(
    { id: PROJECT_ID, name: "自动化引擎测试项目", category: "npd", pmUserId: pmId, createdBy: pmId },
    "npd",
    pmId
  );
  await addProjectMember({ projectId: PROJECT_ID, userId: mgrId, role: "manager", invitedBy: pmId });
  await addProjectMember({ projectId: PROJECT_ID, userId: asgId, role: "rd_hw", invitedBy: pmId });
});
afterAll(async () => {
  // 还原规则到 seed 默认，避免污染共享 DB（如把 high_severity_issue 留成 disabled）
  await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
  await updateAutomationRuleRow({ ruleKey: "overdue_reminder", enabled: false, config: { ...OVERDUE_DEFAULT_CONFIG, notifyRoles: [...OVERDUE_DEFAULT_CONFIG.notifyRoles] } });
  await updateAutomationRuleRow({ ruleKey: "status_change_notify", enabled: false, config: { transitions: { issue: ["resolved", "closed"], task: [], gate: ["approved", "rejected"] }, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "delay_impact_notify", enabled: true, config: { minDeltaDays: 0, notifyGateImpacts: true, notifyTargetBreach: true, onlyNewTargetBreach: false, cadenceHours: 24, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "exception_escalation", enabled: true, config: EXCEPTION_DEFAULT_CONFIG });
  await updateAutomationRuleRow({ ruleKey: "task_assignment", enabled: true, config: { cadenceHours: 24, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "task_ready_notify", enabled: true, config: {} });
  await cleanup();
});
beforeEach(async () => {
  const db = await getDb();
  if (db) {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`DELETE FROM action_items WHERE "projectId" = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${PROJECT_ID}`);
    await db.execute(sql`DELETE FROM automation_claims WHERE "projectId" = ${PROJECT_ID}`);
  }
  // 重置规则到已知状态
  await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
  await updateAutomationRuleRow({ ruleKey: "overdue_reminder", enabled: true, config: { ...OVERDUE_DEFAULT_CONFIG, notifyRoles: [...OVERDUE_DEFAULT_CONFIG.notifyRoles] } });
  await updateAutomationRuleRow({ ruleKey: "status_change_notify", enabled: false, config: {} });
  await updateAutomationRuleRow({ ruleKey: "delay_impact_notify", enabled: true, config: { minDeltaDays: 0, notifyGateImpacts: true, notifyTargetBreach: true, onlyNewTargetBreach: false, cadenceHours: 24, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "exception_escalation", enabled: true, config: EXCEPTION_DEFAULT_CONFIG });
  await updateAutomationRuleRow({ ruleKey: "task_assignment", enabled: true, config: { cadenceHours: 24, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "task_ready_notify", enabled: true, config: {} });
});

describe("automation engine integration", () => {
  it("task_ready 走专用行动项派发，不展开当前事件收件人；派发/静默都完整落 claim/run", async () => {
    const loadProjectMembers = vi.fn(async () => { throw new Error("task_ready 不应加载项目成员"); });
    const notifyTaskReady = vi
      .fn()
      .mockResolvedValueOnce({ eligible: 2, dispatched: 2 })
      .mockResolvedValueOnce({ eligible: 0, dispatched: 0 })
      .mockResolvedValueOnce({ eligible: 1, dispatched: 0 });
    const baseDeps = makeDeps().deps;
    const deps = { ...baseDeps, loadProjectMembers, notifyTaskReady };
    const event = (sourceActivityLogId: number) => ({
      action: "task.update_meta" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:concept:c1`,
      before: { phaseId: "concept", taskId: "c1", status: "in_progress" },
      after: { phaseId: "concept", taskId: "c1", status: "done" },
      sourceActivityLogId,
    });

    expect(await runAutomation(event(990001), deps)).toMatchObject({ matched: 1, fired: 1 });
    expect(await runAutomation(event(990002), deps)).toMatchObject({ matched: 1, skipped: 1 });
    expect(await runAutomation(event(990003), deps)).toMatchObject({ matched: 1, skipped: 1 });
    expect(notifyTaskReady).toHaveBeenCalledTimes(3);
    expect(loadProjectMembers).not.toHaveBeenCalled();

    const runs = (await listAutomationRuns({ projectId: PROJECT_ID }))
      .filter((run) => run.ruleKey === "task_ready_notify");
    expect(runs.filter((run) => run.status === "fired")).toHaveLength(1);
    expect(runs.filter((run) => run.status === "skipped")).toHaveLength(2);
  });

  it("excludes archived projects from scheduled overdue scans", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO projects (id, name, category, "currentPhase", "createdBy", "pmUserId", risk, progress, archived, "projectNumber")
      VALUES (${ARCHIVED_PROJECT_ID}, '已删除逾期提醒测试', 'npd', 'concept', ${pmId}, ${pmId}, 'low', 0, true, 'ARCH-AUTO')
    `);
    await db.execute(sql`
      INSERT INTO project_tasks ("projectId", "phaseId", "taskId", "dueDate", status, "assigneeUserId")
      VALUES (${ARCHIVED_PROJECT_ID}, 'concept', 'archived-overdue-task', '2000-01-01', 'in_progress', ${asgId})
    `);
    await db.execute(sql`
      INSERT INTO project_issues ("projectId", "phaseId", title, "targetDate", status, severity, category)
      VALUES (${ARCHIVED_PROJECT_ID}, 'concept', 'archived overdue issue', '2000-01-01', 'open', 'P2', 'other')
    `);

    const tasks = await getAutomationDueTasks();
    const issues = await getAutomationDueIssues();
    expect(tasks.some((task) => task.projectId === ARCHIVED_PROJECT_ID)).toBe(false);
    expect(issues.some((issue) => issue.projectId === ARCHIVED_PROJECT_ID)).toBe(false);
  });

  it("scans active unassigned tasks but excludes archived projects", async () => {
    const db = await getDb();
    if (!db) throw new Error("DB not available");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO projects (id, name, category, "currentPhase", "createdBy", "pmUserId", risk, progress, archived, "projectNumber")
      VALUES (${ARCHIVED_PROJECT_ID}, '已删除无主任务测试', 'npd', 'concept', ${pmId}, ${pmId}, 'low', 0, true, 'ARCH-UNASSIGNED')
      ON CONFLICT (id) DO UPDATE SET archived = true
    `);
    await db.execute(sql`
      INSERT INTO project_tasks ("projectId", "phaseId", "taskId", status, "assigneeUserId")
      VALUES (${PROJECT_ID}, 'concept', 'unassigned-active-task', 'todo', NULL)
    `);
    await db.execute(sql`
      INSERT INTO project_tasks ("projectId", "phaseId", "taskId", status, "assigneeUserId")
      VALUES (${ARCHIVED_PROJECT_ID}, 'concept', 'unassigned-archived-task', 'todo', NULL)
    `);

    const tasks = await getUnassignedActiveTasks();
    expect(tasks.some((task) => task.projectId === PROJECT_ID && task.taskId === "unassigned-active-task")).toBe(true);
    expect(tasks.some((task) => task.projectId === ARCHIVED_PROJECT_ID)).toBe(false);
  });

  it("dispatches high severity issue to pm + assignee, pushes group, logs a fired run", async () => {
    const { notes, pushes, deps } = makeDeps();
    await runAutomation({
      action: "issue.create",
      projectId: PROJECT_ID,
      entityType: "issue",
      entityId: 9001,
      after: { severity: "P0", title: "整机不开机", assigneeUserId: asgId },
    }, deps);

    const notified = new Set(notes.map((n) => n.userId));
    expect(notified.has(pmId)).toBe(true);
    expect(notified.has(asgId)).toBe(true);
    expect(pushes.length).toBe(1); // pushGroup=true

    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    const fired = runs.find((r) => r.ruleKey === "high_severity_issue" && r.status === "fired");
    expect(fired).toBeTruthy();
  });

  it("test database keeps site notifications and skips every DingTalk group path", async () => {
    const calls = makeDeps();

    const result = await runAutomation(
      {
        action: "issue.create",
        projectId: PROJECT_ID,
        entityType: "issue",
        entityId: 9005,
        after: {
          severity: "P0",
          title: "测试库仅站内提醒",
          assigneeUserId: asgId,
        },
      },
      {
        ...calls.deps,
        isDingtalkDeliveryEnabled: () => false,
      }
    );

    expect(calls.notes.length).toBeGreaterThan(0);
    expect(calls.groups).toEqual([]);
    expect(calls.pushes).toEqual([]);
    expect(result).toMatchObject({ fired: 1, errors: 0 });
  });

  it("skips a loaded group notification when project deletion starts after personal delivery", async () => {
    const calls = makeDeps();
    const isProjectActive = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    const result = await runAutomation({
      action: "issue.create",
      projectId: PROJECT_ID,
      entityType: "issue",
      entityId: 9002,
      after: { severity: "P0", title: "删除竞态群消息", assigneeUserId: asgId },
    }, { ...calls.deps, isProjectActive });

    expect(result.fired).toBe(1);
    expect(calls.groups).toHaveLength(0);
    expect(calls.pushes).toHaveLength(0);
    expect(isProjectActive).toHaveBeenCalledTimes(5);
  });

  it("routes group push to the project DingTalk group when chatId is set, else falls back to webhook", async () => {
    const { updateProject } = await import("../db");
    await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
    // 有项目专属群 → 发到群,不走全局 webhook
    await updateProject(PROJECT_ID, { dingtalkChatId: "chat_test_xyz" });
    const a = makeDeps();
    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9101,
      after: { severity: "P0", title: "群路由测试", assigneeUserId: asgId },
    }, a.deps);
    expect(a.groups.length).toBe(1);
    expect(a.groups[0].chatId).toBe("chat_test_xyz");
    expect(a.pushes.length).toBe(0);
    // 无项目群 → 回退全局 webhook
    await updateProject(PROJECT_ID, { dingtalkChatId: null });
    const b = makeDeps();
    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9102,
      after: { severity: "P0", title: "回退 webhook", assigneeUserId: asgId },
    }, b.deps);
    expect(b.groups.length).toBe(0);
    expect(b.pushes.length).toBe(1);
  });

  it("falls back to webhook when the bound project group rejects the message", async () => {
    const { updateProject } = await import("../db");
    await updateProject(PROJECT_ID, { dingtalkChatId: "chat_broken" });
    const calls = makeDeps();
    calls.deps.notifyGroup = async (chatId: string, title: string) => {
      calls.groups.push({ chatId, title });
      return false;
    };
    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9103,
      after: { severity: "P0", title: "项目群失败回退", assigneeUserId: asgId },
    }, calls.deps);
    expect(calls.groups).toHaveLength(1);
    expect(calls.pushes).toHaveLength(1);
    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((row) => row.ruleKey === "high_severity_issue" && row.entityId === `${PROJECT_ID}:9103` && row.status === "partial")).toBe(true);
    await updateProject(PROJECT_ID, { dingtalkChatId: null });
  });

  it("does not trigger high severity for out-of-set severity (P3)", async () => {
    const { notes, deps } = makeDeps();
    let memberLoads = 0;
    deps.loadProjectMembers = async () => {
      memberLoads += 1;
      return [];
    };
    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9002,
      after: { severity: "P3", title: "文案微调", assigneeUserId: asgId },
    }, deps);
    expect(notes.length).toBe(0);
    expect(memberLoads).toBe(0);
  });

  it("loads project members only after match/claim and reuses the lazy result", async () => {
    const calls = makeDeps();
    let memberLoads = 0;
    const { getProjectMembers } = await import("../db");
    calls.deps.loadProjectMembers = async (projectId: string) => {
      memberLoads += 1;
      return getProjectMembers(projectId);
    };
    await runAutomation({
      action: "issue.create",
      projectId: PROJECT_ID,
      entityType: "issue",
      entityId: 9901,
      after: { severity: "P0", title: "成员惰性加载", assigneeUserId: asgId },
    }, calls.deps);
    expect(memberLoads).toBe(1);
  });

  it("dedups overdue reminders within the cadence window", async () => {
    const overdueEvent = {
      action: "scheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:concept:c1`,
      now: "2026-06-14",
      after: { dueDate: "2026-06-01", status: "in_progress", assigneeUserId: asgId },
    };
    const first = makeDeps();
    await runAutomation(overdueEvent, first.deps);
    expect(first.notes.length).toBeGreaterThan(0); // 首次触发

    const second = makeDeps();
    await runAutomation(overdueEvent, second.deps);
    expect(second.notes.length).toBe(0); // 窗口内被防重发

    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((r) => r.ruleKey === "overdue_reminder" && r.status === "fired")).toBe(true);
    expect(runs.some((r) => r.ruleKey === "overdue_reminder" && r.status === "skipped")).toBe(true);
  });

  it("does not repeat the assignee when overdue reminder and exception escalation both match", async () => {
    // 新默认 assigneeAfterDays=2 且 pmAfterDays=2 时责任人层不可达（day2 直升 PM，
    // 责任人由每日摘要覆盖）；本用例专测"责任人层与逾期提醒不重复"的抑制路径，
    // 显式把责任人层配置为 day0 可达。
    await updateAutomationRuleRow({
      ruleKey: "exception_escalation",
      enabled: true,
      config: { ...EXCEPTION_DEFAULT_CONFIG, assigneeAfterDays: 0 },
    });
    const event = {
      action: "scheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:concept:overdue-no-duplicate`,
      now: "2026-06-14",
      after: {
        dueDate: "2026-06-01",
        status: "in_progress",
        title: "逾期任务不重复通知",
        exceptionType: "overdue_task",
        exceptionAgeDays: 0,
        assigneeUserId: asgId,
      },
    };
    const calls = makeDeps();

    const summary = await runAutomation(event, calls.deps);

    expect(summary).toMatchObject({ matched: 2, fired: 1, skipped: 1 });
    expect(calls.notes).toEqual([{ userId: asgId, title: "任务逾期提醒" }]);
    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((run) =>
      run.ruleKey === "exception_escalation" &&
      run.entityId === `${event.entityId}:assignee` &&
      run.status === "skipped"
    )).toBe(true);
    await updateAutomationRuleRow({
      ruleKey: "exception_escalation",
      enabled: true,
      config: EXCEPTION_DEFAULT_CONFIG,
    });
  });

  it("atomically claims concurrent scheduled sends", async () => {
    const event = {
      action: "scheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:${"phase".repeat(6)}:${"x".repeat(32)}`,
      now: "2026-06-14",
      after: { dueDate: "2026-06-01", status: "in_progress", assigneeUserId: asgId },
    };
    const calls = makeDeps();

    await Promise.all([
      runAutomation(event, calls.deps),
      runAutomation(event, calls.deps),
    ]);

    // One winner notifies the assignee (the new low-noise default). The losing scanner only writes a
    // skipped audit row and never performs an external side effect.
    expect(calls.notes).toHaveLength(1);
    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((row) => row.entityId === event.entityId && row.status === "fired")).toBe(true);
    expect(runs.some((row) => row.entityId === event.entityId && row.status === "skipped")).toBe(true);
  });

  it("dedups concurrent activity-log replay by source id", async () => {
    const event = {
      action: "issue.create" as const,
      projectId: PROJECT_ID,
      entityType: "issue" as const,
      entityId: 9199,
      sourceActivityLogId: 881199,
      after: { severity: "P0", title: "日志重放并发", assigneeUserId: asgId },
    };
    const calls = makeDeps();

    await Promise.all([
      runAutomation(event, calls.deps),
      runAutomation(event, calls.deps),
    ]);

    expect(calls.notes.length).toBeGreaterThan(0);
    expect(new Set(calls.notes.map((note) => note.userId)).size).toBe(calls.notes.length);
    expect(calls.pushes).toHaveLength(1);
    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.filter((row) => row.ruleKey === "high_severity_issue" && row.entityId === `${PROJECT_ID}:9199` && row.status === "fired")).toHaveLength(1);
    expect(runs.some((row) => row.ruleKey === "high_severity_issue" && row.entityId === `${PROJECT_ID}:9199` && row.status === "skipped")).toBe(true);
  });

  it("asks the PM to assign active unowned tasks and dedups within cadence", async () => {
    const event = {
      action: "scheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:concept:c2:unassigned`,
      now: "2026-06-14",
      after: {
        status: "todo",
        unassigned: true,
        assignmentAction: true,
        phaseId: "concept",
        taskId: "c2",
        title: "需求澄清",
        visibleRoles: ["pm"],
        dueDate: "2026-06-20",
      },
    };

    const first = makeDeps();
    await runAutomation(event, first.deps);
    expect(first.notes).toEqual([{ userId: pmId, title: "任务待分派" }]);

    const second = makeDeps();
    await runAutomation(event, second.deps);
    expect(second.notes.length).toBe(0);

    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((r) => r.ruleKey === "task_assignment" && r.status === "fired")).toBe(true);
    expect(runs.some((r) => r.ruleKey === "task_assignment" && r.status === "skipped")).toBe(true);
  });

  it("dedups delay impact event notifications within configured cadence", async () => {
    const delayEvent = {
      action: "task.rescheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: "c1",
      impact: {
        changedTaskId: "c1",
        shifted: [{ taskId: "c6", oldDue: "2026-06-10", newDue: "2026-06-13", deltaDays: 3 }],
        gateImpacts: [{ taskId: "c6", gateName: "概念评审", oldDue: "2026-06-10", newDue: "2026-06-13", deltaDays: 3 }],
        targetBreach: null,
        maxDeltaDays: 3,
        hasImpact: true,
      },
    };
    const first = makeDeps();
    await runAutomation(delayEvent, first.deps);
    expect(first.notes.some((n) => n.userId === pmId && n.title === "延期影响提醒")).toBe(true);

    const second = makeDeps();
    await runAutomation(delayEvent, second.deps);
    expect(second.notes.length).toBe(0);

    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((r) => r.ruleKey === "delay_impact_notify" && r.status === "fired")).toBe(true);
    expect(runs.some((r) => r.ruleKey === "delay_impact_notify" && r.status === "skipped")).toBe(true);
  });

  it("escalates lingering exceptions to manager stage and dedups that stage", async () => {
    const event = {
      action: "scheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:concept:c1:blocked`,
      now: "2026-06-14",
      after: {
        status: "blocked",
        title: "结构开模被阻塞",
        exceptionType: "blocked_task",
        exceptionAgeDays: 10,
        assigneeUserId: asgId,
      },
    };

    const first = makeDeps();
    await runAutomation(event, first.deps);
    const notified = new Set(first.notes.map((n) => n.userId));
    expect(notified.has(asgId)).toBe(false);
    expect(notified.has(pmId)).toBe(false);
    expect(notified.has(mgrId)).toBe(true);
    expect(first.notes).toHaveLength(1);
    expect(first.notes.every((n) => n.title === "异常升级至管理层")).toBe(true);

    const second = makeDeps();
    await runAutomation(event, second.deps);
    expect(second.notes.length).toBe(0);

    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((r) => r.ruleKey === "exception_escalation" && r.entityId === `${PROJECT_ID}:concept:c1:blocked:manager` && r.status === "fired")).toBe(true);
    expect(runs.some((r) => r.ruleKey === "exception_escalation" && r.entityId === `${PROJECT_ID}:concept:c1:blocked:manager` && r.status === "skipped")).toBe(true);
  });

  it("logs exception escalation errors with the leveled entityId", async () => {
    const event = {
      action: "scheduled" as const,
      projectId: PROJECT_ID,
      entityType: "task" as const,
      entityId: `${PROJECT_ID}:concept:c1:blocked`,
      now: "2026-06-14",
      after: {
        status: "blocked",
        title: "结构开模被阻塞",
        exceptionType: "blocked_task",
        exceptionAgeDays: 10,
        assigneeUserId: asgId,
      },
    };
    const deps = makeDeps();
    deps.deps.notifyDingtalk = async () => {
      throw new Error("dingtalk failed");
    };

    await runAutomation(event, deps.deps);

    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    expect(runs.some((r) =>
      r.ruleKey === "exception_escalation" &&
      r.entityId === `${PROJECT_ID}:concept:c1:blocked:manager` &&
      r.status === "error"
    )).toBe(true);
    expect(runs.some((r) =>
      r.ruleKey === "exception_escalation" &&
      r.entityId === `${PROJECT_ID}:concept:c1:blocked` &&
      r.status === "error"
    )).toBe(false);
  });

  it("does not fire a disabled rule", async () => {
    await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: false });
    const { notes, deps } = makeDeps();
    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9003,
      after: { severity: "P0", title: "禁用后不应触发", assigneeUserId: asgId },
    }, deps);
    expect(notes.length).toBe(0);
  });

  it("suppresses automated test fixture projects by default", async () => {
    await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
    const notes: Array<{ userId: number; title: string }> = [];
    const pushes: Array<{ title?: string }> = [];

    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9004,
      after: { severity: "P0", title: "测试夹具不应触发提醒", assigneeUserId: asgId },
    }, {
      createNotification: async (n: { userId: number; title: string }) => { notes.push({ userId: n.userId, title: n.title }); },
      pushWebhook: async (_text: string, opts?: { title?: string }) => { pushes.push({ title: opts?.title }); },
      notifyDingtalk: async () => {},
      notifyGroup: async () => true,
    });

    expect(notes.length).toBe(0);
    expect(pushes.length).toBe(0);
  });

  it("also suppresses release broadcasts for automated test fixture projects", async () => {
    await updateAutomationRuleRow({ ruleKey: "mp_release_broadcast", enabled: true, config: { pushGroup: true } });
    const pushes: Array<{ title?: string }> = [];

    await runAutomation({
      action: "mp.release", projectId: PROJECT_ID, entityType: "mp_release", entityId: "release-1",
      after: { productName: "测试产品", revisionLabel: "Rev.A" },
    }, {
      createNotification: async () => {},
      pushWebhook: async (_text: string, opts?: { title?: string }) => { pushes.push({ title: opts?.title }); },
      notifyDingtalk: async () => {},
      notifyGroup: async () => true,
    });

    expect(pushes.length).toBe(0);
  });
});

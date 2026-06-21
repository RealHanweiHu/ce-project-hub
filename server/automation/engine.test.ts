import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDb, upsertUser, getUserByOpenId, createProjectWithSeed,
  updateAutomationRuleRow, listAutomationRuns, getAutomationDueTasks, getAutomationDueIssues,
  addProjectMember,
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
      createNotification: async (n: { userId: number; title: string }) => { notes.push({ userId: n.userId, title: n.title }); },
      pushWebhook: async (_text: string, opts?: { title?: string }) => { pushes.push({ title: opts?.title }); },
      notifyDingtalk: async () => {}, // 测试不真发钉钉工作通知
      notifyGroup: async (chatId: string, title: string) => { groups.push({ chatId, title }); return true; },
    },
  };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${ARCHIVED_PROJECT_ID}`);
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
});
afterAll(async () => {
  // 还原规则到 seed 默认，避免污染共享 DB（如把 high_severity_issue 留成 disabled）
  await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
  await updateAutomationRuleRow({ ruleKey: "overdue_reminder", enabled: true, config: { graceDays: 0, cadenceHours: 24, scope: "both", notifyRoles: ["assignee", "pm"], pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "status_change_notify", enabled: false, config: { transitions: { issue: ["resolved", "closed"], task: [], gate: ["approved", "rejected"] }, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "delay_impact_notify", enabled: true, config: { minDeltaDays: 0, notifyGateImpacts: true, notifyTargetBreach: true, onlyNewTargetBreach: false, cadenceHours: 24, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "exception_escalation", enabled: true, config: { assigneeAfterDays: 2, pmAfterDays: 5, managerAfterDays: 10, cadenceHours: 24, pushGroup: false } });
  await cleanup();
});
beforeEach(async () => {
  const db = await getDb();
  if (db) { const { sql } = await import("drizzle-orm"); await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${PROJECT_ID}`); }
  // 重置规则到已知状态
  await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
  await updateAutomationRuleRow({ ruleKey: "overdue_reminder", enabled: true, config: { graceDays: 0, cadenceHours: 24, scope: "both", notifyRoles: ["assignee", "pm"], pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "status_change_notify", enabled: false, config: {} });
  await updateAutomationRuleRow({ ruleKey: "delay_impact_notify", enabled: true, config: { minDeltaDays: 0, notifyGateImpacts: true, notifyTargetBreach: true, onlyNewTargetBreach: false, cadenceHours: 24, pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "exception_escalation", enabled: true, config: { assigneeAfterDays: 2, pmAfterDays: 5, managerAfterDays: 10, cadenceHours: 24, pushGroup: false } });
});

describe("automation engine integration", () => {
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

  it("does not trigger high severity for out-of-set severity (P3)", async () => {
    const { notes, deps } = makeDeps();
    await runAutomation({
      action: "issue.create", projectId: PROJECT_ID, entityType: "issue", entityId: 9002,
      after: { severity: "P3", title: "文案微调", assigneeUserId: asgId },
    }, deps);
    expect(notes.length).toBe(0);
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
    expect(notified.has(asgId)).toBe(true);
    expect(notified.has(pmId)).toBe(true);
    expect(notified.has(mgrId)).toBe(true);
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
});

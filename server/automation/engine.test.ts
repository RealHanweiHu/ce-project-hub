import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDb, upsertUser, getUserByOpenId, createProjectWithSeed,
  updateAutomationRuleRow, listAutomationRuns,
} from "../db";
import { runAutomation } from "./engine";

const SUF = "autoeng";
const PROJECT_ID = `proj_${SUF}`;
const PM_OPEN = `pm_${SUF}`;
const ASG_OPEN = `asg_${SUF}`;

let pmId = 0;
let asgId = 0;

// 捕获派发，避免真写通知/真发钉钉
function makeDeps() {
  const notes: Array<{ userId: number; title: string }> = [];
  const pushes: Array<{ title?: string }> = [];
  return {
    notes,
    pushes,
    deps: {
      createNotification: async (n: { userId: number; title: string }) => { notes.push({ userId: n.userId, title: n.title }); },
      pushWebhook: async (_text: string, opts?: { title?: string }) => { pushes.push({ title: opts?.title }); },
    },
  };
}

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
}

beforeAll(async () => {
  await cleanup();
  await upsertUser({ openId: PM_OPEN, name: "PM 用户" });
  await upsertUser({ openId: ASG_OPEN, name: "负责人" });
  pmId = (await getUserByOpenId(PM_OPEN))!.id;
  asgId = (await getUserByOpenId(ASG_OPEN))!.id;
  await createProjectWithSeed(
    { id: PROJECT_ID, name: "自动化引擎测试项目", category: "npd", pmUserId: pmId, createdBy: pmId },
    "npd",
    pmId
  );
});
afterAll(async () => {
  // 还原规则到 seed 默认，避免污染共享 DB（如把 high_severity_issue 留成 disabled）
  await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
  await updateAutomationRuleRow({ ruleKey: "overdue_reminder", enabled: true, config: { graceDays: 0, cadenceHours: 24, scope: "both", notifyRoles: ["assignee", "pm"], pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "status_change_notify", enabled: false, config: { transitions: { issue: ["resolved", "closed"], task: [], gate: ["approved", "rejected"] }, pushGroup: false } });
  await cleanup();
});
beforeEach(async () => {
  const db = await getDb();
  if (db) { const { sql } = await import("drizzle-orm"); await db.execute(sql`DELETE FROM automation_runs WHERE "projectId" = ${PROJECT_ID}`); }
  // 重置规则到已知状态
  await updateAutomationRuleRow({ ruleKey: "high_severity_issue", enabled: true, config: { severities: ["P0", "P1"], pushGroup: true } });
  await updateAutomationRuleRow({ ruleKey: "overdue_reminder", enabled: true, config: { graceDays: 0, cadenceHours: 24, scope: "both", notifyRoles: ["assignee", "pm"], pushGroup: false } });
  await updateAutomationRuleRow({ ruleKey: "status_change_notify", enabled: false, config: {} });
});

describe("automation engine integration", () => {
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

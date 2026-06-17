import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  getDb, upsertUser, getUserByOpenId, createProjectWithSeed,
  updateAutomationRuleRow, listAutomationRuns, createAutomationRun, hasRecentAutomationFire,
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

  it("continues group notification when personal DingTalk notification fails", async () => {
    const { updateProject } = await import("../db");
    await updateProject(PROJECT_ID, { dingtalkChatId: null });
    const dispatch = makeDeps();
    dispatch.deps.notifyDingtalk = async () => {
      throw new Error("dingtalk temporary failure");
    };

    await runAutomation({
      action: "issue.create",
      projectId: PROJECT_ID,
      entityType: "issue",
      entityId: 9201,
      after: { severity: "P0", title: "钉钉瞬时失败", assigneeUserId: asgId },
    }, dispatch.deps);

    expect(dispatch.notes.length).toBeGreaterThan(0);
    expect(dispatch.pushes.length).toBe(1);
    const runs = await listAutomationRuns({ projectId: PROJECT_ID });
    const fired = runs.find((r) => r.ruleKey === "high_severity_issue" && r.entityId === "9201");
    expect(fired?.status).toBe("fired");
    expect(fired?.detail ?? "").toContain("Channel failures");
    expect(fired?.recipients).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: "dingtalk", ok: false }),
      expect.objectContaining({ channel: "webhook", ok: true }),
    ]));
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

  it("dedup lookup includes event type in addition to rule and entity", async () => {
    const entityId = `${PROJECT_ID}:concept:event-type`;
    await createAutomationRun({
      ruleKey: "overdue_reminder",
      projectId: PROJECT_ID,
      eventType: "manual",
      entityType: "task",
      entityId,
      status: "fired",
      recipients: [],
      detail: "manual event",
    });

    const since = new Date("2000-01-01T00:00:00Z");
    await expect(hasRecentAutomationFire({
      ruleKey: "overdue_reminder",
      eventType: "scheduled",
      entityId,
      since,
    })).resolves.toBe(false);
    await expect(hasRecentAutomationFire({
      ruleKey: "overdue_reminder",
      eventType: "manual",
      entityId,
      since,
    })).resolves.toBe(true);
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

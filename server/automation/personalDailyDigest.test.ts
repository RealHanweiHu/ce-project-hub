import { describe, expect, it } from "vitest";
import type { PersonalDailyDigestItem } from "../db";
import type { PersonalDailyDigestConfig } from "./digestRules";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "../../shared/sop-templates";
import {
  buildPersonalDailyDigestMarkdown,
  computePersonalDailyDigestTiming,
  groupPersonalDigestItems,
  runPersonalDailyDigestScan,
} from "./personalDailyDigest";

const cfg: PersonalDailyDigestConfig = {
  sendHour: 9,
  dueSoonDays: 3,
  includePendingReviews: true,
  includeProjectExceptions: true,
  pushDingtalk: true,
};

function item(over: Partial<PersonalDailyDigestItem> = {}): PersonalDailyDigestItem {
  return {
    recipientUserId: 7,
    kind: "task_overdue",
    projectId: "p1",
    projectName: "充气泵",
    projectNumber: "NPD-001",
    projectCategory: "npd",
    phaseId: "design",
    entityType: "task",
    entityId: "p1:design:d1",
    title: "d1",
    dueDate: "2026-06-15",
    status: "in_progress",
    severity: "high",
    ...over,
  };
}

function makeDeps(over: Partial<Parameters<typeof runPersonalDailyDigestScan>[1]> & { rows?: PersonalDailyDigestItem[] } = {}) {
  const calls = {
    notifications: [] as Array<{ userId: number; title: string; body?: string | null }>,
    dingtalk: [] as Array<{ ids: number[]; title: string; markdown: string }>,
    runs: [] as Array<{ status: string; entityId: string; detail: string }>,
  };
  const deps = {
    getConfigRow: async () => ({ enabled: true, config: cfg }),
    getItems: async () => over.rows ?? [
      item(),
      item({ recipientUserId: 8, kind: "deliverable_review", entityType: "deliverable_review", entityId: "review-1", title: "EVT 测试报告", dueDate: null }),
    ],
    getProjectLikes: async () => new Map(),
    hasRun: async () => false,
    now: new Date("2026-06-16T01:30:00Z"),
    writeRun: async (status: "fired" | "skipped", entityId: string, detail: string) => {
      calls.runs.push({ status, entityId, detail });
    },
    createNotification: async (n: { userId: number; title: string; body?: string | null }) => {
      calls.notifications.push({ userId: n.userId, title: n.title, body: n.body });
    },
    notifyDingtalk: async (ids: number[], title: string, markdown: string) => {
      calls.dingtalk.push({ ids, title, markdown });
    },
    getDeliveryProfiles: async (userIds: number[]) => new Map(userIds.map((userId) => [
      userId,
      { userId, prefs: {}, immediateSent24h: 0 },
    ])),
    ...over,
  };
  return { deps, calls };
}

describe("personal daily digest", () => {
  it("computes daily timing in Shanghai time", () => {
    const reached = computePersonalDailyDigestTiming(new Date("2026-06-16T01:30:00Z"), cfg);
    expect(reached).toEqual({ todayISO: "2026-06-16", periodKey: "d:2026-06-16", reached: true });
    expect(computePersonalDailyDigestTiming(new Date("2026-06-16T00:30:00Z"), cfg).reached).toBe(false);
  });

  it("groups items by recipient", () => {
    const grouped = groupPersonalDigestItems([item({ recipientUserId: 1 }), item({ recipientUserId: 2 }), item({ recipientUserId: 1 })]);
    expect(grouped.get(1)?.length).toBe(2);
    expect(grouped.get(2)?.length).toBe(1);
  });

  it("builds compact markdown with counts", () => {
    const out = buildPersonalDailyDigestMarkdown([
      item(),
      item({ kind: "issue_critical", entityType: "issue", entityId: "9", title: "不开机", severity: "P0", dueDate: null }),
    ], "2026-06-16");
    expect(out.title).toBe("我的每日摘要");
    expect(out.body).toContain("P0/P1 1");
    expect(out.body).toContain("逾期 1");
    expect(out.markdown).toContain("充气泵");
  });

  it("resolves lite/add-on task titles from project template context", () => {
    const out = buildPersonalDailyDigestMarkdown([
      item({ phaseId: "design", title: "pb2", entityId: "p1:design:pb2" }),
    ], "2026-06-16", new Map([["p1", {
      category: "npd",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
    }]]));
    expect(out.markdown).toContain("安全 FMEA 与保护链路评审");
    expect(out.markdown).not.toContain("：pb2");
  });

  it("sends one digest per user and writes per-user runs", async () => {
    const { deps, calls } = makeDeps();
    await runPersonalDailyDigestScan(new Date("2026-06-16T01:30:00Z"), deps);
    expect(calls.notifications.map((n) => n.userId).sort()).toEqual([7, 8]);
    expect(calls.dingtalk.map((n) => n.ids[0]).sort()).toEqual([7, 8]);
    expect(calls.runs.map((r) => r.entityId).sort()).toEqual(["d:2026-06-16:7", "d:2026-06-16:8"]);
  });

  it("does not send before the configured hour or when disabled", async () => {
    const before = makeDeps();
    await runPersonalDailyDigestScan(new Date("2026-06-16T00:30:00Z"), before.deps);
    expect(before.calls.notifications).toEqual([]);

    const disabled = makeDeps({ getConfigRow: async () => ({ enabled: false, config: cfg }) });
    await runPersonalDailyDigestScan(new Date("2026-06-16T01:30:00Z"), disabled.deps);
    expect(disabled.calls.notifications).toEqual([]);
  });

  it("dedups already sent users and writes one empty skipped run", async () => {
    const deduped = makeDeps({ hasRun: async (entityId: string) => entityId.endsWith(":7") });
    await runPersonalDailyDigestScan(new Date("2026-06-16T01:30:00Z"), deduped.deps);
    expect(deduped.calls.notifications.map((n) => n.userId)).toEqual([8]);

    const empty = makeDeps({ rows: [] });
    await runPersonalDailyDigestScan(new Date("2026-06-16T01:30:00Z"), empty.deps);
    expect(empty.calls.notifications).toEqual([]);
    expect(empty.calls.runs).toEqual([{ status: "skipped", entityId: "d:2026-06-16:empty", detail: "no personal digest items" }]);
  });

  it("keeps site notification but suppresses real DingTalk when pushDingtalk=false", async () => {
    const noDing = makeDeps({ getConfigRow: async () => ({ enabled: true, config: { ...cfg, pushDingtalk: false } }) });
    await runPersonalDailyDigestScan(new Date("2026-06-16T01:30:00Z"), noDing.deps);
    expect(noDing.calls.notifications.length).toBe(2);
    expect(noDing.calls.dingtalk).toEqual([]);
  });
});

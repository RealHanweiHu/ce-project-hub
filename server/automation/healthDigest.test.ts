import { describe, it, expect } from "vitest";
import {
  shanghaiParts, addDaysISO, isoWeekdayOf, computeDigestTiming,
  scorePortfolio, groupByPm, buildPmMarkdown, buildGroupMarkdown,
  runHealthDigestScan,
} from "./healthDigest";
import type { PortfolioHealthRow } from "../db";
import type { HealthDigestConfig } from "./digestRules";

function row(over: Partial<PortfolioHealthRow>): PortfolioHealthRow {
  return {
    id: "p1", name: "项目1", projectNumber: "NPD-001", category: "npd", risk: "low",
    currentPhase: "concept", targetDate: null, pmUserId: 1, pmName: "张三",
    overdueTasks: 0, blockedTasks: 0, openIssues: 0, criticalIssues: 0,
    plannedEnd: null, plannedItems: 0, dueItems: 0, donePlannedItems: 0, gateNotReady: null, ...over,
  };
}

describe("时点/日期 helper", () => {
  it("addDaysISO", () => {
    expect(addDaysISO("2026-06-16", 0)).toBe("2026-06-16");
    expect(addDaysISO("2026-06-16", -1)).toBe("2026-06-15");
    expect(addDaysISO("2026-06-30", 1)).toBe("2026-07-01");
  });
  it("isoWeekdayOf（2026-06-16 是周二=2）", () => {
    expect(isoWeekdayOf("2026-06-16")).toBe(2);
  });
  it("shanghaiParts 用 UTC 22:00 → 上海次日 06:00", () => {
    const p = shanghaiParts(new Date("2026-06-15T22:00:00Z"));
    expect(p.todayISO).toBe("2026-06-16");
    expect(p.hour).toBe(6);
  });
  it("daily 到点：上海 09:xx → reached", () => {
    const t = computeDigestTiming(new Date("2026-06-16T01:30:00Z"), { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.periodKey).toBe("d:2026-06-16");
    expect(t.reached).toBe(true);
  });
  it("daily 未到点：上海 08:xx → not reached", () => {
    const t = computeDigestTiming(new Date("2026-06-16T00:00:00Z"), { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.reached).toBe(false);
  });
  it("weekly periodKey 为本周目标weekday日期；过点可补发", () => {
    const t = computeDigestTiming(new Date("2026-06-16T02:00:00Z"), { cadence: "weekly", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.periodKey).toBe("w:2026-06-15");
    expect(t.reached).toBe(true);
  });
  it("weekly 目标日在未来 → not reached", () => {
    const t = computeDigestTiming(new Date("2026-06-16T02:00:00Z"), { cadence: "weekly", sendHour: 9, weekday: 5, pushPmPersonal: true, pushManagerGroup: true });
    expect(t.periodKey).toBe("w:2026-06-19");
    expect(t.reached).toBe(false);
  });
});

describe("评分/分组/消息", () => {
  it("scorePortfolio 过滤绿、红在前、计绿数", () => {
    const rows = [
      row({ id: "g", risk: "low" }),
      row({ id: "a", blockedTasks: 1 }),
      row({ id: "r", overdueTasks: 2 }),
    ];
    const { abnormal, greenCount } = scorePortfolio(rows);
    expect(greenCount).toBe(1);
    expect(abnormal.map((s) => s.row.id)).toEqual(["r", "a"]);
    expect(abnormal[0].reasons).toContain("逾期×2");
  });
  it("groupByPm 跳过无 PM", () => {
    const { abnormal } = scorePortfolio([
      row({ id: "r1", pmUserId: 1, overdueTasks: 1 }),
      row({ id: "r2", pmUserId: 2, blockedTasks: 1 }),
      row({ id: "r3", pmUserId: null, overdueTasks: 1 }),
    ]);
    const g = groupByPm(abnormal);
    expect(g.get(1)?.length).toBe(1);
    expect(g.get(2)?.length).toBe(1);
    expect([...g.keys()].sort()).toEqual([1, 2]);
  });
  it("buildPmMarkdown / buildGroupMarkdown 含项目名与计数", () => {
    const { abnormal, greenCount } = scorePortfolio([
      row({ id: "r", name: "充气泵", overdueTasks: 1 }),
      row({ id: "g", risk: "low" }),
    ]);
    const pm = buildPmMarkdown(abnormal, "daily");
    expect(pm.title).toBe("项目健康日报");
    expect(pm.markdown).toContain("充气泵");
    const grp = buildGroupMarkdown(abnormal, greenCount, "weekly");
    expect(grp.title).toContain("周报");
    expect(grp.text).toContain("绿 1");
  });
});

describe("runHealthDigestScan（注入 deps）", () => {
  const NOW = new Date("2026-06-16T02:00:00Z"); // 上海 10:00
  const cfg: HealthDigestConfig = { cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true };

  function makeDeps(over: Partial<Parameters<typeof runHealthDigestScan>[1]> & { rows?: PortfolioHealthRow[] } = {}) {
    const calls = { notify: [] as number[][], notifications: [] as number[], group: 0, runs: [] as Array<{ status: string; key: string }> };
    const deps = {
      getConfigRow: async () => ({ enabled: true, config: cfg }),
      getHealth: async (_today: string) => over.rows ?? [row({ id: "r", overdueTasks: 1, pmUserId: 7 })],
      hasRun: async () => false,
      writeRun: async (status: "fired" | "skipped", key: string) => { calls.runs.push({ status, key }); },
      createNotification: async (n: { userId: number }) => { calls.notifications.push(n.userId); },
      notifyDingtalk: async (ids: number[]) => { calls.notify.push(ids); },
      pushWebhook: async () => { calls.group += 1; },
      ...over,
    };
    return { deps, calls };
  }

  it("正常：PM 个人 + 管理群 + 写 fired", async () => {
    const { deps, calls } = makeDeps();
    await runHealthDigestScan(NOW, deps);
    expect(calls.notifications).toEqual([7]);
    expect(calls.notify).toEqual([[7]]);
    expect(calls.group).toBe(1);
    expect(calls.runs).toEqual([{ status: "fired", key: "d:2026-06-16" }]);
  });

  it("enabled=false 不发", async () => {
    const { deps, calls } = makeDeps({ getConfigRow: async () => ({ enabled: false, config: cfg }) });
    await runHealthDigestScan(NOW, deps);
    expect(calls.runs).toEqual([]);
    expect(calls.group).toBe(0);
  });

  it("未到点不发", async () => {
    const { deps, calls } = makeDeps();
    await runHealthDigestScan(new Date("2026-06-16T00:00:00Z"), deps); // 上海 08:00
    expect(calls.runs).toEqual([]);
  });

  it("当期已有 run → 不重复", async () => {
    const { deps, calls } = makeDeps({ hasRun: async () => true });
    await runHealthDigestScan(NOW, deps);
    expect(calls.runs).toEqual([]);
    expect(calls.group).toBe(0);
  });

  it("无异常 → skipped 不发消息", async () => {
    const { deps, calls } = makeDeps({ rows: [row({ id: "g", risk: "low" })] });
    await runHealthDigestScan(NOW, deps);
    expect(calls.runs).toEqual([{ status: "skipped", key: "d:2026-06-16" }]);
    expect(calls.notifications).toEqual([]);
    expect(calls.group).toBe(0);
  });

  it("pushPmPersonal=false 只发群（个人渠道全静默）", async () => {
    const { deps, calls } = makeDeps({ getConfigRow: async () => ({ enabled: true, config: { ...cfg, pushPmPersonal: false } }) });
    await runHealthDigestScan(NOW, deps);
    expect(calls.notifications).toEqual([]);
    expect(calls.notify).toEqual([]); // 个人钉钉也不发
    expect(calls.group).toBe(1);
    expect(calls.runs[0].status).toBe("fired");
  });

  it("pushManagerGroup=false 只发 PM 个人", async () => {
    const { deps, calls } = makeDeps({ getConfigRow: async () => ({ enabled: true, config: { ...cfg, pushManagerGroup: false } }) });
    await runHealthDigestScan(NOW, deps);
    expect(calls.notifications).toEqual([7]);
    expect(calls.notify).toEqual([[7]]);
    expect(calls.group).toBe(0); // 管理群不发
    expect(calls.runs[0].status).toBe("fired");
  });
});

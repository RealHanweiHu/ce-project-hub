import { describe, expect, it } from "vitest";
import { SOP_TEMPLATE_VERSION_NPD_V3 } from "../../shared/sop-templates";
import type { GroupWeeklyDigestConfig } from "./digestRules";
import {
  computeGroupWeeklyDigestTiming,
  runGroupWeeklyDigestScan,
  type GroupWeeklyDigestProject,
} from "./groupWeeklyDigest";

const config: GroupWeeklyDigestConfig = { sendHour: 9, weekday: 1 };

function project(over: Partial<GroupWeeklyDigestProject> = {}): GroupWeeklyDigestProject {
  return {
    project: {
      id: "p1",
      name: "充气泵",
      projectNumber: "NPD-001",
      category: "npd",
      sopTemplateVersion: SOP_TEMPLATE_VERSION_NPD_V3,
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
      currentPhase: "concept",
      dingtalkChatId: "chat-p1",
    },
    tasks: [
      {
        phaseId: "concept",
        taskId: "nc1",
        status: "done",
        dueDate: "2026-07-13",
        completedAt: new Date("2026-07-13T00:10:00Z"),
        assigneeName: "张三",
      },
      {
        phaseId: "design",
        taskId: "pb2",
        status: "in_progress",
        dueDate: "2026-07-12",
        completedAt: null,
        assigneeName: "李四",
      },
      {
        phaseId: "concept",
        taskId: "nc2",
        status: "todo",
        dueDate: "2026-07-20",
        completedAt: null,
        assigneeName: "王五",
      },
      {
        phaseId: "concept",
        taskId: "nc3",
        status: "todo",
        dueDate: "2026-07-18",
        completedAt: null,
        assigneeName: "赵六",
      },
    ],
    ...over,
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  const calls = {
    loads: 0,
    sentGroup: [] as Array<{ chatId: string; title: string; markdown: string }>,
    runs: [] as Array<{ status: string; projectId: string; entityId: string; detail: string }>,
    finished: [] as Array<{ claimKey: string; token: string; status: string; error?: string | null }>,
  };
  const claimed = new Set<string>();
  const deps = {
    getConfigRow: async () => ({ enabled: true, config }),
    getProjects: async () => {
      calls.loads += 1;
      return [project()];
    },
    isProjectActive: async () => true,
    claim: async (claimKey: string) => {
      if (claimed.has(claimKey)) return null;
      claimed.add(claimKey);
      return { token: `token-${claimed.size}` };
    },
    finishClaim: async (input: { claimKey: string; token: string; status: string; error?: string | null }) => {
      calls.finished.push(input);
      if (input.status === "error") claimed.delete(input.claimKey);
    },
    sendToGroup: async (chatId: string, title: string, markdown: string) => {
      calls.sentGroup.push({ chatId, title, markdown });
      return true;
    },
    writeRun: async (status: string, projectId: string, entityId: string, detail: string) => {
      calls.runs.push({ status, projectId, entityId, detail });
    },
    ...over,
  };
  return { calls, deps };
}

describe("项目群周摘要", () => {
  it("测试库关闭钉钉外发时不加载、不抢占也不发送", async () => {
    const { calls, deps } = makeDeps({
      isDingtalkDeliveryEnabled: () => false,
    });

    await runGroupWeeklyDigestScan(
      new Date("2026-07-13T01:30:00Z"),
      deps
    );

    expect(calls.loads).toBe(0);
    expect(calls.sentGroup).toEqual([]);
    expect(calls.finished).toEqual([]);
    expect(calls.runs).toEqual([]);
  });

  it("按上海时间仅在配置周几 09:00 后触发", () => {
    expect(computeGroupWeeklyDigestTiming(new Date("2026-07-13T01:30:00Z"), config)).toEqual({
      todayISO: "2026-07-13",
      weekStartISO: "2026-07-13",
      periodKey: "w:2026-W29",
      reached: true,
    });
    expect(computeGroupWeeklyDigestTiming(new Date("2026-07-13T00:30:00Z"), config).reached).toBe(false);
    expect(computeGroupWeeklyDigestTiming(new Date("2026-07-15T01:30:00Z"), config).reached).toBe(false);
  });

  it("周一 09:00 后每项目群发一条；同周原子 claim 防重且数据只批量加载一次", async () => {
    const { calls, deps } = makeDeps();
    const monday930 = new Date("2026-07-13T01:30:00Z");
    await runGroupWeeklyDigestScan(monday930, deps);
    await runGroupWeeklyDigestScan(monday930, deps);

    expect(calls.loads).toBe(2);
    expect(calls.sentGroup).toHaveLength(1);
    expect(calls.sentGroup[0].chatId).toBe("chat-p1");
    expect(calls.sentGroup[0].markdown).toContain("本周完成 1");
    expect(calls.sentGroup[0].markdown).toContain("当前逾期 1");
    expect(calls.sentGroup[0].markdown).toContain("李四");
    expect(calls.sentGroup[0].markdown).toContain("下周到期 1");
    expect(calls.sentGroup[0].markdown).toContain("当前阶段");
    expect(calls.sentGroup[0].markdown).toContain("Gate");
    expect(calls.runs.filter((run) => run.status === "fired")).toHaveLength(1);
  });

  it("非发送日和未配置项目群时不发", async () => {
    const offDay = makeDeps();
    await runGroupWeeklyDigestScan(new Date("2026-07-15T01:30:00Z"), offDay.deps);
    expect(offDay.calls.loads).toBe(0);
    expect(offDay.calls.sentGroup).toEqual([]);

    const noChat = makeDeps({ getProjects: async () => [project({ project: { ...project().project, dingtalkChatId: null } })] });
    await runGroupWeeklyDigestScan(new Date("2026-07-13T01:30:00Z"), noChat.deps);
    expect(noChat.calls.sentGroup).toEqual([]);
  });

  it("群发送失败会写错误审计并释放 claim，允许本周重试", async () => {
    let attempt = 0;
    const { calls, deps } = makeDeps({
      sendToGroup: async () => {
        attempt += 1;
        return attempt > 1;
      },
    });
    const monday930 = new Date("2026-07-13T01:30:00Z");
    await runGroupWeeklyDigestScan(monday930, deps);
    await runGroupWeeklyDigestScan(monday930, deps);
    expect(attempt).toBe(2);
    expect(calls.runs.map((run) => run.status)).toEqual(["error", "fired"]);
    expect(calls.finished.map((claim) => claim.status)).toEqual(["error", "fired"]);
  });
});

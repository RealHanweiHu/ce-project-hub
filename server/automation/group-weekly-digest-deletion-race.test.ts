import { describe, expect, it } from "vitest";
import { runGroupWeeklyDigestScan, type GroupWeeklyDigestDeps } from "./groupWeeklyDigest";

describe("group weekly digest deletion race", () => {
  it("does not post a loaded digest after the project becomes inactive", async () => {
    const sent: string[] = [];
    const deps = {
      getConfigRow: async () => ({ enabled: true, config: { sendHour: 9, weekday: 1 } }),
      getProjects: async () => [{
        project: {
          id: "deleted-project",
          name: "已删除项目",
          projectNumber: "P-1",
          category: "npd",
          sopTemplateVersion: "npd_v3",
          customFields: {},
          currentPhase: "concept",
          dingtalkChatId: "chat-1",
        },
        tasks: [],
      }],
      isProjectActive: async () => false,
      claim: async () => ({ token: "token" }),
      finishClaim: async () => undefined,
      sendToGroup: async (chatId: string) => { sent.push(chatId); return true; },
      writeRun: async () => undefined,
    } as GroupWeeklyDigestDeps;

    await runGroupWeeklyDigestScan(new Date("2026-07-13T01:30:00Z"), deps);

    expect(sent).toEqual([]);
  });
});

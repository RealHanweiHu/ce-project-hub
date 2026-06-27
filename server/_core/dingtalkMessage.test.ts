import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";
import { ENV } from "./env";
import { sendWorkNotification } from "./dingtalkMessage";

const originalAgentId = ENV.dingtalkAgentId;

beforeEach(() => {
  vi.restoreAllMocks();
  _resetTokenCacheForTest();
  __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
  ENV.dingtalkAgentId = "10001";
});

afterEach(() => {
  ENV.dingtalkAgentId = originalAgentId;
});

describe("sendWorkNotification", () => {
  it("counts delivered users only when DingTalk accepts the work notification", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 0, task_id: 123 }), { status: 200 });
    });

    const result = await sendWorkNotification(["corp-a", "corp-b", "corp-a"], "任务分配", "hello");

    expect(result).toMatchObject({
      attempted: 2,
      delivered: 2,
      failed: 0,
      skipped: 0,
    });
  });

  it("counts DingTalk errcode responses as failed delivery", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 40035, errmsg: "invalid userid" }), { status: 200 });
    });

    const result = await sendWorkNotification(["corp-a"], "任务分配", "hello");

    expect(result.delivered).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.error).toContain("40035");
  });

  it("counts users as skipped when work notification is not configured", async () => {
    ENV.dingtalkAgentId = "";
    const spy = vi.spyOn(globalThis, "fetch");

    const result = await sendWorkNotification(["corp-a"], "任务分配", "hello");

    expect(result).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 0,
      skipped: 1,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";
import { ENV } from "./env";
import { sendWorkNotification } from "./dingtalkMessage";

const originalAgentId = ENV.dingtalkAgentId;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubEnv("DINGTALK_DELIVERY_MODE", "live");
  _resetTokenCacheForTest();
  __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
  ENV.dingtalkAgentId = "10001";
});

afterEach(() => {
  vi.unstubAllEnvs();
  ENV.dingtalkAgentId = originalAgentId;
});

describe("sendWorkNotification", () => {
  it("suppresses test-database delivery before any DingTalk request", async () => {
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await sendWorkNotification(
      ["corp-a", "corp-b"],
      "测试通知",
      "不应出站"
    );

    expect(result).toMatchObject({
      attempted: 0,
      delivered: 0,
      failed: 0,
      skipped: 2,
    });
    expect(result.error).toContain("已关闭钉钉外发");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

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

  it("sends ActionCard work notifications when action buttons are provided", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ errcode: 0, task_id: 123 }), { status: 200 });
    });

    const result = await sendWorkNotification(["corp-a"], "任务审批", "请审批", {
      buttons: [
        { title: "通过", actionUrl: "https://hub.test/api/action-card/execute?token=ok" },
        { title: "驳回", actionUrl: "https://hub.test/api/action-card/execute?token=no" },
      ],
    });

    expect(result.delivered).toBe(1);
    expect(payloads[0]?.msg).toMatchObject({
      msgtype: "action_card",
      action_card: {
        title: "任务审批",
        markdown: "请审批",
        btn_orientation: "1",
        btn_json_list: [
          { title: "通过", action_url: "https://hub.test/api/action-card/execute?token=ok" },
          { title: "驳回", action_url: "https://hub.test/api/action-card/execute?token=no" },
        ],
      },
    });
  });

  it("falls back to markdown when ActionCard delivery is rejected", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      payloads.push(payload);
      const msg = payload.msg as { msgtype?: string };
      if (msg.msgtype === "action_card") {
        return new Response(JSON.stringify({ errcode: 400, errmsg: "unsupported" }), { status: 200 });
      }
      return new Response(JSON.stringify({ errcode: 0, task_id: 123 }), { status: 200 });
    });

    const result = await sendWorkNotification(["corp-a"], "任务审批", "请审批", {
      buttons: [{ title: "通过", actionUrl: "https://hub.test/api/action-card/execute?token=ok" }],
    });

    expect(result.delivered).toBe(1);
    expect(payloads.map((payload) => (payload.msg as { msgtype?: string }).msgtype)).toEqual(["action_card", "markdown"]);
    expect(payloads[1]?.msg).toMatchObject({
      msgtype: "markdown",
      markdown: {
        title: "任务审批",
      },
    });
    expect(JSON.stringify(payloads[1])).toContain("[通过](https://hub.test/api/action-card/execute?token=ok)");
  });

  it("does not fallback and double-send when an ActionCard response is ambiguous", async () => {
    const payloads: Array<Record<string, unknown>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      }
      payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ message: "upstream timeout" }), { status: 504 });
    });

    const result = await sendWorkNotification(["corp-a"], "任务审批", "请审批", {
      buttons: [{ title: "通过", actionUrl: "https://hub.test/approve" }],
    });

    expect(result).toMatchObject({ delivered: 0, failed: 1 });
    expect(result.error).toContain("结果未知");
    expect(payloads).toHaveLength(1);
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

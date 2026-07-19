import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";
import { buildApprovalForm, createApprovalInstance, getApprovalInstance, normalizeApprovalStatus } from "./dingtalkApproval";
import { ENV } from "./env";

const originalAgentId = ENV.dingtalkAgentId;

beforeEach(() => {
  vi.stubEnv("DINGTALK_DELIVERY_MODE", "live");
  _resetTokenCacheForTest();
  vi.restoreAllMocks();
  __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
  ENV.dingtalkAgentId = originalAgentId;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildApprovalForm", () => {
  it("converts snapshot fields to dingtalk form values", () => {
    expect(buildApprovalForm("mp_release", { 项目: "P1", 数量: 2, 条件: ["A"] })).toEqual([
      { name: "项目", value: "P1" },
      { name: "数量", value: "2" },
      { name: "条件", value: "[\"A\"]" },
    ]);
  });
});

describe("normalizeApprovalStatus", () => {
  it("maps dingtalk statuses to local statuses", () => {
    expect(normalizeApprovalStatus({ status: "RUNNING" })).toBe("pending");
    expect(normalizeApprovalStatus({ status: "COMPLETED", result: "agree" })).toBe("approved");
    expect(normalizeApprovalStatus({ status: "COMPLETED", result: "refuse" })).toBe("rejected");
    expect(normalizeApprovalStatus({ status: "TERMINATED" })).toBe("terminated");
  });
});

describe("createApprovalInstance", () => {
  it("suppresses test-database approval creation as a definite non-delivery", async () => {
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    const result = await createApprovalInstance({
      processCode: "PROC",
      originatorUserId: "u1",
      formComponentValues: [],
    });

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.error).toContain("已关闭钉钉外发");
      expect(result.uncertain).not.toBe(true);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns readable error when processCode is missing", async () => {
    const res = await createApprovalInstance({
      processCode: "",
      originatorUserId: "u1",
      formComponentValues: [],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/processCode/);
  });

  it("creates dingtalk approval instance", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ errcode: 0, result: { process_instance_id: "proc-1" } }), { status: 200 });
    });
    const res = await createApprovalInstance({
      processCode: "PROC",
      originatorUserId: "u1",
      formComponentValues: [{ name: "项目", value: "P1" }],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.processInstanceId).toBe("proc-1");
    expect(calls.some((url) => url.includes("/topapi/processinstance/create"))).toBe(true);
  });

  it("passes explicit approvers through the workflow API", async () => {
    ENV.dingtalkAgentId = "10001";
    const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      calls.push({
        url: u,
        headers: init?.headers as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ instanceId: "proc-v1" }), { status: 200 });
    });
    const res = await createApprovalInstance({
      processCode: "PROC",
      originatorUserId: "u1",
      deptId: 12,
      formComponentValues: [{ name: "项目", value: "P1" }],
      approverUserIds: [" approver-1 ", "approver-1", "approver-2"],
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.processInstanceId).toBe("proc-v1");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.dingtalk.com/v1.0/workflow/processInstances");
    expect(calls[0].headers["x-acs-dingtalk-access-token"]).toBe("tok");
    expect(calls[0].body).toMatchObject({
      processCode: "PROC",
      originatorUserId: "u1",
      deptId: 12,
      microappAgentId: 10001,
      approvers: [{ actionType: "AND", userIds: ["approver-1", "approver-2"] }],
      formComponentValues: [{ name: "项目", value: "P1" }],
    });
  });

  it("marks a transport failure after submission starts as uncertain", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      }
      throw new DOMException("timed out", "TimeoutError");
    });

    const res = await createApprovalInstance({
      processCode: "PROC",
      originatorUserId: "u1",
      formComponentValues: [],
    });

    expect(res).toMatchObject({ ok: false, uncertain: true });
  });

  it("marks a successful response without an instance id as uncertain", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        return new Response(
          JSON.stringify({ accessToken: "tok", expireIn: 7200 }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ success: true, result: {} }), {
        status: 200,
      });
    });

    const res = await createApprovalInstance({
      processCode: "PROC",
      originatorUserId: "u1",
      formComponentValues: [],
    });

    expect(res).toMatchObject({ ok: false, uncertain: true });
  });
});

describe("getApprovalInstance", () => {
  it("fetches and normalizes dingtalk approval detail", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: { status: "COMPLETED", result: "agree" } }), { status: 200 });
    });
    const res = await getApprovalInstance("proc-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.status).toBe("approved");
    expect(calls.some((url) => url.includes("/v1.0/workflow/processInstances?processInstanceId=proc-1"))).toBe(true);
  });

  it("falls back to the old approval detail API when the workflow API is unavailable", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      if (u.includes("/v1.0/workflow/processInstances")) {
        return new Response(JSON.stringify({ code: "needAuth", message: "no permission" }), { status: 400 });
      }
      return new Response(JSON.stringify({ errcode: 0, process_instance: { status: "COMPLETED", result: "refuse" } }), { status: 200 });
    });
    const res = await getApprovalInstance("proc-2");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.status).toBe("rejected");
    expect(calls.some((url) => url.includes("/topapi/processinstance/get"))).toBe(true);
  });
});

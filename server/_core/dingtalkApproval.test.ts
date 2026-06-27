import { beforeEach, describe, expect, it, vi } from "vitest";
import { __setDingtalkConfigForTest, _resetTokenCacheForTest } from "./dingtalk";
import { buildApprovalForm, createApprovalInstance, getApprovalInstance, normalizeApprovalStatus } from "./dingtalkApproval";

beforeEach(() => {
  _resetTokenCacheForTest();
  vi.restoreAllMocks();
  __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
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
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
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
  });
});

describe("getApprovalInstance", () => {
  it("fetches and normalizes dingtalk approval detail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ errcode: 0, process_instance: { status: "COMPLETED", result: "agree" } }), { status: 200 });
    });
    const res = await getApprovalInstance("proc-1");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.status).toBe("approved");
  });
});

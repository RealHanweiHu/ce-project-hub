import { describe, it, expect, vi } from "vitest";

/**
 * 钉钉降级：发起 MP Release 审批时钉钉不可用，不应让 mutation 直接失败——
 * 审批实例落库为 sync_failed 并返回给前端（同一按钮可重发；
 * getPendingExternalApproval 只匹配 pending，不会被失败实例卡住）。
 */

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getApprovalConfig: vi.fn(async () => ({ enabled: true, processCode: "PROC-1", defaultDeptId: null })),
    getPendingExternalApproval: vi.fn(async () => undefined),
    getUserById: vi.fn(async () => ({ id: 1, role: "admin", name: "u", mobile: "13800000000", dingtalkCorpUserId: "corp-1" })),
    getProjectById: vi.fn(async () => ({
      id: "p1", name: "P1", projectNumber: "P1-001", productId: "prod1",
      category: "npd", currentPhase: "pvt", createdBy: 1,
    })),
    isReleaseOverrideAuthorized: vi.fn(async () => true),
    getProductById: vi.fn(async () => ({ id: "prod1", name: "Prod", productNumber: "PN-1" })),
    getOpenP0P1Count: vi.fn(async () => 0),
    getReleaseGateStatus: vi.fn(async () => ({
      phaseId: "pvt", gateName: "MP Gate", decision: "approved", conditions: null,
      roundNumber: 1, ready: true, dimensions: [], deliverables: { done: 1, total: 1, missing: [] },
    })),
    createExternalApprovalInstance: vi.fn(async (v: Record<string, unknown>) => ({ id: 42, status: "pending", lastError: null, ...v })),
    updateExternalApprovalInstance: vi.fn(async (_id: number, patch: Record<string, unknown>) => ({
      id: 42, status: (patch.status as string) ?? "pending", lastError: (patch.lastError as string) ?? null,
      processInstanceId: (patch.processInstanceId as string) ?? null,
    })),
    createActivityLog: vi.fn(async () => {}),
    setUserDingtalkCorpId: vi.fn(async () => {}),
  };
});
vi.mock("./_core/dingtalk", () => ({ resolveDingtalkCorpUserId: vi.fn(async () => "corp-1") }));
vi.mock("./_core/dingtalkApproval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/dingtalkApproval")>();
  return { ...actual, createApprovalInstance: vi.fn(async () => ({ ok: false as const, error: "钉钉不可用" })) };
});

import { submitReleaseApproval } from "./services/external-approval-service";
import { createApprovalInstance } from "./_core/dingtalkApproval";

describe("submitReleaseApproval dingtalk degradation", () => {
  it("钉钉发起失败 → 不抛错，返回 sync_failed 实例供前端提示重试", async () => {
    const res = await submitReleaseApproval({ projectId: "p1", actor: { id: 1, role: "admin" } });
    expect(res.instance.status).toBe("sync_failed");
    expect(res.instance.lastError).toBe("钉钉不可用");
    expect(res.alreadyPending).toBe(false);
  });

  it("钉钉正常 → 行为不变：实例带 processInstanceId 返回", async () => {
    vi.mocked(createApprovalInstance).mockResolvedValueOnce({
      ok: true, data: { processInstanceId: "pi-9" }, raw: {},
    } as Awaited<ReturnType<typeof createApprovalInstance>>);
    const res = await submitReleaseApproval({ projectId: "p1", actor: { id: 1, role: "admin" } });
    expect(res.instance.processInstanceId).toBe("pi-9");
    expect(res.alreadyPending).toBe(false);
  });
});

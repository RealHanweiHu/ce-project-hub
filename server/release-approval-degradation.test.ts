import { beforeEach, describe, it, expect, vi } from "vitest";

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
    getProjectReleaseStateFingerprint: vi.fn(async () => "stable-release-fingerprint"),
    getExternalApprovalById: vi.fn(async () => ({
      id: 42,
      businessType: "mp_release",
      entityType: "project",
      entityId: "p1",
      projectId: "p1",
      processCode: "PROC-1",
      processInstanceId: "pi-9",
      status: "approved",
      title: "MP Release审批：P1",
      submittedBy: 1,
      originatorUserId: 1,
      dingtalkOriginatorUserId: "corp-1",
      formSnapshot: {},
      requestSnapshot: {
        productId: "prod1",
        releaseStateFingerprint: "stable-release-fingerprint",
        product: null,
        override: null,
      },
      responseSnapshot: {},
      lastError: null,
      submittedAt: new Date(),
      approvedAt: new Date(),
      rejectedAt: null,
      terminatedAt: null,
      syncedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
    releaseProject: vi.fn(async () => ({
      productId: "prod1",
      productName: "Prod",
      createdProduct: false,
      technicalBaselineId: "tb-1",
      technicalBaselineLabel: "TB-001",
      revisionId: null,
      revisionLabel: null,
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

import { confirmApprovedRelease, submitReleaseApproval } from "./services/external-approval-service";
import { createApprovalInstance } from "./_core/dingtalkApproval";
import {
  createExternalApprovalInstance,
  getExternalApprovalById,
  getProjectById,
  getProjectReleaseStateFingerprint,
  releaseProject,
} from "./db";

const projectAtApproval = {
  id: "p1",
  name: "P1",
  projectNumber: "P1-001",
  productId: "prod1",
  category: "npd",
  currentPhase: "pvt",
  createdBy: 1,
};

const approvedInstance = {
  id: 42,
  businessType: "mp_release",
  entityType: "project",
  entityId: "p1",
  projectId: "p1",
  processCode: "PROC-1",
  processInstanceId: "pi-9",
  status: "approved",
  title: "MP Release审批：P1",
  submittedBy: 1,
  originatorUserId: 1,
  dingtalkOriginatorUserId: "corp-1",
  formSnapshot: {},
  requestSnapshot: {
    productId: "prod1",
    releaseStateFingerprint: "stable-release-fingerprint",
    product: null,
    override: null,
  },
  responseSnapshot: {},
  lastError: null,
  submittedAt: new Date(),
  approvedAt: new Date(),
  rejectedAt: null,
  terminatedAt: null,
  syncedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getProjectById).mockResolvedValue(projectAtApproval as Awaited<ReturnType<typeof getProjectById>>);
  vi.mocked(getProjectReleaseStateFingerprint).mockResolvedValue("stable-release-fingerprint");
  vi.mocked(getExternalApprovalById).mockResolvedValue(approvedInstance as Awaited<ReturnType<typeof getExternalApprovalById>>);
});

describe("submitReleaseApproval dingtalk degradation", () => {
  it("钉钉发起失败 → 不抛错，返回 sync_failed 实例供前端提示重试", async () => {
    const res = await submitReleaseApproval({ projectId: "p1", actor: { id: 1, role: "admin" } });
    expect(res.instance.status).toBe("sync_failed");
    expect(res.instance.lastError).toBe("钉钉不可用");
    expect(res.alreadyPending).toBe(false);
    expect(createExternalApprovalInstance).toHaveBeenCalledWith(expect.objectContaining({
      entityId: "p1",
      requestSnapshot: expect.objectContaining({
        productId: "prod1",
        releaseStateFingerprint: "stable-release-fingerprint",
      }),
    }));
  });

  it("钉钉正常 → 行为不变：实例带 processInstanceId 返回", async () => {
    vi.mocked(createApprovalInstance).mockResolvedValueOnce({
      ok: true, data: { processInstanceId: "pi-9" }, raw: {},
    } as Awaited<ReturnType<typeof createApprovalInstance>>);
    const res = await submitReleaseApproval({ projectId: "p1", actor: { id: 1, role: "admin" } });
    expect(res.instance.processInstanceId).toBe("pi-9");
    expect(res.alreadyPending).toBe(false);
  });

  it("审批通过后关联产品发生变化 → 原审批失效且不会调用发布", async () => {
    vi.mocked(getProjectById).mockResolvedValueOnce({
      ...projectAtApproval,
      productId: "prod2",
    } as Awaited<ReturnType<typeof getProjectById>>);

    await expect(confirmApprovedRelease({ approvalInstanceId: 42, actorId: 1 }))
      .rejects.toThrow(/关联产品已变化/);
    expect(releaseProject).not.toHaveBeenCalled();
  });

  it("审批通过后发布状态指纹发生变化 → 原审批失效且不会调用发布", async () => {
    vi.mocked(getProjectReleaseStateFingerprint).mockResolvedValueOnce("changed-after-approval");

    await expect(confirmApprovedRelease({ approvalInstanceId: 42, actorId: 1 }))
      .rejects.toThrow(/BOM、关键模块、规格或 Gate 状态已变化/);
    expect(releaseProject).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApprovalConfig: vi.fn(),
  getPendingExternalApproval: vi.fn(),
  getUserById: vi.fn(),
  setUserDingtalkCorpId: vi.fn(),
  createExternalApprovalInstance: vi.fn(),
  updateExternalApprovalInstance: vi.fn(),
  createActivityLog: vi.fn(),
  resolveDingtalkCorpUserId: vi.fn(),
  createApprovalInstance: vi.fn(),
}));

vi.mock("./db", () => ({
  getApprovalConfig: mocks.getApprovalConfig,
  getPendingExternalApproval: mocks.getPendingExternalApproval,
  getUserById: mocks.getUserById,
  setUserDingtalkCorpId: mocks.setUserDingtalkCorpId,
  createExternalApprovalInstance: mocks.createExternalApprovalInstance,
  updateExternalApprovalInstance: mocks.updateExternalApprovalInstance,
  createActivityLog: mocks.createActivityLog,
}));

vi.mock("./_core/dingtalk", () => ({
  resolveDingtalkCorpUserId: mocks.resolveDingtalkCorpUserId,
}));

vi.mock("./_core/dingtalkApproval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/dingtalkApproval")>();
  return {
    ...actual,
    createApprovalInstance: mocks.createApprovalInstance,
  };
});

import { maybeSubmitActionExternalApproval } from "./services/action-approval-submit";

describe("maybeSubmitActionExternalApproval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApprovalConfig.mockResolvedValue({ enabled: true, processCode: "PROC-ACTION", defaultDeptId: 12 });
    mocks.getPendingExternalApproval.mockResolvedValue(undefined);
    mocks.getUserById.mockImplementation(async (id: number) => ({
      id,
      role: "pm",
      mobile: id === 11 ? "13800000011" : "13800000022",
      dingtalkCorpUserId: id === 11 ? "corp-originator" : "corp-approver",
    }));
    mocks.resolveDingtalkCorpUserId.mockImplementation(async (user: { dingtalkCorpUserId?: string | null }) => user.dingtalkCorpUserId ?? null);
    mocks.createExternalApprovalInstance.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 42,
      status: "pending",
      ...input,
    }));
    mocks.updateExternalApprovalInstance.mockImplementation(async (_id: number, patch: Record<string, unknown>) => ({
      id: 42,
      status: "pending",
      ...patch,
    }));
    mocks.createApprovalInstance.mockResolvedValue({ ok: true, data: { processInstanceId: "pi-1" }, raw: { instanceId: "pi-1" } });
  });

  it("passes the action recipient as the DingTalk OA approver", async () => {
    const result = await maybeSubmitActionExternalApproval({
      kind: "task_approval",
      projectId: "p1",
      entityType: "task",
      entityId: "p1:evt:t1",
      recipientUserId: 22,
      title: "任务待审批",
      body: "请审批",
      actionUrl: "https://hub.example/actions/1",
      metadata: { requestedBy: 11, phaseId: "evt", taskId: "t1" },
      actionItemId: 7,
    });

    expect(result.submitted).toBe(true);
    expect(mocks.createApprovalInstance).toHaveBeenCalledWith(expect.objectContaining({
      processCode: "PROC-ACTION",
      originatorUserId: "corp-originator",
      deptId: 12,
      approverUserIds: ["corp-approver"],
    }));
    expect(mocks.createExternalApprovalInstance).toHaveBeenCalledWith(expect.objectContaining({
      requestSnapshot: expect.objectContaining({
        dingtalkApproverUserIds: ["corp-approver"],
      }),
    }));
  });

  it("falls back to CE Hub action items when the approver cannot be mapped to DingTalk", async () => {
    mocks.resolveDingtalkCorpUserId.mockImplementation(async (user: { id: number; dingtalkCorpUserId?: string | null }) => (
      user.id === 22 ? null : user.dingtalkCorpUserId ?? null
    ));

    const result = await maybeSubmitActionExternalApproval({
      kind: "task_approval",
      projectId: "p1",
      entityType: "task",
      entityId: "p1:evt:t1",
      recipientUserId: 22,
      title: "任务待审批",
      metadata: { requestedBy: 11, phaseId: "evt", taskId: "t1" },
    });

    expect(result).toMatchObject({ submitted: false, error: "外部审批处理人未匹配钉钉 userid" });
    expect(mocks.createExternalApprovalInstance).not.toHaveBeenCalled();
    expect(mocks.createApprovalInstance).not.toHaveBeenCalled();
  });
});

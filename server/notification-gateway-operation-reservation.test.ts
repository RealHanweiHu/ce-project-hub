import { describe, expect, it, vi } from "vitest";
import {
  notifyPersonal,
  type NotifyPersonalDeps,
} from "./notification-gateway";
import { ProjectExternalOperationBlockedError } from "./project-external-operation";

describe("notification gateway external-operation reservation", () => {
  it("does not call DingTalk when project deletion already owns the lease", async () => {
    const notifyDingtalk = vi.fn(async () => {});
    const releaseProjectOperation = vi.fn(async () => {});
    const result = await notifyPersonal(
      {
        eventKey: "critical_issue",
        projectId: "deleting-project",
        userIds: [7],
        title: "删除后不得发送",
        priority: "critical",
      },
      {
        isProjectActive: async () => true,
        createNotification: async () => undefined,
        getDeliveryProfiles: async () => new Map(),
        notifyDingtalk,
        reserveProjectOperation: async () => {
          throw new ProjectExternalOperationBlockedError();
        },
        releaseProjectOperation,
      } as NotifyPersonalDeps
    );

    expect(result.dingtalk).toBe(0);
    expect(result.skipped).toBe(1);
    expect(notifyDingtalk).not.toHaveBeenCalled();
    expect(releaseProjectOperation).not.toHaveBeenCalled();
  });

  it("keeps the site notification but skips DingTalk when delivery is disabled", async () => {
    const createNotification = vi.fn(async () => undefined);
    const notifyDingtalk = vi.fn(async () => {});
    const reserveProjectOperation = vi.fn(async () => ({
      token: "must-not-reserve",
      projectIds: ["test-project"],
    }));

    const result = await notifyPersonal(
      {
        eventKey: "critical_issue",
        projectId: "test-project",
        userIds: [7],
        title: "仅保留站内通知",
        priority: "critical",
      },
      {
        isProjectActive: async () => true,
        createNotification,
        getDeliveryProfiles: async () => new Map(),
        notifyDingtalk,
        reserveProjectOperation,
        isDingtalkDeliveryEnabled: () => false,
      } as NotifyPersonalDeps
    );

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      site: 1,
      dingtalk: 0,
      failed: 0,
      skipped: 1,
      errors: [],
    });
    expect(reserveProjectOperation).not.toHaveBeenCalled();
    expect(notifyDingtalk).not.toHaveBeenCalled();
  });

  it("holds the reservation until the remote DingTalk call settles", async () => {
    let resolveRemote!: () => void;
    const remote = new Promise<void>(resolve => {
      resolveRemote = resolve;
    });
    const notifyDingtalk = vi.fn(async () => remote);
    const releaseProjectOperation = vi.fn(async () => {});
    const dispatch = notifyPersonal(
      {
        eventKey: "critical_issue",
        projectIds: ["p1", "p2"],
        userIds: [7],
        title: "受保护发送",
        priority: "critical",
      },
      {
        isProjectActive: async () => true,
        createNotification: async () => undefined,
        getDeliveryProfiles: async () => new Map(),
        notifyDingtalk,
        reserveProjectOperation: async projectIds => ({
          token: "held-token",
          projectIds: [...projectIds],
        }),
        releaseProjectOperation,
      } as NotifyPersonalDeps
    );

    await vi.waitFor(() => expect(notifyDingtalk).toHaveBeenCalledTimes(1));
    expect(releaseProjectOperation).not.toHaveBeenCalled();
    resolveRemote();
    await expect(dispatch).resolves.toMatchObject({ dingtalk: 1 });
    expect(releaseProjectOperation).toHaveBeenCalledWith("held-token");
  });

  it("does not fallback-send when an interactive card outcome is uncertain", async () => {
    const notifyDingtalk = vi.fn(async () => {});
    const releaseProjectOperation = vi.fn(async () => {});
    const deliverInteractiveCard = vi.fn(async () => "uncertain" as const);

    const result = await notifyPersonal(
      {
        eventKey: "task_ready",
        projectId: "project-card-uncertain",
        userIds: [7],
        title: "待处理",
        priority: "critical",
        interactiveActionItem: {
          actionItemId: 42,
          recipientUserId: 7,
          projectId: "project-card-uncertain",
          entityType: "task",
          entityId: "task-42",
        },
      },
      {
        isProjectActive: async () => true,
        createNotification: async () => undefined,
        getDeliveryProfiles: async () => new Map(),
        notifyDingtalk,
        deliverInteractiveCard,
        reserveProjectOperation: async projectIds => ({
          token: "uncertain-card-token",
          projectIds: [...projectIds],
        }),
        releaseProjectOperation,
      } as NotifyPersonalDeps
    );

    expect(deliverInteractiveCard).toHaveBeenCalledTimes(1);
    expect(notifyDingtalk).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dingtalk: 0, failed: 1 });
    expect(result.errors[0]).toContain("不会自动补发");
    expect(releaseProjectOperation).toHaveBeenCalledWith(
      "uncertain-card-token"
    );
  });
});

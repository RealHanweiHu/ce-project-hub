import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  listForActionItem: vi.fn(),
  listDeleted: vi.fn(),
  markStatus: vi.fn(),
  setUserDingtalkCorpId: vi.fn(),
  upsertCard: vi.fn(),
  resolveCorpUserId: vi.fn(),
  createAndDeliver: vi.fn(),
  configured: vi.fn(),
  updateCard: vi.fn(),
  quarantineCurrentOperation: vi.fn(),
}));

vi.mock("./db", () => ({
  getUserById: mocks.getUserById,
  listDingtalkInteractiveCardsForActionItem: mocks.listForActionItem,
  listDeletedProjectDingtalkInteractiveCards: mocks.listDeleted,
  markDingtalkInteractiveCardStatus: mocks.markStatus,
  setUserDingtalkCorpId: mocks.setUserDingtalkCorpId,
  upsertDingtalkInteractiveCard: mocks.upsertCard,
}));

vi.mock("./_core/dingtalk", () => ({
  resolveDingtalkCorpUserId: mocks.resolveCorpUserId,
}));

vi.mock("./_core/dingtalkInteractiveCard", () => ({
  buildHandledActionCardParams: vi.fn(() => ({ status: "handled" })),
  buildPendingActionCardParams: vi.fn(() => ({ status: "pending" })),
  createAndDeliverInteractiveCard: mocks.createAndDeliver,
  isDingtalkInteractiveCardConfigured: mocks.configured,
  updateInteractiveCard: mocks.updateCard,
}));

vi.mock("./project-external-operation", () => ({
  quarantineCurrentProjectExternalOperation:
    mocks.quarantineCurrentOperation,
}));

import {
  markActionItemInteractiveCardsHandled,
  retryDeletedProjectInteractiveCards,
  tryDeliverActionItemInteractiveCard,
} from "./dingtalk-interactive-card-service";

const DELIVERY_INPUT = {
  actionItemId: 42,
  recipientUserId: 7,
  eventKey: "task_ready" as const,
  projectId: "project-card-reliability",
  entityType: "task",
  entityId: "task-42",
  title: "待处理",
};

describe("DingTalk interactive-card durable state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserById.mockResolvedValue({ id: 7, name: "测试用户" });
    mocks.resolveCorpUserId.mockResolvedValue("corp-user-7");
    mocks.configured.mockReturnValue(true);
    mocks.upsertCard.mockImplementation(async input => ({ id: 1, ...input }));
    mocks.markStatus.mockResolvedValue(true);
    mocks.listForActionItem.mockResolvedValue([]);
    mocks.listDeleted.mockResolvedValue([]);
  });

  it("persists a creating intent before remotely delivering the card", async () => {
    mocks.createAndDeliver.mockResolvedValue({ ok: true, raw: {} });

    await expect(
      tryDeliverActionItemInteractiveCard(DELIVERY_INPUT)
    ).resolves.toBe("delivered");

    expect(mocks.upsertCard).toHaveBeenCalledWith(
      expect.objectContaining({ status: "creating" })
    );
    expect(mocks.upsertCard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createAndDeliver.mock.invocationCallOrder[0]
    );
    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        expectedStatuses: ["creating"],
      })
    );
  });

  it("records a definite delivery failure separately from an update failure", async () => {
    mocks.createAndDeliver.mockResolvedValue({
      ok: false,
      error: "delivery rejected",
    });

    await expect(
      tryDeliverActionItemInteractiveCard(DELIVERY_INPUT)
    ).resolves.toBe("fallback");

    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "delivery_failed",
        lastError: "delivery rejected",
        expectedStatuses: ["creating"],
      })
    );
  });

  it("keeps an ambiguous delivery in creating so project deletion still invalidates the known outTrackId", async () => {
    mocks.createAndDeliver.mockResolvedValue({
      ok: false,
      error: "request timed out after DingTalk may have accepted it",
      uncertain: true,
    });

    await expect(
      tryDeliverActionItemInteractiveCard(DELIVERY_INPUT)
    ).resolves.toBe("uncertain");

    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "creating",
        lastError: expect.stringContaining("timed out"),
        expectedStatuses: ["creating"],
      })
    );
    expect(mocks.quarantineCurrentOperation).toHaveBeenCalledWith(
      expect.stringContaining("timed out")
    );
  });

  it("records remote invalidation failures as update_failed with a stale-state guard", async () => {
    mocks.listForActionItem.mockResolvedValue([
      { outTrackId: "card-42", status: "sent" },
    ]);
    mocks.updateCard.mockResolvedValue({ ok: false, error: "update rejected" });

    await expect(
      markActionItemInteractiveCardsHandled(42, {
        title: "项目已删除",
        message: "项目已删除",
      })
    ).resolves.toBe(false);

    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        outTrackId: "card-42",
        status: "update_failed",
        expectedStatuses: ["sent"],
      })
    );
  });

  it("rotates a failed deleted-project retry to update_failed using its loaded state as CAS", async () => {
    mocks.listDeleted.mockResolvedValue([
      { outTrackId: "deleted-card", status: "creating" },
    ]);
    mocks.updateCard.mockResolvedValue({ ok: false, error: "card not found" });

    await expect(retryDeletedProjectInteractiveCards(100)).resolves.toBe(0);

    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        outTrackId: "deleted-card",
        status: "update_failed",
        expectedStatuses: ["creating"],
      })
    );
  });

  it("locally handles delivery_failed rows without issuing a remote update", async () => {
    mocks.listForActionItem.mockResolvedValue([
      { outTrackId: "never-delivered", status: "delivery_failed" },
    ]);

    await expect(
      markActionItemInteractiveCardsHandled(42, {
        title: "已关闭",
        message: "无需处理",
      })
    ).resolves.toBe(true);

    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        outTrackId: "never-delivered",
        status: "handled",
        expectedStatuses: ["delivery_failed"],
      })
    );
  });

  it("settles known-undelivered rows even when DingTalk card updates are not configured", async () => {
    mocks.configured.mockReturnValue(false);
    mocks.listForActionItem.mockResolvedValue([
      { outTrackId: "never-created", status: "delivery_failed" },
    ]);

    await expect(
      markActionItemInteractiveCardsHandled(42, {
        title: "已关闭",
        message: "无需处理",
      })
    ).resolves.toBe(true);

    expect(mocks.updateCard).not.toHaveBeenCalled();
    expect(mocks.markStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        outTrackId: "never-created",
        status: "handled",
      })
    );
  });
});

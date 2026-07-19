import { describe, expect, it, vi } from "vitest";
import type { ProjectRow } from "../drizzle/schema";
import type { updateProject } from "./db";
import {
  beginProjectDingtalkGroupCreation,
  disbandAndCheckpointProjectDingtalkGroup,
  hasUnresolvedProjectDingtalkGroupCreation,
  recordProjectDingtalkGroupCreateFailure,
} from "./project-dingtalk-group-lifecycle";

function fakeUpdate(state: Record<string, unknown>): typeof updateProject {
  return vi.fn(async (_projectId, patch) => {
    Object.assign(state, patch);
  }) as unknown as typeof updateProject;
}

describe("project DingTalk group lifecycle", () => {
  it("persists a create intent and keeps an unknown POST outcome as a hard-delete blocker", async () => {
    const state: Record<string, unknown> = {
      dingtalkChatId: null,
      dingtalkGroupOperationStatus: "idle",
    };
    const update = fakeUpdate(state);
    const intent = await beginProjectDingtalkGroupCreation(
      {
        projectId: "project-1",
        name: "project group",
        ownerUserId: "owner",
        memberUserIds: ["member"],
      },
      { update }
    );

    expect(state).toMatchObject({
      dingtalkGroupOperationStatus: "creating",
      dingtalkGroupIntent: intent,
    });

    await recordProjectDingtalkGroupCreateFailure(
      {
        projectId: "project-1",
        intent,
        result: {
          ok: false,
          outcome: "unknown",
          error: "response lost",
        },
      },
      { update }
    );

    expect(state).toMatchObject({
      dingtalkChatId: null,
      dingtalkGroupOperationStatus: "create_unknown",
      dingtalkGroupIntent: intent,
      dingtalkGroupLastError: "response lost",
    });
    expect(
      hasUnresolvedProjectDingtalkGroupCreation(state as unknown as ProjectRow)
    ).toBe(true);
  });

  it("checkpoints a successful disband by clearing the known chatId", async () => {
    const state: Record<string, unknown> = {
      id: "project-2",
      dingtalkChatId: "chat-2",
      dingtalkGroupOperationStatus: "bound",
    };
    const update = fakeUpdate(state);
    const disbandRemote = vi.fn(async () => {
      expect(state).toMatchObject({
        dingtalkChatId: "chat-2",
        dingtalkGroupOperationStatus: "disbanding",
      });
      return { ok: true as const };
    });

    await expect(
      disbandAndCheckpointProjectDingtalkGroup(
        state as unknown as ProjectRow,
        { update, disbandRemote }
      )
    ).resolves.toBe(true);

    expect(state).toMatchObject({
      dingtalkChatId: null,
      dingtalkGroupOperationStatus: "disbanded",
      dingtalkGroupLastError: null,
    });
  });
});

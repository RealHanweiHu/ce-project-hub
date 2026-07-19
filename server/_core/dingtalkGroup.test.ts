import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./dingtalk", () => ({
  getAccessToken: vi.fn(async () => "token"),
  isDingtalkConfigured: vi.fn(() => true),
}));

import {
  createGroupChat,
  disbandGroupChat,
  sendToGroupChat,
} from "./dingtalkGroup";
import { ProjectRemoteOutcomeUncertainError } from "../project-external-operation";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv(
    "DATABASE_URL",
    "postgres://app:secret@db.example.com:5432/cehub"
  );
  vi.stubEnv("DINGTALK_DELIVERY_MODE", "live");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createGroupChat outcome classification", () => {
  it("suppresses test-database group creation as a definite rejection", async () => {
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    await expect(
      createGroupChat("project group", "owner", ["member"])
    ).resolves.toMatchObject({
      ok: false,
      outcome: "rejected",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("classifies a transport failure after POST starts as an unknown remote outcome", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("socket reset after request write")
    );

    await expect(
      createGroupChat("project group", "owner", ["member"])
    ).resolves.toMatchObject({
      ok: false,
      outcome: "unknown",
    });
  });
});

describe("disbandGroupChat idempotency", () => {
  it("defers cleanup instead of discarding a production handle during an explicit delivery pause", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    await expect(disbandGroupChat("live-production-chat")).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("远端清理已延后"),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("settles test-database cleanup locally without touching DingTalk", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub_test_cleanup"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call DingTalk"));

    await expect(disbandGroupChat("copied-production-chat")).resolves.toEqual({
      ok: true,
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("treats an already-gone group during chat-id conversion as successfully disbanded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "chat_not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(disbandGroupChat("gone-chat")).resolves.toEqual({ ok: true });
  });
});

describe("sendToGroupChat outcome classification", () => {
  it("suppresses test-database group messages before any DingTalk request", async () => {
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(
      sendToGroupChat("chat-1", "测试通知", "不应出站")
    ).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws an uncertain outcome instead of allowing a fallback double-send", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("socket reset after request write")
    );

    await expect(
      sendToGroupChat("chat-1", "title", "markdown")
    ).rejects.toBeInstanceOf(ProjectRemoteOutcomeUncertainError);
  });

  it("returns false for an explicit API rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ errcode: 40035, errmsg: "invalid chat" }), {
        status: 200,
      })
    );

    await expect(
      sendToGroupChat("chat-1", "title", "markdown")
    ).resolves.toBe(false);
  });
});

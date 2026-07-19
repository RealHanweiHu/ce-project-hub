import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDingtalkCleanupMode } from "./dingtalk-cleanup-policy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DingTalk cleanup policy", () => {
  it("defers real remote cleanup when production delivery is explicitly paused", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");

    expect(resolveDingtalkCleanupMode()).toBe("deferred");
  });

  it("settles copied handles locally in a test database", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub_test_cleanup"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");

    expect(resolveDingtalkCleanupMode()).toBe("local_only");
  });

  it("settles local handles without remote calls in non-production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://app:secret@db.example.com:5432/cehub"
    );
    vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");

    expect(resolveDingtalkCleanupMode()).toBe("local_only");
  });
});

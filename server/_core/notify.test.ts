import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV } from "./env";
import { pushWebhook } from "./notify";

const originalWebhookType = ENV.notifyWebhookType;
const originalWebhookUrl = ENV.notifyWebhookUrl;
const originalWebhookSecret = ENV.notifyWebhookSecret;

beforeEach(() => {
  vi.stubEnv("DINGTALK_DELIVERY_MODE", "disabled");
  ENV.notifyWebhookType = "dingtalk";
  ENV.notifyWebhookUrl = "https://notification-proxy.example.test/hook";
  ENV.notifyWebhookSecret = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  ENV.notifyWebhookType = originalWebhookType;
  ENV.notifyWebhookUrl = originalWebhookUrl;
  ENV.notifyWebhookSecret = originalWebhookSecret;
});

describe("notification webhook delivery policy", () => {
  it("blocks a DingTalk webhook even when it uses a custom proxy host", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("must not call remote webhook"));

    await expect(pushWebhook("测试通知")).resolves.toBe(false);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not apply the DingTalk-only switch to a Feishu webhook", async () => {
    ENV.notifyWebhookType = "feishu";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: 0 }), { status: 200 })
    );

    await expect(pushWebhook("飞书通知")).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

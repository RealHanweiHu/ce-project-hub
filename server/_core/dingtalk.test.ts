import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  __setDingtalkConfigForTest, getAccessToken, _resetTokenCacheForTest, resolveDingtalkUserId,
} from "./dingtalk";

beforeEach(() => { _resetTokenCacheForTest(); vi.restoreAllMocks(); });

describe("dingtalk token", () => {
  it("returns null when not configured", async () => {
    __setDingtalkConfigForTest({ appKey: "", appSecret: "" });
    expect(await getAccessToken()).toBeNull();
  });

  it("fetches and caches the token", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accessToken: "tok-1", expireIn: 7200 }), { status: 200 })
    );
    expect(await getAccessToken()).toBe("tok-1");
    expect(await getAccessToken()).toBe("tok-1"); // 命中缓存
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("resolveDingtalkUserId", () => {
  it("uses cached dingtalkUserId without calling api", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    const spy = vi.spyOn(globalThis, "fetch");
    const id = await resolveDingtalkUserId({ id: 1, dingtalkUserId: "u-cached", mobile: "138" }, async () => {});
    expect(id).toBe("u-cached");
    expect(spy).not.toHaveBeenCalled();
  });

  it("looks up by mobile then caches", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    _resetTokenCacheForTest();
    let cached = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      return new Response(JSON.stringify({ errcode: 0, result: { userid: "u-99" } }), { status: 200 });
    });
    const id = await resolveDingtalkUserId({ id: 2, dingtalkUserId: null, mobile: "13800000000" }, async (_uid, dd) => { cached = dd; });
    expect(id).toBe("u-99");
    expect(cached).toBe("u-99"); // 已回写缓存
  });

  it("returns null when no cache and no mobile", async () => {
    const id = await resolveDingtalkUserId({ id: 3, dingtalkUserId: null, mobile: null }, async () => {});
    expect(id).toBeNull();
  });
});

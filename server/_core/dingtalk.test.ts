import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  __setDingtalkConfigForTest, getAccessToken, _resetTokenCacheForTest, resolveDingtalkCorpUserId, resolveDingtalkUserId,
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

  it("returns null instead of throwing when token fetch fails", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    await expect(getAccessToken()).resolves.toBeNull();
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

  it("resolves mobile -> userid -> unionId and caches unionId", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    _resetTokenCacheForTest();
    let cached = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      if (u.includes("getbymobile")) return new Response(JSON.stringify({ errcode: 0, result: { userid: "u-99" } }), { status: 200 });
      // user/get → unionid
      return new Response(JSON.stringify({ errcode: 0, result: { unionid: "union-99" } }), { status: 200 });
    });
    const id = await resolveDingtalkUserId({ id: 2, dingtalkUserId: null, mobile: "13800000000" }, async (_uid, dd) => { cached = dd; });
    expect(id).toBe("union-99");
    expect(cached).toBe("union-99"); // 缓存的是 unionId
  });

  it("returns null when no cache and no mobile", async () => {
    const id = await resolveDingtalkUserId({ id: 3, dingtalkUserId: null, mobile: null }, async () => {});
    expect(id).toBeNull();
  });

  it("returns null instead of throwing when mobile lookup fails", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    _resetTokenCacheForTest();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      throw new Error("lookup failed");
    });
    await expect(resolveDingtalkUserId({ id: 4, dingtalkUserId: null, mobile: "13800000000" }, async () => {})).resolves.toBeNull();
  });
});

describe("resolveDingtalkCorpUserId", () => {
  it("returns null instead of throwing when corp userid lookup fails", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    _resetTokenCacheForTest();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) return new Response(JSON.stringify({ accessToken: "tok", expireIn: 7200 }), { status: 200 });
      throw new Error("lookup failed");
    });
    await expect(resolveDingtalkCorpUserId({ id: 5, dingtalkCorpUserId: null, mobile: "13800000000" }, async () => {})).resolves.toBeNull();
  });
});

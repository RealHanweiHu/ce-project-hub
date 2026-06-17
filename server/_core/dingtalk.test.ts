import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  __setDingtalkConfigForTest, fetchDingtalkApi, getAccessToken, _resetTokenCacheForTest, resolveDingtalkUserId,
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

  it("clears cached token and retries once on 401", async () => {
    __setDingtalkConfigForTest({ appKey: "k", appSecret: "s" });
    let tokenFetches = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("oauth2/accessToken")) {
        tokenFetches += 1;
        return new Response(JSON.stringify({ accessToken: `tok-${tokenFetches}`, expireIn: 7200 }), { status: 200 });
      }
      if (u.includes("tok-1")) return new Response("expired", { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const resp = await fetchDingtalkApi((token) => ({
      url: `https://oapi.dingtalk.com/example?access_token=${encodeURIComponent(token)}`,
    }));

    expect(resp?.status).toBe(200);
    expect(tokenFetches).toBe(2);
    expect(spy).toHaveBeenCalledTimes(4);
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
});

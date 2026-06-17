import { ENV } from "./env";

let cfg = { appKey: ENV.dingtalkAppKey, appSecret: ENV.dingtalkAppSecret };
let tokenCache: { token: string; expiresAt: number } | null = null;
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_FETCH_RETRIES = 1;

/** 测试用：覆盖配置 */
export function __setDingtalkConfigForTest(c: { appKey: string; appSecret: string }) { cfg = c; }
export function _resetTokenCacheForTest() { tokenCache = null; }

export function isDingtalkConfigured(): boolean {
  return !!(cfg.appKey && cfg.appSecret);
}

function clearTokenCache() {
  tokenCache = null;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** 钉钉请求统一入口：10s 超时 + 一次重试，避免网络抖动或慢响应把任务挂死。 */
export async function fetchDingtalkWithRetry(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_FETCH_RETRIES;
  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout(url, init, timeoutMs);
      if (attempt < retries && isRetryableStatus(resp.status)) {
        lastResponse = resp;
        continue;
      }
      return resp;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}

/**
 * 带 access_token 的钉钉 API 请求。HTTP 401 会清掉 token 缓存并重取一次，
 * 避免过期 token 被一直复用。
 */
export async function fetchDingtalkApi(
  buildRequest: (token: string) => { url: string; init?: RequestInit },
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response | null> {
  try {
    for (let tokenAttempt = 0; tokenAttempt < 2; tokenAttempt++) {
      const token = await getAccessToken();
      if (!token) return null;
      const { url, init } = buildRequest(token);
      const resp = await fetchDingtalkWithRetry(url, init, options);
      if (resp.status === 401 && tokenAttempt === 0) {
        clearTokenCache();
        continue;
      }
      return resp;
    }
    return null;
  } catch (error) {
    console.warn("[dingtalk] api request failed:", error);
    return null;
  }
}

/** 取 access token；未配置返回 null；带过期缓存（提前 5 分钟刷新） */
export async function getAccessToken(now = Date.now()): Promise<string | null> {
  if (!isDingtalkConfigured()) return null;
  if (tokenCache && tokenCache.expiresAt - 5 * 60_000 > now) return tokenCache.token;
  try {
    const resp = await fetchDingtalkWithRetry(
      "https://api.dingtalk.com/v1.0/oauth2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appKey: cfg.appKey, appSecret: cfg.appSecret }),
      }
    );
    if (!resp.ok) { console.warn("[dingtalk] token http", resp.status); return null; }
    const j = (await resp.json()) as { accessToken?: string; expireIn?: number };
    if (!j.accessToken) return null;
    tokenCache = { token: j.accessToken, expiresAt: now + (j.expireIn ?? 7200) * 1000 };
    return tokenCache.token;
  } catch (error) {
    console.warn("[dingtalk] token request failed:", error);
    return null;
  }
}

type MappableUser = { id: number; dingtalkUserId?: string | null; dingtalkCorpUserId?: string | null; mobile?: string | null };

/** 解析钉钉通讯录 userid（工作通知用）：缓存命中 → 否则按手机号反查并回写缓存。 */
export async function resolveDingtalkCorpUserId(
  user: MappableUser,
  cacheBack: (userId: number, corpUserId: string) => Promise<void>
): Promise<string | null> {
  if (user.dingtalkCorpUserId) return user.dingtalkCorpUserId;
  if (!user.mobile) return null;
  const resp = await fetchDingtalkApi((token) => ({
    url: `https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${encodeURIComponent(token)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: user.mobile }),
    },
  }));
  if (!resp) return null;
  if (!resp.ok) return null;
  const j = (await resp.json()) as { errcode?: number; result?: { userid?: string } };
  const userid = j.result?.userid;
  if (j.errcode !== 0 || !userid) return null;
  await cacheBack(user.id, userid);
  return userid;
}

/**
 * 解析用户的钉钉 unionId（钉钉日历 API 用的是 unionId，不是通讯录 userid）。
 * 链路：缓存命中 → 否则 手机号→userid→unionId，回写缓存（dingtalkUserId 列存 unionId）。
 * @param cacheBack 回写缓存的副作用（生产传 setUserDingtalkId）
 */
export async function resolveDingtalkUserId(
  user: MappableUser,
  cacheBack: (userId: number, dingtalkUserId: string) => Promise<void>
): Promise<string | null> {
  if (user.dingtalkUserId) return user.dingtalkUserId; // 缓存的就是 unionId
  if (!user.mobile) return null;

  // 1) 手机号 → 通讯录 userid
  const mResp = await fetchDingtalkApi((token) => ({
    url: `https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${encodeURIComponent(token)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile: user.mobile }),
    },
  }));
  if (!mResp) return null;
  if (!mResp.ok) return null;
  const mj = (await mResp.json()) as { errcode?: number; result?: { userid?: string } };
  const userid = mj.result?.userid;
  if (mj.errcode !== 0 || !userid) return null;

  // 2) userid → unionId
  const gResp = await fetchDingtalkApi((token) => ({
    url: `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(token)}`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userid }),
    },
  }));
  if (!gResp) return null;
  if (!gResp.ok) return null;
  const gj = (await gResp.json()) as { errcode?: number; result?: { unionid?: string } };
  const unionid = gj.result?.unionid;
  if (gj.errcode !== 0 || !unionid) return null;

  await cacheBack(user.id, unionid);
  return unionid;
}

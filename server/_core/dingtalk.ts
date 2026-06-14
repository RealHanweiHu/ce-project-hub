import { ENV } from "./env";

let cfg = { appKey: ENV.dingtalkAppKey, appSecret: ENV.dingtalkAppSecret };
let tokenCache: { token: string; expiresAt: number } | null = null;

/** 测试用：覆盖配置 */
export function __setDingtalkConfigForTest(c: { appKey: string; appSecret: string }) { cfg = c; }
export function _resetTokenCacheForTest() { tokenCache = null; }

export function isDingtalkConfigured(): boolean {
  return !!(cfg.appKey && cfg.appSecret);
}

/** 取 access token；未配置返回 null；带过期缓存（提前 5 分钟刷新） */
export async function getAccessToken(now = Date.now()): Promise<string | null> {
  if (!isDingtalkConfigured()) return null;
  if (tokenCache && tokenCache.expiresAt - 5 * 60_000 > now) return tokenCache.token;
  const resp = await fetch("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appKey: cfg.appKey, appSecret: cfg.appSecret }),
  });
  if (!resp.ok) { console.warn("[dingtalk] token http", resp.status); return null; }
  const j = (await resp.json()) as { accessToken?: string; expireIn?: number };
  if (!j.accessToken) return null;
  tokenCache = { token: j.accessToken, expiresAt: now + (j.expireIn ?? 7200) * 1000 };
  return tokenCache.token;
}

type MappableUser = { id: number; dingtalkUserId?: string | null; mobile?: string | null };

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
  const token = await getAccessToken();
  if (!token) return null;

  // 1) 手机号 → 通讯录 userid
  const mResp = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: user.mobile }),
  });
  if (!mResp.ok) return null;
  const mj = (await mResp.json()) as { errcode?: number; result?: { userid?: string } };
  const userid = mj.result?.userid;
  if (mj.errcode !== 0 || !userid) return null;

  // 2) userid → unionId
  const gResp = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/get?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userid }),
  });
  if (!gResp.ok) return null;
  const gj = (await gResp.json()) as { errcode?: number; result?: { unionid?: string } };
  const unionid = gj.result?.unionid;
  if (gj.errcode !== 0 || !unionid) return null;

  await cacheBack(user.id, unionid);
  return unionid;
}

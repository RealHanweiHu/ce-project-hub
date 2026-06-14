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
 * 解析用户的钉钉 userId：优先用缓存；否则按手机号查通讯录并回写缓存；都没有返回 null。
 * @param cacheBack 回写缓存的副作用（生产传 setUserDingtalkId）
 */
export async function resolveDingtalkUserId(
  user: MappableUser,
  cacheBack: (userId: number, dingtalkUserId: string) => Promise<void>
): Promise<string | null> {
  if (user.dingtalkUserId) return user.dingtalkUserId;
  if (!user.mobile) return null;
  const token = await getAccessToken();
  if (!token) return null;
  const resp = await fetch(`https://oapi.dingtalk.com/topapi/v2/user/getbymobile?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mobile: user.mobile }),
  });
  if (!resp.ok) return null;
  const j = (await resp.json()) as { errcode?: number; result?: { userid?: string } };
  const uid = j.result?.userid;
  if (j.errcode !== 0 || !uid) return null;
  await cacheBack(user.id, uid);
  return uid;
}

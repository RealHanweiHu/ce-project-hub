import type { Express } from "express";
import type { AppRouter } from "./routers";
import crypto from "crypto";
import { ENV } from "./_core/env";
import { syncExternalApprovalByProcessInstanceId } from "./services/external-approval-service";
import { executeActionCardToken } from "./action-card-route";

function findProcessInstanceId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of ["processInstanceId", "process_instance_id", "processInstanceID"]) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const nested of Object.values(obj)) {
    if (nested && typeof nested === "object") {
      const found = findProcessInstanceId(nested);
      if (found) return found;
    }
  }
  return null;
}

function findNestedString(value: unknown, keys: readonly string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  for (const nested of Object.values(obj)) {
    if (nested && typeof nested === "object") {
      const found = findNestedString(nested, keys);
      if (found) return found;
    }
  }
  return null;
}

function sha1Sorted(parts: string[]): string {
  return crypto.createHash("sha1").update(parts.sort().join("")).digest("hex");
}

function getString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function removePkcs7Padding(buffer: Buffer): Buffer {
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 32) return buffer;
  return buffer.subarray(0, buffer.length - pad);
}

function getCallbackAesKey(): Buffer | null {
  const key = ENV.dingtalkCallbackAesKey.trim();
  if (!key) return null;
  try {
    return Buffer.from(`${key}=`, "base64");
  } catch {
    return null;
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decryptDingtalkPayload(input: {
  encrypt: string;
  signature: string;
  timestamp: string;
  nonce: string;
}): Record<string, unknown> {
  const token = ENV.dingtalkCallbackToken;
  const aesKey = getCallbackAesKey();
  if (!token || !aesKey || aesKey.length !== 32) {
    throw new Error("钉钉回调加密参数未配置");
  }
  const expected = sha1Sorted([token, input.timestamp, input.nonce, input.encrypt]);
  if (!timingSafeEqualHex(expected, input.signature)) {
    throw new Error("钉钉回调签名校验失败");
  }
  const decipher = crypto.createDecipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  decipher.setAutoPadding(false);
  const decrypted = removePkcs7Padding(Buffer.concat([
    decipher.update(input.encrypt, "base64"),
    decipher.final(),
  ]));
  const content = decrypted.subarray(16);
  const messageLength = content.readUInt32BE(0);
  const message = content.subarray(4, 4 + messageLength).toString("utf8");
  return JSON.parse(message) as Record<string, unknown>;
}

function encryptDingtalkResponse(message: string, nonce: string): Record<string, string> {
  const token = ENV.dingtalkCallbackToken;
  const aesKey = getCallbackAesKey();
  if (!token || !aesKey || aesKey.length !== 32) return { success: "true" };
  const timestamp = String(Date.now());
  const corpOrApp = ENV.dingtalkCorpId || ENV.dingtalkAppKey;
  const msg = Buffer.from(message);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(msg.length, 0);
  const raw = Buffer.concat([crypto.randomBytes(16), len, msg, Buffer.from(corpOrApp)]);
  const remainder = raw.length % 32;
  const pad = remainder === 0 ? 32 : 32 - remainder;
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  const cipher = crypto.createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypt = Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
  return {
    msg_signature: sha1Sorted([token, timestamp, nonce, encrypt]),
    timeStamp: timestamp,
    nonce,
    encrypt,
  };
}

export type CallbackAction =
  | { kind: "verify" }
  | { kind: "card"; token: string; outTrackId: string | null }
  | { kind: "sync"; processInstanceId: string }
  | { kind: "ignore" };

/**
 * 钉钉事件回调分类:
 * - check_url 注册校验事件 → verify(回 ack,不要求 processInstanceId,否则回调 URL 注册握手失败)
 * - 含 processInstanceId 的审批变更事件 → sync
 * - 其余无关事件 → ignore(回 ack,避免钉钉重试风暴)
 */
export function classifyCallbackEvent(payload: Record<string, unknown>): CallbackAction {
  const eventType = getString(payload?.EventType) || getString(payload?.eventType);
  if (eventType === "check_url") return { kind: "verify" };
  const actionToken = findNestedString(payload, ["actionToken", "action_token", "token"]);
  const outTrackId = findNestedString(payload, ["outTrackId", "out_track_id"]);
  if (actionToken && outTrackId) return { kind: "card", token: actionToken, outTrackId };
  const processInstanceId = findProcessInstanceId(payload);
  if (processInstanceId) return { kind: "sync", processInstanceId };
  return { kind: "ignore" };
}

export function registerDingtalkCallbackRoute(app: Express, appRouter?: AppRouter) {
  app.post("/api/dingtalk/callback", async (req, res) => {
    let payload = req.body as Record<string, unknown>;
    const encrypt = getString(payload?.encrypt);
    const nonce = getString(req.query.nonce) || getString(payload?.nonce);
    if (encrypt) {
      try {
        payload = decryptDingtalkPayload({
          encrypt,
          signature: getString(req.query.signature) || getString(req.query.msg_signature) || getString(payload?.signature),
          timestamp: getString(req.query.timestamp) || getString(req.query.timeStamp) || getString(payload?.timeStamp) || getString(payload?.timestamp),
          nonce,
        });
      } catch (error) {
        res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const action = classifyCallbackEvent(payload);
    if (action.kind === "card") {
      if (!appRouter) {
        res.status(500).json({ success: false, error: "app router unavailable" });
        return;
      }
      try {
        const result = await executeActionCardToken(action.token, appRouter, req, res);
        if (encrypt) {
          res.json(encryptDingtalkResponse("success", nonce || "nonce"));
          return;
        }
        res.json({ success: true, outTrackId: action.outTrackId, result });
      } catch (error) {
        res.status(409).json({ success: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // check_url 注册握手与无关事件:回 ack(加密则回加密 success),让钉钉认为已确认
    if (action.kind !== "sync") {
      res.json(encrypt ? encryptDingtalkResponse("success", nonce || "nonce") : { success: true });
      return;
    }
    // sync 会依据 processInstanceId 拉取并落库审批状态,属于写操作。真实钉钉回调始终
    // 加密+签名(encrypt 存在时上面的 decrypt 已校验签名);未加密的 sync 请求一律拒绝,
    // 避免未签名方触发审批同步。握手/无关事件的 ack 路径不受影响。
    if (!encrypt) {
      res.status(401).json({ success: false, error: "signature required" });
      return;
    }
    try {
      const approval = await syncExternalApprovalByProcessInstanceId(action.processInstanceId);
      if (encrypt) {
        res.json(encryptDingtalkResponse("success", nonce || "nonce"));
        return;
      }
      res.json({ success: true, status: approval?.status ?? null });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}

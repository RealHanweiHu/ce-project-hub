import { resolveDingtalkDeliveryPolicy } from "./dingtalk-delivery-policy";

export type DingtalkCleanupMode = "remote" | "local_only" | "deferred";

export const DINGTALK_REMOTE_CLEANUP_DEFERRED_MESSAGE =
  "生产环境已关闭钉钉外发，远端清理已延后；请恢复外发后重试";

/**
 * Test databases and non-production processes may contain copied production
 * handles. They settle those handles locally without touching DingTalk.
 * A production operator pause is different: the real remote resource may
 * still exist, so callers must retain its handle for a later retry.
 */
export function resolveDingtalkCleanupMode(): DingtalkCleanupMode {
  const policy = resolveDingtalkDeliveryPolicy();
  if (policy.enabled) return "remote";
  if (
    policy.reason === "test_database" ||
    policy.reason === "non_production"
  ) {
    return "local_only";
  }
  return "deferred";
}

export type DingtalkDeliveryPolicyReason =
  | "explicit_disabled"
  | "explicit_live"
  | "invalid_mode"
  | "test_database"
  | "non_production"
  | "production_default";

export type DingtalkDeliveryPolicy = {
  enabled: boolean;
  reason: DingtalkDeliveryPolicyReason;
};

type DeliveryEnvironment = Readonly<Record<string, string | undefined>>;

const TEST_DATABASE_NAME = /^cehub_test(?:_|$)/i;

export const DINGTALK_DELIVERY_DISABLED_MESSAGE =
  "当前环境已关闭钉钉外发，仅保留站内通知";

function databaseName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const pathname = new URL(databaseUrl).pathname.replace(/^\/+/, "");
    if (!pathname) return null;
    return decodeURIComponent(pathname.split("/")[0] ?? "");
  } catch {
    return null;
  }
}

/**
 * Test and development processes are silent by default. A production process
 * is live unless it points at the strict `cehub_test*` database convention.
 * Test databases are always silent; even `live` cannot override that safety
 * boundary. `live` is only an escape hatch for controlled transport tests
 * using a non-test database name.
 */
export function resolveDingtalkDeliveryPolicy(
  env: DeliveryEnvironment = process.env
): DingtalkDeliveryPolicy {
  const name = databaseName(env.DATABASE_URL);
  if (name && TEST_DATABASE_NAME.test(name)) {
    return { enabled: false, reason: "test_database" };
  }

  const explicitMode = env.DINGTALK_DELIVERY_MODE?.trim().toLowerCase();
  if (explicitMode === "live") {
    return { enabled: true, reason: "explicit_live" };
  }
  if (env.NODE_ENV !== "production") {
    return { enabled: false, reason: "non_production" };
  }
  if (explicitMode === "disabled") {
    return { enabled: false, reason: "explicit_disabled" };
  }
  if (explicitMode) {
    return { enabled: false, reason: "invalid_mode" };
  }
  return { enabled: true, reason: "production_default" };
}

export function isDingtalkDeliveryEnabled(
  env: DeliveryEnvironment = process.env
): boolean {
  return resolveDingtalkDeliveryPolicy(env).enabled;
}

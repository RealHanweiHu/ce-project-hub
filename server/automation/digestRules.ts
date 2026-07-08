import { z } from "zod";

export const DIGEST_RULE_KEYS = ["health_digest", "personal_daily_digest"] as const;
export type DigestRuleKey = (typeof DIGEST_RULE_KEYS)[number];

export const healthDigestConfigSchema = z.object({
  cadence: z.enum(["daily", "weekly"]).default("daily"),
  sendHour: z.number().int().min(0).max(23).default(9), // Asia/Shanghai
  weekday: z.number().int().min(1).max(7).default(1), // ISO: 1=周一（cadence=weekly 生效）
  pushPmPersonal: z.boolean().default(true),
  pushManagerGroup: z.boolean().default(true),
});
export type HealthDigestConfig = z.infer<typeof healthDigestConfigSchema>;

export const personalDailyDigestConfigSchema = z.object({
  sendHour: z.number().int().min(0).max(23).default(9), // Asia/Shanghai
  dueSoonDays: z.number().int().min(1).max(14).default(3),
  includePendingReviews: z.boolean().default(true),
  includeProjectExceptions: z.boolean().default(true),
  pushDingtalk: z.boolean().default(true),
});
export type PersonalDailyDigestConfig = z.infer<typeof personalDailyDigestConfigSchema>;
export type DigestRuleConfig = HealthDigestConfig | PersonalDailyDigestConfig;

export const DIGEST_RULES = [
  {
    key: "health_digest",
    label: "健康度摘要推送",
    triggerType: "digest", // 标记：不进 runAutomation
    defaultEnabled: false, // 默认关，配好 webhook/钉钉再开
    defaultConfig: healthDigestConfigSchema.parse({}),
    configSchema: healthDigestConfigSchema,
  },
  {
    key: "personal_daily_digest",
    label: "个人每日摘要",
    triggerType: "digest",
    defaultEnabled: true,
    defaultConfig: personalDailyDigestConfigSchema.parse({}),
    configSchema: personalDailyDigestConfigSchema,
  },
] as const;

export function isDigestRuleKey(key: string): key is DigestRuleKey {
  return (DIGEST_RULE_KEYS as readonly string[]).includes(key);
}

export function parseDigestRuleConfig(key: "health_digest", config: unknown): HealthDigestConfig;
export function parseDigestRuleConfig(key: "personal_daily_digest", config: unknown): PersonalDailyDigestConfig;
export function parseDigestRuleConfig(key: DigestRuleKey, config: unknown): DigestRuleConfig;
export function parseDigestRuleConfig(key: DigestRuleKey, config: unknown): DigestRuleConfig {
  const schema = key === "health_digest"
    ? healthDigestConfigSchema
    : key === "personal_daily_digest"
      ? personalDailyDigestConfigSchema
      : null;
  if (!schema) throw new Error(`Unknown digest rule: ${key}`);
  const base = schema.parse({});
  const overrides = config && typeof config === "object" && !Array.isArray(config) ? config : {};
  return schema.parse({ ...base, ...overrides }) as DigestRuleConfig;
}

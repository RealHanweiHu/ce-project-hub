import { describe, it, expect } from "vitest";
import {
  DIGEST_RULE_KEYS, DIGEST_RULES, healthDigestConfigSchema, personalDailyDigestConfigSchema,
  isDigestRuleKey, parseDigestRuleConfig,
} from "./digestRules";

describe("digestRules", () => {
  it("默认配置", () => {
    const c = healthDigestConfigSchema.parse({});
    expect(c).toEqual({ cadence: "daily", sendHour: 9, weekday: 1, pushPmPersonal: true, pushManagerGroup: true });
  });
  it("DIGEST_RULES 含 health_digest 且默认关闭", () => {
    const r = DIGEST_RULES.find((x) => x.key === "health_digest");
    expect(r?.defaultEnabled).toBe(false);
    expect(r?.triggerType).toBe("digest");
  });
  it("personal_daily_digest 默认开启，早上 9 点发 3 天内摘要", () => {
    const c = personalDailyDigestConfigSchema.parse({});
    expect(c).toEqual({
      sendHour: 9,
      dueSoonDays: 3,
      includePendingReviews: true,
      includeProjectExceptions: true,
      pushDingtalk: true,
    });
    const r = DIGEST_RULES.find((x) => x.key === "personal_daily_digest");
    expect(r?.defaultEnabled).toBe(true);
  });
  it("isDigestRuleKey", () => {
    expect(isDigestRuleKey("health_digest")).toBe(true);
    expect(isDigestRuleKey("personal_daily_digest")).toBe(true);
    expect(isDigestRuleKey("overdue_reminder")).toBe(false);
  });
  it("parseDigestRuleConfig 合并部分配置", () => {
    const c = parseDigestRuleConfig("health_digest", { cadence: "weekly", sendHour: 8 });
    expect(c.cadence).toBe("weekly");
    expect(c.sendHour).toBe(8);
    expect(c.weekday).toBe(1);
  });
  it("parseDigestRuleConfig 解析个人摘要配置", () => {
    const c = parseDigestRuleConfig("personal_daily_digest", { dueSoonDays: 5, pushDingtalk: false });
    expect(c.dueSoonDays).toBe(5);
    expect(c.pushDingtalk).toBe(false);
    expect(c.sendHour).toBe(9);
  });
  it("DIGEST_RULE_KEYS 含所有摘要规则", () => {
    expect([...DIGEST_RULE_KEYS]).toEqual(["health_digest", "personal_daily_digest"]);
  });
});

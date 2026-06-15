import { describe, it, expect } from "vitest";
import {
  DIGEST_RULE_KEYS, DIGEST_RULES, healthDigestConfigSchema,
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
  it("isDigestRuleKey", () => {
    expect(isDigestRuleKey("health_digest")).toBe(true);
    expect(isDigestRuleKey("overdue_reminder")).toBe(false);
  });
  it("parseDigestRuleConfig 合并部分配置", () => {
    const c = parseDigestRuleConfig("health_digest", { cadence: "weekly", sendHour: 8 });
    expect(c.cadence).toBe("weekly");
    expect(c.sendHour).toBe(8);
    expect(c.weekday).toBe(1);
  });
  it("DIGEST_RULE_KEYS 只含 health_digest", () => {
    expect([...DIGEST_RULE_KEYS]).toEqual(["health_digest"]);
  });
});

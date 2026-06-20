import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listAutomationRuleRows, updateAutomationRuleRow } from "./db";
import { parseAutomationRuleConfig } from "./automation/rules";
import { automationRouter } from "./routers/automation";

const RULE_KEY = "overdue_reminder";

const makeCtx = () => ({
  user: {
    id: 779901,
    role: "admin",
    name: "Automation Admin",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: true,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
});

let previousRule: Awaited<ReturnType<typeof listAutomationRuleRows>>[number] | undefined;

beforeAll(async () => {
  const rows = await listAutomationRuleRows();
  previousRule = rows.find((row) => row.ruleKey === RULE_KEY);
});

afterAll(async () => {
  const defaultConfig = parseAutomationRuleConfig(RULE_KEY, {}) as Record<string, unknown>;
  await updateAutomationRuleRow({
    ruleKey: RULE_KEY,
    enabled: previousRule?.enabled ?? true,
    config: (previousRule?.config as Record<string, unknown> | undefined) ?? defaultConfig,
    updatedBy: previousRule?.updatedBy ?? null,
  });
});

describe("automation.listRules", () => {
  it("returns effectiveConfig merged with defaults when stored config is empty", async () => {
    await updateAutomationRuleRow({ ruleKey: RULE_KEY, enabled: true, config: {} });

    const caller = automationRouter.createCaller(makeCtx() as any);
    const rules = await caller.listRules();
    const rule = rules.find((item) => item.key === RULE_KEY);
    const expected = parseAutomationRuleConfig(RULE_KEY, {});

    expect(rule?.effectiveConfig).toEqual(expected);
    expect(rule?.config).toEqual(expected);
  });
});

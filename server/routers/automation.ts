import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  listAutomationRuleRows,
  listAutomationRuns,
  updateAutomationRuleRow,
} from "../db";
import { ensureAutomationRuleDefaults } from "../automation/engine";
import {
  AUTOMATION_RULE_KEYS,
  AUTOMATION_RULES,
  parseAutomationRuleConfig,
} from "../automation/rules";

export const automationRouter = router({
  listRules: adminProcedure.query(async () => {
    await ensureAutomationRuleDefaults();
    const rows = await listAutomationRuleRows();
    const rowByKey = new Map(rows.map((row) => [row.ruleKey, row]));

    return AUTOMATION_RULES.map((rule) => {
      const row = rowByKey.get(rule.key);
      return {
        key: rule.key,
        label: rule.label,
        triggerType: rule.triggerType,
        defaultEnabled: rule.defaultEnabled,
        enabled: row?.enabled ?? rule.defaultEnabled,
        config: parseAutomationRuleConfig(rule.key, row?.config ?? rule.defaultConfig),
        recipientRoles: rule.recipientRoles,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
  }),

  updateRule: adminProcedure
    .input(z.object({
      ruleKey: z.enum(AUTOMATION_RULE_KEYS),
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureAutomationRuleDefaults();
      const parsedConfig = input.config
        ? parseAutomationRuleConfig(input.ruleKey, input.config)
        : undefined;
      await updateAutomationRuleRow({
        ruleKey: input.ruleKey,
        enabled: input.enabled,
        config: parsedConfig ? { ...(parsedConfig as Record<string, unknown>) } : undefined,
        updatedBy: ctx.user.id,
      });
      return { ok: true };
    }),

  listRuns: adminProcedure
    .input(z.object({
      projectId: z.string().optional().nullable(),
      limit: z.number().int().min(1).max(200).optional(),
    }).optional())
    .query(({ input }) => listAutomationRuns({
      projectId: input?.projectId ?? null,
      limit: input?.limit,
    })),
});

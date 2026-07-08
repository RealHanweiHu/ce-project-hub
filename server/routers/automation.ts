import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  listAutomationRuleRows,
  listAutomationRuns,
  getAutomationHeartbeat,
  getAutomationPressureMetrics,
  updateAutomationRuleRow,
} from "../db";
import { ACTIVITY_LOG_TAILER_KEY } from "../automation/activityLogTailer";
import { ensureAutomationRuleDefaults } from "../automation/engine";
import {
  AUTOMATION_RULE_KEYS,
  AUTOMATION_RULES,
  parseAutomationRuleConfig,
} from "../automation/rules";
import { DIGEST_RULES, DIGEST_RULE_KEYS, isDigestRuleKey, parseDigestRuleConfig } from "../automation/digestRules";
import { getNotificationPolicy, type NotificationEventKey } from "../../shared/notification-matrix";

export const automationRouter = router({
  listRules: adminProcedure.query(async () => {
    await ensureAutomationRuleDefaults();
    const rows = await listAutomationRuleRows();
    const rowByKey = new Map(rows.map((row) => [row.ruleKey, row]));

    const builtIn = AUTOMATION_RULES.map((rule) => {
      const row = rowByKey.get(rule.key);
      const effectiveConfig = parseAutomationRuleConfig(rule.key, row?.config ?? rule.defaultConfig) as Record<string, unknown>;
      const policy = getNotificationPolicy(rule.key as NotificationEventKey);
      return {
        key: rule.key as string,
        label: rule.label,
        triggerType: rule.triggerType as string,
        defaultEnabled: rule.defaultEnabled,
        enabled: row?.enabled ?? rule.defaultEnabled,
        config: effectiveConfig,
        effectiveConfig,
        recipientRoles: rule.recipientRoles as readonly string[],
        deliveryTier: policy.tier,
        personalChannels: policy.personalChannels,
        requiresAction: policy.requiresAction,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
    const digest = DIGEST_RULES.map((rule) => {
      const row = rowByKey.get(rule.key);
      const effectiveConfig = parseDigestRuleConfig(rule.key, row?.config ?? rule.defaultConfig) as Record<string, unknown>;
      const policy = getNotificationPolicy(rule.key as NotificationEventKey);
      return {
        key: rule.key as string,
        label: rule.label,
        triggerType: rule.triggerType as string,
        defaultEnabled: rule.defaultEnabled,
        enabled: row?.enabled ?? rule.defaultEnabled,
        config: effectiveConfig,
        effectiveConfig,
        recipientRoles: [] as readonly string[],
        deliveryTier: policy.tier,
        personalChannels: policy.personalChannels,
        requiresAction: policy.requiresAction,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
    return [...builtIn, ...digest];
  }),

  updateRule: adminProcedure
    .input(z.object({
      ruleKey: z.enum([...AUTOMATION_RULE_KEYS, ...DIGEST_RULE_KEYS] as [string, ...string[]]),
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ensureAutomationRuleDefaults();
      const parsedConfig = input.config
        ? (isDigestRuleKey(input.ruleKey)
            ? parseDigestRuleConfig(input.ruleKey, input.config)
            : parseAutomationRuleConfig(input.ruleKey as (typeof AUTOMATION_RULE_KEYS)[number], input.config))
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

  schedulerStatus: adminProcedure.query(() => getAutomationHeartbeat()),
  eventTailerStatus: adminProcedure.query(() => getAutomationHeartbeat(ACTIVITY_LOG_TAILER_KEY)),
  pressureMetrics: adminProcedure
    .input(z.object({ windowDays: z.number().int().min(1).max(90).optional() }).optional())
    .query(({ input }) => getAutomationPressureMetrics(input?.windowDays ?? 7)),
});

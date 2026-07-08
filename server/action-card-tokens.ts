import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { ENV } from "./_core/env";

const ACTION_CARD_TOKEN_PURPOSE = "action_card_action";
const ACTION_CARD_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

const baseSchema = z.object({
  userId: z.number().int().positive(),
});

const tokenPayloadSchema = z.discriminatedUnion("kind", [
  baseSchema.extend({
    kind: z.literal("task_approval"),
    actionItemId: z.number().int().positive().optional(),
    projectId: z.string().min(1),
    phaseId: z.string().min(1),
    taskId: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
  }),
  baseSchema.extend({
    kind: z.literal("deliverable_review"),
    actionItemId: z.number().int().positive().optional(),
    projectId: z.string().min(1),
    phaseId: z.string().min(1),
    deliverableName: z.string().min(1),
    decision: z.enum(["approved", "rejected"]),
  }),
  baseSchema.extend({
    kind: z.literal("task_complete"),
    projectId: z.string().min(1),
    phaseId: z.string().min(1),
    taskId: z.string().min(1),
  }),
  baseSchema.extend({
    kind: z.literal("issue_validation"),
    actionItemId: z.number().int().positive().optional(),
    projectId: z.string().min(1),
    phaseId: z.string().min(1),
    issueId: z.union([z.number().int().positive(), z.string().min(1)]),
    decision: z.enum(["accepted", "reopened"]),
  }),
  baseSchema.extend({
    kind: z.literal("action_item_snooze"),
    actionItemId: z.number().int().positive(),
    until: z.enum(["tomorrow_morning"]).default("tomorrow_morning"),
  }),
  baseSchema.extend({
    kind: z.literal("delay_impact_confirm"),
    actionItemId: z.number().int().positive(),
    projectId: z.string().min(1),
    taskId: z.string().min(1),
    startDate: z.string().min(1).optional(),
    dueDate: z.string().min(1).optional(),
  }),
  baseSchema.extend({
    kind: z.literal("mp_release_confirm"),
    actionItemId: z.number().int().positive(),
    projectId: z.string().min(1),
    approvalInstanceId: z.number().int().positive(),
  }),
]);

export type ActionCardTokenPayload = z.infer<typeof tokenPayloadSchema>;

function getActionCardSecret(): Uint8Array {
  if (!ENV.cookieSecret) {
    throw new Error("JWT_SECRET 未配置，无法生成卡片动作令牌");
  }
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function createActionCardToken(
  payload: ActionCardTokenPayload,
  options: { expiresInSeconds?: number } = {},
): Promise<string> {
  const parsed = tokenPayloadSchema.parse(payload);
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    ...parsed,
    purpose: ACTION_CARD_TOKEN_PURPOSE,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + (options.expiresInSeconds ?? ACTION_CARD_TOKEN_TTL_SECONDS))
    .sign(getActionCardSecret());
}

export async function verifyActionCardToken(token: string): Promise<ActionCardTokenPayload> {
  const { payload } = await jwtVerify(token, getActionCardSecret(), { algorithms: ["HS256"] });
  if (payload.purpose !== ACTION_CARD_TOKEN_PURPOSE) {
    throw new Error("卡片动作令牌用途不匹配");
  }
  return tokenPayloadSchema.parse(payload);
}

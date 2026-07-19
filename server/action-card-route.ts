import type { Express, Request, Response } from "express";
import type { TrpcContext } from "./_core/context";
import type { AppRouter } from "./routers";
import { completeActionItem, getUserById, snoozeActionItem } from "./db";
import { verifyActionCardToken, type ActionCardTokenPayload } from "./action-card-tokens";
import {
  buildDeliverableReviewActionPath,
  buildIssueValidationActionPath,
  buildTaskApprovalActionPath,
  buildTaskCompletionActionPath,
  buildProjectActionPath,
} from "../shared/action-links";
import { confirmApprovedRelease } from "./services/external-approval-service";
import { markActionItemInteractiveCardsHandled } from "./dingtalk-interactive-card-service";
import { rescheduleProjectFromTask } from "./services/schedule-service";
import {
  nextShanghaiMorning,
  shanghaiMorningAfterCalendarDays,
  SHANGHAI_TIME_ZONE,
} from "../shared/shanghai-date";

export type ActionCardExecutionResult = {
  title: string;
  message: string;
  actionPath?: string;
};

type ActionItemSnoozeUntil = Extract<
  ActionCardTokenPayload,
  { kind: "action_item_snooze" }
>["until"];

/** 将卡片 snooze 语义解析为绝对时刻；延两天是上海日历后天 08:00。 */
export function actionItemSnoozeUntil(until: ActionItemSnoozeUntil, now = new Date()): Date {
  return until === "in_2_days"
    ? shanghaiMorningAfterCalendarDays(now, 2)
    : nextShanghaiMorning(now);
}

function getString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return getString(value[0]);
  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractToken(req: Request): string | null {
  const queryToken = getString(req.query.token);
  if (queryToken) return queryToken;
  const body = req.body as Record<string, unknown> | undefined;
  return getString(body?.token);
}

function resultPage(result: ActionCardExecutionResult, ok = true): string {
  const title = ok ? result.title : "处理失败";
  const actionLink = result.actionPath
    ? `<p><a href="${escapeHtml(result.actionPath)}">打开详情</a></p>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f5; color: #1f2937; }
      main { max-width: 560px; margin: 14vh auto 0; padding: 24px; }
      section { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 12px; font-size: 22px; line-height: 1.3; }
      p { margin: 0 0 14px; color: #4b5563; line-height: 1.7; }
      a { color: #2563eb; text-decoration: none; font-weight: 600; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(result.message)}</p>
        ${actionLink}
      </section>
    </main>
  </body>
</html>`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "未知错误");
}

function actionPathForPayload(payload: ActionCardTokenPayload): string {
  switch (payload.kind) {
    case "task_approval":
      return buildTaskApprovalActionPath(payload);
    case "deliverable_review":
      return buildDeliverableReviewActionPath(payload);
    case "task_complete":
      return buildTaskCompletionActionPath(payload);
    case "task_start":
      return buildProjectActionPath({
        projectId: payload.projectId,
        tab: "tasks",
        phaseId: payload.phaseId,
        taskId: payload.taskId,
      });
    case "issue_validation":
      return buildIssueValidationActionPath(payload);
    case "action_item_snooze":
      return "/";
    case "delay_impact_confirm":
      return buildProjectActionPath({ projectId: payload.projectId, tab: "tasks", taskId: payload.taskId });
    case "mp_release_confirm":
      return buildProjectActionPath({ projectId: payload.projectId, tab: "approval" });
  }
}

function actionItemIdForPayload(payload: ActionCardTokenPayload): number | null {
  return "actionItemId" in payload && typeof payload.actionItemId === "number" ? payload.actionItemId : null;
}

export async function executeActionCardPayload(
  payload: ActionCardTokenPayload,
  appRouter: AppRouter,
  req: Request,
  res: Response,
): Promise<ActionCardExecutionResult> {
  const user = await getUserById(payload.userId);
  if (!user) throw new Error("动作所属用户不存在或已停用");

  const ctx: TrpcContext = { req: req as TrpcContext["req"], res: res as TrpcContext["res"], user };
  const caller = appRouter.createCaller(ctx);

  switch (payload.kind) {
    case "task_approval":
      await caller.tasks.decideApproval({
        projectId: payload.projectId,
        phaseId: payload.phaseId,
        taskId: payload.taskId,
        decision: payload.decision,
        note: null,
      });
      return {
        title: payload.decision === "approved" ? "任务审批已通过" : "任务审批已驳回",
        message: "已按原有审批权限完成处理，相关行动项会自动闭环。",
        actionPath: actionPathForPayload(payload),
      };

    case "deliverable_review":
      await caller.deliverableReviews.review({
        projectId: payload.projectId,
        phaseId: payload.phaseId,
        deliverableName: payload.deliverableName,
        decision: payload.decision,
        note: null,
      });
      return {
        title: payload.decision === "approved" ? "交付物审核已通过" : "交付物审核已驳回",
        message: "已按指定审核人权限完成处理，审核记录和通知闭环已写入系统。",
        actionPath: actionPathForPayload(payload),
      };

    case "task_complete":
      await caller.tasks.setCompleted({
        projectId: payload.projectId,
        phaseId: payload.phaseId,
        taskId: payload.taskId,
        completed: true,
      });
      return {
        title: "任务已标记完成",
        message: "系统已复用原任务完成规则处理，若该任务需要审批，会自动进入待审批。",
        actionPath: actionPathForPayload(payload),
      };

    case "task_start":
      await caller.tasks.start({
        projectId: payload.projectId,
        phaseId: payload.phaseId,
        taskId: payload.taskId,
      });
      if (payload.actionItemId) {
        // start 本身幂等；行动项若已由首次点击闭环，重试仍返回成功。
        await completeActionItem({
          id: payload.actionItemId,
          recipientUserId: payload.userId,
        });
      }
      return {
        title: "任务已开始",
        message: "已记录实际开始时间，系统会按前置条件更新状态；原计划排期保持不变。",
        actionPath: actionPathForPayload(payload),
      };

    case "issue_validation": {
      const issueId = Number(payload.issueId);
      if (!Number.isInteger(issueId) || issueId <= 0) throw new Error("问题 ID 无效");
      await caller.issues.update({
        id: issueId,
        projectId: payload.projectId,
        status: payload.decision === "accepted" ? "closed" : "in_progress",
      });
      return {
        title: payload.decision === "accepted" ? "问题已验证关闭" : "问题已重开",
        message: "问题状态已更新，系统会继续按当前状态推进后续提醒。",
        actionPath: actionPathForPayload(payload),
      };
    }

    case "action_item_snooze": {
      const snoozedUntil = actionItemSnoozeUntil(payload.until);
      const ok = await snoozeActionItem({
        id: payload.actionItemId,
        recipientUserId: payload.userId,
        snoozedUntil,
      });
      if (!ok) throw new Error("行动项不存在、已处理，或你不是该行动项负责人");
      return {
        title: payload.until === "in_2_days" ? "已延后两天" : "已推迟到明早",
        message: `系统会在 ${snoozedUntil.toLocaleString("zh-CN", { timeZone: SHANGHAI_TIME_ZONE })} 后重新把它放回待办。`,
        actionPath: actionPathForPayload(payload),
      };
    }

    case "delay_impact_confirm": {
      if (payload.startDate && payload.dueDate) {
        await rescheduleProjectFromTask(payload.projectId, payload.taskId, payload.startDate, payload.dueDate, {
          actorId: payload.userId,
        });
      }
      const ok = await completeActionItem({
        id: payload.actionItemId,
        recipientUserId: payload.userId,
      });
      if (!ok) throw new Error("延期影响确认项不存在、已处理，或你不是负责人");
      return {
        title: payload.startDate && payload.dueDate ? "延期影响已确认生效" : "延期影响已确认",
        message: payload.startDate && payload.dueDate
          ? "系统已按确认日期重放排期生效逻辑，并关闭延期影响行动项。"
          : "这次联动顺延已由负责人确认，行动项已闭环。",
        actionPath: actionPathForPayload(payload),
      };
    }

    case "mp_release_confirm": {
      await confirmApprovedRelease({
        approvalInstanceId: payload.approvalInstanceId,
        actorId: payload.userId,
      });
      return {
        title: "MP Release 已发布",
        message: "系统已完成发布冻结链、发布记录和自动化播报。",
        actionPath: actionPathForPayload(payload),
      };
    }
  }
}

export async function executeActionCardToken(
  token: string,
  appRouter: AppRouter,
  req: Request,
  res: Response,
): Promise<ActionCardExecutionResult> {
  const payload = await verifyActionCardToken(token);
  const result = await executeActionCardPayload(payload, appRouter, req, res);
  await markActionItemInteractiveCardsHandled(actionItemIdForPayload(payload), result).catch((error) => {
    console.warn("[dingtalk] failed to mark interactive card handled:", error);
  });
  return result;
}

export function registerActionCardRoute(app: Express, appRouter: AppRouter) {
  async function handle(req: Request, res: Response) {
    const token = extractToken(req);
    if (!token) {
      res.status(400).json({ success: false, error: "missing token" });
      return;
    }

    try {
      const result = await executeActionCardToken(token, appRouter, req, res);
      if (req.method === "GET") {
        res.status(200).send(resultPage(result, true));
      } else {
        res.status(200).json({ success: true, result });
      }
    } catch (error) {
      const message = errorMessage(error);
      const result = { title: "处理失败", message };
      if (req.method === "GET") {
        res.status(409).send(resultPage(result, false));
      } else {
        res.status(409).json({ success: false, error: message });
      }
    }
  }

  app.get("/api/action-card/execute", handle);
  app.post("/api/action-card/execute", handle);
}

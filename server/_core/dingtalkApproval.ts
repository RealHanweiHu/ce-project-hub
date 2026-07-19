import { getAccessToken, isDingtalkConfigured } from "./dingtalk";
import { ENV } from "./env";
import { fetchWithTimeout } from "./fetchWithTimeout";
import {
  DINGTALK_DELIVERY_DISABLED_MESSAGE,
  isDingtalkDeliveryEnabled,
} from "./dingtalk-delivery-policy";

const OAPI_BASE = "https://oapi.dingtalk.com/topapi/processinstance";
const WORKFLOW_PROCESS_INSTANCE_URL = "https://api.dingtalk.com/v1.0/workflow/processInstances";

export type ApprovalCallResult<T> =
  | { ok: true; data: T; raw: unknown }
  | { ok: false; error: string; raw?: unknown; uncertain?: boolean };

export type ApprovalFormComponent = { name: string; value: string };

export type NormalizedApprovalStatus = "pending" | "approved" | "rejected" | "terminated" | "sync_failed";

function responseError(prefix: string, body: Record<string, unknown>, status?: number): string {
  const code = body.errcode ?? body.code ?? status ?? "unknown";
  const message = body.errmsg ?? body.message ?? "";
  return `${prefix} errcode=${code} ${message}`.trim();
}

function isAmbiguousCreateHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function hasApprovalApiError(body: Record<string, unknown>): boolean {
  const errcode = body.errcode;
  const code = body.code;
  return body.success === false
    || (errcode !== undefined && errcode !== 0 && errcode !== "0")
    || (code !== undefined && code !== 0 && code !== "0" && code !== "OK");
}

function toFormValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function buildApprovalForm(_businessType: string, snapshot: Record<string, unknown>): ApprovalFormComponent[] {
  return Object.entries(snapshot)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ({ name, value: toFormValue(value) }));
}

export function normalizeApprovalStatus(raw: Record<string, unknown> | null | undefined): NormalizedApprovalStatus {
  if (!raw) return "sync_failed";
  const status = String(raw.status ?? raw.instanceStatus ?? "").toLowerCase();
  const result = String(raw.result ?? raw.approveResult ?? "").toLowerCase();
  if (status.includes("terminate") || status.includes("cancel")) return "terminated";
  if (result.includes("refuse") || result.includes("reject") || result === "disagree") return "rejected";
  if (result.includes("agree") || result.includes("approve")) return "approved";
  if (status.includes("complete") && !result) return "approved";
  if (status.includes("running") || status.includes("pending") || !status) return "pending";
  return "sync_failed";
}

function positiveNumber(value: string | number | null | undefined): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeApprovers(userIds: string[] | null | undefined): string[] {
  return Array.from(new Set((userIds ?? []).map((userId) => userId.trim()).filter(Boolean)));
}

export async function createApprovalInstance(input: {
  processCode: string;
  originatorUserId: string;
  deptId?: number | null;
  formComponentValues: ApprovalFormComponent[];
  approverUserIds?: string[] | null;
}): Promise<ApprovalCallResult<{ processInstanceId: string }>> {
  if (!input.processCode?.trim()) return { ok: false, error: "钉钉审批模板 processCode 未配置" };
  if (!isDingtalkDeliveryEnabled()) {
    return { ok: false, error: DINGTALK_DELIVERY_DISABLED_MESSAGE };
  }
  if (!isDingtalkConfigured()) return { ok: false, error: "钉钉未配置" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "获取钉钉 access_token 失败" };

  const approverUserIds = normalizeApprovers(input.approverUserIds);
  if (approverUserIds.length > 0) {
    const agentId = positiveNumber(ENV.dingtalkAgentId);
    const requestBody = {
      processCode: input.processCode,
      originatorUserId: input.originatorUserId,
      deptId: input.deptId ?? -1,
      ...(agentId ? { microappAgentId: agentId } : {}),
      approvers: [{ actionType: "AND", userIds: approverUserIds }],
      formComponentValues: input.formComponentValues,
    };
    try {
      const resp = await fetchWithTimeout(WORKFLOW_PROCESS_INSTANCE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-acs-dingtalk-access-token": token,
        },
        body: JSON.stringify(requestBody),
      });
      const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
      if (!resp.ok) {
        return {
          ok: false,
          error: responseError("钉钉审批发起失败", body, resp.status),
          raw: body,
          uncertain: isAmbiguousCreateHttpStatus(resp.status),
        };
      }
      if (hasApprovalApiError(body)) {
        return { ok: false, error: responseError("钉钉审批发起失败", body), raw: body };
      }
      const result = body.result as Record<string, unknown> | undefined;
      const processInstanceId = body.instanceId ?? body.processInstanceId ?? result?.instanceId ?? result?.processInstanceId;
      if (typeof processInstanceId !== "string" || !processInstanceId) {
        return { ok: false, error: "钉钉审批发起成功但未返回实例 ID", raw: body, uncertain: true };
      }
      return { ok: true, data: { processInstanceId }, raw: body };
    } catch (error) {
      return {
        ok: false,
        error: `钉钉审批发起异常: ${error instanceof Error ? error.message : String(error)}`,
        uncertain: true,
      };
    }
  }

  const requestBody = {
    process_code: input.processCode,
    originator_user_id: input.originatorUserId,
    dept_id: input.deptId ?? -1,
    form_component_values: input.formComponentValues,
  };

  try {
    const resp = await fetchWithTimeout(`${OAPI_BASE}/create?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (!resp.ok) {
      return {
        ok: false,
        error: responseError("钉钉审批发起失败", body, resp.status),
        raw: body,
        uncertain: isAmbiguousCreateHttpStatus(resp.status),
      };
    }
    if (hasApprovalApiError(body)) {
      return { ok: false, error: responseError("钉钉审批发起失败", body), raw: body };
    }
    const result = body.result as Record<string, unknown> | undefined;
    const processInstanceId = result?.process_instance_id ?? result?.processInstanceId ?? body.process_instance_id;
    if (typeof processInstanceId !== "string" || !processInstanceId) {
      return { ok: false, error: "钉钉审批发起成功但未返回实例 ID", raw: body, uncertain: true };
    }
    return { ok: true, data: { processInstanceId }, raw: body };
  } catch (error) {
    return {
      ok: false,
      error: `钉钉审批发起异常: ${error instanceof Error ? error.message : String(error)}`,
      uncertain: true,
    };
  }
}

function approvalDetailFrom(body: Record<string, unknown>): Record<string, unknown> {
  return (body.result ?? body.process_instance ?? body) as Record<string, unknown>;
}

export async function getApprovalInstance(
  processInstanceId: string,
): Promise<ApprovalCallResult<{ status: NormalizedApprovalStatus; detail: Record<string, unknown> }>> {
  if (!processInstanceId?.trim()) return { ok: false, error: "缺少钉钉审批实例 ID" };
  if (!isDingtalkConfigured()) return { ok: false, error: "钉钉未配置" };
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "获取钉钉 access_token 失败" };

  try {
    const v1Resp = await fetchWithTimeout(`${WORKFLOW_PROCESS_INSTANCE_URL}?processInstanceId=${encodeURIComponent(processInstanceId)}`, {
      method: "GET",
      headers: {
        "x-acs-dingtalk-access-token": token,
      },
    });
    const v1Body = await v1Resp.json().catch(() => ({})) as Record<string, unknown>;
    if (v1Resp.ok && v1Body.success !== false && (v1Body.errcode === undefined || v1Body.errcode === 0)) {
      const detail = approvalDetailFrom(v1Body);
      return { ok: true, data: { status: normalizeApprovalStatus(detail), detail }, raw: v1Body };
    }

    const resp = await fetchWithTimeout(`${OAPI_BASE}/get?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ process_instance_id: processInstanceId }),
    });
    const body = await resp.json().catch(() => ({})) as Record<string, unknown>;
    if (!resp.ok) return { ok: false, error: responseError("钉钉审批查询失败", body, resp.status), raw: body };
    if (body.errcode !== 0) return { ok: false, error: responseError("钉钉审批查询失败", body), raw: body };
    const detail = approvalDetailFrom(body);
    return { ok: true, data: { status: normalizeApprovalStatus(detail), detail }, raw: body };
  } catch (error) {
    return { ok: false, error: `钉钉审批查询异常: ${error instanceof Error ? error.message : String(error)}` };
  }
}

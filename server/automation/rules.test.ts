import { describe, expect, it } from "vitest";
import {
  AUTOMATION_RULES,
  exceptionEscalationRoles,
  getAutomationRule,
  isAutomationRuleMatch,
  parseAutomationRuleConfig,
} from "./rules";

describe("built-in automation rule matching", () => {
  it("keeps exactly the built-in rule keys (MVP + NPD 生命周期三事件)", () => {
    expect(AUTOMATION_RULES.map((rule) => rule.key)).toEqual([
      "overdue_reminder",
      "due_soon_reminder",
      "task_blocked_notify",
      "task_assignment",
      "gate_prereq_incomplete",
      "high_severity_issue",
      "status_change_notify",
      "mp_release_broadcast",
      "delay_impact_notify",
      "exception_escalation",
      "definition_confirmed_notify",
      "gate_decision_notify",
      "phase_advanced_notify",
    ]);
  });

  it("matches overdue tasks according to graceDays and scope", () => {
    expect(
      isAutomationRuleMatch(
        "overdue_reminder",
        {
          action: "scheduled",
          entityType: "task",
          entityId: "t1",
          after: { dueDate: "2026-06-12", status: "in_progress" },
          now: "2026-06-14",
        },
        { graceDays: 1, scope: "tasks" }
      )
    ).toBe(true);

    expect(
      isAutomationRuleMatch(
        "overdue_reminder",
        {
          action: "scheduled",
          entityType: "issue",
          entityId: 1,
          after: { targetDate: "2026-06-12", status: "open" },
          now: "2026-06-14",
        },
        { scope: "tasks" }
      )
    ).toBe(false);
  });

  it("triggers high severity on create and whenever severity worsens into the set", () => {
    // 创建即落在观察集
    expect(
      isAutomationRuleMatch("high_severity_issue", {
        action: "issue.create",
        entityType: "issue",
        after: { severity: "P0" },
      })
    ).toBe(true);

    // 进入观察集 P2→P1（变更严重）
    expect(
      isAutomationRuleMatch("high_severity_issue", {
        action: "issue.update",
        entityType: "issue",
        before: { severity: "P2" },
        after: { severity: "P1" },
      })
    ).toBe(true);

    // 集合内升级 P1→P0（变更严重）→ 触发
    expect(
      isAutomationRuleMatch("high_severity_issue", {
        action: "issue.update",
        entityType: "issue",
        before: { severity: "P1" },
        after: { severity: "P0" },
      })
    ).toBe(true);

    // 降级 P0→P1（仍在集合但变轻）→ 不触发
    expect(
      isAutomationRuleMatch("high_severity_issue", {
        action: "issue.update",
        entityType: "issue",
        before: { severity: "P0" },
        after: { severity: "P1" },
      })
    ).toBe(false);

    // 变更但不入集合 P3→P2 → 不触发
    expect(
      isAutomationRuleMatch("high_severity_issue", {
        action: "issue.update",
        entityType: "issue",
        before: { severity: "P3" },
        after: { severity: "P2" },
      })
    ).toBe(false);
  });

  it("matches configured status transitions only when the field changed", () => {
    expect(
      isAutomationRuleMatch("status_change_notify", {
        action: "issue.update",
        entityType: "issue",
        before: { status: "in_progress" },
        after: { status: "resolved" },
      })
    ).toBe(true);

    expect(
      isAutomationRuleMatch("status_change_notify", {
        action: "issue.update",
        entityType: "issue",
        before: { status: "resolved" },
        after: { status: "resolved" },
      })
    ).toBe(false);

    expect(
      isAutomationRuleMatch(
        "status_change_notify",
        {
          action: "task.update_meta",
          entityType: "task",
          before: { status: "in_progress" },
          after: { status: "blocked" },
        },
        { transitions: { task: ["blocked"] } }
      )
    ).toBe(true);

    // 关闭事件(issue.close)也按 status 变化触发
    expect(
      isAutomationRuleMatch("status_change_notify", {
        action: "issue.close",
        entityType: "issue",
        before: { status: "in_progress" },
        after: { status: "closed" },
      })
    ).toBe(true);

    // gate 更新为终态决议（entityType gate_review）
    expect(
      isAutomationRuleMatch("status_change_notify", {
        action: "gate.update",
        entityType: "gate_review",
        before: { decision: "conditional" },
        after: { decision: "approved" },
      })
    ).toBe(true);

    // gate 创建即终态（before 缺省，decision 直接 rejected）
    expect(
      isAutomationRuleMatch("status_change_notify", {
        action: "gate.create",
        entityType: "gate_review",
        after: { decision: "rejected" },
      })
    ).toBe(true);

    // gate 创建为非终态（conditional 不在目标集）→ 不触发
    expect(
      isAutomationRuleMatch("status_change_notify", {
        action: "gate.create",
        entityType: "gate_review",
        after: { decision: "conditional" },
      })
    ).toBe(false);
  });

  it("due_soon_reminder fires within window, not when overdue or far off", () => {
    const ev = (dueDate: string) => ({ action: "scheduled" as const, entityType: "task" as const, entityId: "t", now: "2026-06-14", after: { dueDate, status: "in_progress" } });
    expect(isAutomationRuleMatch("due_soon_reminder", ev("2026-06-15"), { dueSoonDays: 2 })).toBe(true);  // 还有1天
    expect(isAutomationRuleMatch("due_soon_reminder", ev("2026-06-14"), { dueSoonDays: 2 })).toBe(true);  // 今天
    expect(isAutomationRuleMatch("due_soon_reminder", ev("2026-06-20"), { dueSoonDays: 2 })).toBe(false); // 太远
    expect(isAutomationRuleMatch("due_soon_reminder", ev("2026-06-10"), { dueSoonDays: 2 })).toBe(false); // 已逾期(归 overdue)
  });

  it("task_blocked_notify fires only on transition into blocked", () => {
    expect(isAutomationRuleMatch("task_blocked_notify", { action: "task.update_meta", entityType: "task", before: { status: "in_progress" }, after: { status: "blocked" } })).toBe(true);
    expect(isAutomationRuleMatch("task_blocked_notify", { action: "task.update_meta", entityType: "task", before: { status: "blocked" }, after: { status: "blocked" } })).toBe(false);
  });

  it("task_assignment fires for active unassigned tasks only", () => {
    const ev = (extra: Record<string, unknown>) => ({
      action: "scheduled" as const,
      entityType: "task" as const,
      entityId: "p1:design:d1:unassigned",
      after: { status: "todo", unassigned: true, taskId: "d1", ...extra },
    });
    expect(isAutomationRuleMatch("task_assignment", ev({}), {})).toBe(true);
    expect(isAutomationRuleMatch("task_assignment", ev({ unassigned: false }), {})).toBe(false);
    expect(isAutomationRuleMatch("task_assignment", ev({ status: "done" }), {})).toBe(false);
    expect(isAutomationRuleMatch("task_assignment", ev({ status: "skipped" }), {})).toBe(false);
  });

  it("gate_prereq_incomplete fires for approaching gate when not ready", () => {
    const ev = (extra: Record<string, unknown>) => ({ action: "scheduled" as const, entityType: "task" as const, entityId: "g", now: "2026-06-14", after: { isGate: true, status: "todo", dueDate: "2026-06-16", ...extra } });
    expect(isAutomationRuleMatch("gate_prereq_incomplete", ev({ notReady: true }), { leadDays: 3 })).toBe(true);
    expect(isAutomationRuleMatch("gate_prereq_incomplete", ev({ notReady: false }), { leadDays: 3 })).toBe(false); // 已就绪
    expect(isAutomationRuleMatch("overdue_reminder", ev({ notReady: true, dueDate: "2026-06-01" }), {})).toBe(false); // gate 事件不触发 overdue
  });

  it("matches MP release completion events", () => {
    expect(
      isAutomationRuleMatch("mp_release_broadcast", {
        action: "mp.release",
        entityType: "mp_release",
        entityId: 1,
      })
    ).toBe(true);
  });

  it("merges admin config onto rule defaults", () => {
    const config = parseAutomationRuleConfig("overdue_reminder", {
      graceDays: 2,
      scope: "issues",
    });

    expect(config).toMatchObject({
      graceDays: 2,
      cadenceHours: 24,
      scope: "issues",
      notifyRoles: ["assignee", "pm"],
    });
  });

  it("exception_escalation escalates by linger days and include switches", () => {
    const ev = (days: number) => ({
      action: "scheduled" as const,
      entityType: "task" as const,
      entityId: "p1:design:d1:blocked",
      after: { status: "blocked", exceptionType: "blocked_task", exceptionAgeDays: days },
    });
    const config = { assigneeAfterDays: 2, pmAfterDays: 5, managerAfterDays: 10 };

    expect(isAutomationRuleMatch("exception_escalation", ev(1), config)).toBe(false);
    expect(isAutomationRuleMatch("exception_escalation", ev(2), config)).toBe(true);
    expect(exceptionEscalationRoles(ev(2), parseAutomationRuleConfig("exception_escalation", config) as any)).toEqual(["assignee"]);
    expect(exceptionEscalationRoles(ev(5), parseAutomationRuleConfig("exception_escalation", config) as any)).toEqual(["assignee", "pm"]);
    expect(exceptionEscalationRoles(ev(10), parseAutomationRuleConfig("exception_escalation", config) as any)).toEqual(["assignee", "pm", "manager"]);

    expect(
      isAutomationRuleMatch("exception_escalation", ev(10), {
        ...config,
        include: { overdueTasks: true, blockedTasks: false, criticalIssues: true, pendingReviews: true },
      })
    ).toBe(false);
  });
});

describe("gate_prereq_incomplete 升级为就绪度", () => {
  const evt = (over: Record<string, unknown>) => ({
    action: "scheduled" as const, entityType: "task" as const, projectId: "p1",
    now: new Date("2026-06-16T00:00:00Z"),
    after: { isGate: true, gateName: "设计冻结", dueDate: "2026-06-18", status: "in_progress", notReady: true, blockerSummaries: ["还差 2 项前置任务", "缺 1/4 项交付物"], ...over },
  });
  it("临近且未就绪 → 触发", () => {
    expect(isAutomationRuleMatch("gate_prereq_incomplete", evt({}), { leadDays: 3 })).toBe(true);
  });
  it("已就绪 → 不触发", () => {
    expect(isAutomationRuleMatch("gate_prereq_incomplete", evt({ notReady: false, blockerSummaries: [] }), { leadDays: 3 })).toBe(false);
  });
  it("超出 leadDays → 不触发", () => {
    expect(isAutomationRuleMatch("gate_prereq_incomplete", evt({ dueDate: "2026-07-01" }), { leadDays: 3 })).toBe(false);
  });
  it("消息含具体缺项", () => {
    const rule = getAutomationRule("gate_prereq_incomplete")!;
    const msg = rule.buildMessage(evt({}) as any, { leadDays: 3 } as any, { projectName: "充气泵" });
    expect(msg.markdown).toContain("还差 2 项前置任务");
    expect(msg.markdown).toContain("缺 1/4 项交付物");
  });
});

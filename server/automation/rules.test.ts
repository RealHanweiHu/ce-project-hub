import { describe, expect, it } from "vitest";
import { AUTOMATION_RULES, isAutomationRuleMatch, parseAutomationRuleConfig } from "./rules";

describe("built-in automation rule matching", () => {
  it("keeps exactly the MVP built-in rule keys", () => {
    expect(AUTOMATION_RULES.map((rule) => rule.key)).toEqual([
      "overdue_reminder",
      "high_severity_issue",
      "status_change_notify",
      "mp_release_broadcast",
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
});

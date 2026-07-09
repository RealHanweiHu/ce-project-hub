import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { ACTION_ITEM_KINDS } from "../drizzle/schema";
import {
  getNotificationPolicy,
  NOTIFICATION_MATRIX,
  type NotificationEventKey,
} from "../shared/notification-matrix";
import { AUTOMATION_RULE_KEYS } from "./automation/rules";
import { DIGEST_RULE_KEYS } from "./automation/digestRules";

function serverSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...serverSourceFiles(full));
    } else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("notification matrix", () => {
  it("covers every automation, digest, and action-item event", () => {
    const registered = new Set(Object.keys(NOTIFICATION_MATRIX));
    for (const key of [...AUTOMATION_RULE_KEYS, ...DIGEST_RULE_KEYS, ...ACTION_ITEM_KINDS]) {
      expect(registered.has(key)).toBe(true);
    }
  });

  it("keeps noisy reminders out of personal DingTalk while preserving true action pushes", () => {
    expect(getNotificationPolicy("overdue_reminder").personalChannels).not.toContain("dingtalk");
    expect(getNotificationPolicy("due_soon_reminder").personalChannels).not.toContain("dingtalk");
    expect(getNotificationPolicy("task_approval").personalChannels).toContain("dingtalk");
    expect(getNotificationPolicy("deliverable_review").requiresAction).toBe(true);
  });

  it("rejects missing registry entries at the type boundary", () => {
    const key: NotificationEventKey = "high_severity_issue";
    expect(getNotificationPolicy(key).tier).toBe("immediate_action");
  });

  it("keeps personal DingTalk work notifications behind the gateway", () => {
    const root = path.join(process.cwd(), "server");
    const allowed = new Set([
      path.join(root, "_core", "dingtalkMessage.ts"),
      path.join(root, "notification-gateway.ts"),
    ]);
    const offenders = serverSourceFiles(root)
      .filter((file) => !allowed.has(file))
      .filter((file) => readFileSync(file, "utf8").includes("notifyUsersViaDingtalk"))
      .map((file) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("keeps direct work-message APIs behind the gateway", () => {
    const root = path.join(process.cwd(), "server");
    const allowed = new Set([
      path.join(root, "_core", "dingtalkMessage.ts"),
      path.join(root, "notification-gateway.ts"),
    ]);
    const offenders = serverSourceFiles(root)
      .filter((file) => !allowed.has(file))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes("sendWorkNotification(") || source.includes("notifyUsersViaDingtalk(");
      })
      .map((file) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });

  it("keeps station notifications behind notifyPersonal", () => {
    const root = path.join(process.cwd(), "server");
    const allowed = new Set([
      path.join(root, "db.ts"),
      path.join(root, "notification-gateway.ts"),
    ]);
    const offenders = serverSourceFiles(root)
      .filter((file) => !allowed.has(file))
      .filter((file) => readFileSync(file, "utf8").includes("createNotification("))
      .map((file) => path.relative(process.cwd(), file));
    expect(offenders).toEqual([]);
  });
});

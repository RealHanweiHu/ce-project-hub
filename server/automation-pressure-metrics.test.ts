import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getAutomationPressureMetrics, getDb } from "./db";
import { actionItems, automationRuns, notifications, projects, dingtalkInteractiveCards } from "../drizzle/schema";

const PROJECT = `pressure-metrics-${Date.now()}`;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "dingtalk_interactive_cards" (
      "id" serial PRIMARY KEY NOT NULL,
      "outTrackId" varchar(128) NOT NULL UNIQUE,
      "actionItemId" integer,
      "recipientUserId" integer NOT NULL,
      "projectId" varchar(32),
      "eventKey" varchar(64) NOT NULL,
      "entityType" varchar(32),
      "entityId" varchar(128),
      "title" varchar(256) NOT NULL,
      "body" text,
      "actionUrl" varchar(1024),
      "status" varchar(24) DEFAULT 'sent' NOT NULL,
      "cardData" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "lastError" text,
      "handledAt" timestamp,
      "createdAt" timestamp DEFAULT now() NOT NULL,
      "updatedAt" timestamp DEFAULT now() NOT NULL
    )
  `);
  await db.insert(projects).values({
    id: PROJECT,
    name: "通知压力测试",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "design",
    createdBy: 7,
  });
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  await db.insert(actionItems).values([
    {
      kind: "task_approval",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:design:d1`,
      dedupeKey: `${PROJECT}:approval`,
      recipientUserId: 101,
      title: "任务待审批",
      actionUrl: "https://hub.example/actions/task-approval",
      status: "closed",
      priority: "high",
      firstSentAt: yesterday,
      lastSentAt: yesterday,
      handledAt: now,
      closedAt: now,
    },
    {
      kind: "task_rework",
      projectId: PROJECT,
      entityType: "task",
      entityId: `${PROJECT}:design:d2`,
      dedupeKey: `${PROJECT}:rework`,
      recipientUserId: 102,
      title: "任务返工",
      actionUrl: "https://hub.example/",
      status: "escalated",
      level: "pm",
      priority: "high",
      firstSentAt: twoDaysAgo,
      lastSentAt: twoDaysAgo,
    },
    {
      kind: "deliverable_review",
      projectId: PROJECT,
      entityType: "deliverable_review",
      entityId: `${PROJECT}:design:spec`,
      dedupeKey: `${PROJECT}:review`,
      recipientUserId: 102,
      title: "交付物审核",
      actionUrl: "https://hub.example/actions/deliverable-review",
      status: "read",
      priority: "normal",
      firstSentAt: twoDaysAgo,
      lastSentAt: twoDaysAgo,
      readAt: yesterday,
    },
  ]);
  await db.insert(notifications).values([
    { userId: 101, type: "action", title: "任务待审批", entityType: "project", entityId: PROJECT, read: false },
    { userId: 102, type: "automation", title: "自动化摘要", entityType: "project", entityId: PROJECT, read: true },
  ]);
  await db.insert(automationRuns).values([
    { ruleKey: "pressure_test", projectId: PROJECT, eventType: "test", entityType: "task", status: "fired" },
    { ruleKey: "pressure_test", projectId: PROJECT, eventType: "test", entityType: "task", status: "error" },
  ]);
  await db.insert(dingtalkInteractiveCards).values([
    {
      outTrackId: `${PROJECT}:card:handled`,
      actionItemId: null,
      recipientUserId: 101,
      projectId: PROJECT,
      eventKey: "task_approval",
      entityType: "task",
      entityId: `${PROJECT}:design:d1`,
      title: "任务待审批",
      status: "handled",
      handledAt: now,
    },
    {
      outTrackId: `${PROJECT}:card:failed`,
      actionItemId: null,
      recipientUserId: 102,
      projectId: PROJECT,
      eventKey: "deliverable_review",
      entityType: "deliverable_review",
      entityId: `${PROJECT}:design:spec`,
      title: "交付物审核",
      status: "failed",
      lastError: "template missing",
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(automationRuns).where(eq(automationRuns.projectId, PROJECT));
  await db.delete(dingtalkInteractiveCards).where(eq(dingtalkInteractiveCards.projectId, PROJECT));
  await db.delete(notifications).where(eq(notifications.entityId, PROJECT));
  await db.delete(actionItems).where(eq(actionItems.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("automation pressure metrics", () => {
  it("summarizes action pressure, notification pressure, and run health", async () => {
    const metrics = await getAutomationPressureMetrics(7);

    expect(metrics.windowDays).toBe(7);
    expect(metrics.actionItems.total).toBeGreaterThanOrEqual(3);
    expect(metrics.actionItems.sent).toBeGreaterThanOrEqual(3);
    expect(metrics.actionItems.handled).toBeGreaterThanOrEqual(1);
    expect(metrics.actionItems.escalated).toBeGreaterThanOrEqual(1);
    expect(metrics.actionItems.readUnresolved).toBeGreaterThanOrEqual(1);
    expect(metrics.actionItems.perRecipientPerDay).not.toBeNull();
    expect(metrics.actionItems.byKind.some((row) => row.kind === "task_approval")).toBe(true);
    expect(metrics.notifications.total).toBeGreaterThanOrEqual(2);
    expect(metrics.dingtalkCards.total).toBeGreaterThanOrEqual(2);
    expect(metrics.dingtalkCards.handled).toBeGreaterThanOrEqual(1);
    expect(metrics.dingtalkCards.failed).toBeGreaterThanOrEqual(1);
    expect(metrics.runs.total).toBeGreaterThanOrEqual(2);
    expect(metrics.runs.errors).toBeGreaterThanOrEqual(1);
  });
});

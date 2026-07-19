import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { projectCalendarEvents, projects } from "../drizzle/schema";
import { getDb } from "./db";
import { meetingsRouter } from "./routers/meetings";

const PROJECT = `meeting-guard-${Date.now().toString().slice(-8)}`;
const USER = 986731;
const ctx = {
  user: {
    id: USER,
    role: "admin",
    name: "meeting guard owner",
    email: null,
    username: null,
    passwordHash: null,
    canCreateProject: true,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
  },
} as never;

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "删除中日程闸门",
    projectNumber: PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: USER,
    lifecycle: "paused",
    meetingConfig: null,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(projectCalendarEvents)
    .where(eq(projectCalendarEvents.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("meeting mutations while project deletion is quiesced", () => {
  it("rejects both one-off events and recurring meeting sync before creating local or remote work", async () => {
    const caller = meetingsRouter.createCaller(ctx);
    await expect(
      caller.createEvent({
        projectId: PROJECT,
        title: "不应创建",
        date: "2026-08-01",
        time: "10:00",
        durationMin: 60,
        syncDingtalk: true,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      caller.setConfig({
        projectId: PROJECT,
        config: {
          enabled: true,
          weekday: 3,
          time: "15:00",
          durationMin: 60,
          title: "项目周会",
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const db = await getDb();
    if (!db) throw new Error("no db");
    const events = await db
      .select()
      .from(projectCalendarEvents)
      .where(eq(projectCalendarEvents.projectId, PROJECT));
    const [project] = await db
      .select({ meetingConfig: projects.meetingConfig })
      .from(projects)
      .where(eq(projects.id, PROJECT));
    expect(events).toHaveLength(0);
    expect(project.meetingConfig).toBeNull();
  });
});

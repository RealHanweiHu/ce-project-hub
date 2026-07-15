import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  activityLogs,
  projectPhases,
  projectTasks,
  projects,
} from "../drizzle/schema";
import {
  createProjectWithSeed,
  getDb,
  seedProjectPhasesAndTasks,
} from "./db";
import { projectsRouter } from "./routers/projects";

const OWNER = 996101;
const SUFFIX = Date.now().toString(36);
const IDS = {
  directLite: `npdv3-lite-${SUFFIX}`,
  secondSeed: `npdv3-seed-${SUFFIX}`,
  routerFull: `npdv3-full-${SUFFIX}`,
  legacyConfigIgnored: `npdv3-fixed-${SUFFIX}`,
};
const ALL_IDS = Object.values(IDS);

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, ALL_IDS));
  await db.delete(projects).where(inArray(projects.id, ALL_IDS));
}

beforeAll(cleanup);
afterAll(cleanup);

describe("NPD v3 create seeding", () => {
  it("createProjectWithSeed 按 lite + battery 只种 17 项", async () => {
    await createProjectWithSeed({
      id: IDS.directLite,
      name: "NPD v3 lite direct",
      projectNumber: IDS.directLite,
      category: "npd",
      sopTemplateVersion: "2026-07-v3",
      customFields: { npdTemplate: { tier: "lite", packs: ["battery"] } },
      createdBy: OWNER,
    }, "npd", OWNER);

    const db = await getDb();
    const rows = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, IDS.directLite));
    expect(rows).toHaveLength(17);
    expect(rows.map((row) => row.taskId)).toEqual(expect.arrayContaining(["pb1", "pb2", "nle1"]));
    expect(rows.map((row) => row.taskId)).not.toContain("ne3");
    expect(rows.some((row) => row.phaseId === "verification")).toBe(true);
  });

  it("seedProjectPhasesAndTasks 从项目 customFields 读取 lite + cert", async () => {
    const db = await getDb();
    await db!.insert(projects).values({
      id: IDS.secondSeed,
      name: "NPD v3 second seed",
      projectNumber: IDS.secondSeed,
      category: "npd",
      sopTemplateVersion: "2026-07-v3",
      customFields: { npdTemplate: { tier: "lite", packs: ["cert"] } },
      createdBy: OWNER,
    });

    await seedProjectPhasesAndTasks(IDS.secondSeed, "npd", OWNER, "2026-07-v3");
    const rows = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, IDS.secondSeed));
    expect(rows).toHaveLength(17);
    expect(rows.map((row) => row.taskId)).toEqual(expect.arrayContaining(["pc1", "pc2"]));
    expect(rows.find((row) => row.taskId === "pc2")?.phaseId).toBe("verification");
  });

  it("projects.create 固定写入完整 NPD 流程并种 32 项", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD creator", canCreateProject: true },
    } as any);

    await expect(caller.create({
      id: IDS.routerFull,
      name: "NPD fixed full process",
      projectNumber: IDS.routerFull,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      customFields: { source: "router-test" },
    })).resolves.toEqual({ success: true });

    const db = await getDb();
    const [project] = await db!.select().from(projects)
      .where(eq(projects.id, IDS.routerFull));
    const rows = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, IDS.routerFull));
    const phases = await db!.select().from(projectPhases)
      .where(eq(projectPhases.projectId, IDS.routerFull));

    expect(project.sopTemplateVersion).toBe("2026-07-v3");
    expect(project.customFields).toMatchObject({
      source: "router-test",
      npdTemplate: {
        tier: "full",
        packs: ["battery", "cert", "software", "mold"],
        policy: "fixed_full_process",
      },
    });
    expect(rows).toHaveLength(32);
    expect(rows.map((row) => row.taskId)).toEqual(
      expect.arrayContaining(["pb1", "pc1", "ps1", "pmo1"]),
    );
    expect(phases).toHaveLength(7);

    const [log] = await db!.select().from(activityLogs).where(and(
      eq(activityLogs.projectId, IDS.routerFull),
      eq(activityLogs.action, "project.create"),
    ));
    expect(log.meta).toMatchObject({
      npdTemplate: {
        tier: "full",
        packs: ["battery", "cert", "software", "mold"],
        policy: "fixed_full_process",
      },
    });
  });

  it("忽略旧客户端提交的属性问答、精简档位和附加包选择", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD creator", canCreateProject: true },
    } as any);

    await expect(caller.create({
      id: IDS.legacyConfigIgnored,
      name: "NPD legacy config ignored",
      projectNumber: IDS.legacyConfigIgnored,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: {
        hasBattery: false,
        needsCert: false,
        hasFirmware: false,
        needsNewMold: false,
        isNewPlatform: false,
      },
      npdTemplate: { tier: "lite", packs: [] },
    })).resolves.toEqual({ success: true });

    const db = await getDb();
    const [project] = await db!.select().from(projects)
      .where(eq(projects.id, IDS.legacyConfigIgnored));
    const rows = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, IDS.legacyConfigIgnored));

    expect(project.customFields).toMatchObject({
      npdTemplate: {
        tier: "full",
        packs: ["battery", "cert", "software", "mold"],
        policy: "fixed_full_process",
      },
    });
    expect(rows).toHaveLength(32);
  });
});

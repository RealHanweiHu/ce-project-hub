import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
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
  routerStandard: `npdv3-router-${SUFFIX}`,
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

  it("projects.create 默认写入 v3、持久化标准档配置并种 25 项", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD v3 creator", canCreateProject: true },
    } as any);
    await expect(caller.create({
      id: IDS.routerStandard,
      name: "NPD v3 router standard",
      projectNumber: IDS.routerStandard,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      customFields: {
        source: "router-test",
        npdTemplate: { tier: "lite", packs: ["battery"] },
      },
      npdTemplate: { tier: "standard", packs: [] },
    })).resolves.toEqual({ success: true });

    const db = await getDb();
    const [project] = await db!.select().from(projects)
      .where(eq(projects.id, IDS.routerStandard));
    const rows = await db!.select().from(projectTasks)
      .where(eq(projectTasks.projectId, IDS.routerStandard));
    expect(project.sopTemplateVersion).toBe("2026-07-v3");
    expect(project.customFields).toMatchObject({
      source: "router-test",
      npdTemplate: { tier: "standard", packs: [] },
    });
    expect(rows).toHaveLength(25);
    const phases = await db!.select().from(projectPhases)
      .where(eq(projectPhases.projectId, IDS.routerStandard));
    expect(phases).toHaveLength(7);
  });
});

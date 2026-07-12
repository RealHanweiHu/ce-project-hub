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
  routerStandard: `npdv3-router-${SUFFIX}`,
  missingLockedPack: `npdv3-lock-${SUFFIX}`,
  missingDowngradeReason: `npdv3-down-${SUFFIX}`,
  missingAttributes: `npdv3-attrs-${SUFFIX}`,
  validDowngrade: `npdv3-audit-${SUFFIX}`,
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
      npdAttributes: {
        hasBattery: false,
        needsCert: false,
        hasFirmware: false,
        needsNewMold: true,
        isNewPlatform: false,
      },
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

  it("含锂电项目缺电池安全包时拒绝创建", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD v3 creator", canCreateProject: true },
    } as any);

    await expect(caller.create({
      id: IDS.missingLockedPack,
      name: "NPD v3 missing battery pack",
      projectNumber: IDS.missingLockedPack,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: {
        hasBattery: true,
        needsCert: false,
        hasFirmware: false,
        needsNewMold: false,
        isNewPlatform: false,
      },
      npdTemplate: { tier: "lite", packs: [] },
    } as any)).rejects.toThrow(/电池安全包/);
  });

  it("推荐 full 却提交 lite 且无降档理由时拒绝创建", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD v3 creator", canCreateProject: true },
    } as any);

    await expect(caller.create({
      id: IDS.missingDowngradeReason,
      name: "NPD v3 missing downgrade reason",
      projectNumber: IDS.missingDowngradeReason,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: {
        hasBattery: true,
        needsCert: true,
        hasFirmware: false,
        needsNewMold: false,
        isNewPlatform: false,
      },
      npdTemplate: { tier: "lite", packs: ["battery", "cert"] },
    } as any)).rejects.toThrow(/降档.*理由/);
  });

  it("NPD 创建缺少项目属性问答时拒绝创建", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD v3 creator", canCreateProject: true },
    } as any);

    await expect(caller.create({
      id: IDS.missingAttributes,
      name: "NPD v3 missing attributes",
      projectNumber: IDS.missingAttributes,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdTemplate: { tier: "standard", packs: [] },
    })).rejects.toThrow(/项目属性/);
  });

  it("有理由降档时持久化推荐差异并写入创建活动审计", async () => {
    const caller = projectsRouter.createCaller({
      user: { id: OWNER, role: "member", name: "NPD v3 creator", canCreateProject: true },
    } as any);
    const downgradeReason = "沿用已量产平台，经负责人确认后降档";
    const attributes = {
      hasBattery: false,
      needsCert: false,
      hasFirmware: false,
      needsNewMold: false,
      isNewPlatform: true,
    };

    await expect(caller.create({
      id: IDS.validDowngrade,
      name: "NPD v3 audited downgrade",
      projectNumber: IDS.validDowngrade,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      progress: 0,
      npdAttributes: attributes,
      npdTemplate: { tier: "lite", packs: [] },
      npdTemplateDowngradeReason: downgradeReason,
    })).resolves.toEqual({ success: true });

    const db = await getDb();
    const [project] = await db!.select().from(projects)
      .where(eq(projects.id, IDS.validDowngrade));
    expect(project.customFields).toMatchObject({
      npdTemplate: {
        tier: "lite",
        packs: [],
        recommended: { tier: "full" },
        attributes,
        downgradeReason,
      },
    });

    const [log] = await db!.select().from(activityLogs).where(and(
      eq(activityLogs.projectId, IDS.validDowngrade),
      eq(activityLogs.action, "project.create"),
    ));
    expect(log.meta).toMatchObject({
      npdTemplate: {
        tier: "lite",
        recommended: { tier: "full" },
        attributes,
        downgradeReason,
      },
    });
  });
});

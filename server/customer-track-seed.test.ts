import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, createProjectWithSeed, getProjectById } from "./db";
import { getPhasesForCategory, getReleaseGatePhase } from "../shared/sop-templates";

// 钉死客户委托轨（JDM/OBT）的建项 seed 链路：
//   1) currentPhase 归位到该 category 真实首阶段（即便调用方沿用默认 "concept"）
//   2) project_phases / project_tasks 按 category 阶段集正确 seed
//   3) MP Release 前置 Gate 落在 PVT，且强制客户签核交付物

const JDM_PRJ = "ctseed_jdm";
const OBT_PRJ = "ctseed_obt";

async function cleanup() {
  const db = await getDb(); if (!db) return;
  const { sql } = await import("drizzle-orm");
  for (const prj of [JDM_PRJ, OBT_PRJ]) {
    await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${prj}`);
    await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${prj}`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${prj}`);
  }
}
beforeAll(cleanup);
afterAll(cleanup);

async function countRows(table: "project_phases" | "project_tasks", projectId: string): Promise<number> {
  const db = await getDb(); if (!db) return 0;
  const { sql } = await import("drizzle-orm");
  const tbl = sql.raw(table);
  const res = await db.execute(sql`SELECT COUNT(*)::int AS n FROM ${tbl} WHERE "projectId" = ${projectId}`);
  // drizzle execute returns rows in .rows (pg) — be defensive across drivers
  const rows = (res as { rows?: Array<{ n: number }> }).rows ?? (res as unknown as Array<{ n: number }>);
  return Number(rows[0]?.n ?? 0);
}

const expectedTaskCount = (cat: string) =>
  getPhasesForCategory(cat).reduce((sum, p) => sum + p.tasks.length, 0);

describe("客户委托轨 建项 seed", () => {
  beforeAll(async () => {
    const db = await getDb(); if (!db) return;
    // 模拟非 UI 调用方：沿用默认 currentPhase="concept"（该值在 jdm/obt 不存在）
    await createProjectWithSeed(
      { id: JDM_PRJ, name: "委托设计项目", projectNumber: "J1", category: "jdm", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "jdm", 1,
    );
    await createProjectWithSeed(
      { id: OBT_PRJ, name: "转产导入项目", projectNumber: "O1", category: "obt", risk: "low", currentPhase: "concept", progress: 0, createdBy: 1, pmUserId: 2 } as any,
      "obt", 1,
    );
  });

  it("currentPhase 归位到 category 首阶段（jdm→input / obt→intake）", async () => {
    const db = await getDb(); if (!db) return;
    const jdm = await getProjectById(JDM_PRJ);
    const obt = await getProjectById(OBT_PRJ);
    expect(jdm?.currentPhase).toBe("input");
    expect(obt?.currentPhase).toBe("intake");
  });

  it("project_phases / project_tasks 按 category 阶段集 seed", async () => {
    const db = await getDb(); if (!db) return;
    expect(await countRows("project_phases", JDM_PRJ)).toBe(getPhasesForCategory("jdm").length);
    expect(await countRows("project_phases", OBT_PRJ)).toBe(getPhasesForCategory("obt").length);
    expect(await countRows("project_tasks", JDM_PRJ)).toBe(expectedTaskCount("jdm"));
    expect(await countRows("project_tasks", OBT_PRJ)).toBe(expectedTaskCount("obt"));
  });

  it("MP Release 前置 Gate 落在 PVT 且强制客户签核交付物", () => {
    const jdmGate = getReleaseGatePhase("jdm");
    const obtGate = getReleaseGatePhase("obt");
    expect(jdmGate?.id).toBe("pvt");
    expect(obtGate?.id).toBe("pvt");
    // 客户签核以「必交付物」落地：readiness 引擎读 gateStandard.requiredDeliverables
    expect(jdmGate?.gateStandard.requiredDeliverables).toContain("客户 golden sample 签样记录");
    expect(obtGate?.gateStandard.requiredDeliverables).toContain("客户放行记录");
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, applyGrandfatherExemptions, getProjectEffectiveProcess } from "./db";
import { projects, projectDeliverableOverrides } from "../drizzle/schema";
import { computeGrandfatherExemptions, passedPhaseIds } from "../shared/gate-tightening";
import { getPhasesForCategory } from "../shared/sop-templates";

const PROJECT = `grandfather-${Date.now()}`;
const REASON = "存量豁免测试";

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  // NPD 项目停在 mp（design/pvt 都已过会）
  await db.insert(projects).values({
    id: PROJECT, name: "grandfather", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "mp", createdBy: 987001,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
});

describe("grandfather 豁免落库", () => {
  it("写入豁免后，已过会阶段(pvt)的有效提交集不再含被豁免的电池硬证据", async () => {
    const order = getPhasesForCategory("npd").map((p) => p.id);
    const ex = computeGrandfatherExemptions({
      projectId: PROJECT, category: "npd",
      passedPhaseIds: passedPhaseIds(order, "mp"),
    });
    const inserted = await applyGrandfatherExemptions(ex, REASON, 0);
    expect(inserted).toBeGreaterThan(0);

    const eff = await getProjectEffectiveProcess(PROJECT);
    const pvt = eff!.phases.find((p) => p.id === "pvt")!;
    expect(pvt.submittedDeliverables).not.toContain("UN38.3运输测试报告或复用确认");
    expect(pvt.submittedDeliverables).not.toContain("MSDS");
    // 未过会/未收紧的普通项仍在（没被误删）
    expect(pvt.submittedDeliverables).toContain("良率报告");
  });

  it("幂等：再次应用不重复插入", async () => {
    const order = getPhasesForCategory("npd").map((p) => p.id);
    const ex = computeGrandfatherExemptions({
      projectId: PROJECT, category: "npd",
      passedPhaseIds: passedPhaseIds(order, "mp"),
    });
    const again = await applyGrandfatherExemptions(ex, REASON, 0);
    expect(again).toBe(0);
  });

  it("豁免记录带 reason（审计痕迹）", async () => {
    const db = await getDb();
    const rows = await db!.select().from(projectDeliverableOverrides)
      .where(eq(projectDeliverableOverrides.projectId, PROJECT));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.action === "remove" && r.reason === REASON)).toBe(true);
  });
});

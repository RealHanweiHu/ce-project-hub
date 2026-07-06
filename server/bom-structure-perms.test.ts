import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { bomItems, projectMembers, projects } from "../drizzle/schema";
import { bomRouter } from "./routers/bom";

/**
 * 工程师 BOM 结构编辑权（canEditBomStructure）：EE/ME 是 EBOM 的作者——
 * 料号/规格/数量/位号是设计决策，必须能自己录；成本与供应商是 SCM 的商业
 * 字段，结构权不能碰（含通过 update 清空既有成本）。
 * SCM/管理路径（canEditProjectInfo | canEditChangelog）保持全字段可编辑。
 */
const PROJ = `bom-struct-${Date.now()}`;
const OWNER = 975001;
const HW = 975002;   // rd_hw：结构可编，商业字段禁止
const ME = 975003;   // rd_mech
const SCM = 975004;  // 全字段
const QA = 975005;   // 无 BOM 编辑权

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: `u${id}`, email: null, canCreateProject: false,
    mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
    passwordHash: null, username: null,
  },
});
const caller = (id: number) => bomRouter.createCaller(makeCtx(id) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PROJ, name: "BOM 结构权", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER, pmUserId: OWNER,
  });
  await db!.insert(projectMembers).values([
    { projectId: PROJ, userId: HW, role: "rd_hw", invitedBy: OWNER },
    { projectId: PROJ, userId: ME, role: "rd_mech", invitedBy: OWNER },
    { projectId: PROJ, userId: SCM, role: "scm", invitedBy: OWNER },
    { projectId: PROJ, userId: QA, role: "qa", invitedBy: OWNER },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(bomItems).where(eq(bomItems.projectId, PROJ));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
});

describe("工程师 BOM 结构编辑权", () => {
  it("rd_hw 可新增结构行（料号/规格/数量）", async () => {
    const r = await caller(HW).add({
      projectId: PROJ,
      line: { name: "充电 IC", partNumber: "IP2312", spec: "QFN-16", quantity: 1, refDesignator: "U3" },
    });
    expect(r.id).toBeGreaterThan(0);
  });

  it("rd_mech 可更新结构字段并删除行", async () => {
    const { id } = await caller(ME).add({ projectId: PROJ, line: { name: "泵体", quantity: 1 } });
    await expect(caller(ME).update({ id, patch: { quantity: 2, spec: "ABS+GF10" } })).resolves.toEqual({ ok: true });
    await expect(caller(ME).delete({ id })).resolves.toEqual({ ok: true });
  });

  it("rd_hw 新增时不能带成本/供应商", async () => {
    await expect(caller(HW).add({
      projectId: PROJ,
      line: { name: "电芯", unitCost: "12.50" },
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(HW).add({
      projectId: PROJ,
      line: { name: "电芯", supplierName: "某供应商" },
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rd_hw 不能通过 update 写或清空商业字段", async () => {
    const { id } = await caller(SCM).add({
      projectId: PROJ,
      line: { name: "马达", unitCost: "8.00", supplierName: "电机厂" },
    });
    await expect(caller(HW).update({ id, patch: { unitCost: "1.00" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 带空字符串的商业字段会静默清掉 SCM 录的成本——同样禁止
    await expect(caller(HW).update({ id, patch: { unitCost: "", quantity: 3 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // 纯结构 patch 不受影响
    await expect(caller(HW).update({ id, patch: { quantity: 3 } })).resolves.toEqual({ ok: true });
    const db = await getDb();
    const [row] = await db!.select().from(bomItems).where(eq(bomItems.id, id));
    expect(row.unitCost).toBe("8.00"); // 成本未被动过
  });

  it("SCM 仍可编辑商业字段；QA 仍无编辑权", async () => {
    const { id } = await caller(SCM).add({ projectId: PROJ, line: { name: "线材", unitCost: "0.80" } });
    await expect(caller(SCM).update({ id, patch: { unitCost: "0.75", supplierName: "线材厂" } })).resolves.toEqual({ ok: true });
    await expect(caller(QA).add({ projectId: PROJ, line: { name: "测试治具" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

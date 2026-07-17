import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  bomItems,
  keyModules,
  projectMembers,
  projects,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { bomRouter } from "./routers/bom";

const SUFFIX = Date.now().toString(36);
const PROJECT_ID = `bom-bulk-${SUFFIX}`;
const MODULE_ID = `km-bom-bulk-${SUFFIX}`;
const SCM_ID = 986001;
const ENGINEER_ID = 986002;
let moduleCreatorId = 0;

const makeCtx = (id: number) => ({
  user: {
    id,
    role: "user",
    name: `u${id}`,
    email: null,
    canCreateProject: false,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
    passwordHash: null,
    username: null,
  },
});

const caller = (id = SCM_ID) => bomRouter.createCaller(makeCtx(id) as never);
type BulkUpsertInput = Parameters<ReturnType<typeof caller>["bulkUpsert"]>[0];

async function previewAndApply(
  input: Omit<
    BulkUpsertInput,
    "dryRun" | "expectedBomDigest" | "expectedBomDigestVersion"
  >,
  userId = SCM_ID,
) {
  const api = caller(userId);
  const preview = await api.bulkUpsert({ ...input, dryRun: true });
  return api.bulkUpsert({
    ...input,
    dryRun: false,
    expectedBomDigest: preview.bomDigest,
    expectedBomDigestVersion: preview.bomDigestVersion,
  });
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");

  const [creator] = await db.insert(users).values({
    openId: `bom-bulk-module-creator-${SUFFIX}`,
    username: `bom-bulk-module-creator-${SUFFIX}`,
    name: "BOM Bulk Module Creator",
  }).returning({ id: users.id });
  moduleCreatorId = creator.id;

  await db.insert(projects).values({
    id: PROJECT_ID,
    name: "BOM 批量导入",
    projectNumber: PROJECT_ID,
    category: "npd",
    risk: "low",
    currentPhase: "design",
    createdBy: SCM_ID,
    pmUserId: SCM_ID,
  });
  await db.insert(projectMembers).values([
    { projectId: PROJECT_ID, userId: SCM_ID, role: "scm", invitedBy: SCM_ID },
    { projectId: PROJECT_ID, userId: ENGINEER_ID, role: "rd_hw", invitedBy: SCM_ID },
  ]);
  await db.insert(keyModules).values({
    id: MODULE_ID,
    moduleNumber: `BAT-BULK-${SUFFIX}`,
    moduleType: "battery_energy",
    name: "受控电池模块",
    category: "test",
    createdBy: moduleCreatorId,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT_ID));
  await db.delete(projects).where(eq(projects.id, PROJECT_ID));
  await db.delete(keyModules).where(eq(keyModules.id, MODULE_ID));
  await db.delete(users).where(eq(users.id, moduleCreatorId));
});

async function clearBom() {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.delete(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
}

describe.sequential("BOM bulkUpsert", () => {
  it("previews a merge without writing rows", async () => {
    await clearBom();
    const result = await caller().bulkUpsert({
      projectId: PROJECT_ID,
      mode: "merge",
      dryRun: true,
      lines: [
        { lineNumber: 10, partNumber: "PN-001", name: "外壳", quantity: 1 },
        { lineNumber: 20, partNumber: "PN-002", name: "线束", quantity: 2 },
      ],
    });

    expect(result).toMatchObject({
      dryRun: true,
      mode: "merge",
      inserted: 2,
      updated: 0,
      deleted: 0,
      preservedControlled: 0,
    });
    expect(result.bomDigestVersion).toBe(1);
    expect(result.bomDigest).toMatch(/^[a-f0-9]{64}$/);
    const db = await getDb();
    expect(await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID))).toEqual([]);
  });

  it("requires an exact preview token and rejects a stale token after concurrent editing", async () => {
    await clearBom();
    const input = {
      projectId: PROJECT_ID,
      mode: "merge" as const,
      lines: [{ partNumber: "PN-PREVIEW", name: "预览物料", quantity: 1 }],
    };
    await expect(caller().bulkUpsert(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const preview = await caller().bulkUpsert({ ...input, dryRun: true });
    await caller().add({
      projectId: PROJECT_ID,
      line: { partNumber: "PN-CONCURRENT", name: "并发新增", quantity: 1 },
    });

    await expect(caller().bulkUpsert({
      ...input,
      dryRun: false,
      expectedBomDigest: preview.bomDigest,
      expectedBomDigestVersion: preview.bomDigestVersion,
    })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("重新预览"),
    });

    const db = await getDb();
    const rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows.map((row) => row.partNumber)).toEqual(["PN-CONCURRENT"]);
  });

  it("merges by part number and records deterministic line order", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      name: "旧名称",
      partNumber: "PN-001",
      quantity: 1,
      sortOrder: 99,
    });

    const result = await previewAndApply({
      projectId: PROJECT_ID,
      mode: "merge",
      lines: [
        { lineNumber: 10, partNumber: "PN-001", name: "新名称", quantity: 3 },
        { lineNumber: 20, partNumber: "PN-002", name: "线束", quantity: 2 },
      ],
    });

    expect(result).toMatchObject({ inserted: 1, updated: 1, deleted: 0 });
    const rows = await db!.select().from(bomItems)
      .where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.partNumber === "PN-001")).toMatchObject({
      name: "新名称",
      quantity: 3,
      sortOrder: 10,
    });
  });

  it("updates a large matching set through the batch merge path", async () => {
    await clearBom();
    const db = await getDb();
    const count = 250;
    await db!.insert(bomItems).values(Array.from({ length: count }, (_, index) => ({
      projectId: PROJECT_ID,
      partNumber: `BATCH-${String(index).padStart(4, "0")}`,
      name: `旧物料 ${index}`,
      quantity: 1,
    })));

    const result = await previewAndApply({
      projectId: PROJECT_ID,
      mode: "merge",
      lines: Array.from({ length: count }, (_, index) => ({
        lineNumber: index + 2,
        partNumber: `BATCH-${String(index).padStart(4, "0")}`,
        name: `新物料 ${index}`,
        quantity: 2,
      })),
    });

    expect(result).toMatchObject({ inserted: 0, updated: count });
    const rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows).toHaveLength(count);
    expect(rows.every((row) => row.quantity === 2 && row.name.startsWith("新物料"))).toBe(true);
  });

  it("allows a blank part number when ref-designator is present and merges by that fallback key", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      name: "旧位号物料",
      partNumber: "",
      refDesignator: "U1",
      quantity: 1,
    });

    const result = await previewAndApply({
      projectId: PROJECT_ID,
      mode: "merge",
      lines: [{ lineNumber: 10, partNumber: "", refDesignator: "u1", name: "新位号物料", quantity: 2 }],
    });

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    const rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "新位号物料", quantity: 2, refDesignator: "u1" });
  });

  it("replaces ordinary rows but preserves controlled key-module rows", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values([
      { projectId: PROJECT_ID, name: "旧普通物料", partNumber: "OLD-001" },
      {
        projectId: PROJECT_ID,
        name: "受控电池模块",
        partNumber: "BAT-CONTROLLED",
        keyModuleId: MODULE_ID,
        keyModuleSnapshot: { moduleNumber: `BAT-BULK-${SUFFIX}` },
      },
    ]);

    const result = await previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [{ lineNumber: 10, partNumber: "NEW-001", name: "新普通物料", quantity: 1 }],
    });

    expect(result).toMatchObject({ inserted: 1, updated: 0, deleted: 1, preservedControlled: 1 });
    const rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows.map((row) => row.partNumber).sort()).toEqual(["BAT-CONTROLLED", "NEW-001"]);
    expect(rows.find((row) => row.keyModuleId === MODULE_ID)).toBeDefined();
  });

  it("preserves PLM-only component links when replace input omits them", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      name: "已关联零部件",
      partNumber: "LINKED-001",
      componentProductId: "component-product-1",
      componentRevisionId: 42,
    });

    await previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [{ partNumber: "LINKED-001", name: "导入后的名称", quantity: 2 }],
    });

    const [row] = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(row).toMatchObject({
      name: "导入后的名称",
      componentProductId: "component-product-1",
      componentRevisionId: 42,
    });
  });

  it("prevents new ordinary duplicates but lets replace clean legacy duplicates", async () => {
    await clearBom();
    const first = await caller().add({
      projectId: PROJECT_ID,
      line: { partNumber: "DUP-001", name: "第一行", quantity: 1 },
    });
    await expect(caller().add({
      projectId: PROJECT_ID,
      line: { partNumber: "dup-001", name: "重复行", quantity: 1 },
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const db = await getDb();
    const [second] = await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      partNumber: "DUP-002",
      name: "第二身份",
    }).returning({ id: bomItems.id });
    await expect(caller().update({
      id: second.id,
      patch: { partNumber: "DUP-001" },
    })).rejects.toMatchObject({ code: "CONFLICT" });

    await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      partNumber: "dup-001",
      name: "历史重复脏行",
    });
    await expect(previewAndApply({
      projectId: PROJECT_ID,
      mode: "merge",
      lines: [{ partNumber: "DUP-001", name: "合并", quantity: 1 }],
    })).rejects.toMatchObject({ code: "CONFLICT" });

    await previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [{ partNumber: "DUP-001", name: "清理后唯一行", quantity: 1 }],
    });
    const rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ partNumber: "DUP-001", name: "清理后唯一行" });
    expect(first.id).toBeGreaterThan(0);
  });

  it("rejects the whole sheet for duplicate line numbers, duplicate materials, or non-positive quantity", async () => {
    await clearBom();
    const duplicateLines = [
      { lineNumber: 10, partNumber: "PN-A", name: "A", quantity: 1 },
      { lineNumber: 10, partNumber: "PN-B", name: "B", quantity: 1 },
    ];
    await expect(previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: duplicateLines,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(caller().bulkUpsert({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [
        { lineNumber: 10, partNumber: " pn-a ", name: "A", quantity: 1 },
        { lineNumber: 20, partNumber: "PN-A", name: "A2", quantity: 1 },
      ],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(caller().bulkUpsert({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [{ lineNumber: 10, partNumber: "PN-Z", name: "Z", quantity: 0 }],
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    for (const unitCost of ["-1", "abc"]) {
      await expect(caller().bulkUpsert({
        projectId: PROJECT_ID,
        mode: "replace",
        lines: [{ lineNumber: 10, partNumber: "PN-COST", name: "非法单价", quantity: 1, unitCost }],
      })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }

    const db = await getDb();
    expect(await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID))).toEqual([]);
  });

  it("rejects an import that conflicts with a controlled module and leaves all existing rows unchanged", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values([
      { projectId: PROJECT_ID, name: "普通物料", partNumber: "KEEP-001" },
      {
        projectId: PROJECT_ID,
        name: "受控电池模块",
        partNumber: "BAT-CONTROLLED",
        keyModuleId: MODULE_ID,
        keyModuleSnapshot: { moduleNumber: `BAT-BULK-${SUFFIX}` },
      },
    ]);

    await expect(previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [{ lineNumber: 10, partNumber: "BAT-CONTROLLED", name: "试图覆盖", quantity: 1 }],
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows.map((row) => row.partNumber).sort()).toEqual(["BAT-CONTROLLED", "KEEP-001"]);
  });

  it("prevents ordinary update/delete from changing a controlled module row", async () => {
    await clearBom();
    const db = await getDb();
    const [controlled] = await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      name: "受控电池模块",
      partNumber: "BAT-CONTROLLED",
      keyModuleId: MODULE_ID,
      keyModuleSnapshot: { moduleNumber: `BAT-BULK-${SUFFIX}` },
      supplierName: "原供应商",
    }).returning({ id: bomItems.id });

    await expect(caller().update({
      id: controlled.id,
      patch: { name: "篡改模块", quantity: 5 },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller().delete({ id: controlled.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // 商业字段不改变模块定义，具备完整 BOM 权限的角色仍可维护。
    await expect(caller().update({
      id: controlled.id,
      patch: { supplierName: "新供应商", unitCost: "12.30" },
    })).resolves.toEqual({ ok: true });

    const [row] = await db!.select().from(bomItems)
      .where(and(eq(bomItems.projectId, PROJECT_ID), eq(bomItems.id, controlled.id)));
    expect(row).toMatchObject({
      name: "受控电池模块",
      quantity: 1,
      supplierName: "新供应商",
      unitCost: "12.30",
    });
  });

  it("applies the same commercial-field restriction to engineer bulk imports", async () => {
    await clearBom();
    await expect(previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [{
        lineNumber: 10,
        partNumber: "PN-COST",
        name: "带成本物料",
        quantity: 1,
        unitCost: "9.99",
      }],
    }, ENGINEER_ID)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("preserves blank commercial columns for full-rights merge and replace imports", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      partNumber: "PN-SCM-PRESERVE",
      name: "旧名称",
      supplierName: "已确认供应商",
      unitCost: "88.20",
    });

    await previewAndApply({
      projectId: PROJECT_ID,
      mode: "merge",
      lines: [{
        partNumber: "PN-SCM-PRESERVE",
        name: "合并后名称",
        quantity: 2,
        supplierName: "   ",
        unitCost: "",
      }],
    });
    let rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows[0]).toMatchObject({
      name: "合并后名称",
      supplierName: "已确认供应商",
      unitCost: "88.20",
    });

    await previewAndApply({
      projectId: PROJECT_ID,
      mode: "replace",
      lines: [
        { partNumber: "PN-SCM-PRESERVE", name: "替换后名称", quantity: 3 },
        { partNumber: "PN-SCM-NEW", name: "新物料", quantity: 1 },
      ],
    });
    rows = await db!.select().from(bomItems).where(eq(bomItems.projectId, PROJECT_ID));
    expect(rows.find((row) => row.partNumber === "PN-SCM-PRESERVE")).toMatchObject({
      name: "替换后名称",
      supplierName: "已确认供应商",
      unitCost: "88.20",
    });
    expect(rows.find((row) => row.partNumber === "PN-SCM-NEW")).toMatchObject({
      supplierName: "",
      unitCost: "",
    });
  });

  it("does not let a technical-only merge erase existing SCM data", async () => {
    await clearBom();
    const db = await getDb();
    await db!.insert(bomItems).values({
      projectId: PROJECT_ID,
      partNumber: "PN-PRESERVE-COMMERCIALS",
      name: "旧技术名称",
      supplierName: "已确认供应商",
      unitCost: "21.50",
    });

    await previewAndApply({
      projectId: PROJECT_ID,
      mode: "merge",
      lines: [{
        lineNumber: 10,
        partNumber: "PN-PRESERVE-COMMERCIALS",
        name: "新技术名称",
        quantity: 2,
      }],
    }, ENGINEER_ID);

    const [row] = await db!.select().from(bomItems)
      .where(and(
        eq(bomItems.projectId, PROJECT_ID),
        eq(bomItems.partNumber, "PN-PRESERVE-COMMERCIALS"),
      ));
    expect(row).toMatchObject({
      name: "新技术名称",
      quantity: 2,
      supplierName: "已确认供应商",
      unitCost: "21.50",
    });
  });
});

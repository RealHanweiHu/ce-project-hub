import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { bomItems, productRevisions, products, projectMembers, projects } from "../drizzle/schema";
import { bomRouter } from "./routers/bom";

/**
 * 冻结 BOM 结构「产品库全员可读」只应覆盖内部员工：纯外部账号（所有项目角色
 * 均为 external_customer/supplier）不得读取任意 revision 的 BOM 结构（料号/
 * 规格/数量本身就是竞争情报），whereUsed/diff 同理。
 * 内外混合账号（在任一项目有内部角色）与零成员内部员工保持可读（脱敏商业字段）。
 */
const PRODUCT = `bom-ext-prod-${Date.now()}`;
const PROJ_A = `bom-ext-a-${Date.now()}`;
const PROJ_B = `bom-ext-b-${Date.now()}`;
const OWNER = 973001;
const EXT_ONLY = 973002;   // 仅 external_customer
const SUP_ONLY = 973003;   // 仅 supplier
const MIXED = 973004;      // A 项目 external_customer + B 项目 rd_hw
const NO_MEMBER = 973005;  // 无任何项目成员身份的内部员工
let revisionId: number;

const makeCtx = (id: number, role = "user") => ({
  user: {
    id, role, name: `u${id}`, email: null, canCreateProject: false,
    mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
    passwordHash: null, username: null,
  },
});
const caller = (id: number, role = "user") => bomRouter.createCaller(makeCtx(id, role) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(products).values({ id: PRODUCT, name: "外部账号隔离产品", category: "npd" as never, createdBy: OWNER });
  const [rev] = await db!.insert(productRevisions).values({
    productId: PRODUCT, revisionLabel: "A", status: "released",
  }).returning();
  revisionId = rev.id;
  await db!.insert(projects).values([
    { id: PROJ_A, name: "A", projectNumber: PROJ_A, category: "npd", risk: "low", currentPhase: "design", createdBy: OWNER, productId: PRODUCT },
    { id: PROJ_B, name: "B", projectNumber: PROJ_B, category: "npd", risk: "low", currentPhase: "design", createdBy: OWNER },
  ]);
  await db!.insert(projectMembers).values([
    { projectId: PROJ_A, userId: EXT_ONLY, role: "external_customer", invitedBy: OWNER },
    { projectId: PROJ_A, userId: SUP_ONLY, role: "supplier", invitedBy: OWNER },
    { projectId: PROJ_A, userId: MIXED, role: "external_customer", invitedBy: OWNER },
    { projectId: PROJ_B, userId: MIXED, role: "rd_hw", invitedBy: OWNER },
  ]);
  await db!.insert(bomItems).values({
    revisionId, projectId: null, partNumber: "PN-9", name: "泵体", spec: "ABS",
    quantity: 1, refDesignator: "", supplierName: "机密供应商", unitCost: "3.20", sortOrder: 0,
  });
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(bomItems).where(eq(bomItems.revisionId, revisionId));
  await db!.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT));
  await db!.delete(projectMembers).where(inArray(projectMembers.projectId, [PROJ_A, PROJ_B]));
  await db!.delete(projects).where(inArray(projects.id, [PROJ_A, PROJ_B]));
  await db!.delete(products).where(eq(products.id, PRODUCT));
});

describe("冻结 BOM 对纯外部账号关闭", () => {
  it("纯 external_customer 账号不能读冻结 BOM", async () => {
    await expect(caller(EXT_ONLY).frozen({ revisionId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("纯 supplier 账号不能 diff 冻结 BOM", async () => {
    await expect(caller(SUP_ONLY).diff({ revA: revisionId, revB: revisionId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("纯外部账号不能查 whereUsed", async () => {
    await expect(caller(EXT_ONLY).whereUsed({ componentProductId: PRODUCT })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("内外混合账号（另有内部角色）仍可读结构，商业字段脱敏", async () => {
    const rows = await caller(MIXED).frozen({ revisionId });
    expect(rows[0].name).toBe("泵体");
    expect(rows[0].unitCost).toBe("");
    expect(rows[0].supplierName).toBe("");
  });

  it("零成员内部员工保持可读（结构可见、商业脱敏）", async () => {
    const rows = await caller(NO_MEMBER).frozen({ revisionId });
    expect(rows[0].name).toBe("泵体");
    expect(rows[0].unitCost).toBe("");
  });
});

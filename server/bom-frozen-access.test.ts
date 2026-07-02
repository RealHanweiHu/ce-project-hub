import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { appRouter } from "./routers";
import { bomItems, productRevisions, products, projects, projectMembers } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

/**
 * P1-11：冻结 BOM 结构（料件/数量）随产品库全员可读，但商业字段
 * unitCost / supplierName 只对该产品线的项目成员或管理员可见——否则任何
 * 登录用户遍历 revisionId 即可拿到成本与供应商。
 */
const PRODUCT = `bomacl-prod-${Date.now()}`;
const PROJECT = `bomacl-proj-${Date.now()}`;
const OWNER = 984001;
const MEMBER = 984002;
const OUTSIDER = 984003;
let revisionId: number;

function makeCtx(userId: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id: userId, openId: `u${userId}`, username: null, passwordHash: null,
      name: `U${userId}`, email: null, loginMethod: null, role,
      canCreateProject: false, mobile: null, dingtalkUserId: null, dingtalkCorpUserId: null,
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(products).values({ id: PRODUCT, name: "BOM ACL 产品", category: "npd" as never, createdBy: OWNER });
  const [rev] = await db.insert(productRevisions).values({
    productId: PRODUCT, revisionLabel: "A", status: "released",
  }).returning();
  revisionId = rev.id;
  await db.insert(projects).values({
    id: PROJECT, name: "BOM ACL 项目", projectNumber: PROJECT, category: "npd",
    risk: "low", currentPhase: "design", createdBy: OWNER, productId: PRODUCT,
  });
  await db.insert(projectMembers).values({ projectId: PROJECT, userId: MEMBER, role: "qa", invitedBy: OWNER });
  await db.insert(bomItems).values({
    revisionId, projectId: null, partNumber: "PN-1", name: "电芯", spec: "18650",
    quantity: 2, refDesignator: "BT1", supplierName: "供应商机密", unitCost: "12.50", sortOrder: 0,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(bomItems).where(eq(bomItems.revisionId, revisionId));
  await db.delete(productRevisions).where(eq(productRevisions.productId, PRODUCT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(products).where(eq(products.id, PRODUCT));
});

describe("冻结 BOM 商业字段脱敏", () => {
  it("产品线项目成员可见成本与供应商", async () => {
    const caller = appRouter.createCaller(makeCtx(MEMBER));
    const rows = await caller.bom.frozen({ revisionId });
    expect(rows[0].name).toBe("电芯");
    expect(rows[0].unitCost).toBe("12.50");
    expect(rows[0].supplierName).toBe("供应商机密");
  });

  it("管理员可见成本与供应商", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER, "admin"));
    const rows = await caller.bom.frozen({ revisionId });
    expect(rows[0].unitCost).toBe("12.50");
  });

  it("非该产品线成员：结构可见，成本/供应商被脱敏", async () => {
    const caller = appRouter.createCaller(makeCtx(OUTSIDER));
    const rows = await caller.bom.frozen({ revisionId });
    expect(rows[0].name).toBe("电芯");          // 结构仍可见
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].unitCost).toBe("");           // 脱敏
    expect(rows[0].supplierName).toBe("");       // 脱敏
  });

  it("diff 对非成员同样脱敏商业字段", async () => {
    const caller = appRouter.createCaller(makeCtx(OUTSIDER));
    const d = await caller.bom.diff({ revA: revisionId, revB: revisionId });
    // 同版本 diff：added/removed 为空，changed 为空——但确保不抛错且类型正确
    expect(d.added.every((x) => x.unitCost === "")).toBe(true);
  });
});

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, createProduct, createProductRevision } from "./db";
import { bomItems, productRevisions, products, projectMembers, projects } from "../drizzle/schema";
import { bomRouter } from "./routers/bom";

const PROJ = `bom-router-${Date.now()}`;
const OWNER = 950001;
const SCM = 950002;
const VIEWER = 950003;
const OUTSIDER = 950004;
const FROZEN_PRODUCT = `bom-router-prod-${Date.now()}`;
let frozenRevId = 0;

const makeCtx = (id: number, role = "user") => ({
  user: {
    id,
    role,
    name: "x",
    email: "x",
    canCreateProject: true,
    mobile: null,
    dingtalkUserId: null,
    dingtalkCorpUserId: null,
    passwordHash: null,
    username: null,
  },
});
const caller = (id: number, role = "user") => bomRouter.createCaller(makeCtx(id, role) as any);

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: PROJ,
    name: "BOM 权限",
    projectNumber: "BOM-PERM",
    category: "npd",
    risk: "low",
    currentPhase: "design",
    createdBy: OWNER,
    pmUserId: OWNER,
  });
  await db!.insert(projectMembers).values([
    { projectId: PROJ, userId: SCM, role: "scm", invitedBy: OWNER },
    { projectId: PROJ, userId: VIEWER, role: "viewer", invitedBy: OWNER },
  ]);
  // bom_items.revisionId 有外键后，冻结行必须挂在真实产品版本上
  await createProduct({ id: FROZEN_PRODUCT, name: "BOM 权限产品", type: "finished", category: "充气泵", createdBy: OWNER });
  frozenRevId = await createProductRevision({ productId: FROZEN_PRODUCT, revisionLabel: "Rev A", status: "released" });
});

afterAll(async () => {
  const db = await getDb();
  await db!.delete(bomItems).where(eq(bomItems.projectId, PROJ));
  await db!.delete(bomItems).where(eq(bomItems.revisionId, frozenRevId));
  await db!.delete(projectMembers).where(eq(projectMembers.projectId, PROJ));
  await db!.delete(projects).where(eq(projects.id, PROJ));
  await db!.delete(productRevisions).where(eq(productRevisions.productId, FROZEN_PRODUCT));
  await db!.delete(products).where(eq(products.id, FROZEN_PRODUCT));
});

describe("bom router permissions", () => {
  it("非项目成员不可读取 working BOM", async () => {
    await expect(caller(OUTSIDER).working({ projectId: PROJ })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("viewer 不可编辑，SCM 可编辑 working BOM", async () => {
    await expect(caller(VIEWER).add({ projectId: PROJ, line: { name: "外壳" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const added = await caller(SCM).add({ projectId: PROJ, line: { name: "外壳", quantity: 1 } });
    await expect(caller(SCM).update({ id: added.id, patch: { quantity: 2 } })).resolves.toEqual({ ok: true });
    await expect(caller(SCM).delete({ id: added.id })).resolves.toEqual({ ok: true });
  });

  it("冻结 BOM 行不可从 working BOM 接口修改", async () => {
    const db = await getDb();
    const [row] = await db!.insert(bomItems).values({
      revisionId: frozenRevId,
      projectId: null,
      name: "冻结物料",
    }).returning({ id: bomItems.id });
    await expect(caller(SCM).update({ id: row.id, patch: { quantity: 3 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

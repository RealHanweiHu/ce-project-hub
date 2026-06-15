/**
 * 统一需求池数据层测试:
 * - projectId 可空(纯产品/全局 backlog)
 * - getRequirements 的三种过滤口径:project(并集) / product / global
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createProjectRequirement,
  getRequirements,
  getRequirementById,
  deleteProjectRequirement,
  getDb,
} from "./db";
import { projectRequirements } from "../drizzle/schema";
import { inArray } from "drizzle-orm";

const SUFFIX = Date.now();
const PROD = `prod-${SUFFIX}`;
const PROJ_A = `projA-${SUFFIX}`;
const PROJ_B = `projB-${SUFFIX}`;
const ids: number[] = [];

beforeAll(async () => {
  // 1) 本项目A提出
  ids.push(await createProjectRequirement({ projectId: PROJ_A, productId: PROD, title: "A-raised", creatorId: 1 }));
  // 2) 本产品待承接(无项目)
  ids.push(await createProjectRequirement({ projectId: null, productId: PROD, title: "product-backlog", creatorId: 1 }));
  // 3) 另一个项目B承接(同产品但已归属B)
  ids.push(await createProjectRequirement({ projectId: PROJ_B, productId: PROD, title: "B-owned", creatorId: 1 }));
  // 4) 纯全局(无项目无产品)
  ids.push(await createProjectRequirement({ projectId: null, productId: null, title: "global-idea", creatorId: 1 }));
});

afterAll(async () => {
  const db = await getDb();
  if (db && ids.length) await db.delete(projectRequirements).where(inArray(projectRequirements.id, ids));
});

const titles = (rows: { title: string }[]) => rows.map((r) => r.title).sort();

describe("unified requirement pool", () => {
  it("允许 projectId 为空(产品/全局 backlog)", async () => {
    const r = await getRequirementById(ids[1]);
    expect(r?.projectId).toBeNull();
    expect(r?.productId).toBe(PROD);
  });

  it("project 视图 = 本项目提出 ∪ 本产品待承接(不含他项目已承接)", async () => {
    const rows = await getRequirements({ scope: "project", projectId: PROJ_A, productId: PROD });
    const t = titles(rows);
    expect(t).toContain("A-raised");
    expect(t).toContain("product-backlog");
    expect(t).not.toContain("B-owned");
    expect(t).not.toContain("global-idea");
  });

  it("project 视图 productId 为空时只看本项目", async () => {
    const rows = await getRequirements({ scope: "project", projectId: PROJ_A, productId: null });
    expect(titles(rows)).toEqual(["A-raised"]);
  });

  it("product 视图 = 该产品全部(含他项目已承接)", async () => {
    const rows = await getRequirements({ scope: "product", productId: PROD });
    const t = titles(rows);
    expect(t).toContain("A-raised");
    expect(t).toContain("product-backlog");
    expect(t).toContain("B-owned");
    expect(t).not.toContain("global-idea");
  });

  it("global 视图包含全部(含无产品的)", async () => {
    const rows = await getRequirements({ scope: "global" });
    const t = titles(rows);
    for (const x of ["A-raised", "product-backlog", "B-owned", "global-idea"]) expect(t).toContain(x);
  });
});

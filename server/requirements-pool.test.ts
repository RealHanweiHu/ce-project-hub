/**
 * 统一需求池数据层测试:
 * - projectId 可空(纯产品/全局 backlog)
 * - getRequirements 的三种过滤口径:project(并集) / product / global
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createProjectRequirement,
  createProjectIssue,
  deleteProjectIssue,
  adoptAndLinkRequirement,
  getRequirements,
  getRequirementById,
  deleteProjectRequirement,
  getDb,
} from "./db";
import { appRouter } from "./routers";
import { activityLogs, projectIssues, projectRequirements, projects } from "../drizzle/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { TrpcContext } from "./_core/context";

const SUFFIX = Date.now();
const PROD = `prod-${SUFFIX}`;
const PROJ_A = `projA-${SUFFIX}`;
const PROJ_B = `projB-${SUFFIX}`;
const VALUE_PROJECT = `value-${SUFFIX}`;
const OWNER = 880001;
const ids: number[] = [];
const convertedIssueIds: number[] = [];

function makeCtx(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `test-user-${userId}`,
      username: null,
      passwordHash: null,
      name: `TestUser${userId}`,
      email: null,
      loginMethod: null,
      role: "user",
      canCreateProject: false,
      mobile: null,
      dingtalkUserId: null,
      dingtalkCorpUserId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

beforeAll(async () => {
  const db = await getDb();
  await db!.insert(projects).values({
    id: VALUE_PROJECT,
    name: "价值链路项目",
    projectNumber: VALUE_PROJECT,
    category: "npd",
    risk: "low",
    currentPhase: "concept",
    createdBy: OWNER,
    value: "目标销量 10 万台 / 毛利 >= 35%",
    description: "验证低噪便携充气泵方案",
  });
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
  if (db) await db.delete(activityLogs).where(eq(activityLogs.projectId, VALUE_PROJECT));
  if (db && convertedIssueIds.length) await db.delete(projectIssues).where(inArray(projectIssues.id, convertedIssueIds));
  if (db && ids.length) await db.delete(projectRequirements).where(inArray(projectRequirements.id, ids));
  if (db) await db.delete(projects).where(eq(projects.id, VALUE_PROJECT));
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

  it("采纳转化为问题:创建问题 + 需求归属目标项目并回链", async () => {
    // 取「本产品待承接」那条(无项目),转化到 PROJ_A
    const reqId = ids[1];
    const issueId = await createProjectIssue({
      projectId: PROJ_A, phaseId: "concept", title: "from-req", severity: "P1", category: "other", creatorId: 1,
    });
    await adoptAndLinkRequirement(reqId, {
      projectId: PROJ_A, status: "accepted", convertedType: "issue", convertedId: String(issueId),
    });
    const r = await getRequirementById(reqId);
    expect(r?.projectId).toBe(PROJ_A);
    expect(r?.status).toBe("accepted");
    expect(r?.convertedType).toBe("issue");
    expect(r?.convertedId).toBe(String(issueId));
    await deleteProjectIssue(issueId);
  });

  it("项目内创建需求继承并维护价值链路字段", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    const result = await caller.requirements.create({
      projectId: VALUE_PROJECT,
      title: "低噪模式",
      successMetric: "1m 距离噪音 <= 58dBA",
    });
    ids.push(result.id);

    let row = await getRequirementById(result.id);
    expect(row?.businessGoal).toBe("目标销量 10 万台 / 毛利 >= 35%");
    expect(row?.projectGoal).toBe("验证低噪便携充气泵方案");
    expect(row?.successMetric).toBe("1m 距离噪音 <= 58dBA");

    await caller.requirements.update({
      id: result.id,
      patch: {
        businessGoal: "北美渠道高端款溢价",
        projectGoal: "完成低噪风道方案收敛",
        successMetric: "DVT 噪音测试通过",
      },
    });

    row = await getRequirementById(result.id);
    expect(row?.businessGoal).toBe("北美渠道高端款溢价");
    expect(row?.projectGoal).toBe("完成低噪风道方案收敛");
    expect(row?.successMetric).toBe("DVT 噪音测试通过");
  });

  it("通过业务 convert 创建问题时产生 canonical issue.create", async () => {
    const caller = appRouter.createCaller(makeCtx(OWNER));
    const created = await caller.requirements.create({
      projectId: VALUE_PROJECT,
      title: "需求转问题 canonical",
      priority: "P1",
    });
    ids.push(created.id);
    const converted = await caller.requirements.convert({
      id: created.id,
      projectId: VALUE_PROJECT,
      phaseId: "concept",
      target: "issue",
    });
    convertedIssueIds.push(Number(converted.convertedId));

    const db = await getDb();
    const [canonical] = await db!.select().from(activityLogs).where(and(
      eq(activityLogs.projectId, VALUE_PROJECT),
      eq(activityLogs.action, "issue.create"),
      eq(activityLogs.entityId, converted.convertedId),
    ));
    expect(canonical?.meta).toMatchObject({
      phaseId: "concept",
      severity: "P1",
      source: "requirement.convert",
      after: { creatorId: OWNER, status: "open", severity: "P1" },
    });
  });
});

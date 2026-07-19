import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  projectGateSignoffAdditions,
  projectGateSignoffRounds,
  projectGateSignoffs,
  projectMembers,
  projects,
} from "../drizzle/schema";
import { SOP_TEMPLATE_VERSION_CURRENT } from "../shared/sop-templates";
import { getDb } from "./db";
import { gateReviewsRouter } from "./routers/gateReviews";

const PROJECT = `jdm-owner-signoff-${Date.now()}`;
const COMPLETED_PROJECT = `jdm-sign-done-${Date.now()}`;
const PRODUCT_OWNER = 996801;
const OTHER_PM = 996802;

const gates = (userId: number) => gateReviewsRouter.createCaller({
  user: {
    id: userId,
    role: "member",
    name: `u${userId}`,
    canCreateProject: false,
  },
} as any);

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values({
    id: PROJECT,
    name: "JDM 产品负责人签核",
    projectNumber: PROJECT,
    category: "jdm",
    sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
    risk: "low",
    currentPhase: "input",
    createdBy: PRODUCT_OWNER,
    productOwnerUserId: PRODUCT_OWNER,
    customFields: {
      projectExecutionBaseline: {
        modelVersion: "project-track-v1",
        status: "draft",
        customerConceptRef: "customer://concept/owner-signoff",
      },
    },
  });
  await db.insert(projects).values({
    id: COMPLETED_PROJECT,
    name: "JDM 已完成 Gate 产品负责人签核",
    projectNumber: COMPLETED_PROJECT,
    category: "jdm",
    sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
    risk: "low",
    currentPhase: "design",
    createdBy: PRODUCT_OWNER,
    productOwnerUserId: PRODUCT_OWNER,
    customFields: {
      projectExecutionBaseline: {
        modelVersion: "project-track-v1",
        status: "frozen",
        productDefinitionRef: "PSD-completed-signoff",
      },
    },
  });
  await db.insert(projectGateSignoffRounds).values({
    projectId: COMPLETED_PROJECT,
    phaseId: "input",
    roundNumber: 1,
    status: "completed",
    requirements: {
      product: "required",
      engineering: "not_applicable",
      qa: "not_applicable",
      scm: "not_applicable",
      npi: "not_applicable",
      certification: "not_applicable",
      customer: "not_applicable",
    },
    riskSnapshot: {
      safetyRiskLevel: "standard",
      regulatoryRiskLevel: "standard",
    },
    sopTemplateVersion: SOP_TEMPLATE_VERSION_CURRENT,
    openedBy: PRODUCT_OWNER,
    completedAt: new Date(),
  });
  await db.insert(projectMembers).values({
    projectId: PROJECT,
    userId: OTHER_PM,
    role: "pm",
    invitedBy: PRODUCT_OWNER,
  });
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectGateSignoffs).where(eq(projectGateSignoffs.projectId, PROJECT));
  await db.delete(projectGateSignoffs).where(eq(projectGateSignoffs.projectId, COMPLETED_PROJECT));
  await db.delete(projectGateSignoffRounds).where(eq(projectGateSignoffRounds.projectId, PROJECT));
  await db.delete(projectGateSignoffRounds).where(eq(projectGateSignoffRounds.projectId, COMPLETED_PROJECT));
  await db.delete(projectGateSignoffAdditions).where(eq(projectGateSignoffAdditions.projectId, PROJECT));
  await db.delete(projectGateSignoffAdditions).where(eq(projectGateSignoffAdditions.projectId, COMPLETED_PROJECT));
  await db.delete(projectMembers).where(eq(projectMembers.projectId, PROJECT));
  await db.delete(projects).where(eq(projects.id, PROJECT));
  await db.delete(projects).where(eq(projects.id, COMPLETED_PROJECT));
});

describe("JDM 产品定义 Gate 产品负责人签核", () => {
  it("指定产品负责人即使没有 pm 成员角色也可以签 product 槽", async () => {
    await expect(gates(PRODUCT_OWNER).sign({
      projectId: PROJECT,
      phaseId: "input",
      slot: "product",
      status: "approved",
      note: "确认产品规格、CSR 与模块基线",
    })).resolves.toMatchObject({ signedBy: PRODUCT_OWNER, status: "approved" });
  });

  it("其他产品经理不能代替指定产品负责人签 JDM P1 product 槽", async () => {
    await expect(gates(OTHER_PM).sign({
      projectId: PROJECT,
      phaseId: "input",
      slot: "product",
      status: "approved",
      note: "尝试代签",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("产品定义 Gate 已完成并进入下一阶段后，不得再为历史轮次写入产品负责人签核", async () => {
    await expect(gates(PRODUCT_OWNER).sign({
      projectId: COMPLETED_PROJECT,
      phaseId: "input",
      slot: "product",
      status: "approved",
      note: "尝试在 Gate 完成后补签",
    })).rejects.toThrow(/当前阶段|已关闭|已推进|历史阶段/);

    const db = await getDb();
    const rows = await db!.select().from(projectGateSignoffs)
      .where(eq(projectGateSignoffs.projectId, COMPLETED_PROJECT));
    expect(rows).toHaveLength(0);
  });
});

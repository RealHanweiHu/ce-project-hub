import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Client } from "pg";
import {
  activityLogs,
  projectMembers,
  projects,
} from "../drizzle/schema";
import {
  type ModuleReuseState,
  type ProductModuleId,
  type ProjectExecutionBaseline,
} from "../shared/project-track-tailoring";
import { getDb, getProjectById } from "./db";
import { projectsRouter } from "./routers/projects";

const SUFFIX = Date.now().toString(36);
const DRAFT_PROJECT = `jdm-draft-${SUFFIX}`;
const NON_JDM_PROJECT = `npd-draft-${SUFFIX}`;
const WRONG_PHASE_PROJECT = `jdm-phase-${SUFFIX}`;
const FROZEN_PROJECT = `jdm-frozen-${SUFFIX}`;
const RACE_PROJECT = `jdm-race-${SUFFIX}`;
const ALL_PROJECTS = [
  DRAFT_PROJECT,
  NON_JDM_PROJECT,
  WRONG_PHASE_PROJECT,
  FROZEN_PROJECT,
  RACE_PROJECT,
];

const CREATOR = 997101;
const PRODUCT_OWNER = 997102;
const PROJECT_MANAGER = 997103;
const VIEWER = 997104;

const allNotReused: Record<ProductModuleId, ModuleReuseState> = {
  battery: "not_reused",
  core_function: "not_reused",
  electronics: "not_reused",
  software_connectivity: "not_reused",
  structure_mold: "not_reused",
  id_cmf: "not_reused",
};

const caller = (userId: number) => projectsRouter.createCaller({
  user: {
    id: userId,
    role: "member",
    name: `u${userId}`,
    canCreateProject: false,
  },
} as any);

function draftBaseline(conceptRef: string): ProjectExecutionBaseline {
  return {
    modelVersion: "project-track-v1",
    status: "draft",
    customerConceptRef: conceptRef,
  };
}

function definitionInput(projectId: string) {
  return {
    projectId,
    productDefinitionRef: `PSD-${projectId}`,
    moduleReuse: { ...allNotReused },
    reuseEvidence: {},
  };
}

async function waitForAdvisoryLockWaiter(client: Client) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await client.query<{ waiting: number }>(`
      select count(distinct waiting.pid)::int as waiting
      from pg_locks held
      join pg_locks waiting
        on waiting.locktype = held.locktype
       and waiting.database is not distinct from held.database
       and waiting.classid is not distinct from held.classid
       and waiting.objid is not distinct from held.objid
       and waiting.objsubid is not distinct from held.objsubid
      where held.pid = pg_backend_pid()
        and held.locktype = 'advisory'
        and held.granted
        and not waiting.granted
    `);
    if (Number(result.rows[0]?.waiting ?? 0) >= 1) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Expected a JDM draft-save advisory-lock waiter");
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values([
    {
      id: DRAFT_PROJECT,
      name: "JDM 定义草稿",
      projectNumber: DRAFT_PROJECT,
      category: "jdm",
      risk: "low",
      currentPhase: "input",
      createdBy: CREATOR,
      productOwnerUserId: PRODUCT_OWNER,
      customFields: {
        untouched: "keep-me",
        projectExecutionBaseline: draftBaseline("customer://original-concept"),
      },
    },
    {
      id: NON_JDM_PROJECT,
      name: "非 JDM",
      projectNumber: NON_JDM_PROJECT,
      category: "npd",
      risk: "low",
      currentPhase: "input",
      createdBy: CREATOR,
      productOwnerUserId: PRODUCT_OWNER,
      customFields: {
        projectExecutionBaseline: draftBaseline("customer://non-jdm"),
      },
    },
    {
      id: WRONG_PHASE_PROJECT,
      name: "JDM 已进入设计",
      projectNumber: WRONG_PHASE_PROJECT,
      category: "jdm",
      risk: "low",
      currentPhase: "design",
      createdBy: CREATOR,
      productOwnerUserId: PRODUCT_OWNER,
      customFields: {
        projectExecutionBaseline: draftBaseline("customer://wrong-phase"),
      },
    },
    {
      id: FROZEN_PROJECT,
      name: "JDM 已冻结",
      projectNumber: FROZEN_PROJECT,
      category: "jdm",
      risk: "low",
      currentPhase: "input",
      createdBy: CREATOR,
      productOwnerUserId: PRODUCT_OWNER,
      customFields: {
        projectExecutionBaseline: {
          ...draftBaseline("customer://frozen"),
          status: "frozen",
          productDefinitionRef: "PSD-frozen",
          moduleReuse: allNotReused,
          reuseEvidence: {},
          frozenAt: "2026-07-15T16:00:00.000Z",
          frozenBy: PRODUCT_OWNER,
        },
      },
    },
    {
      id: RACE_PROJECT,
      name: "JDM 草稿与 Gate 竞态",
      projectNumber: RACE_PROJECT,
      category: "jdm",
      risk: "low",
      currentPhase: "input",
      createdBy: CREATOR,
      productOwnerUserId: PRODUCT_OWNER,
      customFields: {
        projectExecutionBaseline: draftBaseline("customer://race-original"),
      },
    },
  ]);
  await db.insert(projectMembers).values([
    {
      projectId: DRAFT_PROJECT,
      userId: PROJECT_MANAGER,
      role: "project_manager",
      invitedBy: CREATOR,
    },
    {
      projectId: DRAFT_PROJECT,
      userId: VIEWER,
      role: "viewer",
      invitedBy: CREATOR,
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(activityLogs).where(inArray(activityLogs.projectId, ALL_PROJECTS));
  await db.delete(projectMembers).where(inArray(projectMembers.projectId, ALL_PROJECTS));
  await db.delete(projects).where(inArray(projects.id, ALL_PROJECTS));
});

describe("JDM 产品定义草稿专用保存 API", () => {
  it("产品负责人可保存草稿，同时保留客户原始概念与其它自定义字段", async () => {
    await caller(PRODUCT_OWNER).saveJdmDefinitionDraft({
      ...definitionInput(DRAFT_PROJECT),
      customerConceptRef: "customer://malicious-override",
      frozenAt: "2099-01-01T00:00:00.000Z",
      frozenBy: VIEWER,
    } as any);

    const project = await getProjectById(DRAFT_PROJECT);
    expect(project?.customFields).toMatchObject({
      untouched: "keep-me",
      projectExecutionBaseline: {
        modelVersion: "project-track-v1",
        status: "draft",
        customerConceptRef: "customer://original-concept",
        productDefinitionRef: `PSD-${DRAFT_PROJECT}`,
        moduleReuse: allNotReused,
        reuseEvidence: {},
      },
    });
    const baseline = project?.customFields?.projectExecutionBaseline as Record<string, unknown>;
    expect(baseline).not.toHaveProperty("frozenAt");
    expect(baseline).not.toHaveProperty("frozenBy");

    const db = await getDb();
    const logs = await db!.select().from(activityLogs)
      .where(eq(activityLogs.projectId, DRAFT_PROJECT));
    expect(logs).toContainEqual(expect.objectContaining({
      action: "project.jdm_definition_draft.save",
      userId: PRODUCT_OWNER,
    }));
  });

  it("具有 canEditProjectInfo 权限的项目经理也可保存草稿", async () => {
    await expect(caller(PROJECT_MANAGER).saveJdmDefinitionDraft({
      ...definitionInput(DRAFT_PROJECT),
      productDefinitionRef: "PSD-saved-by-project-manager",
    })).resolves.toMatchObject({ success: true });

    const project = await getProjectById(DRAFT_PROJECT);
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({
      status: "draft",
      productDefinitionRef: "PSD-saved-by-project-manager",
      customerConceptRef: "customer://original-concept",
    });
  });

  it("定义收敛期允许先保存复用判断，再逐步补齐复用证据", async () => {
    await expect(caller(PRODUCT_OWNER).saveJdmDefinitionDraft({
      ...definitionInput(DRAFT_PROJECT),
      productDefinitionRef: "",
      moduleReuse: {
        ...allNotReused,
        battery: "reused",
      },
      reuseEvidence: {
        battery: {
          sourceRef: "",
          modelOrVersion: "",
          evidenceRef: "",
          boundaryConfirmed: false,
        },
      },
    })).resolves.toMatchObject({ success: true });

    const project = await getProjectById(DRAFT_PROJECT);
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({
      status: "draft",
      productDefinitionRef: "",
      moduleReuse: { battery: "reused" },
      reuseEvidence: {
        battery: {
          sourceRef: "",
          modelOrVersion: "",
          evidenceRef: "",
          boundaryConfirmed: false,
        },
      },
    });
  });

  it("无 canEditProjectInfo 权限的成员不能保存草稿", async () => {
    await expect(caller(VIEWER).saveJdmDefinitionDraft(
      definitionInput(DRAFT_PROJECT),
    )).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("拒绝 ID/CMF 不复用但结构/模具复用的草稿", async () => {
    const before = await getProjectById(DRAFT_PROJECT);

    await expect(caller(PRODUCT_OWNER).saveJdmDefinitionDraft({
      ...definitionInput(DRAFT_PROJECT),
      moduleReuse: {
        ...allNotReused,
        structure_mold: "reused",
        id_cmf: "not_reused",
      },
      reuseEvidence: {
        structure_mold: {
          sourceRef: "product://structure-base",
          modelOrVersion: "STRUCT-V1",
          evidenceRef: "evidence://structure-v1",
          boundaryConfirmed: true,
        },
      },
    })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/ID\/CMF|结构|模具/),
    });

    const after = await getProjectById(DRAFT_PROJECT);
    expect(after?.customFields?.projectExecutionBaseline)
      .toEqual(before?.customFields?.projectExecutionBaseline);
  });

  it.each([
    [NON_JDM_PROJECT, /JDM/],
    [WRONG_PHASE_PROJECT, /input|产品定义|阶段/],
    [FROZEN_PROJECT, /冻结|草稿/],
  ])("项目 %s 不满足草稿编辑边界时拒绝保存", async (projectId, message) => {
    await expect(caller(PRODUCT_OWNER).saveJdmDefinitionDraft(
      definitionInput(projectId),
    )).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(message),
    });
  });

  it("等待 input 阶段锁期间 Gate 已冻结时，锁内重读会拒绝旧草稿覆盖", async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await blocker.query("select pg_advisory_lock(hashtext($1))", [`${RACE_PROJECT}:input`]);

    const save = caller(PRODUCT_OWNER).saveJdmDefinitionDraft({
      ...definitionInput(RACE_PROJECT),
      productDefinitionRef: "PSD-stale-save",
    });
    const saveOutcome = save.then(
      value => ({ value, error: null }),
      error => ({ value: null, error }),
    );
    try {
      await waitForAdvisoryLockWaiter(blocker);
      const frozenBaseline: ProjectExecutionBaseline = {
        modelVersion: "project-track-v1",
        status: "frozen",
        customerConceptRef: "customer://race-original",
        productDefinitionRef: "PSD-frozen-by-gate",
        moduleReuse: allNotReused,
        reuseEvidence: {},
        frozenAt: "2026-07-15T18:00:00.000Z",
        frozenBy: PRODUCT_OWNER,
      };
      await blocker.query(
        `update projects
         set "currentPhase" = 'design',
             "customFields" = jsonb_set("customFields", '{projectExecutionBaseline}', $2::jsonb, true)
         where id = $1`,
        [RACE_PROJECT, JSON.stringify(frozenBaseline)],
      );
    } finally {
      await blocker.query("select pg_advisory_unlock(hashtext($1))", [`${RACE_PROJECT}:input`]);
      await blocker.end();
    }

    const outcome = await saveOutcome;
    expect(outcome.error).toMatchObject({ code: "BAD_REQUEST" });
    expect(outcome.value).toBeNull();
    const project = await getProjectById(RACE_PROJECT);
    expect(project).toMatchObject({ currentPhase: "design" });
    expect(project?.customFields?.projectExecutionBaseline).toMatchObject({
      status: "frozen",
      productDefinitionRef: "PSD-frozen-by-gate",
    });
    const db = await getDb();
    const logs = await db!.select().from(activityLogs).where(eq(activityLogs.projectId, RACE_PROJECT));
    expect(logs.filter(log => log.action === "project.jdm_definition_draft.save")).toHaveLength(0);
  });
});

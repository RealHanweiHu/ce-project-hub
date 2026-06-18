/**
 * 裁剪服务层直接测试（DB-backed）
 *
 * 覆盖：
 * 1. approve → tasks skipped + getApprovedTailoringSets 包含阶段
 * 2. reject  → tasks 不变   + getApprovedTailoringSets 不包含阶段
 * 3. revoke  → tasks 恢复为 todo + set 不含阶段
 * 4. revoke 后仍被另一条已批准裁剪覆盖的任务保持 skipped
 * 5. setDeliverableOverride add → listDeliverableOverrides 可见；clear → 删除
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb,
  createProjectWithSeed,
  createProjectTailoringRequest,
  reviewProjectTailoring,
  revokeProjectTailoring,
  getApprovedTailoringSets,
  listProjectTailoring,
  listDeliverableOverrides,
  setDeliverableOverride,
} from "./db";
import {
  projects,
  projectPhases,
  projectTasks,
  projectTailoring,
  projectDeliverableOverrides,
} from "../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { getReleaseGatePhase } from "../shared/sop-templates";

// ─── 唯一项目 ID（避免并发污染） ───────────────────────────────────────────
const PROJ = `tsvc-${Date.now()}`;
const U = 700001; // 任意虚构用户 id（不依赖 users 表 FK）

// concept 阶段真实任务：c1..c6（见 shared/sop-templates.ts）
// design 阶段真实任务：d1..d8
// 测试用阶段：concept（包含 c1）

async function getTaskStatus(projectId: string, phaseId: string, taskId: string) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  const rows = await db
    .select({ status: projectTasks.status })
    .from(projectTasks)
    .where(
      and(
        eq(projectTasks.projectId, projectId),
        eq(projectTasks.phaseId, phaseId),
        eq(projectTasks.taskId, taskId),
      ),
    )
    .limit(1);
  return rows[0]?.status ?? null;
}

beforeAll(async () => {
  // createProjectWithSeed 插入项目 + 全部 phases + 全部 tasks（SOP 模板）
  await createProjectWithSeed(
    {
      id: PROJ,
      name: "裁剪服务测试",
      projectNumber: `TSVC-${Date.now()}`,
      category: "npd",
      risk: "low",
      currentPhase: "concept",
      createdBy: U,
    },
    "npd",
    U,
  );
});

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  // 清理顺序：子表 → 主表
  await db.delete(projectDeliverableOverrides).where(eq(projectDeliverableOverrides.projectId, PROJ));
  await db.delete(projectTailoring).where(eq(projectTailoring.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

// ─── 测试 1：approve → tasks skipped ──────────────────────────────────────
describe("1. 批准裁剪 → 阶段任务全部变 skipped", () => {
  it("approve phase 裁剪后 concept 阶段所有任务 status='skipped'", async () => {
    const id = await createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "customer_id",
      reasonNote: "自动化测试",
      targets: [{ scope: "phase", phaseId: "concept" }],
      proposedBy: U,
    });
    expect(id).toBeGreaterThan(0);

    await reviewProjectTailoring({ id, decision: "approved", reviewedBy: U });

    // 验证：concept 阶段全部任务 skipped
    const db = await getDb();
    if (!db) throw new Error("no db");
    const tasks = await db
      .select({ taskId: projectTasks.taskId, status: projectTasks.status })
      .from(projectTasks)
      .where(
        and(
          eq(projectTasks.projectId, PROJ),
          eq(projectTasks.phaseId, "concept"),
        ),
      );
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.status, `concept/${task.taskId} 应为 skipped`).toBe("skipped");
    }

    // 验证 getApprovedTailoringSets 包含此阶段
    const sets = await getApprovedTailoringSets(PROJ);
    expect(sets.tailoredPhaseIds.has("concept")).toBe(true);
  });
});

// ─── 测试 2：reject → 无效果 ────────────────────────────────────────────────
describe("2. 拒绝裁剪 → 任务状态不变", () => {
  it("reject design 裁剪后 design 任务不变 & set 不包含 design", async () => {
    // design 阶段入口依赖规划 Gate；自动状态可能是 blocked，拒绝裁剪后应保持不变。
    const statusBefore = await getTaskStatus(PROJ, "design", "d1");
    expect(statusBefore).toBeTruthy();

    const id = await createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "reuse_mature",
      targets: [{ scope: "phase", phaseId: "design" }],
      proposedBy: U,
    });
    await reviewProjectTailoring({ id, decision: "rejected", reviewedBy: U });

    const statusAfter = await getTaskStatus(PROJ, "design", "d1");
    expect(statusAfter).toBe(statusBefore);

    const sets = await getApprovedTailoringSets(PROJ);
    expect(sets.tailoredPhaseIds.has("design")).toBe(false);
  });
});

// ─── 测试 3：revoke → 恢复为 todo ──────────────────────────────────────────
describe("3. 撤销裁剪 → 任务恢复为 todo", () => {
  it("approve 后 revoke → planning 任务回到 todo，set 不含 planning", async () => {
    const id = await createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "other",
      reasonNote: "测试撤销",
      targets: [{ scope: "phase", phaseId: "planning" }],
      proposedBy: U,
    });
    await reviewProjectTailoring({ id, decision: "approved", reviewedBy: U });

    // 验证 planning 阶段已经 skipped
    const sets1 = await getApprovedTailoringSets(PROJ);
    expect(sets1.tailoredPhaseIds.has("planning")).toBe(true);
    const statusSkipped = await getTaskStatus(PROJ, "planning", "p1");
    expect(statusSkipped).toBe("skipped");

    // 撤销
    await revokeProjectTailoring({ id, reviewedBy: U, reviewNote: "测试撤销" });

    // 验证恢复
    const sets2 = await getApprovedTailoringSets(PROJ);
    expect(sets2.tailoredPhaseIds.has("planning")).toBe(false);
    const statusRestored = await getTaskStatus(PROJ, "planning", "p1");
    expect(statusRestored).toBe("todo");
  });
});

// ─── 测试 4：revoke 后另一条批准裁剪仍覆盖的任务保持 skipped ───────────────
describe("4. revoke 后被另一条已批准裁剪覆盖的任务保持 skipped", () => {
  it("phase 裁剪 + task 裁剪同覆盖 evt/e1；revoke phase 裁剪后 e1 仍 skipped", async () => {
    // 裁剪 1：phase 级别，覆盖整个 evt 阶段（包含 e1）
    const id1 = await createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "customer_id",
      targets: [{ scope: "phase", phaseId: "evt" }],
      proposedBy: U,
    });
    await reviewProjectTailoring({ id: id1, decision: "approved", reviewedBy: U });

    // 裁剪 2：task 级别，单独覆盖 evt/e1（与裁剪1重叠）
    const id2 = await createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "reuse_mature",
      targets: [{ scope: "task", phaseId: "evt", taskId: "e1" }],
      proposedBy: U,
    });
    await reviewProjectTailoring({ id: id2, decision: "approved", reviewedBy: U });

    // 验证 e1 当前 skipped
    expect(await getTaskStatus(PROJ, "evt", "e1")).toBe("skipped");

    // 撤销 phase 级裁剪（id1）
    await revokeProjectTailoring({ id: id1, reviewedBy: U });

    // e1 仍被 task 裁剪（id2）覆盖，应保持 skipped
    expect(await getTaskStatus(PROJ, "evt", "e1")).toBe("skipped");

    // 其他 evt 任务（e2）不再被覆盖，应恢复 todo
    expect(await getTaskStatus(PROJ, "evt", "e2")).toBe("todo");
  });
});

// ─── 测试 5：deliverable override CRUD ────────────────────────────────────
describe("5. deliverable override CRUD", () => {
  it("add → 出现在 list；clear → 删除", async () => {
    // "市场调研报告" 在 npd 资源库中（概念阶段交付物），节点 planning
    const deliverableName = "市场调研报告";
    const nodePhaseId = "planning";

    await setDeliverableOverride({
      projectId: PROJ,
      nodePhaseId,
      deliverableName,
      action: "add",
      createdBy: U,
    });

    const list1 = await listDeliverableOverrides(PROJ);
    const found = list1.find(
      (r) => r.nodePhaseId === nodePhaseId && r.deliverableName === deliverableName,
    );
    expect(found).toBeDefined();
    expect(found?.action).toBe("add");

    // clear → 删除
    await setDeliverableOverride({
      projectId: PROJ,
      nodePhaseId,
      deliverableName,
      action: "clear",
      createdBy: U,
    });

    const list2 = await listDeliverableOverrides(PROJ);
    const gone = list2.find(
      (r) => r.nodePhaseId === nodePhaseId && r.deliverableName === deliverableName,
    );
    expect(gone).toBeUndefined();
  });

  it("remove action 持久化后可 list", async () => {
    const deliverableName = "立项申请书";
    const nodePhaseId = "planning";

    await setDeliverableOverride({
      projectId: PROJ,
      nodePhaseId,
      deliverableName,
      action: "remove",
      createdBy: U,
    });

    const list = await listDeliverableOverrides(PROJ);
    const found = list.find(
      (r) => r.nodePhaseId === nodePhaseId && r.deliverableName === deliverableName,
    );
    expect(found?.action).toBe("remove");

    // 清理
    await setDeliverableOverride({
      projectId: PROJ,
      nodePhaseId,
      deliverableName,
      action: "clear",
      createdBy: U,
    });
  });
});

describe("6. Release Gate 裁剪防护", () => {
  it("拒绝裁剪 MP Release 阶段", async () => {
    const releasePhase = getReleaseGatePhase("npd");
    expect(releasePhase?.isReleaseGate).toBe(true);

    await expect(createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "other",
      reasonNote: "不能跳过发布闸口",
      targets: [{ scope: "phase", phaseId: releasePhase!.id }],
      proposedBy: U,
    })).rejects.toThrow("MP Release 阶段不可裁剪");
  });

  it("拒绝裁剪 MP Release Gate 任务", async () => {
    const releasePhase = getReleaseGatePhase("npd");
    expect(releasePhase?.isReleaseGate).toBe(true);
    expect(releasePhase?.gateTaskId).toBeTruthy();

    await expect(createProjectTailoringRequest({
      projectId: PROJ,
      reasonType: "other",
      reasonNote: "不能跳过发布闸口任务",
      targets: [{ scope: "task", phaseId: releasePhase!.id, taskId: releasePhase!.gateTaskId }],
      proposedBy: U,
    })).rejects.toThrow("MP Release Gate 任务不可裁剪");
  });

  it("审批时也复核 Release Gate 裁剪,防止绕过创建入口", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");
    const releasePhase = getReleaseGatePhase("npd");
    expect(releasePhase?.isReleaseGate).toBe(true);

    const [row] = await db.insert(projectTailoring).values({
      projectId: PROJ,
      reasonType: "other",
      reasonNote: "bypass create guard",
      targets: [{ scope: "phase", phaseId: releasePhase!.id }],
      proposedBy: U,
      status: "pending",
    }).returning({ id: projectTailoring.id });

    await expect(reviewProjectTailoring({
      id: row.id,
      decision: "approved",
      reviewedBy: U,
    })).rejects.toThrow("MP Release 阶段不可裁剪");
  });
});

/**
 * DRV 流程策略应用：重置范围必须限定在"等级发生变化的模块"所影响的任务。
 * - 重放同策略 = no-op，不得重置已完成任务
 * - 只改无关模块不得重置其它模块的已完成任务
 * - 改动相关模块时才重置该模块的已完成任务（范围重划，需要重做）
 * - 已完成任务被策略裁掉时，在返回结果中单列告知
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  applyDerivativeReuseStrategyToProject, upsertProjectTask, getProjectTasks, getDb,
  getProjectEffectiveProcess, listDeliverableOverrides, setDeliverableOverride,
} from "./db";
import { applyProjectSchedule, rescheduleProjectFromTask } from "./services/schedule-service";
import { DERIVATIVE_AUTO_EXEMPT_REASON } from "../shared/derivative-deliverable-tailoring";
import { projects, projectTasks, projectPhases } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const PROJ = `drv-strategy-test-${Date.now()}`;
const BATCH_PROJ = `drv-strategy-batch-${Date.now()}`;

const DEFAULTS: Record<string, string> = {
  battery: "adapt_verify",
  mechanism: "adapt_verify",
  pcba_power: "light_modify",
  firmware: "adapt_verify",
  structure_mold: "light_modify",
  packaging_cert: "direct_reuse",
};

async function taskStatus(taskId: string): Promise<string | undefined> {
  const tasks = await getProjectTasks(PROJ);
  return tasks.find((t) => t.taskId === taskId)?.status;
}

beforeAll(async () => {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.insert(projects).values([
    {
      id: PROJ, name: "DRV策略测试", projectNumber: PROJ, category: "derivative",
      risk: "low", currentPhase: "iteration", createdBy: 1,
    },
    {
      id: BATCH_PROJ, name: "DRV批量写入测试", projectNumber: BATCH_PROJ, category: "derivative",
      risk: "low", currentPhase: "iteration", createdBy: 1,
    },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  if (db) {
    for (const projectId of [PROJ, BATCH_PROJ]) {
      await db.delete(projectTasks).where(eq(projectTasks.projectId, projectId));
      await db.delete(projectPhases).where(eq(projectPhases.projectId, projectId));
      await db.delete(projects).where(eq(projects.id, projectId));
    }
  }
});

describe("applyDerivativeReuseStrategyToProject 重置范围", () => {
  it("初次应用默认策略埋点全量任务", async () => {
    const result = await applyDerivativeReuseStrategyToProject(PROJ, DEFAULTS, 1);
    expect(result.effectiveTasks).toBe(37);
    expect(result.skippedTasks).toBe(0);
  });

  it("重放同策略不重置已完成任务", async () => {
    await upsertProjectTask(PROJ, "design", "dd1", { status: "done", updatedBy: 1 });
    await applyDerivativeReuseStrategyToProject(PROJ, DEFAULTS, 1);
    expect(await taskStatus("dd1")).toBe("done");
  });

  it("只改无关模块（packaging_cert）不重置电池模块的已完成任务", async () => {
    await applyDerivativeReuseStrategyToProject(PROJ, { ...DEFAULTS, packaging_cert: "adapt_verify" }, 1);
    expect(await taskStatus("dd1")).toBe("done");
  });

  it("改动相关模块（battery 升级为 redevelop）时重置该模块的已完成任务", async () => {
    await applyDerivativeReuseStrategyToProject(
      PROJ, { ...DEFAULTS, packaging_cert: "adapt_verify", battery: "redevelop" }, 1
    );
    expect(await taskStatus("dd1")).toBe("todo");
  });

  it("已完成任务被策略裁掉时在结果中单列", async () => {
    await upsertProjectTask(PROJ, "design", "dd1", { status: "done", updatedBy: 1 });
    const result = await applyDerivativeReuseStrategyToProject(
      PROJ, { ...DEFAULTS, packaging_cert: "adapt_verify", battery: "direct_reuse" }, 1
    );
    expect(await taskStatus("dd1")).toBe("skipped");
    expect(result.completedSkippedTasks).toContain("dd1");
  });

  it("排期按有效任务收缩：全 direct_reuse 时 dd6 紧跟 di6，不被被裁任务的幽灵工期撑大", async () => {
    const db = await getDb();
    await db!.update(projects).set({ startDate: "2026-01-05" }).where(eq(projects.id, PROJ));
    const allDirect = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, "direct_reuse"]));
    await applyDerivativeReuseStrategyToProject(PROJ, allDirect, 1);
    await applyProjectSchedule(PROJ);

    const tasks = await getProjectTasks(PROJ);
    const di6 = tasks.find((t) => t.taskId === "di6")!;
    const dd6 = tasks.find((t) => t.taskId === "dd6")!;
    expect(di6.dueDate).toBeTruthy();
    // 依赖收缩后 dd6 直接接在 di6 之后；旧行为会等 dd1-dd5/dd9 的幽灵工期（晚 ~13 个工作日）
    expect(dd6.startDate).toBe(di6.dueDate);
  });

  it("策略自动豁免交付物：structure=direct_reuse 后 DVT 有效提交集不含 T1/T2 模具项，override 带自动理由", async () => {
    await applyDerivativeReuseStrategyToProject(PROJ, { ...DEFAULTS, structure_mold: "direct_reuse" }, 1);
    const eff = await getProjectEffectiveProcess(PROJ);
    const dvt = eff!.phases.find((p) => p.id === "dvt")!;
    expect(dvt.submittedDeliverables).not.toContain("T1试模报告");
    expect(dvt.submittedDeliverables).not.toContain("T2/修模验证报告");
    expect(dvt.submittedDeliverables).not.toContain("限度样本");
    const overrides = await listDeliverableOverrides(PROJ);
    const auto = overrides.find((o) => o.nodePhaseId === "dvt" && o.deliverableName === "T1试模报告");
    expect(auto?.action).toBe("remove");
    expect(auto?.reason).toBe(DERIVATIVE_AUTO_EXEMPT_REASON);
  });

  it("策略回调后自动豁免撤销：structure 恢复 light_modify，T1 试模报告重新必交", async () => {
    await applyDerivativeReuseStrategyToProject(PROJ, DEFAULTS, 1);
    const eff = await getProjectEffectiveProcess(PROJ);
    const dvt = eff!.phases.find((p) => p.id === "dvt")!;
    expect(dvt.submittedDeliverables).toContain("T1试模报告");
    const overrides = await listDeliverableOverrides(PROJ);
    expect(overrides.find((o) => o.deliverableName === "T1试模报告")).toBeUndefined();
  });

  it("PM 手动豁免不被策略应用清除，手动加回不被自动豁免覆盖", async () => {
    // 手动豁免一个整机级交付物（自动豁免永远不会碰它）
    await setDeliverableOverride({
      projectId: PROJ, nodePhaseId: "evt", deliverableName: "新旧版本对比报告",
      action: "remove", createdBy: 1, reason: "客户书面豁免",
    });
    await applyDerivativeReuseStrategyToProject(PROJ, { ...DEFAULTS, structure_mold: "direct_reuse" }, 1);
    const overrides = await listDeliverableOverrides(PROJ);
    const manual = overrides.find((o) => o.deliverableName === "新旧版本对比报告");
    expect(manual?.action).toBe("remove");
    expect(manual?.reason).toBe("客户书面豁免");
    // 手动 add 一个会被自动豁免的目标 → 尊重手动，不改成 remove
    await setDeliverableOverride({
      projectId: PROJ, nodePhaseId: "dvt", deliverableName: "T2/修模验证报告",
      action: "add", createdBy: 1,
    });
    await applyDerivativeReuseStrategyToProject(PROJ, { ...DEFAULTS, structure_mold: "direct_reuse" }, 1);
    const after = await listDeliverableOverrides(PROJ);
    expect(after.find((o) => o.deliverableName === "T2/修模验证报告")?.action).toBe("add");
  });

  it("全模块直接复用：PVT 安全/认证锚点仍在有效提交集", async () => {
    const allDirect = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, "direct_reuse"]));
    await applyDerivativeReuseStrategyToProject(PROJ, allDirect, 1);
    const eff = await getProjectEffectiveProcess(PROJ);
    const pvt = eff!.phases.find((p) => p.id === "pvt")!;
    for (const anchor of ["UN38.3运输测试报告或复用确认", "MSDS", "电芯/电池包安全认证报告或复用确认", "EOL 100%测试能力验收记录"]) {
      expect(pvt.submittedDeliverables, anchor).toContain(anchor);
    }
    // 恢复默认策略，清理本组测试的策略残留
    await applyDerivativeReuseStrategyToProject(PROJ, DEFAULTS, 1);
  });

  it("重排联动不断链：di6 延期后，前置全被裁的 dd6 跟着后移", async () => {
    const tasks = await getProjectTasks(PROJ);
    const di6 = tasks.find((t) => t.taskId === "di6")!;
    // 把 di6 推迟 20 天
    await rescheduleProjectFromTask(PROJ, "di6", "2026-02-16", "2026-02-17");
    const after = await getProjectTasks(PROJ);
    const dd6 = after.find((t) => t.taskId === "dd6")!;
    expect(di6.dueDate).toBeTruthy();
    expect(dd6.startDate! >= "2026-02-17").toBe(true);
  });
});

describe("applyDerivativeReuseStrategyToProject 批量写入", () => {
  it("保留未受影响任务元数据，同时重置受影响审批并跳过旧模板任务", async () => {
    const db = await getDb();
    if (!db) throw new Error("no db");

    const initial = await applyDerivativeReuseStrategyToProject(BATCH_PROJ, DEFAULTS, 1);
    expect(initial.insertedTasks).toBeGreaterThan(0);

    const stableAt = new Date("2026-02-01T08:00:00.000Z");
    const decidedAt = new Date("2026-02-02T08:00:00.000Z");
    const requestedAt = new Date("2026-02-03T08:00:00.000Z");
    await db.update(projectTasks).set({
      status: "done",
      completed: true,
      completedAt: stableAt,
      statusChangedAt: stableAt,
      instructions: "保留原任务说明",
      deliverables: { "升级验证计划": true },
      assigneeUserId: 1001,
      startDate: "2026-02-01",
      dueDate: "2026-02-07",
      requiresApproval: true,
      approverUserId: 1002,
      approvalStatus: "approved",
      approvalNote: "保留审批意见",
      approvalDecidedBy: 1002,
      approvalDecidedAt: decidedAt,
    }).where(and(
      eq(projectTasks.projectId, BATCH_PROJ),
      eq(projectTasks.taskId, "dd6"),
    ));
    await db.update(projectTasks).set({
      status: "pending_approval",
      completed: false,
      statusChangedAt: requestedAt,
      approvalStatus: "pending",
      approvalNote: "待重新评审",
      approvalRequestedBy: 1003,
      approvalRequestedAt: requestedAt,
    }).where(and(
      eq(projectTasks.projectId, BATCH_PROJ),
      eq(projectTasks.taskId, "dd1"),
    ));
    await db.insert(projectTasks).values({
      projectId: BATCH_PROJ,
      phaseId: "design",
      taskId: "legacy-extra",
      status: "done",
      completed: true,
      completedAt: stableAt,
      statusChangedAt: stableAt,
      updatedBy: 1,
    });

    const result = await applyDerivativeReuseStrategyToProject(
      BATCH_PROJ,
      { ...DEFAULTS, battery: "redevelop" },
      7,
    );
    expect(result.insertedTasks).toBe(0);
    expect(result.obsoleteSkippedTasks).toBe(1);

    const rows = await getProjectTasks(BATCH_PROJ);
    const untouched = rows.find((task) => task.taskId === "dd6")!;
    expect(untouched).toMatchObject({
      status: "done",
      completed: true,
      instructions: "保留原任务说明",
      deliverables: { "升级验证计划": true },
      assigneeUserId: 1001,
      startDate: "2026-02-01",
      dueDate: "2026-02-07",
      requiresApproval: true,
      approverUserId: 1002,
      approvalStatus: "approved",
      approvalNote: "保留审批意见",
      approvalDecidedBy: 1002,
      updatedBy: 7,
    });
    expect(untouched.completedAt?.toISOString()).toBe(stableAt.toISOString());
    expect(untouched.statusChangedAt.toISOString()).toBe(stableAt.toISOString());
    expect(untouched.approvalDecidedAt?.toISOString()).toBe(decidedAt.toISOString());

    const rebased = rows.find((task) => task.taskId === "dd1")!;
    expect(rebased).toMatchObject({
      status: "todo",
      completed: false,
      completedAt: null,
      approvalStatus: "none",
      approvalNote: null,
      approvalRequestedBy: null,
      approvalRequestedAt: null,
      approvalDecidedBy: null,
      approvalDecidedAt: null,
      updatedBy: 7,
    });

    const obsolete = rows.find((task) => task.taskId === "legacy-extra")!;
    expect(obsolete).toMatchObject({
      status: "skipped",
      completed: false,
      completedAt: null,
      updatedBy: 7,
    });
    expect(obsolete.statusChangedAt.getTime()).toBeGreaterThan(stableAt.getTime());
  });
});

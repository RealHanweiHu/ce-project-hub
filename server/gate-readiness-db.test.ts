import { describe, it, expect, afterAll } from "vitest";
import {
  getDb, createProjectFile, getProjectFiles,
  getGateReadiness, getPhaseOpenP0P1, getApproachingGates,
  upsertProjectTask, createProjectWithSeed, createProjectTailoringRequest, reviewProjectTailoring,
} from "./db";
import { projects, projectFiles, projectTasks, projectIssues, projectGateReviews, projectDeliverableReviews, projectPhases, projectTailoring } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { submitDeliverableReview, reviewDeliverable } from "./deliverable-review-service";

const PROJ = `gate-rdy-${Date.now()}`;
const TAILORED_PROJ = `gate-tailored-${Date.now()}`;
const deps = { notifyDingtalk: async () => {} };

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
  await db.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, TAILORED_PROJ));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db.delete(projectFiles).where(eq(projectFiles.projectId, TAILORED_PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, TAILORED_PROJ));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJ));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, TAILORED_PROJ));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, TAILORED_PROJ));
  await db.delete(projectTailoring).where(eq(projectTailoring.projectId, TAILORED_PROJ));
  await db.delete(projectPhases).where(eq(projectPhases.projectId, TAILORED_PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
  await db.delete(projects).where(eq(projects.id, TAILORED_PROJ));
});

describe("project_files.deliverableName", () => {
  it("createProjectFile 持久化 deliverableName，getProjectFiles 返回", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: PROJ, name: "gate就绪测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "design", createdBy: 1,
    }).onConflictDoNothing();
    await createProjectFile({
      projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: "ID外观图",
      name: "id.pdf", mimeType: "application/pdf", size: 10, storageKey: "k1", storageUrl: "u1", uploadedBy: 1,
    });
    const files = await getProjectFiles(PROJ, "design", "d8");
    expect(files.length).toBe(1);
    expect(files[0].deliverableName).toBe("ID外观图");
  });
});

describe("getGateReadiness", () => {
  it("聚合 4 维 + 删文件回退就绪", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projects).values({
      id: PROJ, name: "gate就绪测试", projectNumber: PROJ, category: "npd",
      risk: "low", currentPhase: "design", createdBy: 1,
    }).onConflictDoNothing();
    await db.delete(projectDeliverableReviews).where(eq(projectDeliverableReviews.projectId, PROJ));
    await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));

    const r0 = await getGateReadiness(PROJ, "design");
    expect(r0).not.toBeNull();
    const required = r0!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(required.ok).toBe(false); // 初始无文件

    const firstDeliverable = required.blockers[0];
    const fileId = await createProjectFile({
      projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: firstDeliverable,
      name: "f.pdf", mimeType: "application/pdf", size: 1, storageKey: "k", storageUrl: "u", uploadedBy: 1,
    });
    const rFileOnly = await getGateReadiness(PROJ, "design");
    expect(rFileOnly!.dimensions.find((d) => d.dimension === "deliverables")!.blockers).toContain(firstDeliverable);
    await submitDeliverableReview({ projectId: PROJ, phaseId: "design", deliverableName: firstDeliverable, reviewerUserId: 1, submittedBy: 1 }, deps);
    await reviewDeliverable({ projectId: PROJ, phaseId: "design", deliverableName: firstDeliverable, decision: "approved", reviewedBy: 1, note: null }, deps);
    const r1 = await getGateReadiness(PROJ, "design");
    expect(r1!.dimensions.find((d) => d.dimension === "deliverables")!.blockers).not.toContain(firstDeliverable);

    await db.delete(projectFiles).where(eq(projectFiles.id, fileId));
    const r2 = await getGateReadiness(PROJ, "design");
    expect(r2!.dimensions.find((d) => d.dimension === "deliverables")!.blockers).toContain(firstDeliverable);
  });

  it("getPhaseOpenP0P1 只数本阶段未关闭 P0/P1", async () => {
    const db = await getDb();
    if (!db) return;
    await db.insert(projectIssues).values([
      { projectId: PROJ, phaseId: "design", title: "本阶段P0", severity: "P0", status: "open" },
      { projectId: PROJ, phaseId: "design", title: "本阶段已关", severity: "P1", status: "closed" },
      { projectId: PROJ, phaseId: "evt", title: "他阶段P0", severity: "P0", status: "open" },
    ]);
    const res = await getPhaseOpenP0P1(PROJ, "design");
    expect(res.count).toBe(1);
    expect(res.titles).toEqual(["本阶段P0"]);
  });

  it("getApproachingGates 含有 dueDate 未完成的 gate", async () => {
    const db = await getDb();
    if (!db) return;
    await upsertProjectTask(PROJ, "design", "d8", { dueDate: "2026-09-01", status: "in_progress" });
    const gates = await getApproachingGates();
    expect(gates.some((g) => g.projectId === PROJ && g.gateTaskId === "d8")).toBe(true);
  });

  it("前置任务维度排除已裁剪任务", async () => {
    await createProjectWithSeed({
      id: TAILORED_PROJ,
      name: "gate裁剪任务测试",
      projectNumber: TAILORED_PROJ,
      category: "npd",
      risk: "low",
      currentPhase: "design",
      createdBy: 1,
    }, "npd", 1);

    const before = await getGateReadiness(TAILORED_PROJ, "design");
    expect(before?.dimensions.find((d) => d.dimension === "prereq")?.blockers).toContain("d1");

    const tailoringId = await createProjectTailoringRequest({
      projectId: TAILORED_PROJ,
      reasonType: "reuse_mature",
      reasonNote: "成熟模块复用",
      targets: [{ scope: "task", phaseId: "design", taskId: "d1" }],
      proposedBy: 1,
    });
    await reviewProjectTailoring({ id: tailoringId, decision: "approved", reviewedBy: 1 });

    const after = await getGateReadiness(TAILORED_PROJ, "design");
    expect(after?.dimensions.find((d) => d.dimension === "prereq")?.blockers).not.toContain("d1");
  });
});

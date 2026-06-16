import { describe, it, expect, afterAll } from "vitest";
import {
  getDb, createProjectFile, getProjectFiles,
  getGateReadiness, getPhaseOpenP0P1, getApproachingGates,
  upsertProjectTask,
} from "./db";
import { projects, projectFiles, projectTasks, projectIssues, projectGateReviews } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `gate-rdy-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db.delete(projectTasks).where(eq(projectTasks.projectId, PROJ));
  await db.delete(projectIssues).where(eq(projectIssues.projectId, PROJ));
  await db.delete(projectGateReviews).where(eq(projectGateReviews.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
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

    const r0 = await getGateReadiness(PROJ, "design");
    expect(r0).not.toBeNull();
    const required = r0!.dimensions.find((d) => d.dimension === "deliverables")!;
    expect(required.ok).toBe(false); // 初始无文件

    const firstDeliverable = required.blockers[0];
    const fileId = await createProjectFile({
      projectId: PROJ, phaseId: "design", taskId: "d8", deliverableName: firstDeliverable,
      name: "f.pdf", mimeType: "application/pdf", size: 1, storageKey: "k", storageUrl: "u", uploadedBy: 1,
    });
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
});

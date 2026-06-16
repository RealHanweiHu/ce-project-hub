import { describe, it, expect, afterAll } from "vitest";
import { getDb, createProjectFile, getProjectFiles } from "./db";
import { projects, projectFiles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `gate-rdy-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
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

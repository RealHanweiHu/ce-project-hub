import { describe, it, expect, afterAll } from "vitest";
import { getDb, createProjectFile, getProjectFiles } from "./db";
import { projects, projectFiles } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const PROJ = `fmeta-${Date.now()}`;

afterAll(async () => {
  const db = await getDb();
  if (!db) return;
  await db.delete(projectFiles).where(eq(projectFiles.projectId, PROJ));
  await db.delete(projects).where(eq(projects.id, PROJ));
});

async function seedProject() {
  const db = await getDb();
  if (!db) return null;
  await db.insert(projects).values({
    id: PROJ, name: "文件元数据测试", projectNumber: PROJ, category: "npd",
    risk: "low", currentPhase: "concept", archived: false, createdBy: 1,
  }).onConflictDoNothing();
  return db;
}

const base = {
  projectId: PROJ, phaseId: null, taskId: null, deliverableName: null,
  name: "f.pdf", mimeType: "application/pdf", size: 10,
  storageKey: "k", storageUrl: "/storage/k", uploadedBy: 1,
};

describe("createProjectFile fileType/fileVersion 防脏", () => {
  it("合法值落库 + 读回一致", async () => {
    const db = await seedProject();
    if (!db) return;
    await createProjectFile({ ...base, storageKey: "k1", storageUrl: "/storage/k1", fileType: "图纸", fileVersion: "V1.0" });
    const rows = await getProjectFiles(PROJ);
    const row = rows.find((r) => r.storageKey === "k1");
    expect(row?.fileType).toBe("图纸");
    expect(row?.fileVersion).toBe("V1.0");
  });

  it("非法 fileType → null；超长 fileVersion → 32 字符；空白 → null", async () => {
    const db = await seedProject();
    if (!db) return;
    await createProjectFile({ ...base, storageKey: "k2", storageUrl: "/storage/k2", fileType: "乱填", fileVersion: "x".repeat(40) });
    await createProjectFile({ ...base, storageKey: "k3", storageUrl: "/storage/k3", fileType: "", fileVersion: "   " });
    const rows = await getProjectFiles(PROJ);
    const r2 = rows.find((r) => r.storageKey === "k2");
    const r3 = rows.find((r) => r.storageKey === "k3");
    expect(r2?.fileType).toBeNull();
    expect(r2?.fileVersion).toBe("x".repeat(32));
    expect(r2?.fileVersion?.length).toBe(32);
    expect(r3?.fileType).toBeNull();
    expect(r3?.fileVersion).toBeNull();
  });
});

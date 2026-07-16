import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb,
  listProjectCollections,
  getProjectCollection,
  createProjectCollection,
  updateProjectCollection,
  deleteProjectCollection,
  addProjectsToCollection,
  removeProjectFromCollection,
  listCollectionProjects,
  getCollectionIdsForProject,
  createProjectWithSeed,
} from "./db";

const SUF = "pcoltest";
const PROJECT_A = `proj_a_${SUF}`;
const PROJECT_B = `proj_b_${SUF}`;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM project_collections WHERE "name" LIKE ${`%${SUF}%`}`);
  for (const pid of [PROJECT_A, PROJECT_B]) {
    await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${pid}`);
    await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${pid}`);
    await db.execute(sql`DELETE FROM projects WHERE id = ${pid}`);
  }
}

beforeAll(async () => {
  await cleanup();
  await createProjectWithSeed({ id: PROJECT_A, name: `展会样机 ${SUF}`, category: "npd", createdBy: 1 }, "npd", 1);
  await createProjectWithSeed({ id: PROJECT_B, name: `客户定制 ${SUF}`, category: "eco", createdBy: 1 }, "eco", 1);
});
afterAll(cleanup);

describe("project collections", () => {
  it("creates, lists, updates and deletes a collection", async () => {
    const id = await createProjectCollection({ name: `2027 上海展 ${SUF}`, description: "展会项目", createdBy: 1 });
    expect(id).toMatch(/^col_/);

    const listed = (await listProjectCollections()).find((c) => c.id === id);
    expect(listed?.name).toBe(`2027 上海展 ${SUF}`);
    expect(listed?.projectCount).toBe(0);

    await updateProjectCollection(id, { name: `2027 上海展改 ${SUF}`, description: null });
    const fresh = await getProjectCollection(id);
    expect(fresh?.name).toBe(`2027 上海展改 ${SUF}`);
    expect(fresh?.description).toBeNull();

    await deleteProjectCollection(id);
    expect(await getProjectCollection(id)).toBeUndefined();
  });

  it("rejects duplicate collection names", async () => {
    const id = await createProjectCollection({ name: `A客户 ${SUF}`, createdBy: 1 });
    await expect(createProjectCollection({ name: `A客户 ${SUF}`, createdBy: 1 })).rejects.toThrow();
    await deleteProjectCollection(id);
  });

  it("adds/removes projects, is idempotent, and counts them", async () => {
    const id = await createProjectCollection({ name: `组合 ${SUF}`, createdBy: 1 });
    await addProjectsToCollection(id, [PROJECT_A, PROJECT_B], 1);
    // 幂等：重复加入不报错、不重复计数
    await addProjectsToCollection(id, [PROJECT_A], 1);

    const rows = await listCollectionProjects(id);
    expect(rows.map((r) => r.id).sort()).toEqual([PROJECT_A, PROJECT_B].sort());
    expect(rows.find((r) => r.id === PROJECT_A)?.name).toBe(`展会样机 ${SUF}`);

    const listed = (await listProjectCollections()).find((c) => c.id === id);
    expect(listed?.projectCount).toBe(2);

    await removeProjectFromCollection(id, PROJECT_B);
    expect((await listCollectionProjects(id)).map((r) => r.id)).toEqual([PROJECT_A]);

    await deleteProjectCollection(id);
  });

  it("a project can belong to multiple collections; deleting a collection keeps the project", async () => {
    const expo = await createProjectCollection({ name: `上海展 ${SUF}`, createdBy: 1 });
    const customer = await createProjectCollection({ name: `B客户 ${SUF}`, createdBy: 1 });
    await addProjectsToCollection(expo, [PROJECT_A], 1);
    await addProjectsToCollection(customer, [PROJECT_A], 1);

    expect((await getCollectionIdsForProject(PROJECT_A)).sort()).toEqual([customer, expo].sort());

    // 删除项目集只解散分组，项目与另一集合的归属不受影响
    await deleteProjectCollection(expo);
    expect(await getCollectionIdsForProject(PROJECT_A)).toEqual([customer]);
    const db = await getDb();
    const { sql } = await import("drizzle-orm");
    const stillThere = await db!.execute(sql`SELECT id FROM projects WHERE id = ${PROJECT_A}`);
    expect(stillThere.rows.length).toBe(1);

    await deleteProjectCollection(customer);
  });
});

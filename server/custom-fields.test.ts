import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  getDb,
  getCustomFieldDefs, createCustomFieldDef, updateCustomFieldDef, deleteCustomFieldDef,
  createProjectWithSeed, getProjectById, updateProject,
} from "./db";

const SUF = "cftest";
const PROJECT_ID = `proj_${SUF}`;
const FIELD_KEY = `customer_${SUF}`;

async function cleanup() {
  const db = await getDb();
  if (!db) return;
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`DELETE FROM custom_field_defs WHERE "fieldKey" LIKE ${`%${SUF}%`}`);
  await db.execute(sql`DELETE FROM project_tasks WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM project_phases WHERE "projectId" = ${PROJECT_ID}`);
  await db.execute(sql`DELETE FROM projects WHERE id = ${PROJECT_ID}`);
}
beforeAll(cleanup);
afterAll(cleanup);

describe("custom field definitions", () => {
  it("creates, lists, updates and archives definitions", async () => {
    const id = await createCustomFieldDef({
      entityType: "project", fieldKey: FIELD_KEY, label: "客户名称",
      fieldType: "text", required: true, sortOrder: 5,
    });
    expect(id).toBeGreaterThan(0);

    let defs = await getCustomFieldDefs("project");
    const mine = defs.find((d) => d.fieldKey === FIELD_KEY);
    expect(mine?.label).toBe("客户名称");
    expect(mine?.required).toBe(true);

    await updateCustomFieldDef(id, { label: "客户/品牌", required: false });
    defs = await getCustomFieldDefs("project");
    expect(defs.find((d) => d.fieldKey === FIELD_KEY)?.label).toBe("客户/品牌");

    // archived defs are hidden by default, visible with includeArchived
    await updateCustomFieldDef(id, { archived: true });
    expect((await getCustomFieldDefs("project")).some((d) => d.fieldKey === FIELD_KEY)).toBe(false);
    expect((await getCustomFieldDefs("project", true)).some((d) => d.fieldKey === FIELD_KEY)).toBe(true);

    await deleteCustomFieldDef(id);
    expect((await getCustomFieldDefs("project", true)).some((d) => d.fieldKey === FIELD_KEY)).toBe(false);
  });

  it("select type carries its options array", async () => {
    const id = await createCustomFieldDef({
      entityType: "project", fieldKey: `cert_${SUF}`, label: "认证要求",
      fieldType: "select", options: ["CE", "FCC", "RoHS"],
    });
    const def = (await getCustomFieldDefs("project")).find((d) => d.id === id);
    expect(def?.options).toEqual(["CE", "FCC", "RoHS"]);
    await deleteCustomFieldDef(id);
  });
});

describe("project customFields values", () => {
  it("defaults to empty object and persists set values", async () => {
    await createProjectWithSeed(
      { id: PROJECT_ID, name: "自定义字段测试项目", category: "npd", createdBy: 1 },
      "npd",
      1
    );
    const fresh = await getProjectById(PROJECT_ID);
    expect(fresh?.customFields).toEqual({});

    await updateProject(PROJECT_ID, { customFields: { [FIELD_KEY]: "ACME Corp", cert: ["CE"] } });
    const updated = await getProjectById(PROJECT_ID);
    expect((updated?.customFields as Record<string, unknown>)[FIELD_KEY]).toBe("ACME Corp");
    expect((updated?.customFields as Record<string, unknown>).cert).toEqual(["CE"]);
  });
});

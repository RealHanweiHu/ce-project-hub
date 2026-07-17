import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("PLM key module library UI", () => {
  it("provides one PLM entry with product and key-module workspaces", () => {
    const workspace = source("../client/src/components/views/PlmWorkspaceView.tsx");
    expect(workspace).toContain("产品主数据");
    expect(workspace).toContain("关键模块");
    expect(workspace).toContain("KeyModuleLibraryView");
    expect(workspace).toContain("ProductLibraryView");
  });

  it("supports search, create, technical confirmation, approval and derivation", () => {
    const library = source("../client/src/components/views/KeyModuleLibraryView.tsx");
    expect(library).toContain("trpc.keyModules.list.useQuery");
    expect(library).toContain("搜索编号、名称、型号或品类");
    expect(library).toContain("trpc.keyModules.confirmTechnical.useMutation");
    expect(library).toContain("trpc.keyModules.approve.useMutation");
    expect(library).toContain("trpc.keyModules.derive.useMutation");
  });

  it("edits the controlled internal BOM without supplier fields", () => {
    const editor = source("../client/src/components/views/key-modules/KeyModuleEditorDialog.tsx");
    expect(editor).toContain("内部 BOM");
    expect(editor).toContain("部件编号");
    expect(editor).toContain("位号");
    expect(editor).not.toMatch(/<Label[^>]*>供应商/);
    expect(editor).not.toMatch(/placeholder=["']二供/);
  });
});

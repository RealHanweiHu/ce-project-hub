import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("BOM bulk import UI", () => {
  it("exposes the import entry from the project BOM", () => {
    const panel = source("../client/src/components/views/BomPanel.tsx");
    expect(panel).toContain("<BomImportDialog");
    expect(panel).toContain("批量导入");
    expect(panel).toContain("受控");
  });

  it("parses locally, previews through the server and supports merge or replace", () => {
    const dialog = source("../client/src/components/views/BomImportDialog.tsx");
    expect(dialog).toContain('import("xlsx")');
    expect(dialog).toContain("parseBomImportRows");
    expect(dialog).toContain("trpc.bom.bulkUpsert.useMutation");
    expect(dialog).toContain('dryRun: true');
    expect(dialog).toContain("expectedBomDigest: preview!.bomDigest");
    expect(dialog).toContain("expectedBomDigestVersion: preview!.bomDigestVersion");
    expect(dialog).toContain("BOM 预览基线");
    expect(dialog).toContain("合并更新");
    expect(dialog).toContain("替换普通物料");
  });

  it("explains controlled-module and commercial-data protections", () => {
    const dialog = source("../client/src/components/views/BomImportDialog.tsx");
    expect(dialog).toContain("受控关键模块始终保留");
    expect(dialog).toContain("不能被普通 BOM 导入覆盖或删除");
    expect(dialog).toContain("当前权限不能导入供应商或单价");
  });
});

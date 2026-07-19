import { describe, expect, it } from "vitest";

import {
  parseBomImportRows,
  resolveImportedBomCommercials,
  stableBomDigestPayload,
} from "./bom-import";

describe("BOM import parsing", () => {
  it("accepts the Chinese template headers and normalizes values", () => {
    const result = parseBomImportRows([
      {
        料号: " PN-001 ",
        名称: "主控板",
        规格: "V2",
        用量: "2",
        位号: "PCBA1",
        供应商: "示例供应商",
        单价: "18.50",
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.lines).toEqual([
      {
        partNumber: "PN-001",
        name: "主控板",
        spec: "V2",
        quantity: 2,
        refDesignator: "PCBA1",
        supplierName: "示例供应商",
        unitCost: "18.50",
      },
    ]);
  });

  it("accepts English aliases and defaults an empty quantity to one", () => {
    const result = parseBomImportRows([
      { "Part Number": "BAT-01", Name: "Battery", Quantity: "" },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.lines[0]).toMatchObject({
      partNumber: "BAT-01",
      name: "Battery",
      quantity: 1,
    });
  });

  it("reports row-level errors without importing invalid rows", () => {
    const result = parseBomImportRows([
      { 料号: "PN-001", 名称: "", 用量: 1 },
      { 料号: "PN-002", 名称: "电机", 用量: 0 },
      { 料号: "PN-003", 名称: "电池", 用量: 1 },
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: 2, message: "缺少名称" },
      { row: 3, message: "用量必须是大于 0 的整数" },
    ]);
  });

  it("rejects fractional quantities before the server preview", () => {
    const result = parseBomImportRows([
      { 料号: "PN-FRACTION", 名称: "分数用量", 用量: 1.5 },
    ]);

    expect(result.lines).toEqual([]);
    expect(result.errors).toEqual([
      { row: 2, message: "用量必须是大于 0 的整数" },
    ]);
  });

  it("rejects duplicate identities in the same file", () => {
    const result = parseBomImportRows([
      { 料号: "PN-001", 名称: "电池", 用量: 1 },
      { 料号: "pn-001", 名称: "电池备用行", 用量: 1 },
    ]);

    expect(result.lines).toHaveLength(1);
    expect(result.errors).toEqual([
      { row: 3, message: "料号或位号与第 2 行重复" },
    ]);
  });

  it("ignores fully empty spreadsheet rows", () => {
    const result = parseBomImportRows([{ 料号: "", 名称: "", 用量: "" }]);

    expect(result.lines).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.ignoredRows).toBe(1);
  });
});

describe("BOM import snapshot and commercial-field rules", () => {
  it("preserves existing commercials when imported cells are omitted or blank", () => {
    const current = { supplierName: "已确认供应商", unitCost: "42.50" };

    expect(resolveImportedBomCommercials({}, current)).toEqual(current);
    expect(resolveImportedBomCommercials(
      { supplierName: "  ", unitCost: "" },
      current,
    )).toEqual(current);
    expect(resolveImportedBomCommercials(
      { supplierName: "新供应商", unitCost: "50" },
      current,
    )).toEqual({ supplierName: "新供应商", unitCost: "50" });
  });

  it("uses empty commercials for a new unmatched row and protects them for technical editors", () => {
    expect(resolveImportedBomCommercials({})).toEqual({
      supplierName: "",
      unitCost: "",
    });
    expect(resolveImportedBomCommercials(
      { supplierName: "不应写入", unitCost: "99" },
      { supplierName: "原供应商", unitCost: "10" },
      false,
    )).toEqual({ supplierName: "原供应商", unitCost: "10" });
  });

  it("builds a stable digest payload regardless of object key order", () => {
    expect(stableBomDigestPayload({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableBomDigestPayload({ a: { c: 3, d: 4 }, b: 2 }));
  });
});

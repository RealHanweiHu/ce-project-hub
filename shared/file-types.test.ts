import { describe, expect, it } from "vitest";
import { FILE_TYPES, normalizeFileType, normalizeFileVersion } from "@shared/file-types";

describe("normalizeFileType", () => {
  it("白名单内的值保留", () => {
    for (const t of FILE_TYPES) expect(normalizeFileType(t)).toBe(t);
  });
  it("前后空格 trim 后匹配", () => {
    expect(normalizeFileType("  图纸 ")).toBe("图纸");
  });
  it("空串/空白/非法值/null/undefined → null", () => {
    expect(normalizeFileType("")).toBeNull();
    expect(normalizeFileType("   ")).toBeNull();
    expect(normalizeFileType("乱填")).toBeNull();
    expect(normalizeFileType(null)).toBeNull();
    expect(normalizeFileType(undefined)).toBeNull();
  });
});

describe("normalizeFileVersion", () => {
  it("正常值保留", () => {
    expect(normalizeFileVersion("V1.0")).toBe("V1.0");
  });
  it("trim", () => {
    expect(normalizeFileVersion("  T1  ")).toBe("T1");
  });
  it("空串/纯空白/null/undefined → null", () => {
    expect(normalizeFileVersion("")).toBeNull();
    expect(normalizeFileVersion("   ")).toBeNull();
    expect(normalizeFileVersion(null)).toBeNull();
    expect(normalizeFileVersion(undefined)).toBeNull();
  });
  it("超 32 字符截断到 32（trim 之后）", () => {
    const long = "x".repeat(40);
    expect(normalizeFileVersion(long)).toBe("x".repeat(32));
    expect(normalizeFileVersion(long)!.length).toBe(32);
  });
});

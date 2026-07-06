import { describe, it, expect } from "vitest";
import { resolveDefaultUploadVisibility, canRoleViewFileVisibility } from "./file-visibility";

/**
 * 上传未显式指定 visibility 时的默认值：一律 internal，绝不静默对外。
 * 旧行为 sales 默认 "customer"——销售手滑一次，内部文件就进了客户视野。
 * 例外仅限外部角色本身：external_customer/supplier 只能看各自通道，
 * 默认给其唯一可用的 audience（否则传什么都 403，账号不可用）。
 *
 * 配套约束：sales 的 canViewInternalFiles=false，默认 internal 会被
 * 可见性校验拒绝——等价于强制 sales 显式选择「客户可见」才能上传。
 */
describe("resolveDefaultUploadVisibility", () => {
  it("sales 默认 internal（不再静默客户可见）", () => {
    expect(resolveDefaultUploadVisibility("sales")).toBe("internal");
  });

  it("内部角色默认 internal", () => {
    expect(resolveDefaultUploadVisibility("rd_hw")).toBe("internal");
    expect(resolveDefaultUploadVisibility("project_manager")).toBe("internal");
    expect(resolveDefaultUploadVisibility("qa")).toBe("internal");
  });

  it("外部角色默认各自 audience（其唯一可用通道）", () => {
    expect(resolveDefaultUploadVisibility("external_customer")).toBe("customer");
    expect(resolveDefaultUploadVisibility("supplier")).toBe("supplier");
  });

  it("sales 默认 internal 会被可见性校验拒绝 → 必须显式选择客户可见", () => {
    expect(canRoleViewFileVisibility("sales", resolveDefaultUploadVisibility("sales"))).toBe(false);
    expect(canRoleViewFileVisibility("sales", "customer")).toBe(true);
  });
});

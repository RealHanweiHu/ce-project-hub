import { describe, expect, it } from "vitest";
import {
  findBestMatchingProductCategory,
  tidyProductCategory,
  uniqueProductCategories,
} from "./product-categories";

describe("product category normalization", () => {
  it("tidies separators and whitespace", () => {
    expect(tidyProductCategory("  充气泵，风扇 / JP  ")).toBe("充气泵 / 风扇 / JP");
  });

  it("matches category names with common domain modifiers", () => {
    const categories = ["汽车充气泵", "风扇"];

    expect(findBestMatchingProductCategory("汽车轮胎充气泵", categories)?.category).toBe("汽车充气泵");
    expect(findBestMatchingProductCategory("车载打气泵", categories)?.category).toBe("汽车充气泵");
  });

  it("does not merge unrelated categories that share a broad prefix", () => {
    expect(findBestMatchingProductCategory("汽车风扇", ["汽车充气泵"])?.category).toBeUndefined();
  });

  it("keeps one display name per exact normalized category", () => {
    expect(uniqueProductCategories(["汽车充气泵", " 汽车 充气泵 ", "", null])).toEqual(["汽车充气泵"]);
  });
});

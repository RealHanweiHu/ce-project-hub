const CATEGORY_MODIFIERS = [
  "汽车",
  "车载",
  "车用",
  "轮胎",
  "胎压",
  "便携式",
  "便携",
  "无线",
  "锂电",
  "电动",
  "智能",
  "迷你",
  "小型",
  "大型",
  "通用",
  "家用",
  "户外",
  "产品",
  "品类",
  "系列",
];

const CATEGORY_ALIASES: Array<[RegExp, string]> = [
  [/打气/g, "充气"],
  [/充气机/g, "充气泵"],
];

export type ProductCategoryMatch = {
  category: string;
  score: number;
};

export function tidyProductCategory(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[｜|]/g, "/")
    .replace(/\s*[/／、，,]\s*/g, " / ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeProductCategory(value: string | null | undefined): string {
  return tidyProductCategory(value)
    .toLocaleLowerCase()
    .replace(/[^0-9a-z\u4e00-\u9fa5]+/g, "");
}

function comparableCategoryKey(value: string | null | undefined): string {
  const normalized = normalizeProductCategory(value);
  let key = normalized;
  for (const [pattern, replacement] of CATEGORY_ALIASES) {
    key = key.replace(pattern, replacement);
  }
  for (const modifier of CATEGORY_MODIFIERS) {
    key = key.replaceAll(modifier, "");
  }
  return key || normalized;
}

function bigrams(value: string): string[] {
  const chars = Array.from(value);
  if (chars.length <= 1) return chars;
  const grams: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) {
    grams.push(`${chars[index]}${chars[index + 1]}`);
  }
  return grams;
}

function diceScore(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = bigrams(a);
  const bGrams = bigrams(b);
  const remaining = new Map<string, number>();
  for (const gram of bGrams) remaining.set(gram, (remaining.get(gram) ?? 0) + 1);

  let overlap = 0;
  for (const gram of aGrams) {
    const count = remaining.get(gram) ?? 0;
    if (count > 0) {
      overlap += 1;
      remaining.set(gram, count - 1);
    }
  }
  return (2 * overlap) / (aGrams.length + bGrams.length);
}

export function scoreProductCategory(candidate: string, existing: string): number {
  const candidateNorm = normalizeProductCategory(candidate);
  const existingNorm = normalizeProductCategory(existing);
  if (!candidateNorm || !existingNorm) return 0;
  if (candidateNorm === existingNorm) return 1;

  const candidateKey = comparableCategoryKey(candidate);
  const existingKey = comparableCategoryKey(existing);
  if (candidateKey && candidateKey === existingKey && candidateKey.length >= 2) return 0.94;

  if (
    Math.min(candidateNorm.length, existingNorm.length) >= 3 &&
    (candidateNorm.includes(existingNorm) || existingNorm.includes(candidateNorm))
  ) {
    return 0.82;
  }

  if (
    Math.min(candidateKey.length, existingKey.length) >= 3 &&
    (candidateKey.includes(existingKey) || existingKey.includes(candidateKey))
  ) {
    return 0.76;
  }

  return Math.max(diceScore(candidateNorm, existingNorm), diceScore(candidateKey, existingKey));
}

export function findBestMatchingProductCategory(
  candidate: string,
  categories: string[],
  minScore = 0.72,
): ProductCategoryMatch | null {
  const cleanCandidate = tidyProductCategory(candidate);
  if (!cleanCandidate) return null;

  let best: ProductCategoryMatch | null = null;
  for (const category of categories) {
    const cleanCategory = tidyProductCategory(category);
    if (!cleanCategory) continue;
    const score = scoreProductCategory(cleanCandidate, cleanCategory);
    if (score >= minScore && (!best || score > best.score)) {
      best = { category: cleanCategory, score };
    }
  }
  return best;
}

export function uniqueProductCategories(categories: Array<string | null | undefined>): string[] {
  const byKey = new Map<string, string>();
  for (const category of categories) {
    const cleanCategory = tidyProductCategory(category);
    const key = normalizeProductCategory(cleanCategory);
    if (!cleanCategory || !key || byKey.has(key)) continue;
    byKey.set(key, cleanCategory);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

export const FILE_TYPES = [
  "图纸", "BOM", "报告", "规格书", "测试数据", "认证文件", "评审记录", "变更单", "其他",
] as const;

export type FileType = (typeof FILE_TYPES)[number];

/** 规范化用户输入的 fileType：trim 后在白名单内才保留，否则 null */
export function normalizeFileType(raw: string | null | undefined): FileType | null {
  const v = (raw ?? "").trim();
  return (FILE_TYPES as readonly string[]).includes(v) ? (v as FileType) : null;
}

/** 规范化 fileVersion：trim → 空串落 null → 截断 32 */
export function normalizeFileVersion(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  return v ? v.slice(0, 32) : null;
}

/** 根据最近一次版本生成下一版；新交付物统一从 V1.0 起步。 */
export function nextAutoFileVersion(rawPrevious: string | null | undefined): string {
  const previous = normalizeFileVersion(rawPrevious);
  if (!previous) return "V1.0";

  const vMatch = /^v(\d+)\.(\d+)$/i.exec(previous);
  if (vMatch) {
    const major = Number(vMatch[1]);
    const minor = Number(vMatch[2]);
    return normalizeFileVersion(`V${major}.${minor + 1}`)!;
  }

  const tMatch = /^t(\d+)$/i.exec(previous);
  if (tMatch) {
    const build = Number(tMatch[1]);
    return normalizeFileVersion(`T${build + 1}`)!;
  }

  const revMatch = /^rev\.([a-z]+)$/i.exec(previous);
  if (revMatch) {
    const letters = revMatch[1].toUpperCase();
    const chars = letters.split("");
    let index = chars.length - 1;
    while (index >= 0) {
      if (chars[index] !== "Z") {
        chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1);
        return normalizeFileVersion(`Rev.${chars.join("")}`)!;
      }
      chars[index] = "A";
      index -= 1;
    }
    return normalizeFileVersion(`Rev.A${chars.join("")}`)!;
  }

  return "V1.0";
}

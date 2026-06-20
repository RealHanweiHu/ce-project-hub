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

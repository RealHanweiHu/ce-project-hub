// 文件名 + 分类/版本/可见范围徽标行（B8 收敛：任务附件行与「项目文件」页共用同一渲染，
// 避免两处 markup 各自漂移）。
const VISIBILITY_LABELS: Record<string, string> = {
  customer: '客户可见',
  supplier: '供应商可见',
  public: '公开',
};

export function FileNameBadges({ name, fileType, fileVersion, visibility, nameClassName }: {
  name: string;
  fileType?: string | null;
  fileVersion?: string | null;
  visibility?: string | null;
  nameClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className={`text-sm text-foreground truncate ${nameClassName ?? ''}`}>{name}</span>
      {fileType && <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">{fileType}</span>}
      {fileVersion && <span className="shrink-0 text-[10px] num text-primary">{fileVersion}</span>}
      {visibility && visibility !== 'internal' && (
        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground">
          {VISIBILITY_LABELS[visibility] ?? visibility}
        </span>
      )}
    </div>
  );
}

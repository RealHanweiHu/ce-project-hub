import { Battery, Boxes, CircuitBoard, Cog, FileLock2, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';

type ModuleSnapshot = Record<string, unknown> & {
  id?: string;
  moduleNumber?: string;
  moduleType?: string;
  name?: string;
  category?: string;
  model?: string | null;
  internalBomHash?: string;
};

type ModuleAssignment = {
  moduleType: string;
  moduleId?: string;
  moduleSnapshot?: ModuleSnapshot | null;
};

type BomSnapshotRow = Record<string, unknown> & {
  id?: number;
  partNumber?: string;
  name?: string;
  spec?: string | null;
  quantity?: number | string;
  revision?: string | null;
  keyModuleId?: string | null;
};

type TechnicalBaseline = {
  id: string;
  productId: string;
  baselineLabel: string;
  sourceProjectId: string;
  keyModulesSnapshot?: Record<string, unknown> | null;
  bomSnapshot?: BomSnapshotRow[] | null;
  specSnapshot?: {
    specificationFiles?: Array<{
      sourceFileId?: number;
      name?: string;
      fileVersion?: string | null;
      deliverableName?: string | null;
      approvedAt?: Date | string | null;
    }>;
    productDefinitionSnapshot?: unknown;
    projectExecutionBaseline?: unknown;
  } | null;
  releasedAt: Date;
};

type TechnicalBaselineResponse =
  | (TechnicalBaseline & {
      assignments?: ModuleAssignment[];
      sourceProjectName?: string | null;
    })
  | null;

const MODULES = [
  { type: 'battery_energy', snapshotKey: 'battery', label: '电池 / 能源', Icon: Battery },
  { type: 'core_function', snapshotKey: 'core_function', label: '核心功能', Icon: Cog },
  { type: 'electronics_hardware', snapshotKey: 'electronics', label: '电子硬件', Icon: CircuitBoard },
] as const;

function normalizeResponse(data: TechnicalBaselineResponse | undefined) {
  if (!data) return null;
  return {
    baseline: data,
    assignments: data.assignments ?? [],
    sourceProjectName: data.sourceProjectName,
  };
}

function snapshotFor(
  baseline: TechnicalBaseline,
  assignments: ModuleAssignment[],
  moduleType: string,
  snapshotKey: string,
) {
  const assignment = assignments.find((item) => item.moduleType === moduleType);
  if (assignment?.moduleSnapshot) return assignment.moduleSnapshot;

  const raw = baseline.keyModulesSnapshot?.[snapshotKey];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.reuseState !== 'reused' || !record.keyModuleId) return null;
  const nested = record.moduleSnapshot;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as ModuleSnapshot;
  }
  const keyModuleSnapshot = record.keyModuleSnapshot;
  if (keyModuleSnapshot && typeof keyModuleSnapshot === 'object' && !Array.isArray(keyModuleSnapshot)) {
    return keyModuleSnapshot as ModuleSnapshot;
  }
  return record as ModuleSnapshot;
}

function quantityLabel(value: BomSnapshotRow['quantity']) {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity.toLocaleString('zh-CN') : '—';
}

export function ProductTechnicalBaselinePanel({ productId }: { productId: string }) {
  const currentQuery = trpc.products.currentTechnicalBaseline.useQuery({ productId });
  const historyQuery = trpc.products.technicalBaselines.useQuery({ productId });
  const current = currentQuery.data as TechnicalBaselineResponse | undefined;
  const history = historyQuery.data ?? [];
  const [selectedBaselineId, setSelectedBaselineId] = useState<string | null>(null);

  useEffect(() => {
    const preferred = current?.id ?? history[0]?.id ?? null;
    setSelectedBaselineId((existing) => (
      existing && history.some((item) => item.id === existing) ? existing : preferred
    ));
  }, [current?.id, history]);

  const selectedQuery = trpc.products.technicalBaseline.useQuery(
    { id: selectedBaselineId ?? '' },
    { enabled: Boolean(selectedBaselineId && selectedBaselineId !== current?.id) },
  );
  const selected = selectedBaselineId === current?.id
    ? current
    : selectedQuery.data as TechnicalBaselineResponse | undefined;
  const selectedIndex = history.findIndex((item) => item.id === selectedBaselineId);
  const previousBaselineId = selectedIndex >= 0 ? history[selectedIndex + 1]?.id ?? null : null;
  const previousQuery = trpc.products.technicalBaseline.useQuery(
    { id: previousBaselineId ?? '' },
    { enabled: Boolean(previousBaselineId) },
  );
  const normalized = normalizeResponse(selected);
  const previousNormalized = normalizeResponse(
    previousQuery.data as TechnicalBaselineResponse | undefined,
  );
  const isLoading = currentQuery.isLoading
    || historyQuery.isLoading
    || (Boolean(selectedBaselineId && selectedBaselineId !== current?.id) && selectedQuery.isLoading);
  const error = currentQuery.error ?? historyQuery.error ?? selectedQuery.error;

  return (
    <AccordionItem value="technical-baseline">
      <AccordionTrigger className="text-foreground">
        <span className="flex items-center gap-2">
          <FileLock2 size={15} className="text-muted-foreground" />
          <span className="text-base text-foreground">技术基线 · 关键模块 / BOM</span>
          {normalized?.baseline.baselineLabel ? (
            <span className="rounded bg-[color:var(--acc-soft)] px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {normalized.baseline.baselineLabel}
            </span>
          ) : null}
        </span>
      </AccordionTrigger>
      <AccordionContent>
        <div className="border border-border bg-secondary p-4">
          <p className="text-xs leading-5 text-muted-foreground">
            项目交付生成技术配置；Revision 只维护包装、印刷、标签等轻微改版。
          </p>

          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> 加载技术基线…
            </div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-[color:var(--destructive)]">
              技术基线加载失败：{error.message}
            </p>
          ) : !normalized ? (
            <div className="py-8 text-center">
              <FileLock2 size={22} className="mx-auto mb-2 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">暂无已发布的产品技术基线。</p>
              <p className="mt-1 text-xs text-muted-foreground">项目完成并交付到产品库后，将在这里生成只读快照。</p>
            </div>
          ) : (
            <>
              {history.length > 1 ? (
                <div className="mt-4 border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-xs font-medium text-foreground">技术基线历史</p>
                    <span className="text-[11px] text-muted-foreground">{history.length} 个受控版本</span>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {history.map((item) => {
                      const active = item.id === normalized.baseline.id;
                      const isCurrent = item.id === current?.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedBaselineId(item.id)}
                          className={`min-w-[8.5rem] border px-3 py-2 text-left transition-colors ${
                            active
                              ? 'border-primary bg-[color:var(--acc-soft)] text-primary'
                              : 'border-border bg-secondary text-foreground hover:border-primary/50'
                          }`}
                        >
                          <span className="block text-xs font-medium">
                            {item.baselineLabel}{isCurrent ? ' · 当前' : ''}
                          </span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {new Date(item.releasedAt).toLocaleDateString('zh-CN')}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <BaselineContent
                {...normalized}
                previousBaseline={previousNormalized?.baseline ?? null}
                previousAssignments={previousNormalized?.assignments ?? []}
              />
            </>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function BaselineContent({
  baseline,
  assignments,
  sourceProjectName,
  previousBaseline,
  previousAssignments,
}: Exclude<ReturnType<typeof normalizeResponse>, null> & {
  previousBaseline: TechnicalBaseline | null;
  previousAssignments: ModuleAssignment[];
}) {
  const bom = Array.isArray(baseline.bomSnapshot) ? baseline.bomSnapshot : [];
  const specificationFiles = Array.isArray(baseline.specSnapshot?.specificationFiles)
    ? baseline.specSnapshot.specificationFiles
    : [];
  const hasStructuredSpecification = Boolean(
    baseline.specSnapshot?.productDefinitionSnapshot
      || baseline.specSnapshot?.projectExecutionBaseline,
  );

  return (
    <div className="mt-4 space-y-5">
      <div className="grid grid-cols-1 gap-3 border-y border-border py-3 text-xs sm:grid-cols-3">
        <Metadata label="技术基线" value={baseline.baselineLabel} />
        <Metadata
          label="发布日期"
          value={new Date(baseline.releasedAt).toLocaleString('zh-CN')}
        />
        <Metadata
          label="来源项目"
          value={sourceProjectName ? `${sourceProjectName} · ${baseline.sourceProjectId}` : baseline.sourceProjectId}
        />
      </div>

      {previousBaseline ? (
        <BaselineDelta
          baseline={baseline}
          assignments={assignments}
          previousBaseline={previousBaseline}
          previousAssignments={previousAssignments}
        />
      ) : null}

      <section aria-labelledby="technical-baseline-specification">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 id="technical-baseline-specification" className="text-sm font-medium text-foreground">规格基线</h4>
          <span className="text-[11px] text-muted-foreground">项目任务提交后随发布冻结</span>
        </div>
        {specificationFiles.length > 0 ? (
          <div className="divide-y divide-border border border-border bg-card">
            {specificationFiles.slice(0, 5).map((file, index) => (
              <div key={`${file.sourceFileId ?? file.name ?? 'spec'}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{file.name || file.deliverableName || '产品规格文件'}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {[file.deliverableName, file.fileVersion].filter(Boolean).join(' · ') || '规格文件'}
                  </p>
                </div>
                <span className="shrink-0 rounded bg-[color:var(--acc-soft)] px-2 py-1 text-[11px] text-primary">已审核受控</span>
              </div>
            ))}
          </div>
        ) : hasStructuredSpecification ? (
          <p className="border border-border bg-card px-3 py-4 text-xs text-muted-foreground">结构化产品定义 / 项目执行规格已冻结在该技术基线中。</p>
        ) : (
          <p className="border border-border bg-card px-3 py-4 text-xs text-muted-foreground">该基线未记录独立规格文件。</p>
        )}
      </section>

      <section aria-labelledby="technical-baseline-modules">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 id="technical-baseline-modules" className="text-sm font-medium text-foreground">关键模块快照</h4>
          <span className="text-[11px] text-muted-foreground">已冻结，不随模块库后续变更漂移</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODULES.map(({ type, snapshotKey, label, Icon }) => {
            const snapshot = snapshotFor(baseline, assignments, type, snapshotKey);
            return (
              <div key={type} className="border border-border bg-card p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Icon size={14} className="text-primary" /> {label}
                </div>
                {snapshot ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm font-medium text-foreground">{snapshot.moduleNumber || '未编号模块'}</p>
                    <p className="text-xs text-muted-foreground">{snapshot.name || '名称未登记'}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {[snapshot.model, snapshot.category].filter(Boolean).join(' · ') || '型号 / 品类未登记'}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">项目开发 / 未绑定受控模块</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="technical-baseline-bom">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h4 id="technical-baseline-bom" className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Boxes size={14} className="text-muted-foreground" /> 冻结 BOM 摘要
          </h4>
          <span className="text-[11px] text-muted-foreground">{bom.length} 行</span>
        </div>
        {bom.length === 0 ? (
          <p className="border border-border bg-card px-3 py-5 text-center text-xs text-muted-foreground">该技术基线未包含 BOM 行。</p>
        ) : (
          <div className="overflow-hidden border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-xs">
                <thead className="border-b border-border bg-secondary/70 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">物料编号</th>
                    <th className="px-3 py-2 font-medium">名称</th>
                    <th className="px-3 py-2 font-medium">规格</th>
                    <th className="px-3 py-2 text-right font-medium">数量</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bom.slice(0, 12).map((row, index) => (
                    <tr key={`${row.id ?? row.partNumber ?? 'bom'}-${index}`}>
                      <td className="px-3 py-2 font-medium text-foreground">{row.partNumber || '—'}</td>
                      <td className="px-3 py-2 text-foreground">{row.name || '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.spec || row.revision || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-foreground">{quantityLabel(row.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {bom.length > 12 ? (
              <p className="border-t border-border px-3 py-2 text-center text-[11px] text-muted-foreground">
                当前显示前 12 行，其余 {bom.length - 12} 行已保存在冻结快照中。
              </p>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}

function BaselineDelta({
  baseline,
  assignments,
  previousBaseline,
  previousAssignments,
}: {
  baseline: TechnicalBaseline;
  assignments: ModuleAssignment[];
  previousBaseline: TechnicalBaseline;
  previousAssignments: ModuleAssignment[];
}) {
  const summary = useMemo(() => {
    const rowKey = (row: BomSnapshotRow, index: number) => row.partNumber?.trim() || `${row.name ?? 'row'}:${index}`;
    const comparable = (row: BomSnapshotRow) => JSON.stringify({
      name: row.name ?? '',
      spec: row.spec ?? '',
      quantity: Number(row.quantity ?? 0),
      keyModuleId: row.keyModuleId ?? null,
    });
    const beforeRows = Array.isArray(previousBaseline.bomSnapshot) ? previousBaseline.bomSnapshot : [];
    const afterRows = Array.isArray(baseline.bomSnapshot) ? baseline.bomSnapshot : [];
    const before = new Map(beforeRows.map((row, index) => [rowKey(row, index), comparable(row)]));
    const after = new Map(afterRows.map((row, index) => [rowKey(row, index), comparable(row)]));
    const added = Array.from(after.keys()).filter((key) => !before.has(key)).length;
    const removed = Array.from(before.keys()).filter((key) => !after.has(key)).length;
    const changed = Array.from(after.entries()).filter(([key, value]) => before.has(key) && before.get(key) !== value).length;
    const moduleByType = (rows: ModuleAssignment[]) => new Map(rows.map((row) => [row.moduleType, row.moduleId ?? null]));
    const beforeModules = moduleByType(previousAssignments);
    const afterModules = moduleByType(assignments);
    const moduleTypes = new Set([
      ...Array.from(beforeModules.keys()),
      ...Array.from(afterModules.keys()),
    ]);
    const moduleChanges = Array.from(moduleTypes)
      .filter((type) => beforeModules.get(type) !== afterModules.get(type)).length;
    return { added, removed, changed, moduleChanges };
  }, [assignments, baseline, previousAssignments, previousBaseline]);

  return (
    <section className="border border-border bg-card px-3 py-3" aria-label="技术基线差异摘要">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">
          相比 {previousBaseline.baselineLabel}
        </p>
        <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span>关键模块变更 {summary.moduleChanges}</span>
          <span>BOM 新增 {summary.added}</span>
          <span>删除 {summary.removed}</span>
          <span>修改 {summary.changed}</span>
        </div>
      </div>
    </section>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words font-medium text-foreground">{value}</p>
    </div>
  );
}

import { useMemo } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Lock,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import {
  PRODUCT_MODULES,
  type ProjectExecutionBaseline,
} from "@shared/project-track-tailoring";
import { updateDerivativeModuleReuse } from "@/lib/derivative-create";
import {
  buildJdmDefinitionDraftBaseline,
  getJdmDefinitionTaskPreview,
  validateJdmDefinitionFreeze,
  type JdmDefinitionFormState,
} from "@/lib/jdm-definition";

export interface JdmDefinitionBaselinePanelProps {
  projectId: string;
  baseline: ProjectExecutionBaseline;
  state: JdmDefinitionFormState;
  onChange: (state: JdmDefinitionFormState) => void;
  canEdit: boolean;
  compact?: boolean;
}

export function JdmDefinitionBaselinePanel({
  projectId,
  baseline,
  state,
  onChange,
  canEdit,
  compact = false,
}: JdmDefinitionBaselinePanelProps) {
  const utils = trpc.useUtils();
  const isFrozen = baseline.status === "frozen";
  const editable = canEdit && !isFrozen;
  const validation = useMemo(
    () => validateJdmDefinitionFreeze(state),
    [state],
  );
  const preview = useMemo(
    () => getJdmDefinitionTaskPreview(state.moduleReuse),
    [state.moduleReuse],
  );
  const riskScope = trpc.projects.riskScope.useQuery(
    { projectId },
    { staleTime: 5_000 },
  );
  const saveDraft = trpc.projects.saveJdmDefinitionDraft.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.projects.get.invalidate({ id: projectId }),
        utils.projects.list.invalidate(),
      ]);
      toast.success("JDM 产品定义草稿已保存");
    },
    onError: error => toast.error(error.message || "草稿保存失败"),
  });

  const updateModuleState = (
    moduleId: (typeof PRODUCT_MODULES)[number]["id"],
    nextState: "reused" | "not_reused",
  ) => {
    const nextModuleReuse = updateDerivativeModuleReuse(
      state.moduleReuse,
      moduleId,
      nextState,
    );
    if (nextModuleReuse === state.moduleReuse) {
      toast.error("ID/CMF 不复用时，产品结构/模具不能单独设为复用");
      return;
    }
    onChange({ ...state, moduleReuse: nextModuleReuse });
  };

  const save = () => {
    const draft = buildJdmDefinitionDraftBaseline(state);
    saveDraft.mutate({
      projectId,
      productDefinitionRef: draft.productDefinitionRef ?? "",
      moduleReuse: draft.moduleReuse!,
      reuseEvidence: draft.reuseEvidence ?? {},
    });
  };

  const risk = riskScope.data;
  const riskReady = !!risk?.engineeringConfirmedAt && !!risk?.qaOrCertConfirmedAt;

  return (
    <section
      className={cn(
        "rounded-[10px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]",
        compact ? "p-3" : "p-4",
      )}
      aria-label="JDM 产品定义与六模块执行基线"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck size={15} className="text-primary" />
            <h3 className="text-sm font-semibold text-foreground">
              JDM 产品定义与六模块执行基线
            </h3>
            <span className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              isFrozen
                ? "bg-[color:var(--success-soft)] text-[color:var(--success)]"
                : "bg-card text-primary",
            )}>
              {isFrozen ? "已冻结" : "定义中"}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
            创建时只留存客户概念；P1 完成我方规格书和复用证据。Gate 通过后系统按“不复用”模块生成 P2–P6 设计任务，复用模块不再派发重复设计任务。
          </p>
        </div>
        {isFrozen && (
          <div className="flex items-center gap-1 text-[11px] text-[color:var(--success)]">
            <Lock size={12} /> Gate 已冻结，只读
          </div>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[8px] border border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            客户原始概念 / ID（创建时留存）
          </div>
          <div className="mt-1 break-words text-xs text-foreground">
            {state.customerConceptRef || "未登记"}
          </div>
        </div>
        <label className="rounded-[8px] border border-border bg-card p-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            我方产品规格书 / 产品定义引用
          </span>
          <input
            value={state.productDefinitionRef}
            onChange={event =>
              onChange({ ...state, productDefinitionRef: event.target.value })
            }
            disabled={!editable}
            placeholder="例如 PSD-JDM-2026-001 或文档链接"
            aria-label="JDM 产品规格书引用"
            className="mt-1.5 w-full rounded-[7px] border border-border bg-secondary/30 px-3 py-2 text-xs outline-none focus:border-[color:var(--acc-border)] disabled:cursor-not-allowed disabled:opacity-70"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {PRODUCT_MODULES.map(module => {
          const reused = state.moduleReuse[module.id] === "reused";
          const evidence = state.reuseEvidence[module.id];
          return (
            <div key={module.id} className="rounded-[9px] border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-foreground">{module.label}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    {module.responsibilityDomain}
                  </div>
                </div>
                <div className="flex rounded-[7px] border border-border bg-secondary/40 p-0.5">
                  {([
                    ["reused", "复用"],
                    ["not_reused", "不复用"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={`${module.label}${label}`}
                      disabled={!editable}
                      onClick={() => updateModuleState(module.id, value)}
                      className={cn(
                        "rounded-[5px] px-2.5 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed",
                        state.moduleReuse[module.id] === value
                          ? "bg-card text-primary shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {reused && (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <input
                    value={evidence.sourceRef}
                    onChange={event => onChange({
                      ...state,
                      reuseEvidence: {
                        ...state.reuseEvidence,
                        [module.id]: { ...evidence, sourceRef: event.target.value },
                      },
                    })}
                    disabled={!editable}
                    placeholder="来源产品 / 模块"
                    aria-label={`${module.label}复用来源`}
                    className="rounded-[6px] border border-border bg-secondary/30 px-2 py-1.5 text-[11px] outline-none disabled:opacity-70"
                  />
                  <input
                    value={evidence.modelOrVersion}
                    onChange={event => onChange({
                      ...state,
                      reuseEvidence: {
                        ...state.reuseEvidence,
                        [module.id]: { ...evidence, modelOrVersion: event.target.value },
                      },
                    })}
                    disabled={!editable}
                    placeholder="型号 / 版本"
                    aria-label={`${module.label}复用型号或版本`}
                    className="rounded-[6px] border border-border bg-secondary/30 px-2 py-1.5 text-[11px] outline-none disabled:opacity-70"
                  />
                  <input
                    value={evidence.evidenceRef}
                    onChange={event => onChange({
                      ...state,
                      reuseEvidence: {
                        ...state.reuseEvidence,
                        [module.id]: { ...evidence, evidenceRef: event.target.value },
                      },
                    })}
                    disabled={!editable}
                    placeholder="证据引用"
                    aria-label={`${module.label}复用证据引用`}
                    className="rounded-[6px] border border-border bg-secondary/30 px-2 py-1.5 text-[11px] outline-none disabled:opacity-70"
                  />
                  <label className="col-span-full flex items-center gap-2 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={evidence.boundaryConfirmed}
                      onChange={event => onChange({
                        ...state,
                        reuseEvidence: {
                          ...state.reuseEvidence,
                          [module.id]: {
                            ...evidence,
                            boundaryConfirmed: event.target.checked,
                          },
                        },
                      })}
                      disabled={!editable}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    已由负责工程师确认复用适用边界
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
        <div className="rounded-[8px] border border-border bg-card p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-foreground">冻结后任务预览</span>
            <span className="text-muted-foreground">
              复用 {preview.reusedModuleCount}/6 · P2–P6 共 {preview.executionTaskCount} 项任务
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {preview.phases.filter(phase => phase.id !== "input").map(phase => (
              <span key={phase.id} className="rounded bg-secondary px-2 py-1 text-[10px] text-muted-foreground">
                {phase.code} {phase.name} · {phase.tasks.length}
              </span>
            ))}
          </div>
        </div>
        <div className={cn(
          "min-w-[220px] rounded-[8px] border p-3 text-xs",
          riskReady
            ? "border-border bg-card"
            : "border-[color:var(--warning)] bg-[color:var(--warning-soft)]",
        )}>
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            {riskReady
              ? <CheckCircle2 size={13} className="text-[color:var(--success)]" />
              : <AlertTriangle size={13} className="text-[color:var(--warning)]" />}
            风险声明 {risk ? `v${risk.version}` : "未建立"}
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            研发：{risk?.engineeringConfirmedAt ? "已确认" : "待确认"} · QA/认证：{risk?.qaOrCertConfirmedAt ? "已确认" : "待确认"}
          </div>
        </div>
      </div>

      {!validation.ok && (
        <div className="mt-3 flex items-start gap-2 rounded-[8px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] px-3 py-2 text-[11px] text-[color:var(--warning)]" role="alert">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Gate 冻结前还需补齐：{validation.issues.map(issue => issue.message).join("；")}</span>
        </div>
      )}

      {editable && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saveDraft.isPending}
            className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save size={13} />
            {saveDraft.isPending ? "保存中…" : "保存定义草稿"}
          </button>
        </div>
      )}
    </section>
  );
}

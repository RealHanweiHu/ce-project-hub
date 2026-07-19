// Linear redesign — 项目组合看板 (portfolio board)
// Phase 1: VISUAL ONLY. Three view modes (list / kanban / timeline) derived from the
// existing `projects` data. No drag-and-drop, no WIP limits, no toast-undo, no persisted
// grouping/collapse state. All existing data wiring + mutations (add / delete / clone)
// are preserved; only presentation changed.

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  Plus, Minus, Trash2, ChevronDown, ChevronRight, ChevronLeft, Check, Copy, Eye, Lock,
  AlertTriangle, Search, SlidersHorizontal, Star, LayoutGrid, List as ListIcon,
  GanttChartSquare, X as XIcon, CalendarDays, Archive,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Project,
  PHASE_MAP,
  HEALTH_CONFIG,
  type ProjectCreateDraft,
  getPhaseProgress,
  getOverallProgress,
  getProjectPhases,
} from "@/lib/data";
import {
  PROJECT_CATEGORIES,
  ProjectCategory,
  getPhasesForCategory,
  CATEGORY_MAP,
  DERIVATIVE_MODULE_TASK_IDS,
} from "@/lib/sop-templates";
import {
  LinearCard,
  Kicker,
  PageHeader,
  StatusDot,
  LinearBar,
  SegToggle,
  TypeBadge,
} from "@/components/linear/primitives";
import { cn } from "@/lib/utils";
import { useBoardPrefs } from "@/hooks/useBoardPrefs";
import { isSystemAdminRole } from "@shared/system-roles";
import {
  EMPTY_CHANGE_SCOPE_DECLARATION,
  type ProjectChangeScopeDeclaration,
} from "@shared/sop-risk";
import {
  NPD_FULL_TEMPLATE_CONFIG,
  getNpdV3EffectivePhases,
} from "@shared/npd-v3";
import {
  PRODUCT_MODULES,
} from "@shared/project-track-tailoring";
import {
  KEY_MODULE_TYPE_BY_DRV_MODULE,
  PHYSICAL_DRV_MODULE_IDS,
  type DrvKeyModuleReferences,
  type DrvKeyModuleSelectionRefs,
  type PhysicalDrvModuleId,
} from "@shared/key-modules";
import {
  KeyModulePicker,
  type DrvKeyModuleChoice,
} from "./key-modules/KeyModulePicker";
import {
  EMPTY_DERIVATIVE_MODULE_REUSE,
  buildDerivativeExecutionBaseline,
  createEmptyDerivativeReuseEvidence,
  getDerivativeTaskPreview,
  updateDerivativeModuleReuse,
  validateDerivativeCreateBaseline,
} from "@/lib/derivative-create";
import {
  buildJdmCreateExecutionBaseline,
  getJdmCreatePhasePreview,
  validateJdmCreateInput,
  validateObtCreateInput,
} from "@/lib/jdm-create";

interface ProjectListViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onAddProject: (project: ProjectCreateDraft) => Promise<void>;
  onDeleteProject: (id: string) => void;
  onCloneProject?: (
    sourceId: string,
    overrides: Partial<Omit<Project, "id" | "phases">>
  ) => void;
  /** Whether the current user can create new projects */
  canCreateProject?: boolean;
}

// ── Wizard Steps ──────────────────────────────────────────────────────────────
type WizardStep = 1 | 2;

const STEP_LABELS: Record<WizardStep, string> = {
  1: "选择类别",
  2: "填写并确认",
};

const PRODUCT_TYPES = [
  "汽车充气泵",
  "自行车充气泵",
  "户外充气泵",
  "车载吸尘器",
  "暴力风扇",
  "胎压计",
  "机械式打气筒",
  "组件",
];

const ECO_CHANGE_SCOPE_OPTIONS: Array<{
  key: Exclude<keyof ProjectChangeScopeDeclaration, "targetMarkets" | "notes">;
  label: string;
}> = [
  { key: "batteryCellChange", label: "新增或更换电芯" },
  { key: "batteryPackOrBmsChange", label: "电池包 / BMS / 保护板变化" },
  { key: "protectionParameterChange", label: "充放电策略或保护参数变化" },
  {
    key: "powerOrThermalBoundaryChange",
    label: "功率、电流、温升或连续工作边界变化",
  },
  { key: "pressurizedStructureChange", label: "受压结构或过压保护边界变化" },
  { key: "targetMarketExpansion", label: "新增目标市场并需要认证验证" },
  {
    key: "criticalSafetySupplierChange",
    label: "关键安全件供应商或二供变化",
  },
  {
    key: "safetyRelatedSoftwareChange",
    label: "安全相关固件、OTA、APP 或烧录变化",
  },
  { key: "eolTestChange", label: "EOL 测试项目、限值或能力变化" },
  { key: "otherSafetyOrRegulatoryChange", label: "其他安全或法规变化" },
];

// ── Kanban stage columns (display-only) ─────────────────────────────────────────
// The 6 canonical lifecycle stages. Each project's currentPhase is mapped onto one of
// these stage buckets so projects with category-specific SOP templates still slot in.
const STAGE_COLUMNS: { id: string; label: string; short: string }[] = [
  { id: "concept", label: "概念 Concept", short: "概念" },
  { id: "design", label: "设计 Design", short: "设计" },
  { id: "evt", label: "EVT 工程样机", short: "EVT" },
  { id: "dvt", label: "DVT 设计验证", short: "DVT" },
  { id: "pvt", label: "PVT 试产", short: "PVT" },
  { id: "mp", label: "量产 MP", short: "量产" },
];

const DERIVATIVE_MODULE_DISPLAY_ORDER = [
  "battery",
  "core_function",
  "electronics",
  "software_connectivity",
  "id_cmf",
  "structure_mold",
] as const;

const DERIVATIVE_MODULES_FOR_CREATE = DERIVATIVE_MODULE_DISPLAY_ORDER.map(
  moduleId => {
    const module = PRODUCT_MODULES.find(item => item.id === moduleId);
    if (!module) throw new Error(`Missing product module definition: ${moduleId}`);
    return module;
  },
);
const STAGE_IDS = STAGE_COLUMNS.map(s => s.id);
const STAGE_SHORT: Record<string, string> = Object.fromEntries(
  STAGE_COLUMNS.map(s => [s.id, s.short])
);

// ── Drop-zone id helpers ────────────────────────────────────────────────────
// Encode lane + stage into a single droppable id. Task 3 uses laneKey='' (no
// grouping); Task 4 will pass a real laneKey for cross-lane reassign. Splitting
// on '::' keeps the parser forward-compatible.
function makeDropId(laneKey: string, stageId: string): string {
  return `${laneKey}::${stageId}`;
}
function parseDrop(id: string): { laneKey: string; stageId: string } {
  const idx = String(id).indexOf("::");
  if (idx === -1) return { laneKey: "", stageId: String(id) };
  return {
    laneKey: String(id).slice(0, idx),
    stageId: String(id).slice(idx + 2),
  };
}

// Map an arbitrary phase id onto a kanban stage bucket.
function stageBucket(phaseId: string): string {
  if (STAGE_IDS.includes(phaseId)) return phaseId;
  if (phaseId === "planning") return "concept";
  return "concept";
}

// Risk → StatusDot tone
function riskTone(risk: Project["risk"]): "green" | "amber" | "red" {
  return risk === "high" ? "red" : risk === "medium" ? "amber" : "green";
}

// Deterministic avatar color from a name
const AVATAR_COLORS = [
  "#5e6ad2",
  "#3fa66a",
  "#d97706",
  "#0ea5e9",
  "#db2777",
  "#0891b2",
];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initial(name: string): string {
  return (name || "?").trim().charAt(0) || "?";
}

type GroupBy = "none" | "type" | "cat" | "pm";
type FilterKey = "ontrack" | "risk" | "alert" | "starred";
type ViewMode = "list" | "kanban" | "timeline";

// Sentinel lane key for "unassigned" (no pm / no product). Must be used
// consistently in laneKeyOf() AND when decoding the drop target so bucketing and
// reassign stay in lockstep.
const LANE_NONE = "__none__";

// The single source of truth for a project's lane key under a given groupBy.
// Used BOTH to bucket projects into lanes AND to build the droppable dropId, so
// the value a card lands on always round-trips back to the same lane.
//   - 'pm'   → pmUserId (numeric, stringified) — reassign target is pmUserId
//   - 'type' → productId (产品线) — reassign target is productId
//   - 'cat'  → category id (NOT reassignable)
function laneKeyOf(project: Project, groupBy: GroupBy): string {
  if (groupBy === "pm")
    return project.pmUserId != null ? String(project.pmUserId) : LANE_NONE;
  if (groupBy === "type")
    return project.productId != null && project.productId !== ""
      ? project.productId
      : LANE_NONE;
  if (groupBy === "cat") return project.category || "npd";
  return "";
}

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        fontSize: size * 0.46,
      }}
    >
      {initial(name)}
    </span>
  );
}

export function ProjectListView({
  projects,
  onSelectProject,
  onAddProject,
  onDeleteProject,
  onCloneProject,
  canCreateProject = false,
}: ProjectListViewProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [cloneSource, setCloneSource] = useState<Project | null>(null);
  const [cloneForm, setCloneForm] = useState({
    name: "",
    code: "",
    pmUserId: null as number | null,
    startDate: "",
    targetDate: "",
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // ── Board presentation state (local only; collapse/WIP prefs are persisted via useBoardPrefs) ──
  // 移动端默认纵向列表（看板横向内容远超窄屏宽度），桌面端默认看板
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches ? 'list' : 'kanban'
  );
  // 看板默认隐藏空阶段（P1-项目组合）；「显示设置」里可切回全部
  const [showEmptyStages, setShowEmptyStages] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const [search, setSearch] = useState("");
  const [starred, setStarred] = useState<Set<string>>(() => new Set()); // display-only star
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const archived = trpc.projects.archivedList.useQuery(undefined, {
    enabled: showArchive,
  });

  const handleOpenClone = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setCloneSource(project);
    setCloneForm({
      name: `${project.name}（副本）`,
      code: "",
      pmUserId: project.pmUserId ?? null,
      startDate: "",
      targetDate: "",
    });
  };

  const handleCloneConfirm = () => {
    if (!cloneSource || !cloneForm.name.trim()) return;
    onCloneProject?.(cloneSource.id, {
      name: cloneForm.name.trim(),
      code: cloneForm.code.trim() || (undefined as unknown as string),
      pmUserId: cloneForm.pmUserId,
      startDate: cloneForm.startDate,
      targetDate: cloneForm.targetDate,
    });
    setCloneSource(null);
  };
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedCategory, setSelectedCategory] =
    useState<ProjectCategory>("npd");
  const [zeroReuseWarningOpen, setZeroReuseWarningOpen] = useState(false);
  const isDerivative = selectedCategory === "derivative";
  const isEco = selectedCategory === "eco";
  const capturesEcoChangeScope = selectedCategory === "eco";
  const isJdm = selectedCategory === "jdm";
  const isObt = selectedCategory === "obt";
  const {
    data: userList,
    isLoading: usersLoading,
    isError: usersError,
  } = trpc.admin.listUsersForSelect.useQuery();
  const utils = trpc.useUtils();

  // ── Drag-to-advance/regress (PM/admin override) ──
  const { user } = useAuth();
  const isAdmin = isSystemAdminRole(
    (user as (typeof user & { role?: string }) | null)?.role
  );
  const moveMut = trpc.projects.move.useMutation();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );
  // WIP 上限（per-stage，跨泳道共享，持久化在 localStorage）。
  const {
    wipLimits,
    setWipLimit,
    isLaneCollapsed,
    toggleLane: toggleLanePersist,
  } = useBoardPrefs();
  // Patch shape accepted by trpc.projects.move (only provided fields are written).
  type MovePatch = {
    currentPhase?: string;
    pmUserId?: number | null;
    productId?: string | null;
  };
  // Pending drag awaiting confirmation. `patch`/`undoPatch`/`successMsg` carry the
  // full mutation (stage and/or reassign) so the confirm dialog can dispatch it.
  const [moveConfirm, setMoveConfirm] = useState<{
    project: Project;
    fromStage: string;
    toStage: string;
    patch: MovePatch;
    undoPatch: MovePatch;
    successMsg: string;
  } | null>(null);

  // Can the current user drag (override the phase of) this project?
  const canDrag = (project: Project): boolean =>
    isAdmin || !!project.canEditProjectInfo;

  const stageLabel = (stageId: string): string =>
    STAGE_COLUMNS.find(s => s.id === stageId)?.label ?? stageId;

  // Refresh the board: `projects` is a prop derived from trpc.projects.list in
  // Home, so invalidating that query (the same path Home's invalidateProjects
  // uses) re-fetches and re-renders the board with persisted data.
  const refreshBoard = () => {
    utils.projects.list.invalidate();
    utils.projects.portfolio.invalidate();
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const project = projects.find(p => p.id === String(e.active.id));
    if (!project || !canDrag(project)) return;
    const { stageId: toStage, laneKey: toLane } = parseDrop(String(e.over.id));
    const fromStage = stageBucket(project.currentPhase);
    const stageChanged = !!toStage && toStage !== fromStage;

    // Cross-lane reassign — only for pm (负责人) and type (产品线) groupings.
    // cat (项目类型) and none must NEVER reassign.
    let reassignPatch: MovePatch | null = null;
    let undoReassign: MovePatch | null = null;
    let reassignLabel = "";
    if (
      toLane != null &&
      toLane !== "" &&
      (groupBy === "pm" || groupBy === "type")
    ) {
      const fromLane = laneKeyOf(project, groupBy);
      if (toLane !== fromLane) {
        if (groupBy === "pm") {
          const newPm = toLane === LANE_NONE ? null : Number(toLane);
          reassignPatch = { pmUserId: newPm };
          undoReassign = { pmUserId: project.pmUserId ?? null };
          reassignLabel = "改派负责人";
        } else {
          // 'type' → 产品线
          const newProduct = toLane === LANE_NONE ? null : toLane;
          reassignPatch = { productId: newProduct };
          undoReassign = { productId: project.productId ?? null };
          reassignLabel = "改派产品线";
        }
      }
    }

    if (!stageChanged && !reassignPatch) return;

    // 只允许往回拖（回退）；前进必须走项目详情的 Gate 评审，看板不做前进推进。
    if (stageChanged) {
      const fromIdx = STAGE_IDS.indexOf(fromStage);
      const toIdx = STAGE_IDS.indexOf(toStage);
      if (fromIdx >= 0 && toIdx > fromIdx) {
        toast.error(
          "看板只支持往回拖（回退）；前进推进请在项目详情走 Gate 评审"
        );
        return;
      }
    }

    // 目标列（npd 阶段桶）→ 该项目类别的具体阶段：取该类别中落在此列桶内的第一个阶段
    // （npd 行为不变；eco/idr/jdm/obt 落到自己流程的合法阶段，服务端阶段守卫才会放行）。
    // 类别没有对应此列的阶段（如 OBT 拖到 EVT 列）→ 明确提示，而不是写入非法阶段。
    let targetPhase: string | null = null;
    if (stageChanged) {
      const candidate = getProjectPhases(project).find(
        ph => stageBucket(ph.id) === toStage
      );
      if (!candidate) {
        const catName =
          CATEGORY_MAP[project.category as ProjectCategory]?.name ??
          project.category;
        toast.error(
          `「${catName}」流程没有对应「${stageLabel(toStage)}」列的阶段，无法回退到此列`
        );
        return;
      }
      targetPhase = candidate.id;
    }

    // HARD WIP 上限：只有阶段推进（toStage 变化）才受限；纯改派不受 WIP 约束。
    // 限制是 per-stage 的，计数为全板内 currentPhase 落在 toStage 的项目总数。
    if (stageChanged) {
      const limit = wipLimits[toStage];
      if (limit != null) {
        const countInTarget = projects.filter(
          p => stageBucket(p.currentPhase) === toStage
        ).length;
        if (countInTarget >= limit) {
          toast.error(`${stageLabel(toStage)} 已达 WIP 上限 ${limit}`);
          return; // 不进入 confirm/move
        }
      }
    }

    if (stageChanged && reassignPatch) {
      // Combined推进+改派 → keep the confirm dialog (stage change is the heavy part).
      setMoveConfirm({
        project,
        fromStage,
        toStage,
        patch: { currentPhase: targetPhase!, ...reassignPatch },
        // 撤销须还原“原始”阶段（可能是 planning/d3 等细粒度 phase），不能用 stageBucket 折叠后的 fromStage
        undoPatch: { currentPhase: project.currentPhase, ...undoReassign! },
        successMsg: `已回退并改派 · 可撤销`,
      });
    } else if (reassignPatch) {
      // Reassign-only is lighter → no confirm, dispatch directly.
      void doMove(
        project,
        reassignPatch,
        undoReassign!,
        `已${reassignLabel} · 可撤销`
      );
    } else {
      // Stage-only → existing confirm path.
      setMoveConfirm({
        project,
        fromStage,
        toStage,
        patch: { currentPhase: targetPhase! },
        // 撤销还原原始细粒度 phase（非 stageBucket 折叠值）
        undoPatch: { currentPhase: project.currentPhase },
        successMsg: `已将 ${project.name} 回退到 ${stageLabel(toStage)} · 可撤销`,
      });
    }
  };

  // Generic move: apply `patch`, on success offer 撤销 that applies `undoPatch`.
  const doMove = async (
    project: Project,
    patch: MovePatch,
    undoPatch: MovePatch,
    successMsg: string
  ) => {
    try {
      await moveMut.mutateAsync({ id: project.id, ...patch });
      refreshBoard();
      toast.success(successMsg, {
        action: {
          label: "撤销",
          onClick: async () => {
            try {
              await moveMut.mutateAsync({ id: project.id, ...undoPatch });
              refreshBoard();
              toast.success(`已撤销 · ${project.name}`);
            } catch {
              toast.error("撤销失败");
              refreshBoard();
            }
          },
        },
      });
    } catch (e) {
      // 服务端阶段守卫会给出具体原因（如「不能直接前进阶段：请通过 Gate 评审推进」），透传给用户
      toast.error(
        e instanceof Error && e.message ? e.message : "操作失败，已回滚"
      );
      refreshBoard();
    }
  };
  const { data: productList = [] } = trpc.products.list.useQuery(undefined);
  const products = productList as Array<{
    id: string;
    name: string;
    productNumber: string;
    lifecycleState: string;
  }>;

  const emptyForm = {
    code: "",
    name: "",
    type: "汽车充气泵",
    productId: null as string | null,
    pmUserId: null as number | null,
    startDate: "",
    targetDate: "",
    risk: "low" as "low" | "medium" | "high",
    safetyRiskLevel: "standard" as "standard" | "high",
    regulatoryRiskLevel: "standard" as "standard" | "high",
    customerConceptRef: "",
    customerInputVersion: "",
    customerPartNumber: "",
    commercialBoundary: "",
    customerSignoffOwnerUserId: null as number | null,
    moduleReuse: { ...EMPTY_DERIVATIVE_MODULE_REUSE },
    reuseEvidence: createEmptyDerivativeReuseEvidence(),
    keyModuleRefs: {} as Partial<Record<PhysicalDrvModuleId, DrvKeyModuleChoice>>,
    changeScopeDeclaration: { ...EMPTY_CHANGE_SCOPE_DECLARATION },
    targetMarketsText: "",
  };
  const [form, setForm] = useState(emptyForm);

  const resetWizard = () => {
    setStep(1);
    setSelectedCategory("npd");
    setForm(emptyForm);
  };

  const handleClose = () => {
    setShowAdd(false);
    setZeroReuseWarningOpen(false);
    resetWizard();
  };

  const handleCategoryChange = (category: ProjectCategory) => {
    if (category === selectedCategory) return;
    setSelectedCategory(category);
    setZeroReuseWarningOpen(false);
    // 类型专属输入不能跨项目轨道继承，尤其不能把折叠区里的旧风险勾选静默带入。
    setForm(current => ({
      ...current,
      customerConceptRef: "",
      productId: null,
      customerInputVersion: "",
      customerPartNumber: "",
      commercialBoundary: "",
      customerSignoffOwnerUserId: null,
      moduleReuse: { ...EMPTY_DERIVATIVE_MODULE_REUSE },
      reuseEvidence: createEmptyDerivativeReuseEvidence(),
      keyModuleRefs: {},
      changeScopeDeclaration: { ...EMPTY_CHANGE_SCOPE_DECLARATION },
      targetMarketsText: "",
      safetyRiskLevel: "standard",
      regulatoryRiskLevel: "standard",
    }));
  };

  const handleCreate = async () => {
    if (isCreating) return;
    if (!form.name.trim()) return;
    if (isJdm && !jdmCreateValidation.ok) {
      toast.error(`请补充：${jdmCreateValidation.issues.join("、")}`);
      return;
    }
    if (isObt && !obtCreateValidation.ok) {
      toast.error(`请补充：${obtCreateValidation.issues.join("、")}`);
      return;
    }
    if (isEco && !form.productId) {
      toast.error("ECO 必须选择要变更的现有产品");
      return;
    }
    const jdmDraftExecutionBaseline = isJdm
      ? buildJdmCreateExecutionBaseline(form.customerConceptRef)
      : null;
    let derivativeBaseline = null;
    if (isDerivative) {
      const validation = validateDerivativeCreateBaseline({
        moduleReuse: form.moduleReuse,
        reuseEvidence: form.reuseEvidence,
        keyModuleRefs: derivativeKeyModuleRefs,
      });
      if (!validation.ok) {
        if (validation.issues.some(issue => issue.code === "drv_no_modules_reused")) {
          setZeroReuseWarningOpen(true);
          return;
        }
        toast.error(validation.issues[0]?.message || "请完整确认 DRV 六模块执行基线");
        return;
      }
      const actorId = Number(
        (user as (typeof user & { id?: number }) | null)?.id ?? 0,
      );
      if (!actorId) {
        toast.error("无法确认当前创建人，请刷新页面后重试");
        return;
      }
      derivativeBaseline = buildDerivativeExecutionBaseline({
        moduleReuse: form.moduleReuse,
        reuseEvidence: form.reuseEvidence,
        frozenAt: new Date().toISOString(),
        frozenBy: actorId,
      });
    }
    const firstPhaseId = sopPhases[0]?.id || "concept";
    setIsCreating(true);
    try {
      const projectDraft: ProjectCreateDraft = {
        code: form.code,
        name: form.name,
        type: form.type,
        pmUserId: form.pmUserId,
        startDate: form.startDate,
        targetDate: form.targetDate,
        risk: form.risk,
        productId: isEco ? form.productId : null,
        safetyRiskLevel: form.safetyRiskLevel,
        regulatoryRiskLevel: form.regulatoryRiskLevel,
        customerInputVersion: isObt ? form.customerInputVersion.trim() : null,
        customerPartNumber: isObt ? form.customerPartNumber.trim() : null,
        commercialBoundary: (isJdm || isObt)
          ? form.commercialBoundary.trim()
          : null,
        customerSignoffOwnerUserId: form.customerSignoffOwnerUserId,
        description: null,
        background: null,
        value: null,
        customFields: {
          productType: form.type,
          ...(isDerivative
            ? {
                projectExecutionBaseline: derivativeBaseline,
              }
            : isJdm
              ? {
                  projectExecutionBaseline: jdmDraftExecutionBaseline,
                }
            : {}),
        },
        changeScopeDeclaration: capturesEcoChangeScope
          ? {
              ...form.changeScopeDeclaration,
              targetMarkets: form.targetMarketsText
                .split(",")
                .map(market => market.trim())
                .filter(Boolean),
            }
          : { ...EMPTY_CHANGE_SCOPE_DECLARATION },
        pm: "",
        drvKeyModuleRefs: isDerivative
          ? Object.fromEntries(Object.entries(form.keyModuleRefs).map(([moduleId, reference]) => [
              moduleId,
              { keyModuleId: reference.keyModuleId },
            ])) as DrvKeyModuleSelectionRefs
          : undefined,
        currentPhase: firstPhaseId,
        category: selectedCategory,
        npdTemplate:
          selectedCategory === "npd"
            ? {
                tier: NPD_FULL_TEMPLATE_CONFIG.tier,
                packs: [...NPD_FULL_TEMPLATE_CONFIG.packs],
              }
            : undefined,
      };
      await onAddProject(projectDraft);
      handleClose();
    } catch (error) {
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "创建项目失败，请稍后重试"
      );
    } finally {
      setIsCreating(false);
    }
  };

  const categoryConfig = CATEGORY_MAP[selectedCategory];
  const derivativePreview = useMemo(
    () => getDerivativeTaskPreview(form.moduleReuse),
    [form.moduleReuse],
  );
  const derivativeKeyModuleRefs = useMemo(() => Object.fromEntries(
    Object.entries(form.keyModuleRefs).map(([moduleId, reference]) => [
      moduleId,
      { keyModuleId: reference.keyModuleId, moduleNumber: reference.moduleNumber },
    ]),
  ) as DrvKeyModuleReferences, [form.keyModuleRefs]);
  const derivativeBaselineValidation = useMemo(
    () => validateDerivativeCreateBaseline({
      moduleReuse: form.moduleReuse,
      reuseEvidence: form.reuseEvidence,
      keyModuleRefs: derivativeKeyModuleRefs,
    }),
    [derivativeKeyModuleRefs, form.moduleReuse, form.reuseEvidence],
  );
  const derivativeBlockingIssue = derivativeBaselineValidation.issues.find(
    issue => issue.code !== "drv_no_modules_reused",
  );
  const jdmCreateValidation = useMemo(
    () => validateJdmCreateInput({
      customerConceptRef: form.customerConceptRef,
      commercialBoundary: form.commercialBoundary,
      customerSignoffOwnerUserId: form.customerSignoffOwnerUserId,
    }),
    [
      form.commercialBoundary,
      form.customerConceptRef,
      form.customerSignoffOwnerUserId,
    ],
  );
  const obtCreateValidation = useMemo(
    () => validateObtCreateInput({
      customerInputVersion: form.customerInputVersion,
      customerPartNumber: form.customerPartNumber,
      commercialBoundary: form.commercialBoundary,
      customerSignoffOwnerUserId: form.customerSignoffOwnerUserId,
    }),
    [
      form.commercialBoundary,
      form.customerInputVersion,
      form.customerPartNumber,
      form.customerSignoffOwnerUserId,
    ],
  );
  const jdmCreatePreview = useMemo(
    () => getJdmCreatePhasePreview(form.customerConceptRef),
    [form.customerConceptRef],
  );
  const sopPhases = useMemo(
    () =>
      selectedCategory === "npd"
        ? getNpdV3EffectivePhases(NPD_FULL_TEMPLATE_CONFIG)
        : selectedCategory === "derivative"
          ? derivativePreview.phases
        : selectedCategory === "jdm"
          ? jdmCreatePreview.phases
        : getPhasesForCategory(selectedCategory),
    [derivativePreview.phases, jdmCreatePreview.phases, selectedCategory]
  );
  const isCreateBlocked = !form.name.trim() ||
    (selectedCategory === "derivative" && Boolean(derivativeBlockingIssue)) ||
    (isEco && !form.productId) ||
    (isJdm && !jdmCreateValidation.ok) ||
    (isObt && !obtCreateValidation.ok);

  // ── Derived per-project presentation model ───────────────────────────────────
  interface Row {
    project: Project;
    stage: string;
    overall: number;
    phaseProgress: number;
    tone: "green" | "amber" | "red";
    phaseName: string;
    catId: string;
    catBadge: string;
    isStarred: boolean;
  }
  const rows: Row[] = useMemo(
    () =>
      projects.map(project => {
        const phases = getProjectPhases(project);
        const phaseObj =
          phases.find(p => p.id === project.currentPhase) ||
          PHASE_MAP[project.currentPhase];
        const catId = project.category || "npd";
        const catConfig = CATEGORY_MAP[catId as ProjectCategory];
        return {
          project,
          stage: stageBucket(project.currentPhase),
          overall: getOverallProgress(project),
          phaseProgress: getPhaseProgress(project, project.currentPhase),
          tone: riskTone(project.risk),
          phaseName: phaseObj?.name || project.currentPhase,
          catId,
          catBadge: catConfig?.badge || "NPD",
          isStarred: starred.has(project.id),
        };
      }),
    [projects, starred]
  );

  // pmUserId → 显示名解析（行的 project.pm 在数据层是空串，名字在 UI 用 listUsersForSelect 解析）
  const pmNameById = useMemo(() => {
    const m = new Map<string, string>();
    (userList || []).forEach(u =>
      m.set(String(u.id), u.name || u.username || `#${u.id}`)
    );
    return m;
  }, [userList]);
  const pmLabel = (p: Project): string =>
    (p.pm && p.pm.trim()) ||
    (p.pmUserId != null ? (pmNameById.get(String(p.pmUserId)) ?? "") : "");

  // ── Filter + search ──────────────────────────────────────────────────────────
  const matches = (r: Row): boolean => {
    if (activeFilter === "ontrack" && r.project.risk !== "low") return false;
    if (activeFilter === "risk" && r.project.risk !== "medium") return false;
    if (activeFilter === "alert" && r.project.risk !== "high") return false;
    if (activeFilter === "starred" && !r.isStarred) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay =
        `${r.project.name} ${r.project.code} ${pmLabel(r.project)} ${r.project.type}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const visibleRows = rows.filter(matches);

  // ── Grouping (swimlanes) ───────────────────────────────────────────────────────
  // id → human label resolvers for the id-based lane keys (pmUserId / productId).
  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach(p => m.set(p.id, p.name));
    return m;
  }, [products]);
  interface Lane {
    key: string;
    label: string;
    color: string;
    rows: Row[];
  }
  const lanes: Lane[] = useMemo(() => {
    if (groupBy === "none") return [];
    const map = new Map<string, Lane>();
    const colorFor = (k: string) => avatarColor(k);
    visibleRows.forEach(r => {
      // laneKeyOf is the single source of truth: the lane key is exactly the value
      // a card's droppable carries, so cross-lane drops resolve back to this lane.
      const key = laneKeyOf(r.project, groupBy);
      let label: string;
      if (groupBy === "type") {
        label =
          key === LANE_NONE
            ? "未关联产品"
            : productNameById.get(key) || r.project.type || key;
      } else if (groupBy === "cat") {
        label = CATEGORY_MAP[r.catId as ProjectCategory]?.name || r.catBadge;
      } else {
        // 'pm'
        label =
          key === LANE_NONE
            ? "未分配"
            : pmLabel(r.project) || pmNameById.get(key) || `#${key}`;
      }
      if (!map.has(key))
        map.set(key, { key, label, color: colorFor(key), rows: [] });
      map.get(key)!.rows.push(r);
    });
    return Array.from(map.values());
  }, [visibleRows, groupBy, productNameById, pmNameById]);

  const toggleLane = toggleLanePersist;
  const toggleStar = (id: string) =>
    setStarred(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // ── Filter chip definitions with live counts ──
  const filterChips: {
    key: FilterKey;
    label: string;
    dot: string;
    count: number;
  }[] = [
    {
      key: "ontrack",
      label: "按期",
      dot: "var(--success)",
      count: rows.filter(r => r.project.risk === "low").length,
    },
    {
      key: "risk",
      label: "风险",
      dot: "var(--warning)",
      count: rows.filter(r => r.project.risk === "medium").length,
    },
    {
      key: "alert",
      label: "告警",
      dot: "var(--destructive)",
      count: rows.filter(r => r.project.risk === "high").length,
    },
    {
      key: "starred",
      label: "已标星",
      dot: "var(--star)",
      count: rows.filter(r => r.isStarred).length,
    },
  ];

  const detailRow = detailId
    ? (rows.find(r => r.project.id === detailId) ?? null)
    : null;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <PageHeader
        title="项目组合"
        sub={
          <>
            <span className="num">{projects.length}</span> 个项目 ·
            全生命周期看板
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowArchive(true)}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] border border-border bg-card px-3 text-[12px] font-medium text-foreground hover:bg-secondary"
            >
              <Archive size={14} />
              归档 / 终止
            </button>
            {canCreateProject ? (
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90"
              >
                <Plus size={15} />
                新建项目
              </button>
            ) : (
              <div
                className="inline-flex h-[30px] cursor-not-allowed items-center gap-1.5 rounded-[7px] border border-border bg-secondary px-3 text-[11px] font-medium text-muted-foreground"
                title="仅拥有创建权限的成员可创建项目"
              >
                <Lock size={12} />
                无创建权限
              </div>
            )}
          </div>
        }
      />

      <Dialog open={showArchive} onOpenChange={setShowArchive}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>归档与终止项目</DialogTitle>
          <p className="text-xs text-muted-foreground">
            正常关闭与中途终止分开展示；终止项目保留理由和日期，不混入活跃组合统计。
          </p>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {(archived.data ?? []).map(item => (
              <div
                key={item.id}
                className="rounded-[9px] border border-border p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {item.projectNumber} · {CATEGORY_MAP[item.category].name}
                    </div>
                  </div>
                  <span
                    className={`rounded px-2 py-1 text-[10px] ${item.lifecycle === "terminated" ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}
                  >
                    {item.lifecycle === "terminated" ? "中途终止" : "正常关闭"}
                  </span>
                </div>
                {item.lifecycleReason && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {item.lifecycleReason}
                  </p>
                )}
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {item.lifecycleChangedAt
                    ? new Date(item.lifecycleChangedAt).toLocaleDateString()
                    : "归档日期未记录"}
                </div>
              </div>
            ))}
            {!archived.isLoading && archived.data?.length === 0 && (
              <div className="rounded border border-dashed border-border p-8 text-center text-xs text-muted-foreground">
                暂无归档项目
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* View toggle + search */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegToggle<ViewMode>
          value={viewMode}
          onChange={setViewMode}
          options={[
            {
              value: "list",
              label: (
                <>
                  <ListIcon size={12} />
                  列表
                </>
              ),
            },
            {
              value: "kanban",
              label: (
                <>
                  <LayoutGrid size={12} />
                  看板
                </>
              ),
            },
            {
              value: "timeline",
              label: (
                <>
                  <GanttChartSquare size={12} />
                  时间轴
                </>
              ),
            },
          ]}
        />
        <div className="flex h-[32px] w-[240px] items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-[color:var(--acc-border)] focus-within:ring-2 focus-within:ring-[color:var(--acc-soft)]">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="搜索项目 / 编号 / 负责人…"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Filter strip: 核心筛选 + 显示设置（高级分组/看板选项收进二级入口，P1-项目组合） */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-border bg-card px-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:border-[color:var(--acc-border)] hover:text-foreground">
              <SlidersHorizontal size={12} />
              显示设置
              {groupBy !== 'none' && (
                <span className="rounded bg-[color:var(--acc-soft)] px-1 py-px text-[10px] font-semibold text-primary">
                  {groupBy === 'type' ? '产品线' : groupBy === 'cat' ? '项目类型' : '负责人'}
                </span>
              )}
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>分组方式</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <DropdownMenuRadioItem value="none">不分组</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="type">按产品线</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="cat">按项目类型</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="pm">按负责人</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>看板</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={showEmptyStages}
              onCheckedChange={(v) => setShowEmptyStages(!!v)}
            >
              显示空阶段
            </DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="h-5 w-px bg-border" />
        <div className="flex flex-wrap items-center gap-2">
          {filterChips.map(c => {
            const on = activeFilter === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setActiveFilter(on ? null : c.key)}
                className={cn(
                  "inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] transition-colors",
                  on
                    ? "border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] text-primary"
                    : "border-transparent bg-secondary text-[color:var(--secondary-foreground)] hover:bg-[color:var(--muted)]"
                )}
              >
                {c.key === "starred" ? (
                  <Star
                    size={11}
                    style={{ fill: "var(--star)", color: "var(--star)" }}
                  />
                ) : (
                  <span
                    className="h-[7px] w-[7px] rounded-full"
                    style={{ background: c.dot }}
                  />
                )}
                {c.label}
                <span className="num text-[11px] opacity-70">{c.count}</span>
              </button>
            );
          })}
          {(activeFilter || search) && (
            <button
              onClick={() => {
                setActiveFilter(null);
                setSearch("");
              }}
              className="text-[12px] text-muted-foreground hover:text-primary"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* ── VIEWS ── */}
      {visibleRows.length === 0 ? (
        <LinearCard className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <LayoutGrid size={26} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-muted-foreground">
            无匹配的项目
          </p>
        </LinearCard>
      ) : viewMode === 'kanban' ? (
        (() => {
          // 默认隐藏空阶段；按全部可见项目计算，保证泳道间列对齐
          const kanbanStages = showEmptyStages
            ? STAGE_COLUMNS
            : STAGE_COLUMNS.filter((s) => visibleRows.some((r) => r.stage === s.id));
          const hiddenCount = STAGE_COLUMNS.length - kanbanStages.length;
          return (
            <div className="space-y-2">
              <KanbanView
                stages={kanbanStages}
                groupBy={groupBy}
                lanes={lanes}
                rows={visibleRows}
                isLaneCollapsed={isLaneCollapsed}
                onToggleLane={toggleLane}
                onToggleStar={toggleStar}
                onOpen={onSelectProject}
                onPreview={setDetailId}
              />
              {hiddenCount > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  已隐藏 {hiddenCount} 个空阶段 ·
                  <button
                    onClick={() => setShowEmptyStages(true)}
                    className="ml-1 text-primary hover:opacity-80"
                  >
                    显示全部阶段
                  </button>
                </p>
              )}
            </div>
          );
        })()
      ) : viewMode === 'list' ? (
        <ListView rows={visibleRows} groupBy={groupBy} lanes={lanes} onOpen={onSelectProject} />
      ) : (
        <TimelineView rows={visibleRows} groupBy={groupBy} lanes={lanes} onOpen={onSelectProject} />
      )}

      {/* ── Detail Drawer ── */}
      <Dialog
        open={!!detailRow}
        onOpenChange={o => {
          if (!o) setDetailId(null);
        }}
      >
        <DialogContent className="max-w-[min(460px,calc(100vw-1.5rem))] gap-0 overflow-hidden p-0">
          {detailRow &&
            (() => {
              const p = detailRow.project;
              const health = HEALTH_CONFIG[p.risk];
              return (
                <div className="flex max-h-[85vh] flex-col">
                  {/* Header */}
                  <div className="border-b border-border px-5 pb-4 pt-5">
                    <div className="mb-3 flex items-center gap-2.5">
                      <span className="text-[11.5px] text-muted-foreground num">
                        {p.code}
                      </span>
                      <TypeBadge type={detailRow.catBadge} />
                    </div>
                    <DialogTitle className="text-[21px] font-bold leading-tight tracking-[-0.3px]">
                      {p.name}
                    </DialogTitle>
                    <DialogDescription className="mt-1 text-[12px] text-muted-foreground">
                      {p.type || '项目快速预览'}
                    </DialogDescription>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 py-4">
                    {/* Properties */}
                    <section className="mb-6">
                      <Kicker className="mb-3">参数 Properties</Kicker>
                      <div className="space-y-0">
                        <PropRow
                          k="当前阶段"
                          v={
                            <span className="inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11.5px]">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                              {detailRow.phaseName}
                            </span>
                          }
                        />
                        <PropRow
                          k="整体进度"
                          v={<span className="num">{detailRow.overall}%</span>}
                        />
                        <PropRow
                          k="风险"
                          v={
                            <span className="inline-flex items-center gap-2">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{
                                  background:
                                    detailRow.tone === "green"
                                      ? "var(--success)"
                                      : detailRow.tone === "amber"
                                        ? "var(--warning)"
                                        : "var(--destructive)",
                                }}
                              />
                              {health.label}
                            </span>
                          }
                        />
                        <PropRow
                          k="负责人"
                          v={
                            <span className="inline-flex items-center gap-2">
                              <Avatar name={pmLabel(p) || "?"} size={20} />
                              {pmLabel(p) || "未分配"}
                            </span>
                          }
                        />
                        <PropRow
                          k="目标日期"
                          v={<span className="num">{p.targetDate || "—"}</span>}
                        />
                      </div>
                    </section>

                    {/* 生命周期 stepper 与最近变更已删：与详情页 PhaseStepper / 变更记录 tab 完全重合，
                      抽屉只做快速预览 + 操作入口，完整信息点「进入项目」查看（B7 去重） */}
                  </div>

                  {/* Footer: navigation + clone/delete actions */}
                  <div className="flex items-center gap-2 border-t border-border px-5 py-3.5">
                    <button
                      onClick={() => {
                        onSelectProject(p.id);
                        setDetailId(null);
                      }}
                      className="inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[7px] bg-primary text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90"
                    >
                      进入项目
                      <ChevronRight size={14} />
                    </button>
                    <button
                      onClick={e => handleOpenClone(e, p)}
                      title="克隆项目"
                      aria-label="克隆项目"
                      className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[7px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    >
                      <Copy size={15} />
                    </button>
                    {p.canDeleteProject && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setDeleteConfirm({ id: p.id, name: p.name });
                        }}
                        title="删除项目"
                        aria-label="删除项目"
                        className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[7px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-[color:var(--destructive)]"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => setDetailId(null)}
                      className="inline-flex h-[34px] items-center rounded-[7px] border border-border bg-card px-3 text-[12.5px] font-medium text-muted-foreground hover:bg-secondary"
                    >
                      关闭
                    </button>
                  </div>
                </div>
              );
            })()}
        </DialogContent>
      </Dialog>

      {/* ── Clone Project Modal ──────────────────────────────────────────────── */}
      {cloneSource && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4"
          onClick={() => setCloneSource(null)}
        >
          <LinearCard
            className="w-full max-w-lg shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-6">
              <div>
                <h3 className="text-xl font-bold tracking-[-0.3px]">
                  克隆项目
                </h3>
                <Kicker className="mt-0.5">CLONE PROJECT</Kicker>
              </div>
              <button
                onClick={() => setCloneSource(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Source Info */}
            <div className="px-6 pb-3 pt-5">
              <div className="mb-5 flex items-center gap-2 rounded-[8px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3">
                <Copy size={13} className="shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    基于「{cloneSource.name}」克隆
                  </p>
                  <p className="text-[10px] text-muted-foreground num">
                    {cloneSource.category
                      ? CATEGORY_MAP[cloneSource.category]?.name
                      : "NPD"}
                    {" · "}
                    {cloneSource.category
                      ? CATEGORY_MAP[cloneSource.category]?.phaseCount
                      : 7}{" "}
                    个阶段 · 进度将清零
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Kicker className="mb-1.5">新项目名称 *</Kicker>
                  <input
                    type="text"
                    value={cloneForm.name}
                    onChange={e =>
                      setCloneForm({ ...cloneForm, name: e.target.value })
                    }
                    className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                    autoFocus
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Kicker className="mb-1.5">项目编号</Kicker>
                    <input
                      type="text"
                      value={cloneForm.code}
                      onChange={e =>
                        setCloneForm({ ...cloneForm, code: e.target.value })
                      }
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      placeholder={
                        cloneSource.code
                          ? `${cloneSource.code}-2`
                          : "CE-2026-XXX"
                      }
                    />
                  </div>
                  <div>
                    <Kicker className="mb-1.5">项目经理</Kicker>
                    <select
                      value={cloneForm.pmUserId ?? ""}
                      onChange={e =>
                        setCloneForm({
                          ...cloneForm,
                          pmUserId: e.target.value
                            ? Number(e.target.value)
                            : null,
                        })
                      }
                      disabled={usersLoading}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)] disabled:opacity-50"
                    >
                      {usersLoading && <option value="">加载中...</option>}
                      {usersError && <option value="">加载失败</option>}
                      {!usersLoading && !usersError && (
                        <option value="">选择项目经理...</option>
                      )}
                      {(userList || []).map(u => (
                        <option key={u.id} value={u.id}>
                          {u.name || u.username}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Kicker className="mb-1.5">开始日期</Kicker>
                    <input
                      type="date"
                      value={cloneForm.startDate}
                      onChange={e =>
                        setCloneForm({
                          ...cloneForm,
                          startDate: e.target.value,
                        })
                      }
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                    />
                  </div>
                  <div>
                    <Kicker className="mb-1.5">目标日期</Kicker>
                    <input
                      type="date"
                      value={cloneForm.targetDate}
                      onChange={e =>
                        setCloneForm({
                          ...cloneForm,
                          targetDate: e.target.value,
                        })
                      }
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border p-6">
              <button
                onClick={() => setCloneSource(null)}
                className="rounded-[7px] border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary"
              >
                取消
              </button>
              <button
                onClick={handleCloneConfirm}
                disabled={!cloneForm.name.trim()}
                className={cn(
                  "flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90",
                  !cloneForm.name.trim() && "cursor-not-allowed opacity-50"
                )}
              >
                <Copy size={13} />
                克隆项目
              </button>
            </div>
          </LinearCard>
        </div>
      )}

      {/* ── New Project Wizard Modal ─────────────────────────────────────────── */}
      <Dialog
        open={showAdd}
        onOpenChange={open => {
          if (!open && !isCreating) handleClose();
        }}
      >
        <DialogContent
          className="!flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden rounded-[11px] border-border bg-card p-0 shadow-2xl sm:!max-w-3xl"
          showCloseButton={false}
        >
          <DialogDescription className="sr-only">
            选择项目类型，填写项目资料，并确认系统将生成的流程和任务。
          </DialogDescription>
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border p-6">
              <div>
                <DialogTitle
                  className="text-xl font-bold tracking-[-0.3px]"
                >
                  新建项目
                </DialogTitle>
                <Kicker className="mt-0.5">NEW PROJECT</Kicker>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isCreating}
                aria-label="关闭新建项目窗口"
                className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Step Indicator */}
            <div className="flex shrink-0 items-center border-b border-border bg-secondary px-6 py-3">
              {([1, 2] as WizardStep[]).map((s, i) => (
                <div key={s} className="flex items-center">
                  <div
                    aria-current={step === s ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-2",
                      step === s
                        ? "text-foreground"
                        : step > s
                          ? "text-[color:var(--success)]"
                          : "text-muted-foreground"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold",
                        step === s
                          ? "border-primary bg-primary text-primary-foreground"
                          : step > s
                            ? "border-[color:var(--success)] bg-[color:var(--success)] text-white"
                            : "border-border bg-card text-muted-foreground"
                      )}
                    >
                      {step > s ? <Check size={10} /> : s}
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide">
                      {STEP_LABELS[s]}
                    </span>
                  </div>
                  {i < 1 && <div className="mx-3 h-px w-8 bg-border" />}
                </div>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto">
              {/* ── Step 1: Category Selection ── */}
              {step === 1 && (
                <div className="space-y-4 p-6">
                  <p className="text-sm text-muted-foreground">
                    选择项目类型；新产品开发使用完整流程，衍生开发按六模块复用情况自动减负。
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {PROJECT_CATEGORIES.map(cat => {
                      const active = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => handleCategoryChange(cat.id)}
                          aria-pressed={active}
                          className={cn(
                            "relative flex flex-col rounded-[10px] border-2 p-4 text-left transition-all",
                            active
                              ? "border-primary bg-[color:var(--acc-soft)]"
                              : "border-border bg-card hover:border-[color:var(--acc-border)]"
                          )}
                        >
                          {active && (
                            <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                              <Check
                                size={11}
                                className="text-primary-foreground"
                              />
                            </div>
                          )}
                          <span className="text-3xl">{cat.icon}</span>
                          <span className="mt-3 text-base font-semibold text-foreground">
                            {cat.name}
                          </span>
                          <span className="mt-1.5">
                            <TypeBadge type={cat.badge} />
                          </span>
                          <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">
                            {cat.desc}
                          </p>
                          <div className="mt-3 flex flex-col gap-0.5 border-t border-border pt-3">
                            <span className="text-[10px] text-muted-foreground num">
                              {cat.phaseCount} 个阶段
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              典型周期 {cat.typicalDuration}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── Step 2: Basic Info ── */}
              {step === 2 && (
                <div className="space-y-4 p-6">
                  <div className="flex items-center gap-2 rounded-[8px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] px-3 py-2">
                    <span>{categoryConfig.icon}</span>
                    <span className="text-xs font-medium text-primary">
                      {categoryConfig.name} · {sopPhases.length} 个阶段 ·{" "}
                      {categoryConfig.typicalDuration}
                    </span>
                  </div>

                  <div>
                    <Kicker className="mb-1.5">项目名称 *</Kicker>
                    <input
                      type="text"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      placeholder="输入项目名称"
                      autoFocus
                    />
                  </div>
                  <div>
                    <Kicker className="mb-1.5">项目编号</Kicker>
                    <input
                      type="text"
                      value={form.code}
                      onChange={e => setForm({ ...form, code: e.target.value })}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      placeholder="CE-2026-XXX"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Kicker className="mb-1.5">产品类型</Kicker>
                      <select
                        value={form.type}
                        onChange={e =>
                          setForm({ ...form, type: e.target.value })
                        }
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      >
                        {PRODUCT_TYPES.map(t => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Kicker className="mb-1.5">项目经理</Kicker>
                      <select
                        value={form.pmUserId ?? ""}
                        onChange={e =>
                          setForm({
                            ...form,
                            pmUserId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        disabled={usersLoading}
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)] disabled:opacity-50"
                      >
                        {usersLoading && <option value="">加载中...</option>}
                        {usersError && (
                          <option value="">加载失败，可手动输入</option>
                        )}
                        {!usersLoading && !usersError && (
                          <option value="">选择项目经理...</option>
                        )}
                        {(userList || []).map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.username}
                          </option>
                        ))}
                        {!usersLoading &&
                          !usersError &&
                          (userList?.length ?? 0) === 0 && (
                            <option value="" disabled>
                              暂无用户，请先在管理员后台创建用户
                            </option>
                          )}
                      </select>
                    </div>
                  </div>
                  {isEco && (
                    <div className="rounded-[8px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3">
                      <Kicker className="mb-1.5">要变更的现有产品 *</Kicker>
                      <select
                        value={form.productId ?? ""}
                        onChange={event => setForm({
                          ...form,
                          productId: event.target.value || null,
                        })}
                        required
                        aria-label="ECO 关联产品"
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      >
                        <option value="">选择产品库中的现有产品…</option>
                        {products.map(product => (
                          <option key={product.id} value={product.id}>
                            {product.productNumber} · {product.name}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                        ECO 完成后会在该产品下生成新的受控技术基线；不会创建另一条产品，也不会生成包装类 Revision。
                      </p>
                    </div>
                  )}
                  {isJdm && (
                    <div className="space-y-3 rounded-[8px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3">
                      <div>
                        <Kicker>JDM 立项原始输入</Kicker>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          创建时只留存客户概念或 ID 原始输入、商务边界和客户签核责任人。产品规格书、CSR 与六模块复用草稿在 P1 产品定义阶段完成，并在 Gate 通过时冻结。
                        </p>
                      </div>
                      <textarea
                        value={form.customerConceptRef}
                        onChange={event =>
                          setForm({
                            ...form,
                            customerConceptRef: event.target.value,
                          })
                        }
                        rows={2}
                        required
                        aria-label="客户概念或 ID 原始输入"
                        placeholder="客户概念 / ID 原始输入引用，例如：客户 ID 图链接、邮件主题或需求附件编号"
                        className="w-full resize-none rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      />
                      <textarea
                        value={form.commercialBoundary}
                        onChange={event =>
                          setForm({
                            ...form,
                            commercialBoundary: event.target.value,
                          })
                        }
                        rows={2}
                        required
                        aria-label="JDM 商务边界"
                        placeholder="商务边界：NRE、模具、认证、交付、变更责任……"
                        className="w-full resize-none rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      />
                      <select
                        value={form.customerSignoffOwnerUserId ?? ""}
                        onChange={event =>
                          setForm({
                            ...form,
                            customerSignoffOwnerUserId: event.target.value
                              ? Number(event.target.value)
                              : null,
                          })
                        }
                        required
                        aria-label="JDM 客户签核责任人"
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      >
                        <option value="">选择客户签核责任人…</option>
                        {(userList || []).map(userOption => (
                          <option key={userOption.id} value={userOption.id}>
                            {userOption.name || userOption.username}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {isObt && (
                    <div className="space-y-3 rounded-[8px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3">
                      <div>
                        <Kicker>OBT 客户设计输入（创建后冻结）</Kicker>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          OBT 以客户完整设计和 BOM 为输入；后续变化必须走变更记录和重新签核，不能直接覆盖。
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          value={form.customerInputVersion}
                          onChange={e =>
                            setForm({
                              ...form,
                              customerInputVersion: e.target.value,
                            })
                          }
                          placeholder="客户输入版本，如 BOM V1.3"
                          required
                          aria-label="OBT 客户输入版本"
                          className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                        />
                        <input
                          value={form.customerPartNumber}
                          onChange={e =>
                            setForm({
                              ...form,
                              customerPartNumber: e.target.value,
                            })
                          }
                          placeholder="客户料号"
                          required
                          aria-label="OBT 客户料号"
                          className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                        />
                      </div>
                      <textarea
                        value={form.commercialBoundary}
                        onChange={e =>
                          setForm({
                            ...form,
                            commercialBoundary: e.target.value,
                          })
                        }
                        rows={2}
                        required
                        aria-label="OBT 商务边界"
                        placeholder="商务边界：NRE、模具、认证、交付、变更责任……"
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      />
                      <select
                        value={form.customerSignoffOwnerUserId ?? ""}
                        onChange={e =>
                          setForm({
                            ...form,
                            customerSignoffOwnerUserId: e.target.value
                              ? Number(e.target.value)
                              : null,
                          })
                        }
                        required
                        aria-label="OBT 客户签核责任人"
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      >
                        <option value="">选择客户签核责任人…</option>
                        {(userList || []).map(u => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.username}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {isDerivative && (
                    <div className="space-y-4 rounded-[10px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-4">
                      <div>
                        <Kicker>六模块执行基线</Kicker>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          默认均为“不复用”。只有型号、接口、参数和适用边界完全不变时才选择“复用”；系统会直接移除该模块任务包。产品规格书在创建后的“产品定义/规格基线确认”任务中提交。
                        </p>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-[8px] border border-border bg-card px-1.5 py-2.5 text-center sm:px-3 sm:text-left">
                          <div className="whitespace-nowrap text-[9px] text-muted-foreground sm:text-[10px]">公共任务</div>
                          <div className="mt-0.5 text-lg font-semibold num">
                            {derivativePreview.publicTaskCount}
                          </div>
                        </div>
                        <div className="rounded-[8px] border border-border bg-card px-1.5 py-2.5 text-center sm:px-3 sm:text-left">
                          <div className="whitespace-nowrap text-[9px] text-muted-foreground sm:text-[10px]">模块任务</div>
                          <div className="mt-0.5 text-lg font-semibold num">
                            {derivativePreview.moduleTaskCount}
                          </div>
                        </div>
                        <div
                          className="rounded-[8px] border border-primary/30 bg-primary/5 px-1.5 py-2.5 text-center sm:px-3 sm:text-left"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="whitespace-nowrap text-[9px] text-primary sm:text-[10px]">总任务</div>
                          <div className="mt-0.5 text-lg font-semibold text-primary num">
                            {derivativePreview.totalTaskCount}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2">
                        {DERIVATIVE_MODULES_FOR_CREATE.map(module => {
                          const state = form.moduleReuse[module.id];
                          const structureReuseBlocked =
                            module.id === "structure_mold" &&
                            form.moduleReuse.id_cmf === "not_reused";
                          const physicalModuleId = PHYSICAL_DRV_MODULE_IDS.includes(module.id as PhysicalDrvModuleId)
                            ? module.id as PhysicalDrvModuleId
                            : null;
                          const selectState = (
                            nextState: "reused" | "not_reused",
                          ) => setForm(current => {
                            const keyModuleRefs = { ...current.keyModuleRefs };
                            if (nextState === "not_reused" && physicalModuleId) {
                              delete keyModuleRefs[physicalModuleId];
                            }
                            return {
                              ...current,
                              keyModuleRefs,
                              moduleReuse: updateDerivativeModuleReuse(
                                current.moduleReuse,
                                module.id,
                                nextState,
                              ),
                            };
                          });
                          return (
                            <div
                              key={module.id}
                              className="rounded-[9px] border border-border bg-card p-3"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold text-foreground">
                                    {module.label}
                                  </div>
                                  <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
                                    {module.responsibilityDomain}
                                  </p>
                                </div>
                                <span className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[9px] text-muted-foreground num">
                                  {state === "reused" ? "减少" : "生成"}{" "}
                                  {DERIVATIVE_MODULE_TASK_IDS[module.id].length}{" "}
                                  项
                                </span>
                              </div>
                              <div
                                className="mt-3 grid grid-cols-2 gap-2"
                                role="group"
                                aria-label={`${module.label}复用状态`}
                              >
                                <button
                                  type="button"
                                  onClick={() => selectState("reused")}
                                  disabled={structureReuseBlocked}
                                  aria-pressed={state === "reused"}
                                  aria-label={`${module.label}：复用`}
                                  aria-describedby={structureReuseBlocked ? "structure-reuse-blocked-description" : undefined}
                                  className={cn(
                                    "rounded-[7px] border px-3 py-2 text-xs font-medium transition-colors",
                                    state === "reused"
                                      ? "border-primary bg-primary text-primary-foreground"
                                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary",
                                    structureReuseBlocked && "cursor-not-allowed opacity-45",
                                  )}
                                >
                                  复用
                                </button>
                                <button
                                  type="button"
                                  onClick={() => selectState("not_reused")}
                                  aria-pressed={state === "not_reused"}
                                  aria-label={`${module.label}：不复用`}
                                  className={cn(
                                    "rounded-[7px] border px-3 py-2 text-xs font-medium transition-colors",
                                    state === "not_reused"
                                      ? "border-foreground/30 bg-foreground text-background"
                                      : "border-border bg-secondary/40 text-muted-foreground hover:bg-secondary",
                                  )}
                                >
                                  不复用
                                </button>
                              </div>
                              {structureReuseBlocked && (
                                <p
                                  id="structure-reuse-blocked-description"
                                  className="mt-2 text-[10px] text-muted-foreground"
                                >
                                  ID/CMF 不复用时，结构/模具必须一并由工程师跟进。
                                </p>
                              )}
                              {module.id === "id_cmf" && (
                                <p className="mt-2 text-[10px] text-muted-foreground">
                                  仅颜色、标签或文案轻改请退出建项，转产品库 Revision。
                                </p>
                              )}
                              {state === "reused" && (
                                <div className="mt-3 space-y-2 border-t border-border pt-3">
                                  {physicalModuleId ? (
                                    <KeyModulePicker
                                      moduleType={KEY_MODULE_TYPE_BY_DRV_MODULE[physicalModuleId]}
                                      category={form.type}
                                      value={form.keyModuleRefs[physicalModuleId]}
                                      onChange={reference => setForm(current => ({
                                        ...current,
                                        keyModuleRefs: { ...current.keyModuleRefs, [physicalModuleId]: reference },
                                      }))}
                                      label={module.label}
                                    />
                                  ) : (
                                    <p className="rounded-[6px] bg-secondary/40 px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground">
                                      选择复用表示该模块沿用现有方案，系统不生成对应设计开发任务包；后续仍在公共验证任务中确认整机表现。
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {derivativeBlockingIssue && (
                        <div
                          className="flex items-start gap-2 rounded-[8px] border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
                          role="alert"
                        >
                          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                          <span>{derivativeBlockingIssue.message}</span>
                        </div>
                      )}
                    </div>
                  )}
                  {capturesEcoChangeScope && (
                    <div className="space-y-3 rounded-[8px] border border-border bg-card p-3">
                      <div>
                        <Kicker>ECO 变更范围</Kicker>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          只勾选本次真实发生、需要正式验证和多人协作的工程变化。轻微包装、印刷、标签等在产品库维护
                          Revision。
                        </p>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {ECO_CHANGE_SCOPE_OPTIONS.map(option => (
                          <label
                            key={option.key}
                            className="flex cursor-pointer items-start gap-2 rounded-[7px] border border-border bg-secondary/30 px-3 py-2.5 text-xs text-foreground transition-colors hover:bg-secondary/60"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(
                                form.changeScopeDeclaration[option.key]
                              )}
                              onChange={event =>
                                setForm({
                                  ...form,
                                  changeScopeDeclaration: {
                                    ...form.changeScopeDeclaration,
                                    [option.key]: event.target.checked,
                                  },
                                })
                              }
                              className="mt-0.5 h-3.5 w-3.5 accent-primary"
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                      {form.changeScopeDeclaration.targetMarketExpansion && (
                        <input
                          value={form.targetMarketsText}
                          onChange={event =>
                            setForm({
                              ...form,
                              targetMarketsText: event.target.value,
                            })
                          }
                          placeholder="新增目标市场，逗号分隔，例如 US, EU, JP"
                          className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                        />
                      )}
                      <textarea
                        value={form.changeScopeDeclaration.notes ?? ""}
                        onChange={event =>
                          setForm({
                            ...form,
                            changeScopeDeclaration: {
                              ...form.changeScopeDeclaration,
                              notes: event.target.value,
                            },
                          })
                        }
                        rows={2}
                        placeholder="补充变更程度、验证范围或切换方式（可选）"
                        className="w-full resize-none rounded-[7px] border border-border bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                      />
                    </div>
                  )}
                  {capturesEcoChangeScope && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Kicker className="mb-1.5">
                          安全风险（仅可主动升级）
                        </Kicker>
                        <select
                          value={form.safetyRiskLevel}
                          onChange={e =>
                            setForm({
                              ...form,
                              safetyRiskLevel: e.target.value as
                                | "standard"
                                | "high",
                            })
                          }
                          className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                        >
                          <option value="standard">标准</option>
                          <option value="high">高风险（锁定安全验证）</option>
                        </select>
                      </div>
                      <div>
                        <Kicker className="mb-1.5">
                          法规风险（仅可主动升级）
                        </Kicker>
                        <select
                          value={form.regulatoryRiskLevel}
                          onChange={e =>
                            setForm({
                              ...form,
                              regulatoryRiskLevel: e.target.value as
                                | "standard"
                                | "high",
                            })
                          }
                          className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[color:var(--acc-border)]"
                        >
                          <option value="standard">标准</option>
                          <option value="high">高风险（强制认证会签）</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Kicker className="mb-1.5">开始日期</Kicker>
                      <input
                        type="date"
                        value={form.startDate}
                        onChange={e =>
                          setForm({ ...form, startDate: e.target.value })
                        }
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      />
                    </div>
                    <div>
                      <Kicker className="mb-1.5">目标日期</Kicker>
                      <input
                        type="date"
                        value={form.targetDate}
                        onChange={e =>
                          setForm({ ...form, targetDate: e.target.value })
                        }
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      />
                    </div>
                  </div>
                  <details className="group rounded-[8px] border border-border bg-card">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
                      <div>
                        <Kicker>将创建的项目流程</Kicker>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          展开查看各阶段任务与 Gate 明细。
                        </p>
                      </div>
                      <ChevronRight
                        size={15}
                        className="shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
                      />
                    </summary>
                    <div className="grid grid-cols-1 gap-2 border-t border-border p-3 sm:grid-cols-2">
                      {sopPhases.map((phase, index) => (
                        <div
                          key={phase.id}
                          className="flex items-start gap-2 rounded-[7px] bg-secondary/40 px-3 py-2"
                        >
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white num"
                            style={{ backgroundColor: phase.color }}
                          >
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-foreground">
                              {phase.name}
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground">
                              {phase.tasks.length} 个任务 · Gate: {phase.gate}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex shrink-0 items-center justify-between border-t border-border p-6">
              <button
                onClick={() =>
                  step > 1 ? setStep((step - 1) as WizardStep) : handleClose()
                }
                disabled={isCreating}
                className="flex items-center gap-1.5 rounded-[7px] border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft size={14} />
                {step === 1 ? "取消" : "上一步"}
              </button>

              {step < 2 ? (
                <button
                  onClick={() => setStep(2)}
                  className="flex items-center gap-1.5 rounded-[7px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
                >
                  下一步
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={isCreateBlocked || isCreating}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[7px] bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90",
                    (isCreateBlocked || isCreating) && "cursor-not-allowed opacity-50"
                  )}
                >
                  <Check size={14} />
                  {isCreating ? "创建中…" : "创建项目"}
                </button>
              )}
            </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={zeroReuseWarningOpen} onOpenChange={setZeroReuseWarningOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>当前没有复用任何模块</AlertDialogTitle>
            <AlertDialogDescription>
              DRV 至少需要复用一个现有模块；如果全部模块重新开发，更符合 NPD。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setZeroReuseWarningOpen(false)}>返回修改</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              setZeroReuseWarningOpen(false);
              handleCategoryChange("npd");
              setStep(2);
            }}>切换为 NPD</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Drag Move Confirmation Dialog ── */}
      <AlertDialog
        open={!!moveConfirm}
        onOpenChange={open => {
          if (!open) setMoveConfirm(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ChevronRight size={18} className="text-primary rotate-180" />
              回退项目阶段
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-foreground">
                {moveConfirm && (
                  <p>
                    手动覆盖：
                    <span className="font-semibold">
                      {moveConfirm.project.name}
                    </span>
                    （
                    <span className="num">
                      {moveConfirm.project.code || moveConfirm.project.id}
                    </span>
                    ） {stageLabel(moveConfirm.fromStage)} →{" "}
                    {stageLabel(moveConfirm.toStage)}。
                    看板回退直接改阶段、不生成 Gate 记录；前进推进请走 Gate
                    评审。确认？
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMoveConfirm(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (moveConfirm) {
                  const { project, patch, undoPatch, successMsg } = moveConfirm;
                  setMoveConfirm(null);
                  void doMove(project, patch, undoPatch, successMsg);
                }
              }}
            >
              确认推进
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Confirmation Dialog ── */}
      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={open => {
          if (!open) setDeleteConfirm(null);
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[color:var(--destructive)]">
              <AlertTriangle size={18} />
              删除项目
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-foreground">
                <p>
                  您即将删除项目{" "}
                  <span className="font-semibold">
                    「{deleteConfirm?.name}」
                  </span>
                  。
                </p>
                <div className="mt-3 space-y-1 rounded border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/8 p-3 text-sm text-[color:var(--destructive)]">
                  <p className="font-medium">此操作将永久删除：</p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs">
                    <li>项目所有阶段和任务数据</li>
                    <li>所有问题记录和关门评审</li>
                    <li>所有附件文件（S3 存储）</li>
                    <li>变更日志和操作记录</li>
                    <li>已绑定的钉钉项目群</li>
                  </ul>
                  <p className="mt-2 font-medium">此操作不可撤销。</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirm) {
                  onDeleteProject(deleteConfirm.id);
                  setDeleteConfirm(null);
                }
              }}
              className="bg-[color:var(--destructive)] text-white hover:opacity-90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  // ── Sub-components defined inline so they close over canCreateProject etc. ──
  function ProjectCard({
    row,
    onOpen,
    onPreview,
    onToggleStar,
    draggable = false,
  }: {
    row: Row;
    onOpen: (id: string) => void;
    onPreview?: (id: string) => void;
    onToggleStar: (id: string) => void;
    draggable?: boolean;
  }) {
    const p = row.project;
    const drag = useDraggable({
      id: p.id,
      disabled: !draggable || !canDrag(p),
    });
    // dnd-kit's CSS.Translate without the @dnd-kit/utilities package (not installed)
    const transformStyle = drag.transform
      ? {
          transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)`,
        }
      : undefined;
    return (
      <LinearCard
        hover
        ref={drag.setNodeRef}
        {...(draggable ? drag.attributes : {})}
        {...(draggable ? drag.listeners : {})}
        style={transformStyle}
        className={cn(
          "cursor-pointer p-3",
          drag.isDragging && "z-10 opacity-60 shadow-lg"
        )}
        onClick={() => onOpen(p.id)}
      >
        <div className="flex items-center gap-2">
          <StatusDot tone={row.tone} />
          <span className="text-[10.5px] text-muted-foreground num">
            {p.code}
          </span>
          <span className="ml-auto inline-flex h-[18px] items-center rounded-[5px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] px-1.5 text-[9.5px] font-semibold text-primary">
            {row.catBadge}
          </span>
          {onPreview && (
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(p.id); }}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title="快速预览"
              aria-label="快速预览"
            >
              <Eye size={14} />
            </button>
          )}
          <button
            onClick={e => {
              e.stopPropagation();
              onToggleStar(p.id);
            }}
            className="shrink-0"
            title="标星"
            aria-label={row.isStarred ? '取消标星' : '标星'}
          >
            <Star
              size={14}
              style={
                row.isStarred
                  ? { fill: "var(--star)", color: "var(--star)" }
                  : { color: "var(--muted-foreground)" }
              }
            />
          </button>
        </div>
        {/* 名称为真按钮：键盘可达且避免整卡 role=button 内嵌交互控件的违例 */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}
          className="mt-2 block w-full rounded-[4px] text-left text-[13.5px] font-semibold leading-tight text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {p.name}
        </button>
        <div className="mt-2.5 flex items-center gap-2">
          <LinearBar value={row.overall} className="flex-1" />
          <span className="text-[11px] font-semibold text-muted-foreground num">
            {row.overall}%
          </span>
        </div>
        <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
          <div className="flex items-center gap-1.5">
            <Avatar name={pmLabel(p) || "?"} size={20} />
            <span className="text-[11.5px] text-[color:var(--secondary-foreground)]">
              {pmLabel(p) || "未分配"}
            </span>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground num">
            <CalendarDays size={11} />
            {p.targetDate || "—"}
          </span>
        </div>
      </LinearCard>
    );
  }

  function KanbanView({
    stages, groupBy, lanes, rows, isLaneCollapsed, onToggleLane, onToggleStar, onOpen, onPreview,
  }: {
    stages: typeof STAGE_COLUMNS; groupBy: GroupBy; lanes: Lane[]; rows: Row[];
    isLaneCollapsed: (k: string) => boolean; onToggleLane: (k: string) => void; onToggleStar: (id: string) => void; onOpen: (id: string) => void; onPreview?: (id: string) => void;
  }) {
    // Droppable stage column. laneKey='' for ungrouped (Task 3); Task 4 will pass
    // a real laneKey for cross-lane reassign via the same makeDropId encoding.
    const column = (laneKey: string, stageId: string, label: string, items: Row[]) => (
      <StageColumn key={`${laneKey}::${stageId}`} dropId={makeDropId(laneKey, stageId)} stageId={stageId} label={label} count={items.length}>
        {items.map((r) => <ProjectCard key={r.project.id} row={r} onOpen={onOpen} onPreview={onPreview} onToggleStar={onToggleStar} draggable />)}
      </StageColumn>
    );

    return (
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {groupBy === "none" ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stages.map(s =>
              column(
                "",
                s.id,
                s.label,
                rows.filter(r => r.stage === s.id)
              )
            )}
          </div>
        ) : (
          // Swimlanes: each lane is a row of stage columns
          <div className="flex flex-col gap-3 overflow-x-auto pb-2">
            {lanes.map(lane => {
              const ck = `${groupBy}:${lane.key}`;
              const collapsed = isLaneCollapsed(ck);
              return (
                <div key={lane.key}>
                  <button
                    onClick={() => onToggleLane(ck)}
                    className="mb-2 flex w-full items-center gap-2 text-left"
                  >
                    <ChevronRight
                      size={15}
                      className={cn(
                        "text-muted-foreground transition-transform",
                        !collapsed && "rotate-90"
                      )}
                    />
                    <span
                      className="h-4 w-1 rounded-[2px]"
                      style={{ background: lane.color }}
                    />
                    <span className="text-[13.5px] font-semibold">
                      {lane.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground num">
                      {lane.rows.length} 个项目
                    </span>
                  </button>
                  {!collapsed && (
                    <div className="flex gap-3 overflow-x-auto pb-2">
                      {stages.map(s =>
                        column(
                          lane.key,
                          s.id,
                          s.label,
                          lane.rows.filter(r => r.stage === s.id)
                        )
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DndContext>
    );
  }

  function StageColumn({
    dropId,
    stageId,
    label,
    count,
    children,
  }: {
    dropId: string;
    stageId: string;
    label: string;
    count: number;
    children: React.ReactNode;
  }) {
    const { setNodeRef, isOver } = useDroppable({ id: dropId });
    const limit = wipLimits[stageId];
    const atLimit = limit != null && count >= limit;
    // 无上限时，从当前列计数起步增减；setWipLimit 处理 ≤0 → 清除。
    const step = (delta: number) =>
      setWipLimit(stageId, (limit ?? count) + delta);
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex w-[208px] shrink-0 flex-col rounded-[12px] border bg-[color:var(--secondary)] transition-colors lg:w-auto lg:min-w-[208px] lg:flex-1 lg:shrink",
          isOver
            ? "border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]"
            : "border-border"
        )}
      >
        <div className="group/wip flex items-center gap-2 px-3 pb-2.5 pt-3">
          <span className="h-2 w-2 rounded-[3px] bg-primary" />
          <span className="flex-1 text-[12.5px] font-semibold">{label}</span>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={`降低 ${label} WIP 上限`}
            title="降低 WIP 上限"
            className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/wip:opacity-100"
          >
            <Minus size={11} />
          </button>
          <span className="rounded-full border border-border bg-card px-2 py-px text-[12px] text-muted-foreground num">
            <span className={cn(atLimit && "text-[color:var(--destructive)]")}>
              {count}
            </span>
            {limit != null && <span> / {limit}</span>}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={`提高 ${label} WIP 上限`}
            title="提高 WIP 上限"
            className="inline-flex h-4 w-4 items-center justify-center rounded-[4px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/wip:opacity-100"
          >
            <Plus size={11} />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-2.5 px-2.5 pb-2.5">
          {children}
        </div>
      </div>
    );
  }

  function ListView({
    rows,
    groupBy,
    lanes,
    onOpen,
  }: {
    rows: Row[];
    groupBy: GroupBy;
    lanes: Lane[];
    onOpen: (id: string) => void;
  }) {
    const tableHead = (
      <div className="grid grid-cols-[18px_1fr_120px_180px_140px_90px_64px] items-center gap-4 border-b border-border px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span />
        <span>项目</span>
        <span>阶段</span>
        <span>进度</span>
        <span>负责人</span>
        <span className="text-right">目标</span>
        <span className="text-right">操作</span>
      </div>
    );
    const rowEl = (r: Row) => (
      <div
        key={r.project.id}
        onClick={() => onOpen(r.project.id)}
        className="group grid cursor-pointer grid-cols-[18px_1fr_120px_180px_140px_90px_64px] items-center gap-4 border-b border-border px-4 py-2.5 transition-colors hover:bg-secondary"
      >
        <StatusDot tone={r.tone} />
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="shrink-0 text-[11.5px] text-muted-foreground num">{r.project.code}</span>
          {/* 名称为真按钮：行内其余操作是独立按钮，键盘可逐一到达 */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpen(r.project.id); }}
            className="min-w-0 truncate rounded-[4px] text-left text-[14px] font-medium text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {r.project.name}
          </button>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-[color:var(--secondary-foreground)]">
          <span className="h-1.5 w-1.5 rounded-[2px] bg-primary" />
          {STAGE_SHORT[r.stage]}
        </span>
        <div className="flex items-center gap-2">
          <LinearBar value={r.overall} className="flex-1" />
          <span className="w-8 text-right text-[12px] text-muted-foreground num">
            {r.overall}%
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Avatar name={pmLabel(r.project) || "?"} size={22} />
          <span className="truncate text-[12.5px] text-[color:var(--secondary-foreground)]">
            {pmLabel(r.project) || "未分配"}
          </span>
        </div>
        <span className="text-right text-[12px] text-muted-foreground num">
          {r.project.targetDate || "—"}
        </span>
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={e => handleOpenClone(e, r.project)}
            title="克隆项目"
            aria-label="克隆项目"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <Copy size={14} />
          </button>
          {r.project.canDeleteProject && (
            <button
              onClick={e => {
                e.stopPropagation();
                setDeleteConfirm({ id: r.project.id, name: r.project.name });
              }}
              title="删除项目"
              aria-label="删除项目"
              className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-card hover:text-[color:var(--destructive)]"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
    );

    // 移动端：纵向摘要行（名称/阶段 + 编号/负责人/目标 + 进度），避免窄屏表格挤压
    const mobileRowEl = (r: Row) => (
      <button
        key={r.project.id}
        type="button"
        onClick={() => onOpen(r.project.id)}
        className="flex w-full flex-col gap-1.5 border-b border-border px-4 py-3 text-left transition-colors hover:bg-secondary"
      >
        <div className="flex w-full items-center gap-2">
          <StatusDot tone={r.tone} />
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{r.project.name}</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-[color:var(--secondary-foreground)]">
            {STAGE_SHORT[r.stage]}
          </span>
        </div>
        <div className="flex w-full items-center gap-2 pl-[26px] text-[11.5px] text-muted-foreground">
          {r.project.code && (
            <>
              <span className="num shrink-0">{r.project.code}</span>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span className="min-w-0 truncate">{pmLabel(r.project) || '未分配'}</span>
          <span className="num ml-auto shrink-0">{r.project.targetDate || '—'}</span>
        </div>
        <div className="flex w-full items-center gap-2 pl-[26px]">
          <LinearBar value={r.overall} className="flex-1" />
          <span className="num text-[11px] text-muted-foreground">{r.overall}%</span>
        </div>
      </button>
    );
    const laneHead = (lane: Lane) => (
      <div className="flex items-center gap-2 bg-secondary px-4 py-2">
        <span className="h-2 w-2 rounded-full" style={{ background: lane.color }} />
        <span className="text-[12.5px] font-semibold">{lane.label}</span>
        <span className="text-[12px] text-muted-foreground num">{lane.rows.length}</span>
      </div>
    );

    return (
      <LinearCard className="overflow-hidden">
        <div className="md:hidden">
          {groupBy === 'none'
            ? rows.map(mobileRowEl)
            : lanes.map((lane) => (
              <div key={lane.key}>
                {laneHead(lane)}
                {lane.rows.map(mobileRowEl)}
              </div>
            ))}
        </div>
        <div className="hidden overflow-x-auto md:block">
          <div className="min-w-[760px]">
            {tableHead}
            {groupBy === "none"
              ? rows.map(rowEl)
              : lanes.map((lane) => (
                <div key={lane.key}>
                  {laneHead(lane)}
                  {lane.rows.map(rowEl)}
                </div>
              ))}
          </div>
        </div>
      </LinearCard>
    );
  }

  function TimelineView({
    rows,
    groupBy,
    lanes,
    onOpen,
  }: {
    rows: Row[];
    groupBy: GroupBy;
    lanes: Lane[];
    onOpen: (id: string) => void;
  }) {
    // Display-only portfolio timeline: each project = a bar spanning start→target across a month axis.
    const parse = (s: string) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const allDates = rows
      .flatMap(r => [parse(r.project.startDate), parse(r.project.targetDate)])
      .filter(Boolean) as Date[];
    const now = new Date();
    const min = allDates.length
      ? new Date(Math.min(...allDates.map(d => d.getTime())))
      : new Date(now.getFullYear(), 0, 1);
    const max = allDates.length
      ? new Date(Math.max(...allDates.map(d => d.getTime()), now.getTime()))
      : new Date(now.getFullYear(), 11, 31);
    // Build month buckets
    const months: { y: number; m: number }[] = [];
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    const end = new Date(max.getFullYear(), max.getMonth(), 1);
    while (cur <= end) {
      months.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
      cur.setMonth(cur.getMonth() + 1);
    }
    if (months.length === 0)
      months.push({ y: now.getFullYear(), m: now.getMonth() + 1 });
    const COLW = 78,
      LABELW = 220;
    const trackW = COLW * months.length;
    const monthIndex = (d: Date) =>
      (d.getFullYear() - months[0].y) * 12 + (d.getMonth() + 1 - months[0].m);
    const todayPx = (monthIndex(now) + now.getDate() / 30) * COLW;

    const rowEl = (r: Row) => {
      const s = parse(r.project.startDate),
        e = parse(r.project.targetDate);
      const si = s ? monthIndex(s) : 0;
      const ei = e ? monthIndex(e) : Math.min(months.length - 1, si + 3);
      const left = Math.max(0, si) * COLW;
      const width = Math.max(
        COLW * 0.6,
        (Math.max(ei, si) - Math.max(0, si) + 1) * COLW
      );
      const barColor =
        r.tone === "red"
          ? "var(--destructive)"
          : r.tone === "amber"
            ? "var(--warning)"
            : "var(--primary)";
      return (
        <div key={r.project.id} className="flex border-b border-border">
          <div
            role="button"
            tabIndex={0}
            onClick={() => onOpen(r.project.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.project.id); }
            }}
            className="sticky left-0 z-[2] flex shrink-0 cursor-pointer items-center gap-2.5 border-r border-border bg-card px-3.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
            style={{ width: LABELW, height: 48 }}
          >
            <StatusDot tone={r.tone} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">
                {r.project.name}
              </div>
              <div className="text-[10.5px] text-muted-foreground num">
                {r.project.code} · {STAGE_SHORT[r.stage]}
              </div>
            </div>
            <Avatar name={pmLabel(r.project) || "?"} size={22} />
          </div>
          <div
            onClick={() => onOpen(r.project.id)}
            className="relative shrink-0 cursor-pointer"
            style={{
              width: trackW,
              height: 48,
              backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent ${COLW - 1}px, var(--border) ${COLW - 1}px, var(--border) ${COLW}px)`,
            }}
          >
            <div
              className="absolute flex items-center gap-2 overflow-hidden rounded-[6px] px-2.5 text-[11px] font-semibold text-white"
              style={{ left, width, top: 11, height: 26, background: barColor }}
            >
              <span>{STAGE_SHORT[r.stage]}</span>
              <span className="opacity-80 num">{r.overall}%</span>
            </div>
          </div>
        </div>
      );
    };

    return (
      <LinearCard className="overflow-auto">
        <div className="min-w-min">
          {/* Axis header */}
          <div className="sticky top-0 z-[4] flex border-b border-border bg-card">
            <div
              className="sticky left-0 z-[6] flex shrink-0 items-center border-r border-border bg-card px-3.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              style={{ width: LABELW, height: 38 }}
            >
              项目 / 排期
            </div>
            <div className="flex">
              {months.map((mm, i) => (
                <div
                  key={i}
                  className="shrink-0 border-l border-border py-2 text-center text-[11px] text-muted-foreground num"
                  style={{ width: COLW }}
                >
                  {mm.m}月
                  {mm.m === 1 ? (
                    <span className="block text-[9px] text-muted-foreground">
                      {mm.y}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            {groupBy === "none"
              ? rows.map(rowEl)
              : lanes.map(lane => (
                  <div key={lane.key}>
                    <div className="flex bg-secondary">
                      <div
                        className="sticky left-0 z-[2] flex shrink-0 items-center gap-2 border-r border-border bg-secondary px-3.5 text-[12px] font-semibold"
                        style={{ width: LABELW, height: 34 }}
                      >
                        <span
                          className="h-3.5 w-1 rounded-[2px]"
                          style={{ background: lane.color }}
                        />
                        {lane.label}
                        <span className="text-muted-foreground num">
                          {lane.rows.length}
                        </span>
                      </div>
                      <div
                        className="shrink-0"
                        style={{ width: trackW, height: 34 }}
                      />
                    </div>
                    {lane.rows.map(rowEl)}
                  </div>
                ))}
            {/* Today line */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-[3] w-0.5 bg-primary"
              style={{ left: LABELW + todayPx }}
            />
          </div>
        </div>
      </LinearCard>
    );
  }
}

function PropRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-1.5 last:border-none">
      <span className="text-[12.5px] text-muted-foreground">{k}</span>
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        {v}
      </span>
    </div>
  );
}

// Linear redesign — 项目组合看板 (portfolio board)
// Phase 1: VISUAL ONLY. Three view modes (list / kanban / timeline) derived from the
// existing `projects` data. No drag-and-drop, no WIP limits, no toast-undo, no persisted
// grouping/collapse state. All existing data wiring + mutations (add / delete / clone)
// are preserved; only presentation changed.

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { toast } from 'sonner';
import {
  DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import { Plus, Minus, Trash2, ChevronRight, ChevronLeft, Check, Copy, Lock, AlertTriangle, Search, Star, LayoutGrid, List as ListIcon, GanttChartSquare, X as XIcon, CalendarDays } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  Project, PHASE_MAP, HEALTH_CONFIG,
  computePhaseProgress, computeOverallProgress, getProjectPhases,
} from '@/lib/data';
import {
  PROJECT_CATEGORIES, ProjectCategory, getPhasesForCategory, CATEGORY_MAP,
} from '@/lib/sop-templates';
import {
  LinearCard, Kicker, PageHeader, StatusDot, LinearBar, SegToggle, TypeBadge,
} from '@/components/linear/primitives';
import { cn } from '@/lib/utils';
import { useBoardPrefs } from '@/hooks/useBoardPrefs';

interface ProjectListViewProps {
  projects: Project[];
  onSelectProject: (id: string) => void;
  onAddProject: (project: Omit<Project, 'id' | 'phases'>) => void;
  onDeleteProject: (id: string) => void;
  onCloneProject?: (sourceId: string, overrides: Partial<Omit<Project, 'id' | 'phases'>>) => void;
  /** Whether the current user can create new projects */
  canCreateProject?: boolean;
}

// ── Wizard Steps ──────────────────────────────────────────────────────────────
type WizardStep = 1 | 2 | 3;

const STEP_LABELS: Record<WizardStep, string> = {
  1: '选择类别',
  2: '填写信息',
  3: '确认流程',
};

const PRODUCT_TYPES = [
  '汽车充气泵', '自行车充气泵', '户外充气泵', '车载吸尘器',
  '暴力风扇', '胎压计', '机械式打气筒', '组件',
];

// ── Kanban stage columns (display-only) ─────────────────────────────────────────
// The 6 canonical lifecycle stages. Each project's currentPhase is mapped onto one of
// these stage buckets so projects with category-specific SOP templates still slot in.
const STAGE_COLUMNS: { id: string; label: string; short: string }[] = [
  { id: 'concept', label: '概念 Concept', short: '概念' },
  { id: 'design', label: '设计 Design', short: '设计' },
  { id: 'evt', label: 'EVT 工程样机', short: 'EVT' },
  { id: 'dvt', label: 'DVT 设计验证', short: 'DVT' },
  { id: 'pvt', label: 'PVT 试产', short: 'PVT' },
  { id: 'mp', label: '量产 MP', short: '量产' },
];
const STAGE_IDS = STAGE_COLUMNS.map((s) => s.id);
const STAGE_SHORT: Record<string, string> = Object.fromEntries(STAGE_COLUMNS.map((s) => [s.id, s.short]));

// ── Drop-zone id helpers ────────────────────────────────────────────────────
// Encode lane + stage into a single droppable id. Task 3 uses laneKey='' (no
// grouping); Task 4 will pass a real laneKey for cross-lane reassign. Splitting
// on '::' keeps the parser forward-compatible.
function makeDropId(laneKey: string, stageId: string): string {
  return `${laneKey}::${stageId}`;
}
function parseDrop(id: string): { laneKey: string; stageId: string } {
  const idx = String(id).indexOf('::');
  if (idx === -1) return { laneKey: '', stageId: String(id) };
  return { laneKey: String(id).slice(0, idx), stageId: String(id).slice(idx + 2) };
}

// Map an arbitrary phase id onto a kanban stage bucket.
function stageBucket(phaseId: string): string {
  if (STAGE_IDS.includes(phaseId)) return phaseId;
  if (phaseId === 'planning') return 'concept';
  return 'concept';
}

// Risk → StatusDot tone
function riskTone(risk: Project['risk']): 'green' | 'amber' | 'red' {
  return risk === 'high' ? 'red' : risk === 'medium' ? 'amber' : 'green';
}

// Deterministic avatar color from a name
const AVATAR_COLORS = ['#5e6ad2', '#3fa66a', '#d97706', '#0ea5e9', '#db2777', '#0891b2'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initial(name: string): string {
  return (name || '?').trim().charAt(0) || '?';
}

type GroupBy = 'none' | 'type' | 'cat' | 'pm';
type FilterKey = 'ontrack' | 'risk' | 'alert' | 'starred';
type ViewMode = 'list' | 'kanban' | 'timeline';

// Sentinel lane key for "unassigned" (no pm / no product). Must be used
// consistently in laneKeyOf() AND when decoding the drop target so bucketing and
// reassign stay in lockstep.
const LANE_NONE = '__none__';

// The single source of truth for a project's lane key under a given groupBy.
// Used BOTH to bucket projects into lanes AND to build the droppable dropId, so
// the value a card lands on always round-trips back to the same lane.
//   - 'pm'   → pmUserId (numeric, stringified) — reassign target is pmUserId
//   - 'type' → productId (产品线) — reassign target is productId
//   - 'cat'  → category id (NOT reassignable)
function laneKeyOf(project: Project, groupBy: GroupBy): string {
  if (groupBy === 'pm') return project.pmUserId != null ? String(project.pmUserId) : LANE_NONE;
  if (groupBy === 'type') return project.productId != null && project.productId !== '' ? project.productId : LANE_NONE;
  if (groupBy === 'cat') return project.category || 'npd';
  return '';
}

function Avatar({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: avatarColor(name), fontSize: size * 0.46 }}
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
  const [cloneSource, setCloneSource] = useState<Project | null>(null);
  const [cloneForm, setCloneForm] = useState({ name: '', code: '', pmUserId: null as number | null, startDate: '', targetDate: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

  // ── Board presentation state (local only; collapse/WIP prefs are persisted via useBoardPrefs) ──
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [activeFilter, setActiveFilter] = useState<FilterKey | null>(null);
  const [search, setSearch] = useState('');
  const [starred, setStarred] = useState<Set<string>>(() => new Set()); // display-only star
  const [detailId, setDetailId] = useState<string | null>(null);

  const handleOpenClone = (e: React.MouseEvent, project: Project) => {
    e.stopPropagation();
    setCloneSource(project);
    setCloneForm({
      name: `${project.name}（副本）`,
      code: '',
      pmUserId: project.pmUserId ?? null,
      startDate: '',
      targetDate: '',
    });
  };

  const handleCloneConfirm = () => {
    if (!cloneSource || !cloneForm.name.trim()) return;
    onCloneProject?.(cloneSource.id, {
      name: cloneForm.name.trim(),
      code: cloneForm.code.trim() || undefined as unknown as string,
      pmUserId: cloneForm.pmUserId,
      startDate: cloneForm.startDate,
      targetDate: cloneForm.targetDate,
    });
    setCloneSource(null);
  };
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedCategory, setSelectedCategory] = useState<ProjectCategory>('npd');
  const { data: userList, isLoading: usersLoading, isError: usersError } = trpc.admin.listUsersForSelect.useQuery();
  const utils = trpc.useUtils();

  // ── Drag-to-advance/regress (PM/admin override) ──
  const { user } = useAuth();
  const isAdmin = (user as (typeof user & { role?: string }) | null)?.role === 'admin';
  const moveMut = trpc.projects.move.useMutation();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  // WIP 上限（per-stage，跨泳道共享，持久化在 localStorage）。
  const { wipLimits, setWipLimit, isLaneCollapsed, toggleLane: toggleLanePersist } = useBoardPrefs();
  // Patch shape accepted by trpc.projects.move (only provided fields are written).
  type MovePatch = { currentPhase?: string; pmUserId?: number | null; productId?: string | null };
  // Pending drag awaiting confirmation. `patch`/`undoPatch`/`successMsg` carry the
  // full mutation (stage and/or reassign) so the confirm dialog can dispatch it.
  const [moveConfirm, setMoveConfirm] = useState<
    { project: Project; fromStage: string; toStage: string; patch: MovePatch; undoPatch: MovePatch; successMsg: string } | null
  >(null);

  // Can the current user drag (override the phase of) this project?
  const canDrag = (project: Project): boolean =>
    isAdmin || !!project.canEditProjectInfo;

  const stageLabel = (stageId: string): string =>
    STAGE_COLUMNS.find((s) => s.id === stageId)?.label ?? stageId;

  // Refresh the board: `projects` is a prop derived from trpc.projects.list in
  // Home, so invalidating that query (the same path Home's invalidateProjects
  // uses) re-fetches and re-renders the board with persisted data.
  const refreshBoard = () => {
    utils.projects.list.invalidate();
    utils.projects.portfolio.invalidate();
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (!e.over) return;
    const project = projects.find((p) => p.id === String(e.active.id));
    if (!project || !canDrag(project)) return;
    const { stageId: toStage, laneKey: toLane } = parseDrop(String(e.over.id));
    const fromStage = stageBucket(project.currentPhase);
    const stageChanged = !!toStage && toStage !== fromStage;

    // Cross-lane reassign — only for pm (负责人) and type (产品线) groupings.
    // cat (项目类型) and none must NEVER reassign.
    let reassignPatch: MovePatch | null = null;
    let undoReassign: MovePatch | null = null;
    let reassignLabel = '';
    if (toLane != null && toLane !== '' && (groupBy === 'pm' || groupBy === 'type')) {
      const fromLane = laneKeyOf(project, groupBy);
      if (toLane !== fromLane) {
        if (groupBy === 'pm') {
          const newPm = toLane === LANE_NONE ? null : Number(toLane);
          reassignPatch = { pmUserId: newPm };
          undoReassign = { pmUserId: project.pmUserId ?? null };
          reassignLabel = '改派负责人';
        } else { // 'type' → 产品线
          const newProduct = toLane === LANE_NONE ? null : toLane;
          reassignPatch = { productId: newProduct };
          undoReassign = { productId: project.productId ?? null };
          reassignLabel = '改派产品线';
        }
      }
    }

    if (!stageChanged && !reassignPatch) return;

    // 只允许往回拖（回退）；前进必须走项目详情的 Gate 评审，看板不做前进推进。
    if (stageChanged) {
      const fromIdx = STAGE_IDS.indexOf(fromStage);
      const toIdx = STAGE_IDS.indexOf(toStage);
      if (fromIdx >= 0 && toIdx > fromIdx) {
        toast.error('看板只支持往回拖（回退）；前进推进请在项目详情走 Gate 评审');
        return;
      }
    }

    // HARD WIP 上限：只有阶段推进（toStage 变化）才受限；纯改派不受 WIP 约束。
    // 限制是 per-stage 的，计数为全板内 currentPhase 落在 toStage 的项目总数。
    if (stageChanged) {
      const limit = wipLimits[toStage];
      if (limit != null) {
        const countInTarget = projects.filter((p) => stageBucket(p.currentPhase) === toStage).length;
        if (countInTarget >= limit) {
          toast.error(`${stageLabel(toStage)} 已达 WIP 上限 ${limit}`);
          return; // 不进入 confirm/move
        }
      }
    }

    if (stageChanged && reassignPatch) {
      // Combined推进+改派 → keep the confirm dialog (stage change is the heavy part).
      setMoveConfirm({
        project, fromStage, toStage,
        patch: { currentPhase: toStage, ...reassignPatch },
        // 撤销须还原“原始”阶段（可能是 planning/d3 等细粒度 phase），不能用 stageBucket 折叠后的 fromStage
        undoPatch: { currentPhase: project.currentPhase, ...undoReassign! },
        successMsg: `已回退并改派 · 可撤销`,
      });
    } else if (reassignPatch) {
      // Reassign-only is lighter → no confirm, dispatch directly.
      void doMove(project, reassignPatch, undoReassign!, `已${reassignLabel} · 可撤销`);
    } else {
      // Stage-only → existing confirm path.
      setMoveConfirm({
        project, fromStage, toStage,
        patch: { currentPhase: toStage },
        // 撤销还原原始细粒度 phase（非 stageBucket 折叠值）
        undoPatch: { currentPhase: project.currentPhase },
        successMsg: `已将 ${project.name} 回退到 ${stageLabel(toStage)} · 可撤销`,
      });
    }
  };

  // Generic move: apply `patch`, on success offer 撤销 that applies `undoPatch`.
  const doMove = async (project: Project, patch: MovePatch, undoPatch: MovePatch, successMsg: string) => {
    try {
      await moveMut.mutateAsync({ id: project.id, ...patch });
      refreshBoard();
      toast.success(successMsg, {
        action: {
          label: '撤销',
          onClick: async () => {
            try {
              await moveMut.mutateAsync({ id: project.id, ...undoPatch });
              refreshBoard();
              toast.success(`已撤销 · ${project.name}`);
            } catch {
              toast.error('撤销失败');
              refreshBoard();
            }
          },
        },
      });
    } catch {
      toast.error('操作失败，已回滚');
      refreshBoard();
    }
  };
  const { data: productList = [] } = trpc.products.list.useQuery(undefined);
  const products = productList as Array<{ id: string; name: string; productNumber: string }>;
  const createProductMutation = trpc.products.create.useMutation({
    onSuccess: () => utils.products.list.invalidate(),
  });

  const emptyForm = {
    code: '',
    name: '',
    type: '汽车充气泵',
    pmUserId: null as number | null,
    productId: '' as string,        // 关联已有产品
    newProductName: '' as string,   // 新产品(填写则建档并关联)
    startDate: '',
    targetDate: '',
    risk: 'low' as 'low' | 'medium' | 'high',
  };
  const [form, setForm] = useState(emptyForm);

  const resetWizard = () => {
    setStep(1);
    setSelectedCategory('npd');
    setForm(emptyForm);
  };

  const handleClose = () => {
    setShowAdd(false);
    resetWizard();
  };

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const phases = getPhasesForCategory(selectedCategory);
    const firstPhaseId = phases[0]?.id || 'concept';
    // 关联产品:选了已有 → 用它;否则填了新产品名 → 先建档再关联
    let productId: string | null = form.productId || null;
    if (!productId && form.newProductName.trim()) {
      try {
        const res = await createProductMutation.mutateAsync({ name: form.newProductName.trim(), type: 'finished', category: form.type });
        productId = res.id;
      } catch { /* 建产品失败不阻断建项目 */ }
    }
    onAddProject({
      code: form.code, name: form.name, type: form.type, pmUserId: form.pmUserId,
      startDate: form.startDate, targetDate: form.targetDate, risk: form.risk,
      productId,
      pm: '',
      currentPhase: firstPhaseId,
      category: selectedCategory,
    });
    handleClose();
  };

  const categoryConfig = CATEGORY_MAP[selectedCategory];
  const sopPhases = getPhasesForCategory(selectedCategory);

  // ── Derived per-project presentation model ───────────────────────────────────
  interface Row {
    project: Project;
    stage: string;
    overall: number;
    phaseProgress: number;
    tone: 'green' | 'amber' | 'red';
    phaseName: string;
    catId: string;
    catBadge: string;
    isStarred: boolean;
  }
  const rows: Row[] = useMemo(() => projects.map((project) => {
    const phases = project.category ? getPhasesForCategory(project.category) : getProjectPhases(project);
    const phaseObj = phases.find((p) => p.id === project.currentPhase) || PHASE_MAP[project.currentPhase];
    const catId = project.category || 'npd';
    const catConfig = CATEGORY_MAP[catId as ProjectCategory];
    return {
      project,
      stage: stageBucket(project.currentPhase),
      overall: computeOverallProgress(project),
      phaseProgress: computePhaseProgress(project.phases[project.currentPhase], project.currentPhase),
      tone: riskTone(project.risk),
      phaseName: phaseObj?.name || project.currentPhase,
      catId,
      catBadge: catConfig?.badge || 'NPD',
      isStarred: starred.has(project.id),
    };
  }), [projects, starred]);

  // pmUserId → 显示名解析（行的 project.pm 在数据层是空串，名字在 UI 用 listUsersForSelect 解析）
  const pmNameById = useMemo(() => {
    const m = new Map<string, string>();
    (userList || []).forEach((u) => m.set(String(u.id), u.name || u.username || `#${u.id}`));
    return m;
  }, [userList]);
  const pmLabel = (p: Project): string =>
    (p.pm && p.pm.trim()) || (p.pmUserId != null ? pmNameById.get(String(p.pmUserId)) ?? '' : '');

  // ── Filter + search ──────────────────────────────────────────────────────────
  const matches = (r: Row): boolean => {
    if (activeFilter === 'ontrack' && r.project.risk !== 'low') return false;
    if (activeFilter === 'risk' && r.project.risk !== 'medium') return false;
    if (activeFilter === 'alert' && r.project.risk !== 'high') return false;
    if (activeFilter === 'starred' && !r.isStarred) return false;
    const q = search.trim().toLowerCase();
    if (q) {
      const hay = `${r.project.name} ${r.project.code} ${pmLabel(r.project)} ${r.project.type}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };
  const visibleRows = rows.filter(matches);

  // ── Grouping (swimlanes) ───────────────────────────────────────────────────────
  // id → human label resolvers for the id-based lane keys (pmUserId / productId).
  const productNameById = useMemo(() => {
    const m = new Map<string, string>();
    products.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [products]);
  interface Lane { key: string; label: string; color: string; rows: Row[] }
  const lanes: Lane[] = useMemo(() => {
    if (groupBy === 'none') return [];
    const map = new Map<string, Lane>();
    const colorFor = (k: string) => avatarColor(k);
    visibleRows.forEach((r) => {
      // laneKeyOf is the single source of truth: the lane key is exactly the value
      // a card's droppable carries, so cross-lane drops resolve back to this lane.
      const key = laneKeyOf(r.project, groupBy);
      let label: string;
      if (groupBy === 'type') {
        label = key === LANE_NONE ? '未关联产品' : (productNameById.get(key) || r.project.type || key);
      } else if (groupBy === 'cat') {
        label = CATEGORY_MAP[r.catId as ProjectCategory]?.name || r.catBadge;
      } else { // 'pm'
        label = key === LANE_NONE ? '未分配' : (pmLabel(r.project) || pmNameById.get(key) || `#${key}`);
      }
      if (!map.has(key)) map.set(key, { key, label, color: colorFor(key), rows: [] });
      map.get(key)!.rows.push(r);
    });
    return Array.from(map.values());
  }, [visibleRows, groupBy, productNameById, pmNameById]);

  const toggleLane = toggleLanePersist;
  const toggleStar = (id: string) => setStarred((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Filter chip definitions with live counts ──
  const filterChips: { key: FilterKey; label: string; dot: string; count: number }[] = [
    { key: 'ontrack', label: '按期', dot: 'var(--success)', count: rows.filter((r) => r.project.risk === 'low').length },
    { key: 'risk', label: '风险', dot: 'var(--warning)', count: rows.filter((r) => r.project.risk === 'medium').length },
    { key: 'alert', label: '告警', dot: 'var(--destructive)', count: rows.filter((r) => r.project.risk === 'high').length },
    { key: 'starred', label: '已标星', dot: 'var(--star)', count: rows.filter((r) => r.isStarred).length },
  ];

  const detailRow = detailId ? rows.find((r) => r.project.id === detailId) ?? null : null;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <PageHeader
        title="项目组合"
        sub={<><span className="num">{projects.length}</span> 个项目 · 全生命周期看板</>}
        actions={
          canCreateProject ? (
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90"
            >
              <Plus size={15} />
              新建项目
            </button>
          ) : (
            <div className="inline-flex h-[30px] cursor-not-allowed items-center gap-1.5 rounded-[7px] border border-border bg-secondary px-3 text-[11px] font-medium text-muted-foreground" title="仅管理员、管理层和 PM 可创建项目">
              <Lock size={12} />
              无创建权限
            </div>
          )
        }
      />

      {/* View toggle + search */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <SegToggle<ViewMode>
          value={viewMode}
          onChange={setViewMode}
          options={[
            { value: 'list', label: <><ListIcon size={12} />列表</> },
            { value: 'kanban', label: <><LayoutGrid size={12} />看板</> },
            { value: 'timeline', label: <><GanttChartSquare size={12} />时间轴</> },
          ]}
        />
        <div className="flex h-[32px] w-[240px] items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:border-[color:var(--acc-border)] focus-within:ring-2 focus-within:ring-[color:var(--acc-soft)]">
          <Search size={14} className="shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索项目 / 编号 / 负责人…"
            className="w-full bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
        </div>
      </div>

      {/* Filter strip: group-by + filter chips */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-2">
          <Kicker>分组</Kicker>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="cursor-pointer rounded-[7px] border border-transparent bg-secondary px-2.5 py-1 text-[12.5px] font-medium text-foreground outline-none hover:bg-[color:var(--muted)] focus:border-[color:var(--acc-border)]"
          >
            <option value="none">无</option>
            <option value="type">产品线</option>
            <option value="cat">项目类型</option>
            <option value="pm">负责人</option>
          </select>
        </div>
        <div className="h-5 w-px bg-border" />
        <div className="flex flex-wrap items-center gap-2">
          {filterChips.map((c) => {
            const on = activeFilter === c.key;
            return (
              <button
                key={c.key}
                onClick={() => setActiveFilter(on ? null : c.key)}
                className={cn(
                  'inline-flex h-[26px] items-center gap-1.5 rounded-[7px] border px-2.5 text-[12px] transition-colors',
                  on
                    ? 'border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] text-primary'
                    : 'border-transparent bg-secondary text-[color:var(--secondary-foreground)] hover:bg-[color:var(--muted)]',
                )}
              >
                {c.key === 'starred'
                  ? <Star size={11} style={{ fill: 'var(--star)', color: 'var(--star)' }} />
                  : <span className="h-[7px] w-[7px] rounded-full" style={{ background: c.dot }} />}
                {c.label}
                <span className="num text-[11px] opacity-70">{c.count}</span>
              </button>
            );
          })}
          {(activeFilter || search) && (
            <button
              onClick={() => { setActiveFilter(null); setSearch(''); }}
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
          <p className="text-sm font-medium text-muted-foreground">无匹配的项目</p>
        </LinearCard>
      ) : viewMode === 'kanban' ? (
        <KanbanView
          stages={STAGE_COLUMNS}
          groupBy={groupBy}
          lanes={lanes}
          rows={visibleRows}
          isLaneCollapsed={isLaneCollapsed}
          onToggleLane={toggleLane}
          onToggleStar={toggleStar}
          onOpen={setDetailId}
        />
      ) : viewMode === 'list' ? (
        <ListView rows={visibleRows} groupBy={groupBy} lanes={lanes} onOpen={setDetailId} />
      ) : (
        <TimelineView rows={visibleRows} groupBy={groupBy} lanes={lanes} onOpen={setDetailId} />
      )}

      {/* ── Detail Drawer ── */}
      <Dialog open={!!detailRow} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-[460px] gap-0 overflow-hidden p-0">
          {detailRow && (() => {
            const p = detailRow.project;
            const phases = p.category ? getPhasesForCategory(p.category) : getProjectPhases(p);
            const curIdx = phases.findIndex((ph) => ph.id === p.currentPhase);
            const health = HEALTH_CONFIG[p.risk];
            const changeLog = (p.changeLog || []).slice(0, 5);
            return (
              <div className="flex max-h-[85vh] flex-col">
                {/* Header */}
                <div className="border-b border-border px-5 pb-4 pt-5">
                  <div className="mb-3 flex items-center gap-2.5">
                    <span className="text-[11.5px] text-muted-foreground num">{p.code}</span>
                    <TypeBadge type={detailRow.catBadge} />
                  </div>
                  <DialogTitle className="text-[21px] font-bold leading-tight tracking-[-0.3px]">{p.name}</DialogTitle>
                  <p className="mt-1 text-[12px] text-muted-foreground">{p.type}</p>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* Properties */}
                  <section className="mb-6">
                    <Kicker className="mb-3">参数 Properties</Kicker>
                    <div className="space-y-0">
                      <PropRow k="当前阶段" v={<span className="inline-flex items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11.5px]"><span className="h-1.5 w-1.5 rounded-full bg-primary" />{detailRow.phaseName}</span>} />
                      <PropRow k="整体进度" v={<span className="num">{detailRow.overall}%</span>} />
                      <PropRow k="风险" v={<span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: detailRow.tone === 'green' ? 'var(--success)' : detailRow.tone === 'amber' ? 'var(--warning)' : 'var(--destructive)' }} />{health.label}</span>} />
                      <PropRow k="负责人" v={<span className="inline-flex items-center gap-2"><Avatar name={pmLabel(p) || '?'} size={20} />{pmLabel(p) || '未分配'}</span>} />
                      <PropRow k="目标日期" v={<span className="num">{p.targetDate || '—'}</span>} />
                    </div>
                  </section>

                  {/* Lifecycle stepper */}
                  <section className="mb-6">
                    <Kicker className="mb-3">生命周期 Lifecycle</Kicker>
                    <div className="flex flex-col">
                      {phases.map((ph, i) => {
                        const done = i < curIdx, cur = i === curIdx;
                        return (
                          <div key={ph.id} className="relative flex h-[34px] items-center gap-3">
                            {i < phases.length - 1 && (
                              <span className={cn('absolute left-[5px] top-[17px] h-[34px] w-0.5', done ? 'bg-primary' : 'bg-border')} />
                            )}
                            <span className={cn(
                              'z-[1] h-[11px] w-[11px] shrink-0 rounded-full border-2',
                              done ? 'border-primary bg-primary'
                                : cur ? 'border-primary bg-primary shadow-[0_0_0_4px_var(--acc-soft)]'
                                : 'border-border bg-card',
                            )} />
                            <span className={cn('text-[13px]', cur ? 'font-semibold text-primary' : done ? 'text-foreground' : 'text-muted-foreground')}>
                              {ph.name}
                            </span>
                            <span className="ml-auto text-[11px] text-muted-foreground">{cur ? '当前' : done ? '✓' : ''}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Recent changes */}
                  <section>
                    <Kicker className="mb-3">最近变更 Activity</Kicker>
                    {changeLog.length === 0 ? (
                      <p className="text-[12px] text-muted-foreground">暂无变更记录</p>
                    ) : (
                      <div className="flex flex-col">
                        {changeLog.map((c, i) => (
                          <div key={i} className="flex gap-2.5 border-b border-border py-2 last:border-none">
                            <div className="text-[12px] leading-snug text-[color:var(--secondary-foreground)]">
                              {c.title || c.description || '变更'}
                              <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                                {c.decisionMaker || ''}
                                {c.createdDate || c.createdAt ? ` · ${c.createdDate || c.createdAt}` : ''}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* Footer: navigation + clone/delete actions */}
                <div className="flex items-center gap-2 border-t border-border px-5 py-3.5">
                  <button
                    onClick={() => { onSelectProject(p.id); setDetailId(null); }}
                    className="inline-flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-[7px] bg-primary text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90"
                  >
                    进入项目
                    <ChevronRight size={14} />
                  </button>
                  <button
                    onClick={(e) => handleOpenClone(e, p)}
                    title="克隆项目"
                    aria-label="克隆项目"
                    className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-[7px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <Copy size={15} />
                  </button>
                  {p.canDeleteProject && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: p.id, name: p.name }); }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={() => setCloneSource(null)}>
          <LinearCard
            className="w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-6">
              <div>
                <h3 className="text-xl font-bold tracking-[-0.3px]">克隆项目</h3>
                <Kicker className="mt-0.5">CLONE PROJECT</Kicker>
              </div>
              <button onClick={() => setCloneSource(null)} className="text-muted-foreground hover:text-foreground"><XIcon size={18} /></button>
            </div>

            {/* Source Info */}
            <div className="px-6 pb-3 pt-5">
              <div className="mb-5 flex items-center gap-2 rounded-[8px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] p-3">
                <Copy size={13} className="shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">基于「{cloneSource.name}」克隆</p>
                  <p className="text-[10px] text-muted-foreground num">
                    {cloneSource.category ? CATEGORY_MAP[cloneSource.category]?.name : 'NPD'}
                    {' · '}
                    {cloneSource.category ? CATEGORY_MAP[cloneSource.category]?.phaseCount : 7} 个阶段 · 进度将清零
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Kicker className="mb-1.5">新项目名称 *</Kicker>
                  <input
                    type="text"
                    value={cloneForm.name}
                    onChange={(e) => setCloneForm({ ...cloneForm, name: e.target.value })}
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
                      onChange={(e) => setCloneForm({ ...cloneForm, code: e.target.value })}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      placeholder={cloneSource.code ? `${cloneSource.code}-2` : 'CE-2026-XXX'}
                    />
                  </div>
                  <div>
                    <Kicker className="mb-1.5">项目经理</Kicker>
                    <select
                      value={cloneForm.pmUserId ?? ''}
                      onChange={(e) => setCloneForm({ ...cloneForm, pmUserId: e.target.value ? Number(e.target.value) : null })}
                      disabled={usersLoading}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)] disabled:opacity-50"
                    >
                      {usersLoading && <option value="">加载中...</option>}
                      {usersError && <option value="">加载失败</option>}
                      {!usersLoading && !usersError && <option value="">选择项目经理...</option>}
                      {(userList || []).map((u) => (
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
                      onChange={(e) => setCloneForm({ ...cloneForm, startDate: e.target.value })}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                    />
                  </div>
                  <div>
                    <Kicker className="mb-1.5">目标日期</Kicker>
                    <input
                      type="date"
                      value={cloneForm.targetDate}
                      onChange={(e) => setCloneForm({ ...cloneForm, targetDate: e.target.value })}
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
                  'flex items-center gap-2 rounded-[7px] bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90',
                  !cloneForm.name.trim() && 'cursor-not-allowed opacity-50',
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
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={handleClose}>
          <LinearCard
            className="flex max-h-[90vh] w-full max-w-3xl flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border p-6">
              <div>
                <h3 className="text-xl font-bold tracking-[-0.3px]">新建项目</h3>
                <Kicker className="mt-0.5">NEW PROJECT</Kicker>
              </div>
              <button onClick={handleClose} className="text-muted-foreground hover:text-foreground"><XIcon size={18} /></button>
            </div>

            {/* Step Indicator */}
            <div className="flex shrink-0 items-center border-b border-border bg-secondary px-6 py-3">
              {([1, 2, 3] as WizardStep[]).map((s, i) => (
                <div key={s} className="flex items-center">
                  <div className={cn('flex items-center gap-2', step === s ? 'text-foreground' : step > s ? 'text-[color:var(--success)]' : 'text-muted-foreground')}>
                    <div className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-bold',
                      step === s ? 'border-primary bg-primary text-primary-foreground'
                        : step > s ? 'border-[color:var(--success)] bg-[color:var(--success)] text-white'
                        : 'border-border bg-card text-muted-foreground',
                    )}>
                      {step > s ? <Check size={10} /> : s}
                    </div>
                    <span className="text-[11px] font-semibold uppercase tracking-wide">{STEP_LABELS[s]}</span>
                  </div>
                  {i < 2 && <div className="mx-3 h-px w-8 bg-border" />}
                </div>
              ))}
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto">

              {/* ── Step 1: Category Selection ── */}
              {step === 1 && (
                <div className="space-y-4 p-6">
                  <p className="text-sm text-muted-foreground">选择项目类型，系统将自动匹配对应的 SOP 流程模板。</p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {PROJECT_CATEGORIES.map((cat) => {
                      const active = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={cn(
                            'relative flex flex-col rounded-[10px] border-2 p-4 text-left transition-all',
                            active ? 'border-primary bg-[color:var(--acc-soft)]' : 'border-border bg-card hover:border-[color:var(--acc-border)]',
                          )}
                        >
                          {active && (
                            <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                              <Check size={11} className="text-primary-foreground" />
                            </div>
                          )}
                          <span className="text-3xl">{cat.icon}</span>
                          <span className="mt-3 text-base font-semibold text-foreground">{cat.name}</span>
                          <span className="mt-1.5"><TypeBadge type={cat.badge} /></span>
                          <p className="mt-2 flex-1 text-xs leading-relaxed text-muted-foreground">{cat.desc}</p>
                          <div className="mt-3 flex flex-col gap-0.5 border-t border-border pt-3">
                            <span className="text-[10px] text-muted-foreground num">{cat.phaseCount} 个阶段</span>
                            <span className="text-[10px] text-muted-foreground">典型周期 {cat.typicalDuration}</span>
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
                      {categoryConfig.name} · {categoryConfig.phaseCount} 个阶段 · {categoryConfig.typicalDuration}
                    </span>
                  </div>

                  <div>
                    <Kicker className="mb-1.5">项目名称 *</Kicker>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                      onChange={(e) => setForm({ ...form, code: e.target.value })}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      placeholder="CE-2026-XXX"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Kicker className="mb-1.5">产品类型</Kicker>
                      <select
                        value={form.type}
                        onChange={(e) => setForm({ ...form, type: e.target.value })}
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      >
                        {PRODUCT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <Kicker className="mb-1.5">项目经理</Kicker>
                      <select
                        value={form.pmUserId ?? ''}
                        onChange={(e) => setForm({ ...form, pmUserId: e.target.value ? Number(e.target.value) : null })}
                        disabled={usersLoading}
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)] disabled:opacity-50"
                      >
                        {usersLoading && <option value="">加载中...</option>}
                        {usersError && <option value="">加载失败，可手动输入</option>}
                        {!usersLoading && !usersError && <option value="">选择项目经理...</option>}
                        {(userList || []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name || u.username}
                          </option>
                        ))}
                        {!usersLoading && !usersError && (userList?.length ?? 0) === 0 && (
                          <option value="" disabled>暂无用户，请先在管理员后台创建用户</option>
                        )}
                      </select>
                    </div>
                  </div>
                  <div>
                    <Kicker className="mb-1.5">关联产品型号（选填）</Kicker>
                    <select
                      value={form.productId}
                      onChange={(e) => setForm({ ...form, productId: e.target.value, newProductName: '' })}
                      className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                    >
                      <option value="">暂不关联，先按 SOP 完成立项与产品定义…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}{p.productNumber ? ` · ${p.productNumber}` : ''}</option>
                      ))}
                    </select>
                    {selectedCategory === 'npd' && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        产品定义、客户差异、规格确认属于项目 SOP 输入；不要求先在产品库建档。项目完成或 SKU 明确后，可在产品库沉淀产品型号与可销售版本。
                      </p>
                    )}
                    {selectedCategory !== 'npd' && !form.productId && (
                      <input
                        value={form.newProductName}
                        onChange={(e) => setForm({ ...form, newProductName: e.target.value })}
                        placeholder="新产品名称（选填，填写则在产品库建档并关联）"
                        className="mt-2 w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Kicker className="mb-1.5">开始日期</Kicker>
                      <input
                        type="date"
                        value={form.startDate}
                        onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      />
                    </div>
                    <div>
                      <Kicker className="mb-1.5">目标日期</Kicker>
                      <input
                        type="date"
                        value={form.targetDate}
                        onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                        className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 3: SOP Preview ── */}
              {step === 3 && (
                <div className="space-y-4 p-6">
                  <div className="flex items-start gap-3 rounded-[8px] border border-border bg-secondary p-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className="text-base font-semibold text-foreground">{form.name || '（未命名）'}</span>
                        <TypeBadge type={categoryConfig.badge} />
                      </div>
                      <div className="text-xs text-muted-foreground num">
                        {form.code && <span className="mr-3">{form.code}</span>}
                        {form.pmUserId && <span className="mr-3">PM: {userList?.find(u => u.id === form.pmUserId)?.name || userList?.find(u => u.id === form.pmUserId)?.username || ''}</span>}
                        {form.startDate && <span>{form.startDate} → {form.targetDate || '?'}</span>}
                      </div>
                    </div>
                  </div>

                  <div>
                    <Kicker className="mb-3">{categoryConfig.name} SOP 流程 · {sopPhases.length} 个阶段</Kicker>
                    <div className="space-y-2">
                      {sopPhases.map((phase, idx) => (
                        <div key={phase.id} className="flex items-start gap-3 rounded-[8px] border border-border bg-card p-3">
                          <div
                            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white num"
                            style={{ backgroundColor: phase.color }}
                          >
                            {idx + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="mb-0.5 flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">{phase.name}</span>
                              <span className="text-[10px] text-muted-foreground">{phase.duration}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{phase.desc}</p>
                            <div className="mt-1 flex items-center gap-1">
                              <span className="text-[9px] font-semibold uppercase tracking-wide text-primary">
                                Gate: {phase.gate}
                              </span>
                              <span className="text-[9px] text-muted-foreground">·</span>
                              <span className="text-[9px] text-muted-foreground num">
                                {phase.tasks.length} 个任务
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex shrink-0 items-center justify-between border-t border-border p-6">
              <button
                onClick={() => step > 1 ? setStep((step - 1) as WizardStep) : handleClose()}
                className="flex items-center gap-1.5 rounded-[7px] border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary"
              >
                <ChevronLeft size={14} />
                {step === 1 ? '取消' : '上一步'}
              </button>

              {step < 3 ? (
                <button
                  onClick={() => {
                    if (step === 2 && !form.name.trim()) return;
                    setStep((step + 1) as WizardStep);
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-[7px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90',
                    step === 2 && !form.name.trim() && 'cursor-not-allowed opacity-50',
                  )}
                >
                  下一步
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  className="flex items-center gap-1.5 rounded-[7px] bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90"
                >
                  <Check size={14} />
                  创建项目
                </button>
              )}
            </div>
          </LinearCard>
        </div>
      )}

      {/* ── Drag Move Confirmation Dialog ── */}
      <AlertDialog open={!!moveConfirm} onOpenChange={(open) => { if (!open) setMoveConfirm(null); }}>
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
                    手动覆盖：<span className="font-semibold">{moveConfirm.project.name}</span>
                    （<span className="num">{moveConfirm.project.code || moveConfirm.project.id}</span>）
                    {' '}{stageLabel(moveConfirm.fromStage)} → {stageLabel(moveConfirm.toStage)}。
                    看板回退直接改阶段、不生成 Gate 记录；前进推进请走 Gate 评审。确认？
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMoveConfirm(null)}>取消</AlertDialogCancel>
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
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[color:var(--destructive)]">
              <AlertTriangle size={18} />
              删除项目
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-foreground">
                <p>
                  您即将删除项目 <span className="font-semibold">「{deleteConfirm?.name}」</span>。
                </p>
                <div className="mt-3 space-y-1 rounded border border-[color:var(--destructive)]/30 bg-[color:var(--destructive)]/8 p-3 text-sm text-[color:var(--destructive)]">
                  <p className="font-medium">此操作将永久删除：</p>
                  <ul className="list-inside list-disc space-y-0.5 text-xs">
                    <li>项目所有阶段和任务数据</li>
                    <li>所有问题记录和关门评审</li>
                    <li>所有附件文件（S3 存储）</li>
                    <li>变更日志和操作记录</li>
                  </ul>
                  <p className="mt-2 font-medium">此操作不可撤销。</p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteConfirm(null)}>取消</AlertDialogCancel>
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
  function ProjectCard({ row, onOpen, onToggleStar, draggable = false }: { row: Row; onOpen: (id: string) => void; onToggleStar: (id: string) => void; draggable?: boolean }) {
    const p = row.project;
    const drag = useDraggable({ id: p.id, disabled: !draggable || !canDrag(p) });
    // dnd-kit's CSS.Translate without the @dnd-kit/utilities package (not installed)
    const transformStyle = drag.transform
      ? { transform: `translate3d(${drag.transform.x}px, ${drag.transform.y}px, 0)` }
      : undefined;
    return (
      <LinearCard
        hover
        ref={drag.setNodeRef}
        {...(draggable ? drag.attributes : {})}
        {...(draggable ? drag.listeners : {})}
        style={transformStyle}
        className={cn(
          'cursor-pointer p-3',
          drag.isDragging && 'z-10 opacity-60 shadow-lg',
        )}
        onClick={() => onOpen(p.id)}
      >
        <div className="flex items-center gap-2">
          <StatusDot tone={row.tone} />
          <span className="text-[10.5px] text-muted-foreground num">{p.code}</span>
          <span className="ml-auto inline-flex h-[18px] items-center rounded-[5px] border border-[color:var(--acc-border)] bg-[color:var(--acc-soft)] px-1.5 text-[9.5px] font-semibold text-primary">
            {row.catBadge}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onToggleStar(p.id); }}
            className="shrink-0"
            title="标星"
          >
            <Star size={14} style={row.isStarred ? { fill: 'var(--star)', color: 'var(--star)' } : { color: 'var(--muted-foreground)' }} />
          </button>
        </div>
        <div className="mt-2 text-[13.5px] font-semibold leading-tight">{p.name}</div>
        <div className="mt-2.5 flex items-center gap-2">
          <LinearBar value={row.overall} className="flex-1" />
          <span className="text-[11px] font-semibold text-muted-foreground num">{row.overall}%</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between border-t border-border pt-2.5">
          <div className="flex items-center gap-1.5">
            <Avatar name={pmLabel(p) || '?'} size={20} />
            <span className="text-[11.5px] text-[color:var(--secondary-foreground)]">{pmLabel(p) || '未分配'}</span>
          </div>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground num">
            <CalendarDays size={11} />{p.targetDate || '—'}
          </span>
        </div>
      </LinearCard>
    );
  }

  function KanbanView({
    stages, groupBy, lanes, rows, isLaneCollapsed, onToggleLane, onToggleStar, onOpen,
  }: {
    stages: typeof STAGE_COLUMNS; groupBy: GroupBy; lanes: Lane[]; rows: Row[];
    isLaneCollapsed: (k: string) => boolean; onToggleLane: (k: string) => void; onToggleStar: (id: string) => void; onOpen: (id: string) => void;
  }) {
    // Droppable stage column. laneKey='' for ungrouped (Task 3); Task 4 will pass
    // a real laneKey for cross-lane reassign via the same makeDropId encoding.
    const column = (laneKey: string, stageId: string, label: string, items: Row[]) => (
      <StageColumn key={`${laneKey}::${stageId}`} dropId={makeDropId(laneKey, stageId)} stageId={stageId} label={label} count={items.length}>
        {items.map((r) => <ProjectCard key={r.project.id} row={r} onOpen={onOpen} onToggleStar={onToggleStar} draggable />)}
      </StageColumn>
    );

    return (
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {groupBy === 'none' ? (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stages.map((s) => column('', s.id, s.label, rows.filter((r) => r.stage === s.id)))}
          </div>
        ) : (
          // Swimlanes: each lane is a row of stage columns
          <div className="flex flex-col gap-3 overflow-x-auto pb-2">
            {lanes.map((lane) => {
              const ck = `${groupBy}:${lane.key}`;
              const collapsed = isLaneCollapsed(ck);
              return (
                <div key={lane.key}>
                  <button
                    onClick={() => onToggleLane(ck)}
                    className="mb-2 flex w-full items-center gap-2 text-left"
                  >
                    <ChevronRight size={15} className={cn('text-muted-foreground transition-transform', !collapsed && 'rotate-90')} />
                    <span className="h-4 w-1 rounded-[2px]" style={{ background: lane.color }} />
                    <span className="text-[13.5px] font-semibold">{lane.label}</span>
                    <span className="text-[11px] text-muted-foreground num">{lane.rows.length} 个项目</span>
                  </button>
                  {!collapsed && (
                    <div className="flex gap-3">
                      {stages.map((s) => column(lane.key, s.id, s.label, lane.rows.filter((r) => r.stage === s.id)))}
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

  function StageColumn({ dropId, stageId, label, count, children }: { dropId: string; stageId: string; label: string; count: number; children: React.ReactNode }) {
    const { setNodeRef, isOver } = useDroppable({ id: dropId });
    const limit = wipLimits[stageId];
    const atLimit = limit != null && count >= limit;
    // 无上限时，从当前列计数起步增减；setWipLimit 处理 ≤0 → 清除。
    const step = (delta: number) => setWipLimit(stageId, (limit ?? count) + delta);
    return (
      <div
        ref={setNodeRef}
        className={cn(
          'flex min-w-[208px] flex-1 flex-col rounded-[12px] border bg-[color:var(--secondary)] transition-colors',
          isOver ? 'border-[color:var(--acc-border)] bg-[color:var(--acc-soft)]' : 'border-border',
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
            <span className={cn(atLimit && 'text-[color:var(--destructive)]')}>{count}</span>
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

  function ListView({ rows, groupBy, lanes, onOpen }: { rows: Row[]; groupBy: GroupBy; lanes: Lane[]; onOpen: (id: string) => void }) {
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
          <span className="truncate text-[14px] font-medium">{r.project.name}</span>
        </div>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11.5px] font-medium text-[color:var(--secondary-foreground)]">
          <span className="h-1.5 w-1.5 rounded-[2px] bg-primary" />{STAGE_SHORT[r.stage]}
        </span>
        <div className="flex items-center gap-2">
          <LinearBar value={r.overall} className="flex-1" />
          <span className="w-8 text-right text-[12px] text-muted-foreground num">{r.overall}%</span>
        </div>
        <div className="flex items-center gap-2">
          <Avatar name={pmLabel(r.project) || '?'} size={22} />
          <span className="truncate text-[12.5px] text-[color:var(--secondary-foreground)]">{pmLabel(r.project) || '未分配'}</span>
        </div>
        <span className="text-right text-[12px] text-muted-foreground num">{r.project.targetDate || '—'}</span>
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => handleOpenClone(e, r.project)}
            title="克隆项目"
            aria-label="克隆项目"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <Copy size={14} />
          </button>
          {r.project.canDeleteProject && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeleteConfirm({ id: r.project.id, name: r.project.name }); }}
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

    return (
      <LinearCard className="overflow-hidden">
        {tableHead}
        {groupBy === 'none'
          ? rows.map(rowEl)
          : lanes.map((lane) => (
            <div key={lane.key}>
              <div className="flex items-center gap-2 bg-secondary px-4 py-2">
                <span className="h-2 w-2 rounded-full" style={{ background: lane.color }} />
                <span className="text-[12.5px] font-semibold">{lane.label}</span>
                <span className="text-[12px] text-muted-foreground num">{lane.rows.length}</span>
              </div>
              {lane.rows.map(rowEl)}
            </div>
          ))}
      </LinearCard>
    );
  }

  function TimelineView({ rows, groupBy, lanes, onOpen }: { rows: Row[]; groupBy: GroupBy; lanes: Lane[]; onOpen: (id: string) => void }) {
    // Display-only portfolio timeline: each project = a bar spanning start→target across a month axis.
    const parse = (s: string) => { const d = new Date(s); return isNaN(d.getTime()) ? null : d; };
    const allDates = rows.flatMap((r) => [parse(r.project.startDate), parse(r.project.targetDate)]).filter(Boolean) as Date[];
    const now = new Date();
    const min = allDates.length ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : new Date(now.getFullYear(), 0, 1);
    const max = allDates.length ? new Date(Math.max(...allDates.map((d) => d.getTime()), now.getTime())) : new Date(now.getFullYear(), 11, 31);
    // Build month buckets
    const months: { y: number; m: number }[] = [];
    const cur = new Date(min.getFullYear(), min.getMonth(), 1);
    const end = new Date(max.getFullYear(), max.getMonth(), 1);
    while (cur <= end) { months.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 }); cur.setMonth(cur.getMonth() + 1); }
    if (months.length === 0) months.push({ y: now.getFullYear(), m: now.getMonth() + 1 });
    const COLW = 78, LABELW = 220;
    const trackW = COLW * months.length;
    const monthIndex = (d: Date) => (d.getFullYear() - months[0].y) * 12 + (d.getMonth() + 1 - months[0].m);
    const todayPx = (monthIndex(now) + now.getDate() / 30) * COLW;

    const rowEl = (r: Row) => {
      const s = parse(r.project.startDate), e = parse(r.project.targetDate);
      const si = s ? monthIndex(s) : 0;
      const ei = e ? monthIndex(e) : Math.min(months.length - 1, si + 3);
      const left = Math.max(0, si) * COLW;
      const width = Math.max(COLW * 0.6, (Math.max(ei, si) - Math.max(0, si) + 1) * COLW);
      const barColor = r.tone === 'red' ? 'var(--destructive)' : r.tone === 'amber' ? 'var(--warning)' : 'var(--primary)';
      return (
        <div key={r.project.id} className="flex border-b border-border">
          <div
            onClick={() => onOpen(r.project.id)}
            className="sticky left-0 z-[2] flex shrink-0 cursor-pointer items-center gap-2.5 border-r border-border bg-card px-3.5 hover:bg-secondary"
            style={{ width: LABELW, height: 48 }}
          >
            <StatusDot tone={r.tone} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{r.project.name}</div>
              <div className="text-[10.5px] text-muted-foreground num">{r.project.code} · {STAGE_SHORT[r.stage]}</div>
            </div>
            <Avatar name={pmLabel(r.project) || '?'} size={22} />
          </div>
          <div
            onClick={() => onOpen(r.project.id)}
            className="relative shrink-0 cursor-pointer"
            style={{ width: trackW, height: 48, backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent ${COLW - 1}px, var(--border) ${COLW - 1}px, var(--border) ${COLW}px)` }}
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
            <div className="sticky left-0 z-[6] flex shrink-0 items-center border-r border-border bg-card px-3.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" style={{ width: LABELW, height: 38 }}>
              项目 / 排期
            </div>
            <div className="flex">
              {months.map((mm, i) => (
                <div key={i} className="shrink-0 border-l border-border py-2 text-center text-[11px] text-muted-foreground num" style={{ width: COLW }}>
                  {mm.m}月{mm.m === 1 ? <span className="block text-[9px] text-muted-foreground">{mm.y}</span> : null}
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            {groupBy === 'none'
              ? rows.map(rowEl)
              : lanes.map((lane) => (
                <div key={lane.key}>
                  <div className="flex bg-secondary">
                    <div className="sticky left-0 z-[2] flex shrink-0 items-center gap-2 border-r border-border bg-secondary px-3.5 text-[12px] font-semibold" style={{ width: LABELW, height: 34 }}>
                      <span className="h-3.5 w-1 rounded-[2px]" style={{ background: lane.color }} />
                      {lane.label}<span className="text-muted-foreground num">{lane.rows.length}</span>
                    </div>
                    <div className="shrink-0" style={{ width: trackW, height: 34 }} />
                  </div>
                  {lane.rows.map(rowEl)}
                </div>
              ))}
            {/* Today line */}
            <div className="pointer-events-none absolute bottom-0 top-0 z-[3] w-0.5 bg-primary" style={{ left: LABELW + todayPx }} />
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
      <span className="flex items-center gap-1.5 text-[13px] font-medium">{v}</span>
    </div>
  );
}

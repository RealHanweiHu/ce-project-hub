// 项目集：手动把若干项目归类到一个管理容器（如「2027 上海展」「A客户」），与产品库正交。
// 一个项目最多属于一个项目集；重新归类即移动，删除项目集只解除归类、不影响项目本身。
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { toast } from 'sonner';
import { Boxes, Plus, Pencil, Trash2, ArrowLeft, FolderKanban, FolderMinus, Loader2 } from 'lucide-react';
import { PageHeader, Kicker, LinearCard, TypeBadge } from '@/components/linear/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { isSystemAdminRole } from '@shared/system-roles';
import { PortfolioDashboard } from '@/components/views/overview/PortfolioDashboard';
import type { PortfolioTableRow } from '@/components/views/overview/types';

const CATEGORY_BADGE: Record<string, string> = {
  npd: 'NPD', eco: 'ECO', derivative: 'DRV', idr: 'IDR', jdm: 'JDM', obt: 'OBT',
};

type CollectionForm = { id?: string; name: string; description: string };

export function ProjectCollectionsView({ onSelectProject }: { onSelectProject?: (id: string) => void }) {
  const { user } = useAuth();
  const canManage = isSystemAdminRole(user?.role)
    || !!(user as (typeof user & { canCreateProject?: boolean }) | null)?.canCreateProject;

  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<CollectionForm | null>(null);

  const listQ = trpc.projectCollections.list.useQuery();
  const detailQ = trpc.projectCollections.get.useQuery(
    { id: selectedId ?? '' },
    { enabled: !!selectedId }
  );
  const portfolioQ = trpc.projects.portfolio.useQuery(undefined, { enabled: !!selectedId });
  const portfolioRows = useMemo(() => {
    const ids = new Set((detailQ.data?.projects ?? []).map((project) => project.id));
    return ((portfolioQ.data ?? []) as PortfolioTableRow[]).filter((row) => ids.has(row.id));
  }, [detailQ.data?.projects, portfolioQ.data]);

  const invalidate = () => {
    utils.projectCollections.list.invalidate();
    utils.projectCollections.assignments.invalidate();
    if (selectedId) utils.projectCollections.get.invalidate({ id: selectedId });
  };

  const createM = trpc.projectCollections.create.useMutation({
    onSuccess: () => { invalidate(); setForm(null); toast.success('项目集已创建'); },
    onError: (e) => toast.error(e.message),
  });
  const updateM = trpc.projectCollections.update.useMutation({
    onSuccess: () => { invalidate(); setForm(null); toast.success('已保存'); },
    onError: (e) => toast.error(e.message),
  });
  const deleteM = trpc.projectCollections.delete.useMutation({
    onSuccess: () => { setSelectedId(null); invalidate(); toast.success('项目集已删除'); },
    onError: (e) => toast.error(e.message),
  });

  const submitForm = () => {
    if (!form) return;
    const name = form.name.trim();
    if (!name) { toast.error('请填写项目集名称'); return; }
    const description = form.description.trim();
    if (form.id) {
      updateM.mutate({ id: form.id, patch: { name, description: description || null } });
    } else {
      createM.mutate({ name, description: description || undefined });
    }
  };

  return (
    <div className="flex flex-col">
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><Boxes size={20} className="text-primary" />项目集</span>}
        sub="按你的管理需要自由归类项目，不改变项目与产品库的关联"
        actions={canManage && !selectedId ? (
          <Button size="sm" onClick={() => setForm({ name: '', description: '' })}>
            <Plus size={14} className="mr-1" />
            <span className="sm:hidden">新建</span>
            <span className="hidden sm:inline">新建项目集</span>
          </Button>
        ) : undefined}
      />

      {!selectedId ? (
        <CollectionGrid
          loading={listQ.isLoading}
          collections={listQ.data ?? []}
          onOpen={setSelectedId}
        />
      ) : (
        <CollectionDetail
          key={selectedId}
          collectionId={selectedId}
          detail={detailQ.data}
          portfolioRows={portfolioRows}
          loading={detailQ.isLoading || portfolioQ.isLoading}
          canManage={canManage}
          onBack={() => setSelectedId(null)}
          onEdit={(c) => setForm({ id: c.id, name: c.name, description: c.description ?? '' })}
          onDelete={(c) => {
            if (confirm(`删除项目集「${c.name}」？只解散分组，不影响其中的项目。`)) deleteM.mutate({ id: c.id });
          }}
          onSelectProject={onSelectProject}
        />
      )}

      {/* 新建 / 编辑 弹窗 */}
      <Dialog open={!!form} onOpenChange={(open) => { if (!open) setForm(null); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{form?.id ? '编辑项目集' : '新建项目集'}</DialogTitle>
            <DialogDescription>填写自定义名称；说明仅用于补充这个项目集的管理用途。</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <Kicker>名称</Kicker>
              <Input
                className="mt-1"
                autoFocus
                placeholder="如：2027 上海展 / A客户"
                value={form?.name ?? ''}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitForm(); }}
              />
            </div>
            <div>
              <Kicker>说明（可选）</Kicker>
              <Textarea
                className="mt-1"
                rows={3}
                placeholder="这个项目集的用途、范围…"
                value={form?.description ?? ''}
                onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setForm(null)}>取消</Button>
            <Button size="sm" onClick={submitForm} disabled={createM.isPending || updateM.isPending}>
              {(createM.isPending || updateM.isPending) && <Loader2 size={14} className="mr-1 animate-spin" />}
              {form?.id ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── 集合卡片网格 ──────────────────────────────────────────────────────────────

type CollectionRow = { id: string; name: string; description: string | null; projectCount: number };

function CollectionGrid({ loading, collections, onOpen }: {
  loading: boolean;
  collections: CollectionRow[];
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return <div className="py-16 flex justify-center text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>;
  }
  if (collections.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center gap-2 text-muted-foreground">
        <Boxes size={28} className="opacity-40" />
        <p className="text-sm">还没有项目集 — 新建一个项目集，把需要集中管理的项目归类进来</p>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {collections.map((c) => (
        <LinearCard
          key={c.id}
          className="cursor-pointer p-4 transition-colors hover:border-[color:var(--acc-border)]"
          onClick={() => onOpen(c.id)}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">{c.name}</h3>
            <span className="shrink-0 rounded-[6px] border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
              {c.projectCount} 个项目
            </span>
          </div>
          {c.description && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{c.description}</p>
          )}
        </LinearCard>
      ))}
    </div>
  );
}

// ── 集合详情 ─────────────────────────────────────────────────────────────────

type DetailData = {
  collection: { id: string; name: string; description: string | null };
  projects: {
    id: string; name: string; category: string; currentPhase: string | null;
    sopTemplateVersion: string | null; customFields: unknown;
    progress: number | null; archived: boolean; lifecycle: string;
  }[];
  hiddenCount: number;
};

function CollectionDetail({ collectionId, detail, portfolioRows, loading, canManage, onBack, onEdit, onDelete, onSelectProject }: {
  collectionId: string;
  detail: DetailData | undefined;
  portfolioRows: PortfolioTableRow[];
  loading: boolean;
  canManage: boolean;
  onBack: () => void;
  onEdit: (c: DetailData['collection']) => void;
  onDelete: (c: DetailData['collection']) => void;
  onSelectProject?: (id: string) => void;
}) {
  const utils = trpc.useUtils();
  const [adding, setAdding] = useState(false);

  const addM = trpc.projectCollections.addProjects.useMutation({
    onSuccess: () => {
      utils.projectCollections.get.invalidate({ id: collectionId });
      utils.projectCollections.list.invalidate();
      utils.projectCollections.assignments.invalidate();
      setAdding(false);
      toast.success('项目已归类到此项目集');
    },
    onError: (e) => toast.error(e.message),
  });
  const removeM = trpc.projectCollections.removeProject.useMutation({
    onSuccess: () => {
      utils.projectCollections.get.invalidate({ id: collectionId });
      utils.projectCollections.list.invalidate();
      utils.projectCollections.assignments.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  if (loading || !detail) {
    return <div className="py-16 flex justify-center text-muted-foreground"><Loader2 size={18} className="animate-spin" /></div>;
  }
  const { collection, projects, hiddenCount } = detail;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] border border-border text-muted-foreground transition-colors hover:text-foreground"
            aria-label="返回项目集列表"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h2 className="text-[15px] font-semibold text-foreground">{collection.name}</h2>
            {collection.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{collection.description}</p>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} className="mr-1" />归类项目
            </Button>
            <Button variant="outline" size="sm" onClick={() => onEdit(collection)}>
              <Pencil size={14} className="mr-1" />编辑
            </Button>
            <Button
              variant="outline" size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => onDelete(collection)}
            >
              <Trash2 size={14} className="mr-1" />删除
            </Button>
          </div>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="py-12 flex flex-col items-center gap-2 text-muted-foreground">
          <FolderKanban size={24} className="opacity-40" />
          <p className="text-sm">项目集还是空的{canManage ? ' — 点「归类项目」开始集中管理' : ''}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {portfolioRows.length > 0 && (
            <PortfolioDashboard
              rows={portfolioRows}
              scopeLabel={`项目集 · ${collection.name}`}
              onSelectProject={(id) => onSelectProject?.(id)}
              showManagementKpis={false}
            />
          )}
          <CollectionMembershipList
            projects={projects}
            canManage={canManage}
            onSelectProject={onSelectProject}
            onRemove={(project) => {
              if (confirm(`把「${project.name}」移出项目集？项目本身不会被删除。`)) {
                removeM.mutate({ id: collectionId, projectId: project.id });
              }
            }}
          />
        </div>
      )}

      {hiddenCount > 0 && (
        <p className="text-xs text-muted-foreground">另有 {hiddenCount} 个项目因您无权限而未显示。</p>
      )}

      {adding && (
        <AddProjectsDialog
          collectionId={collectionId}
          collectionName={collection.name}
          existingIds={projects.map((p) => p.id)}
          pending={addM.isPending}
          onClose={() => setAdding(false)}
          onAdd={(ids) => addM.mutate({ id: collectionId, projectIds: ids })}
        />
      )}
    </div>
  );
}

function CollectionMembershipList({ projects, canManage, onSelectProject, onRemove }: {
  projects: DetailData['projects'];
  canManage: boolean;
  onSelectProject?: (id: string) => void;
  onRemove: (project: DetailData['projects'][number]) => void;
}) {
  return (
    <LinearCard className="overflow-hidden p-0">
      <div className="border-b border-border px-4 py-3">
        <Kicker>项目集成员</Kicker>
        <p className="mt-1 text-xs text-muted-foreground">集中管理归类关系；移出不会删除项目或改变产品关联。</p>
      </div>
      <div className="divide-y divide-border">
        {projects.map((project) => (
          <div key={project.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground hover:text-primary hover:underline"
              onClick={() => onSelectProject?.(project.id)}
            >
              {project.name}
            </button>
            <TypeBadge type={CATEGORY_BADGE[project.category] ?? project.category.toUpperCase()} />
            {(project.archived || project.lifecycle !== 'active') && (
              <span className="text-xs text-muted-foreground">
                {project.archived ? '已归档' : project.lifecycle === 'paused' ? '已暂停' : project.lifecycle === 'terminated' ? '已终止' : project.lifecycle}
              </span>
            )}
            {canManage && (
              <button
                type="button"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                aria-label={`将${project.name}移出项目集`}
                title="移出项目集"
                onClick={() => onRemove(project)}
              >
                <FolderMinus size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </LinearCard>
  );
}

// ── 加入项目弹窗 ─────────────────────────────────────────────────────────────

function AddProjectsDialog({ collectionId, collectionName, existingIds, pending, onClose, onAdd }: {
  collectionId: string;
  collectionName: string;
  existingIds: string[];
  pending: boolean;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const projectsQ = trpc.projects.list.useQuery();
  const assignmentsQ = trpc.projectCollections.assignments.useQuery();
  const [keyword, setKeyword] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const assignmentByProject = useMemo(
    () => new Map((assignmentsQ.data ?? []).map((assignment) => [assignment.projectId, assignment])),
    [assignmentsQ.data],
  );

  const candidates = useMemo(() => {
    const existing = new Set(existingIds);
    const rows = ((projectsQ.data ?? []) as { id: string; name: string; category: string }[])
      .filter((p) => !existing.has(p.id));
    const kw = keyword.trim().toLowerCase();
    return kw ? rows.filter((p) => p.name.toLowerCase().includes(kw)) : rows;
  }, [projectsQ.data, existingIds, keyword]);

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const submit = () => {
    const ids = Array.from(checked);
    const moving = ids.filter((id) => {
      const current = assignmentByProject.get(id);
      return current && current.collectionId !== collectionId;
    });
    if (moving.length > 0 && !confirm(`其中 ${moving.length} 个项目已属于其他项目集，将移动到「${collectionName}」。是否继续？`)) {
      return;
    }
    onAdd(ids);
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>归类项目</DialogTitle>
          <DialogDescription>未归类项目会直接加入；已有归属的项目会在确认后移动到当前项目集。</DialogDescription>
        </DialogHeader>
        <Input
          placeholder="搜索项目名…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="max-h-[300px] overflow-y-auto rounded-[8px] border border-border">
          {projectsQ.isLoading || assignmentsQ.isLoading ? (
            <div className="py-8 flex justify-center text-muted-foreground"><Loader2 size={16} className="animate-spin" /></div>
          ) : candidates.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">没有可加入的项目</p>
          ) : (
            candidates.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2.5 border-b border-border px-3 py-2 last:border-b-0 hover:bg-secondary/50"
              >
                <input
                  type="checkbox"
                  className="accent-[color:var(--primary)]"
                  checked={checked.has(p.id)}
                  onChange={() => toggle(p.id)}
                />
                <span className="flex-1 text-[13px] text-foreground">{p.name}</span>
                {assignmentByProject.get(p.id) && (
                  <span className="max-w-[130px] truncate text-[10px] text-[color:var(--warning)]" title={assignmentByProject.get(p.id)?.collectionName}>
                    当前：{assignmentByProject.get(p.id)?.collectionName}
                  </span>
                )}
                <TypeBadge type={CATEGORY_BADGE[p.category] ?? p.category.toUpperCase()} />
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={checked.size === 0 || pending} onClick={submit}>
            {pending && <Loader2 size={14} className="mr-1 animate-spin" />}
            归类 {checked.size > 0 ? `(${checked.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

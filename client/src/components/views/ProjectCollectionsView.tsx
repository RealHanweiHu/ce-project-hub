// 项目集：手动把若干项目组合成一个集合（如「2027 上海展」「A客户」），与产品库的结构性归属正交。
// 一个项目可同时属于多个项目集；删除项目集只解散分组，不影响项目本身。
import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { toast } from 'sonner';
import { Boxes, Plus, Pencil, Trash2, ArrowLeft, FolderKanban, Loader2 } from 'lucide-react';
import { PageHeader, Kicker, LinearCard, TypeBadge, LinearBar } from '@/components/linear/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { isSystemAdminRole } from '@shared/system-roles';
import { getEffectivePhasesForProjectLike, type ProjectTemplateLike } from '@shared/npd-v3';

const CATEGORY_BADGE: Record<string, string> = {
  npd: 'NPD', eco: 'ECO', derivative: 'DRV', idr: 'IDR', jdm: 'JDM', obt: 'OBT',
};

function phaseLabel(project: ProjectTemplateLike, phaseId: string | null): string {
  if (!phaseId) return '—';
  return getEffectivePhasesForProjectLike(project).find((p) => p.id === phaseId)?.name ?? phaseId;
}

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

  const invalidate = () => {
    utils.projectCollections.list.invalidate();
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
        sub="跨类别、跨产品线的人工分组 — 展会、客户、专题"
        actions={canManage ? (
          <Button size="sm" onClick={() => setForm({ name: '', description: '' })}>
            <Plus size={14} className="mr-1" />新建项目集
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
          loading={detailQ.isLoading}
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
        <p className="text-sm">还没有项目集 — 用「新建项目集」把相关项目组合起来（展会、客户、专题）</p>
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

function CollectionDetail({ collectionId, detail, loading, canManage, onBack, onEdit, onDelete, onSelectProject }: {
  collectionId: string;
  detail: DetailData | undefined;
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
      setAdding(false);
      toast.success('已加入项目集');
    },
    onError: (e) => toast.error(e.message),
  });
  const removeM = trpc.projectCollections.removeProject.useMutation({
    onSuccess: () => {
      utils.projectCollections.get.invalidate({ id: collectionId });
      utils.projectCollections.list.invalidate();
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
              <Plus size={14} className="mr-1" />加入项目
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
          <p className="text-sm">项目集还是空的{canManage ? ' — 点「加入项目」开始组合' : ''}</p>
        </div>
      ) : (
        <LinearCard className="overflow-hidden p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">项目</th>
                <th className="px-3 py-2.5 font-medium">类别</th>
                <th className="px-3 py-2.5 font-medium">阶段</th>
                <th className="w-[160px] px-3 py-2.5 font-medium">进度</th>
                {canManage && <th className="w-[60px] px-3 py-2.5" />}
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-b-0 hover:bg-secondary/50">
                  <td className="px-4 py-2.5">
                    <button
                      className="text-left font-medium text-foreground hover:text-primary hover:underline"
                      onClick={() => onSelectProject?.(p.id)}
                    >
                      {p.name}
                    </button>
                    {(p.archived || p.lifecycle !== 'active') && (
                      <span className="ml-2 rounded-[5px] border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {p.archived ? '已归档' : p.lifecycle === 'paused' ? '已暂停' : '已终止'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5"><TypeBadge type={CATEGORY_BADGE[p.category] ?? p.category.toUpperCase()} /></td>
                  <td className="px-3 py-2.5 text-muted-foreground">{phaseLabel(p, p.currentPhase)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <LinearBar value={p.progress ?? 0} className="flex-1" />
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">{p.progress ?? 0}%</span>
                    </div>
                  </td>
                  {canManage && (
                    <td className="px-3 py-2.5 text-right">
                      <button
                        className="text-muted-foreground transition-colors hover:text-destructive"
                        aria-label="移出项目集"
                        onClick={() => {
                          if (confirm(`把「${p.name}」移出项目集？`)) removeM.mutate({ id: collectionId, projectId: p.id });
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </LinearCard>
      )}

      {hiddenCount > 0 && (
        <p className="text-xs text-muted-foreground">另有 {hiddenCount} 个项目因您无权限而未显示。</p>
      )}

      {adding && (
        <AddProjectsDialog
          existingIds={projects.map((p) => p.id)}
          pending={addM.isPending}
          onClose={() => setAdding(false)}
          onAdd={(ids) => addM.mutate({ id: collectionId, projectIds: ids })}
        />
      )}
    </div>
  );
}

// ── 加入项目弹窗 ─────────────────────────────────────────────────────────────

function AddProjectsDialog({ existingIds, pending, onClose, onAdd }: {
  existingIds: string[];
  pending: boolean;
  onClose: () => void;
  onAdd: (ids: string[]) => void;
}) {
  const projectsQ = trpc.projects.list.useQuery();
  const [keyword, setKeyword] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());

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

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>加入项目</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="搜索项目名…"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="max-h-[300px] overflow-y-auto rounded-[8px] border border-border">
          {projectsQ.isLoading ? (
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
                <TypeBadge type={CATEGORY_BADGE[p.category] ?? p.category.toUpperCase()} />
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" disabled={checked.size === 0 || pending} onClick={() => onAdd(Array.from(checked))}>
            {pending && <Loader2 size={14} className="mr-1 animate-spin" />}
            加入 {checked.size > 0 ? `(${checked.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

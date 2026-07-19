import { useMemo, useState } from 'react';
import { Boxes, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/_core/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LinearCard, PageHeader } from '@/components/linear/primitives';
import { trpc } from '@/lib/trpc';
import { KeyModuleDetailDialog } from './key-modules/KeyModuleDetailDialog';
import { KeyModuleEditorDialog, type KeyModuleEditorValue } from './key-modules/KeyModuleEditorDialog';
import { MODULE_STATUS_LABEL, MODULE_TYPE_LABEL, MODULE_TYPE_OPTIONS, type KeyModuleBundle, type KeyModuleStatus, type KeyModuleType } from './key-modules/types';

const ALL_STATUSES: KeyModuleStatus[] = ['draft', 'technical_confirmed', 'approved', 'restricted', 'obsolete'];

export function KeyModuleLibraryView() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<'all' | KeyModuleType>('all');
  const [status, setStatus] = useState<'all' | KeyModuleStatus>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<KeyModuleBundle | null>(null);
  const canApprove = Boolean(user && ('canCreateProject' in user && user.canCreateProject || user.role === 'admin' || user.role === 'owner'));
  const list = trpc.keyModules.list.useQuery({ query: query || undefined, moduleType: type === 'all' ? undefined : type, statuses: status === 'all' ? ALL_STATUSES : [status], page: 1, pageSize: 100 });
  const detail = trpc.keyModules.get.useQuery({ id: selectedId ?? '' }, { enabled: Boolean(selectedId) });
  const history = trpc.keyModules.history.useQuery({ id: selectedId ?? '' }, { enabled: Boolean(selectedId) });
  const invalidate = async () => { await utils.keyModules.invalidate(); };
  const success = (message: string) => { toast.success(message); void invalidate(); };
  const failure = (error: { message: string }) => toast.error(error.message);

  const create = trpc.keyModules.create.useMutation({ onSuccess: () => { success('关键模块草稿已创建'); setEditorOpen(false); }, onError: failure });
  const update = trpc.keyModules.updateDraft.useMutation({ onSuccess: () => { success('模块草稿已保存'); setEditorOpen(false); }, onError: failure });
  const confirm = trpc.keyModules.confirmTechnical.useMutation({ onSuccess: () => success('技术确认完成，等待产品或项目经理批准'), onError: failure });
  const approve = trpc.keyModules.approve.useMutation({ onSuccess: () => success('模块已批准，可供项目选用'), onError: failure });
  const returnToDraft = trpc.keyModules.returnToDraft.useMutation({ onSuccess: () => success('模块已退回草稿'), onError: failure });
  const derive = trpc.keyModules.derive.useMutation({ onSuccess: result => { success('已派生新的模块草稿'); setSelectedId(result.module.id); }, onError: failure });
  const restrict = trpc.keyModules.restrict.useMutation({ onSuccess: () => success('已限制新项目选用'), onError: failure });
  const obsolete = trpc.keyModules.obsolete.useMutation({ onSuccess: () => success('模块已停用'), onError: failure });
  const pending = [create, update, confirm, approve, returnToDraft, derive, restrict, obsolete].some(mutation => mutation.isPending);

  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const submitEditor = (value: KeyModuleEditorValue) => editing
    ? update.mutate({ id: editing.module.id, moduleNumber: value.moduleNumber, name: value.name, category: value.category, model: value.model, items: value.items })
    : create.mutate(value);
  const ask = (message: string) => window.prompt(message)?.trim() || null;

  return <div className="flex flex-col">
    <PageHeader title="关键模块" sub={<>受控的电池、核心功能与电子硬件模块 · <span className="num">{list.data?.pagination.totalItems ?? 0}</span> 个</>} actions={<Button onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus size={15} /> 新建模块</Button>} />
    <div className="mb-4 flex flex-wrap items-center gap-3 border-b border-border pb-4">
      <div className="relative min-w-[260px] flex-1 sm:max-w-sm"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索编号、名称、型号或品类" aria-label="搜索关键模块" /></div>
      <Select value={type} onValueChange={value => setType(value as typeof type)}><SelectTrigger className="w-[160px]" aria-label="模块类型筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{MODULE_TYPE_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>
      <Select value={status} onValueChange={value => setStatus(value as typeof status)}><SelectTrigger className="w-[140px]" aria-label="模块状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{ALL_STATUSES.map(value => <SelectItem key={value} value={value}>{MODULE_STATUS_LABEL[value]}</SelectItem>)}</SelectContent></Select>
    </div>
    {list.isLoading ? <LinearCard className="py-16 text-center text-sm text-muted-foreground">加载关键模块…</LinearCard> : rows.length === 0 ? <LinearCard className="flex flex-col items-center py-16 text-center"><Boxes className="mb-3 text-muted-foreground/50" /><p className="text-sm font-medium">没有匹配的关键模块</p><p className="mt-1 text-xs text-muted-foreground">工程师可创建模块草稿并提交技术确认。</p></LinearCard> : <LinearCard className="overflow-hidden"><Table><TableHeader><TableRow><TableHead>模块编号</TableHead><TableHead>名称</TableHead><TableHead>类型</TableHead><TableHead>品类 / 型号</TableHead><TableHead>状态</TableHead><TableHead>更新时间</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id} className="cursor-pointer" tabIndex={0} onClick={() => setSelectedId(row.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(row.id); } }}><TableCell className="font-semibold">{row.moduleNumber}</TableCell><TableCell>{row.name}</TableCell><TableCell>{MODULE_TYPE_LABEL[row.moduleType]}</TableCell><TableCell>{[row.category, row.model].filter(Boolean).join(' · ') || '—'}</TableCell><TableCell>{MODULE_STATUS_LABEL[row.status]}</TableCell><TableCell>{new Date(row.updatedAt).toLocaleDateString('zh-CN')}</TableCell></TableRow>)}</TableBody></Table></LinearCard>}

    <KeyModuleEditorDialog open={editorOpen} onOpenChange={setEditorOpen} detail={editing} pending={pending} onSubmit={submitEditor} />
    <KeyModuleDetailDialog open={Boolean(selectedId)} onOpenChange={open => { if (!open) setSelectedId(null); }} detail={detail.data as KeyModuleBundle | undefined} loading={detail.isLoading} history={[...(history.data ?? [])].reverse()} historyLoading={history.isLoading} canApprove={canApprove} pending={pending}
      onEdit={() => { setEditing(detail.data as KeyModuleBundle); setEditorOpen(true); }} onConfirm={() => selectedId && confirm.mutate({ id: selectedId })} onApprove={() => selectedId && approve.mutate({ id: selectedId })} onReturn={() => { const reason = ask('请输入退回草稿的原因'); if (selectedId && reason) returnToDraft.mutate({ id: selectedId, reason }); }}
      onDerive={() => { if (!selectedId || !detail.data) return; const moduleNumber = ask('请输入新的模块编号'); if (moduleNumber) derive.mutate({ sourceId: selectedId, moduleNumber, name: `${detail.data.module.name}（派生）` }); }}
      onRestrict={() => { const reason = ask('请输入限制新项目选用的原因'); if (selectedId && reason) restrict.mutate({ id: selectedId, reason }); }} onObsolete={() => { const reason = ask('请输入停用原因'); if (selectedId && reason) obsolete.mutate({ id: selectedId, reason }); }} />
  </div>;
}

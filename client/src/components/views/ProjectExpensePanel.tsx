import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, WalletCards } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

const CATEGORY_LABELS: Record<string, string> = {
  tooling: '模具/治具', certification: '认证', nre: 'NRE', prototype: '打样', travel: '差旅', other: '其他',
};
const STATUS_LABELS: Record<string, string> = { planned: '计划', committed: '已承诺', paid: '已付款', cancelled: '已取消' };

type ExpenseForm = {
  id: number | null;
  category: 'tooling' | 'certification' | 'nre' | 'prototype' | 'travel' | 'other';
  title: string;
  supplier: string;
  currency: string;
  budget: string;
  actual: string;
  status: 'planned' | 'committed' | 'paid' | 'cancelled';
  ownerUserId: number | null;
  occurredDate: string;
  evidenceReference: string;
  notes: string;
};

const emptyForm = (): ExpenseForm => ({ id: null, category: 'tooling', title: '', supplier: '', currency: 'CNY', budget: '', actual: '', status: 'planned', ownerUserId: null, occurredDate: '', evidenceReference: '', notes: '' });
const toMinor = (value: string) => Math.round((Number(value) || 0) * 100);
const fromMinor = (value: number) => (value / 100).toFixed(2);
const fmt = (currency: string, value: number) => `${currency} ${(value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function ProjectExpensePanel({ projectId, canView, canEdit }: { projectId: string; canView: boolean; canEdit: boolean }) {
  const utils = trpc.useUtils();
  const list = trpc.expenses.list.useQuery({ projectId }, { enabled: canView });
  const summary = trpc.expenses.summary.useQuery({ projectId }, { enabled: canView });
  const members = trpc.members.list.useQuery({ projectId }, { enabled: canView, staleTime: 60_000 });
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const internalMembers = useMemo(() => (members.data ?? []).filter((member) => !['external_customer', 'supplier'].includes(member.role)), [members.data]);
  const nameById = useMemo(() => new Map(internalMembers.map((member) => [member.userId, member.userName || `用户 #${member.userId}`])), [internalMembers]);
  const refresh = async () => {
    await Promise.all([utils.expenses.list.invalidate({ projectId }), utils.expenses.summary.invalidate({ projectId }), utils.projects.portfolio.invalidate()]);
  };
  const create = trpc.expenses.create.useMutation({ onSuccess: async () => { toast.success('项目费用已登记'); setForm(emptyForm()); await refresh(); }, onError: (error) => toast.error(error.message) });
  const update = trpc.expenses.update.useMutation({ onSuccess: async () => { toast.success('项目费用已更新'); setForm(emptyForm()); await refresh(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.expenses.delete.useMutation({ onSuccess: async () => { toast.success('未发生费用计划已删除'); await refresh(); }, onError: (error) => toast.error(error.message) });

  if (!canView) return <div className="rounded-[11px] border border-border bg-card p-6 text-center text-sm text-muted-foreground">当前岗位无权查看项目费用。</div>;

  const submit = () => {
    if (!form.title.trim() || !form.ownerUserId) { toast.error('请填写费用名称并选择责任人'); return; }
    const payload = {
      projectId,
      category: form.category,
      title: form.title.trim(),
      supplier: form.supplier.trim() || null,
      currency: form.currency.trim().toUpperCase(),
      budgetAmountMinor: toMinor(form.budget),
      actualAmountMinor: toMinor(form.actual),
      status: form.status,
      ownerUserId: form.ownerUserId,
      occurredDate: form.occurredDate || null,
      evidenceReference: form.evidenceReference.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else create.mutate(payload);
  };

  const edit = (row: NonNullable<typeof list.data>[number]) => setForm({
    id: row.id,
    category: row.category,
    title: row.title,
    supplier: row.supplier ?? '',
    currency: row.currency,
    budget: fromMinor(row.budgetAmountMinor),
    actual: fromMinor(row.actualAmountMinor),
    status: row.status,
    ownerUserId: row.ownerUserId,
    occurredDate: row.occurredDate ?? '',
    evidenceReference: row.evidenceReference ?? '',
    notes: row.notes ?? '',
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="rounded-[8px] bg-[color:var(--acc-soft)] p-2 text-primary"><WalletCards size={17} /></div>
        <div><div className="text-sm font-semibold text-foreground">项目费用</div><div className="text-xs text-muted-foreground">模具、认证、NRE、打样等项目性支出；不同币种独立汇总。</div></div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(summary.data ?? []).map((row) => (
          <div key={row.currency} className="rounded-[9px] border border-border bg-card p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{row.currency} · {row.itemCount} 项</div>
            <div className="mt-2 text-sm text-foreground">实际 <b>{fmt(row.currency, row.actualAmountMinor)}</b></div>
            <div className="mt-1 text-xs text-muted-foreground">预算 {fmt(row.currency, row.budgetAmountMinor)}</div>
            <div className={`mt-1 text-xs font-semibold ${row.varianceAmountMinor > 0 ? 'text-[color:var(--destructive)]' : 'text-[color:var(--success)]'}`}>偏差 {row.varianceAmountMinor > 0 ? '+' : ''}{fmt(row.currency, row.varianceAmountMinor)}</div>
          </div>
        ))}
        {(summary.data ?? []).length === 0 && <div className="rounded-[9px] border border-dashed border-border p-4 text-xs text-muted-foreground">尚未登记项目性支出</div>}
      </div>

      {canEdit && (
        <div className="rounded-[11px] border border-border bg-secondary p-4 space-y-3">
          <div className="text-xs font-semibold text-foreground">{form.id ? '编辑费用' : '登记费用'}</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="费用名称" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as ExpenseForm['category'] })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm">{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input value={form.supplier} onChange={(event) => setForm({ ...form, supplier: event.target.value })} placeholder="供应商（可选）" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
            <select value={form.ownerUserId ?? ''} onChange={(event) => setForm({ ...form, ownerUserId: event.target.value ? Number(event.target.value) : null })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm"><option value="">责任人</option>{internalMembers.map((member) => <option key={member.userId} value={member.userId}>{member.userName || `用户 #${member.userId}`}</option>)}</select>
            <input value={form.currency} maxLength={3} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="CNY" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm uppercase" />
            <input type="number" min="0" step="0.01" value={form.budget} onChange={(event) => setForm({ ...form, budget: event.target.value })} placeholder="预算金额" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
            <input type="number" min="0" step="0.01" value={form.actual} onChange={(event) => setForm({ ...form, actual: event.target.value })} placeholder="实际金额" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ExpenseForm['status'] })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input type="date" value={form.occurredDate} onChange={(event) => setForm({ ...form, occurredDate: event.target.value })} className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
            <input value={form.evidenceReference} onChange={(event) => setForm({ ...form, evidenceReference: event.target.value })} placeholder="合同、发票或凭证引用" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm md:col-span-2" />
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="备注" className="rounded-[7px] border border-border bg-card px-3 py-2 text-sm" />
          </div>
          <div className="flex justify-end gap-2">{form.id && <button onClick={() => setForm(emptyForm())} className="rounded-[7px] border border-border px-3 py-2 text-xs">取消编辑</button>}<button onClick={submit} disabled={create.isPending || update.isPending} className="inline-flex items-center gap-1.5 rounded-[7px] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"><Plus size={13} />{form.id ? '保存更新' : '登记费用'}</button></div>
        </div>
      )}

      <div className="space-y-2">{(list.data ?? []).map((row) => (
        <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[9px] border border-border bg-card p-3">
          <div><div className="text-sm font-medium text-foreground">{row.title}<span className="ml-2 text-[10px] text-muted-foreground">{CATEGORY_LABELS[row.category]} · {STATUS_LABELS[row.status]}</span></div><div className="mt-1 text-xs text-muted-foreground">责任人 {nameById.get(row.ownerUserId) ?? `#${row.ownerUserId}`}{row.supplier ? ` · ${row.supplier}` : ''}{row.evidenceReference ? ` · 凭证 ${row.evidenceReference}` : ''}</div></div>
          <div className="flex items-center gap-3"><div className="text-right text-xs"><div>实际 <b>{fmt(row.currency, row.actualAmountMinor)}</b></div><div className="text-muted-foreground">预算 {fmt(row.currency, row.budgetAmountMinor)}</div></div>{canEdit && <button onClick={() => edit(row)} className="text-muted-foreground hover:text-foreground"><Pencil size={14} /></button>}{canEdit && row.actualAmountMinor === 0 && row.status !== 'paid' && <button onClick={() => remove.mutate({ projectId, id: row.id })} className="text-muted-foreground hover:text-[color:var(--destructive)]"><Trash2 size={14} /></button>}</div>
        </div>
      ))}</div>
    </div>
  );
}

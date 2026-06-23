// 自定义字段面板：管理员定义字段（全局），项目级填值（存 project.customFields）。
import { useState, useEffect } from 'react';
import type { Project } from '@/lib/data';
import { trpc } from '@/lib/trpc';
import { Plus, Trash2, Settings2, X, GripVertical, Loader2 } from 'lucide-react';

type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';
const TYPE_LABELS: Record<FieldType, string> = {
  text: '文本', number: '数字', date: '日期', select: '单选', boolean: '是/否',
};

type FieldDef = {
  id: number;
  entityType: string;
  fieldKey: string;
  label: string;
  fieldType: FieldType;
  options: string[];
  required: boolean;
  sortOrder: number;
  archived: boolean;
};

export function CustomFieldsPanel({
  project, onUpdate, canEdit, isAdmin,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const utils = trpc.useUtils();
  const defsQuery = trpc.customFields.listDefs.useQuery({ entityType: 'project' });
  const [managing, setManaging] = useState(false);

  const defs = (defsQuery.data ?? []) as FieldDef[];
  const values = (project.customFields ?? {}) as Record<string, unknown>;

  const setValue = (key: string, value: unknown) => {
    if (!canEdit) return;
    onUpdate({ ...project, customFields: { ...values, [key]: value } });
  };

  if (defsQuery.isLoading) {
    return <div className="flex items-center gap-2 text-muted-foreground text-sm py-6"><Loader2 size={14} className="animate-spin" />加载字段定义…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-foreground">自定义字段</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">由系统管理员统一定义，所有项目共享字段集</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setManaging((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider rounded-[7px] border border-border text-foreground hover:bg-secondary transition-colors"
          >
            <Settings2 size={13} />
            {managing ? '完成' : '管理字段'}
          </button>
        )}
      </div>

      {managing && isAdmin && <FieldDefManager defs={defs} onChanged={() => utils.customFields.listDefs.invalidate()} />}

      {defs.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-dashed border-border rounded-[11px] py-8 text-center">
          暂无自定义字段{isAdmin ? '，点击右上角「管理字段」添加' : '，请联系管理员添加'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {defs.map((def) => (
            <div key={def.id} className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                {def.label}
                {def.required && <span className="text-[color:var(--destructive)]">*</span>}
              </label>
              <FieldValueInput def={def} value={values[def.fieldKey]} canEdit={canEdit} onChange={(v) => setValue(def.fieldKey, v)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldValueInput({
  def, value, canEdit, onChange,
}: { def: FieldDef; value: unknown; canEdit: boolean; onChange: (v: unknown) => void }) {
  const base = 'w-full rounded-[7px] border border-border px-2.5 py-1.5 text-sm focus:border-[color:var(--acc-border)] focus:outline-none disabled:bg-secondary disabled:text-muted-foreground';
  switch (def.fieldType) {
    case 'number':
      return <input type="number" disabled={!canEdit} value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} className={base} />;
    case 'text':
      // 本地草稿，避免受控输入在保存往返期间回弹
      return <TextDraftInput value={value == null ? '' : String(value)} canEdit={canEdit} onCommit={onChange} className={base} />;
    case 'date':
      return <input type="date" disabled={!canEdit} value={value ? String(value) : ''}
        onChange={(e) => onChange(e.target.value || null)} className={base} />;
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-foreground py-1.5">
          <input type="checkbox" disabled={!canEdit} checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-[color:var(--primary)]" />
          {value ? '是' : '否'}
        </label>
      );
    case 'select':
      return (
        <select disabled={!canEdit} value={value ? String(value) : ''} onChange={(e) => onChange(e.target.value || null)} className={base}>
          <option value="">—</option>
          {def.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );
    default:
      return <TextDraftInput value={value == null ? '' : String(value)} canEdit={canEdit} onCommit={onChange} className={base} />;
  }
}

// 文本输入：本地维护草稿，onChange 即时上报（父级已对网络保存做防抖），失焦时再兜底提交一次。
function TextDraftInput({ value, canEdit, onCommit, className }: { value: string; canEdit: boolean; onCommit: (v: string) => void; className: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return (
    <input
      type="text"
      disabled={!canEdit}
      value={draft}
      onChange={(e) => { setDraft(e.target.value); onCommit(e.target.value); }}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      className={className}
    />
  );
}

// ── 管理员：字段定义增删 ───────────────────────────────────────────────
function FieldDefManager({ defs, onChanged }: { defs: FieldDef[]; onChanged: () => void }) {
  const createDef = trpc.customFields.createDef.useMutation({ onSuccess: onChanged });
  const updateDef = trpc.customFields.updateDef.useMutation({ onSuccess: onChanged });
  const deleteDef = trpc.customFields.deleteDef.useMutation({ onSuccess: onChanged });

  const [form, setForm] = useState({ label: '', fieldKey: '', fieldType: 'text' as FieldType, options: '', required: false });
  const busy = createDef.isPending || deleteDef.isPending || updateDef.isPending;

  const add = () => {
    const slug = form.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    // 中文等无法生成 slug 时回退到唯一 key（用户也可手填）
    const fieldKey = form.fieldKey.trim() || slug || `field_${Date.now().toString(36)}`;
    if (!form.label.trim()) return;
    createDef.mutate({
      entityType: 'project',
      fieldKey,
      label: form.label.trim(),
      fieldType: form.fieldType,
      options: form.fieldType === 'select' ? form.options.split(',').map((s) => s.trim()).filter(Boolean) : [],
      required: form.required,
      sortOrder: defs.length,
    });
    setForm({ label: '', fieldKey: '', fieldType: 'text', options: '', required: false });
  };

  return (
    <div className="rounded-[11px] border border-border bg-secondary/60 p-4 space-y-3">
      {/* 现有字段列表 */}
      {defs.length > 0 && (
        <div className="space-y-1.5">
          {defs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm bg-card border border-border rounded-[7px] px-2.5 py-1.5">
              <GripVertical size={13} className="text-muted-foreground/60" />
              <span className="font-medium text-foreground">{d.label}</span>
              <span className="num text-[10px] text-muted-foreground">{d.fieldKey}</span>
              <span className="num text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground border border-border">{TYPE_LABELS[d.fieldType]}</span>
              {d.required && <span className="text-[10px] text-[color:var(--destructive)]">必填</span>}
              {d.fieldType === 'select' && d.options.length > 0 && <span className="text-[10px] text-muted-foreground truncate">{d.options.join(' / ')}</span>}
              <button disabled={busy} onClick={() => { if (confirm(`删除字段「${d.label}」？已填写的值会被忽略。`)) deleteDef.mutate({ id: d.id }); }}
                className="ml-auto text-muted-foreground hover:text-[color:var(--destructive)] disabled:opacity-40"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {/* 新增字段 */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input placeholder="字段名(如 客户名称)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="rounded-[7px] border border-border px-2 py-1.5 text-sm w-40 focus:border-[color:var(--acc-border)] focus:outline-none" />
        <input placeholder="key(可留空自动生成)" value={form.fieldKey} onChange={(e) => setForm({ ...form, fieldKey: e.target.value })}
          className="num rounded-[7px] border border-border px-2 py-1.5 text-sm w-44 text-xs focus:border-[color:var(--acc-border)] focus:outline-none" />
        <select value={form.fieldType} onChange={(e) => setForm({ ...form, fieldType: e.target.value as FieldType })}
          className="rounded-[7px] border border-border px-2 py-1.5 text-sm focus:border-[color:var(--acc-border)] focus:outline-none">
          {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        {form.fieldType === 'select' && (
          <input placeholder="选项,逗号分隔" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })}
            className="rounded-[7px] border border-border px-2 py-1.5 text-sm w-44 focus:border-[color:var(--acc-border)] focus:outline-none" />
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="accent-[color:var(--primary)]" />必填
        </label>
        <button disabled={busy || !form.label.trim()} onClick={add}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs uppercase tracking-wider rounded-[7px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity">
          <Plus size={13} />添加
        </button>
      </div>
    </div>
  );
}

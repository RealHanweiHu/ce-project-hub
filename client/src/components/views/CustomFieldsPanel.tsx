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
    return <div className="flex items-center gap-2 text-stone-400 text-sm py-6"><Loader2 size={14} className="animate-spin" />加载字段定义…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-stone-800">自定义字段</h3>
          <p className="text-[11px] text-stone-400 mt-0.5">由系统管理员统一定义，所有项目共享字段集</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setManaging((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider border border-stone-300 text-stone-600 hover:bg-stone-50 transition-colors"
          >
            <Settings2 size={13} />
            {managing ? '完成' : '管理字段'}
          </button>
        )}
      </div>

      {managing && isAdmin && <FieldDefManager defs={defs} onChanged={() => utils.customFields.listDefs.invalidate()} />}

      {defs.length === 0 ? (
        <div className="text-sm text-stone-400 border border-dashed border-stone-200 py-8 text-center">
          暂无自定义字段{isAdmin ? '，点击右上角「管理字段」添加' : '，请联系管理员添加'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {defs.map((def) => (
            <div key={def.id} className="space-y-1">
              <label className="text-[11px] font-mono uppercase tracking-wider text-stone-500 flex items-center gap-1">
                {def.label}
                {def.required && <span className="text-rose-500">*</span>}
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
  const base = 'w-full border border-stone-300 px-2.5 py-1.5 text-sm focus:border-stone-500 focus:outline-none disabled:bg-stone-50 disabled:text-stone-400';
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
        <label className="flex items-center gap-2 text-sm text-stone-700 py-1.5">
          <input type="checkbox" disabled={!canEdit} checked={!!value} onChange={(e) => onChange(e.target.checked)} className="accent-stone-700" />
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
    <div className="border border-stone-200 bg-stone-50/60 p-4 space-y-3">
      {/* 现有字段列表 */}
      {defs.length > 0 && (
        <div className="space-y-1.5">
          {defs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm bg-white border border-stone-200 px-2.5 py-1.5">
              <GripVertical size={13} className="text-stone-300" />
              <span className="font-medium text-stone-700">{d.label}</span>
              <span className="text-[10px] font-mono text-stone-400">{d.fieldKey}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 bg-stone-100 text-stone-500 border border-stone-200">{TYPE_LABELS[d.fieldType]}</span>
              {d.required && <span className="text-[10px] text-rose-500">必填</span>}
              {d.fieldType === 'select' && d.options.length > 0 && <span className="text-[10px] text-stone-400 truncate">{d.options.join(' / ')}</span>}
              <button disabled={busy} onClick={() => { if (confirm(`删除字段「${d.label}」？已填写的值会被忽略。`)) deleteDef.mutate({ id: d.id }); }}
                className="ml-auto text-stone-400 hover:text-rose-600 disabled:opacity-40"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}

      {/* 新增字段 */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <input placeholder="字段名(如 客户名称)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
          className="border border-stone-300 px-2 py-1.5 text-sm w-40 focus:border-stone-500 focus:outline-none" />
        <input placeholder="key(可留空自动生成)" value={form.fieldKey} onChange={(e) => setForm({ ...form, fieldKey: e.target.value })}
          className="border border-stone-300 px-2 py-1.5 text-sm w-44 font-mono text-xs focus:border-stone-500 focus:outline-none" />
        <select value={form.fieldType} onChange={(e) => setForm({ ...form, fieldType: e.target.value as FieldType })}
          className="border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none">
          {(Object.keys(TYPE_LABELS) as FieldType[]).map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
        </select>
        {form.fieldType === 'select' && (
          <input placeholder="选项,逗号分隔" value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })}
            className="border border-stone-300 px-2 py-1.5 text-sm w-44 focus:border-stone-500 focus:outline-none" />
        )}
        <label className="flex items-center gap-1.5 text-xs text-stone-600">
          <input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} className="accent-stone-700" />必填
        </label>
        <button disabled={busy || !form.label.trim()} onClick={add}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono uppercase tracking-wider bg-stone-800 text-white hover:bg-stone-900 disabled:opacity-40 transition-colors">
          <Plus size={13} />添加
        </button>
      </div>
    </div>
  );
}

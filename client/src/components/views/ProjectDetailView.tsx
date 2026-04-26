// Design: Industrial Precision - stone/amber color system
// ProjectDetailView: phase navigation, Gantt chart tab, task checklist, task details, file upload

import { useState, useRef } from 'react';
import {
  ArrowLeft, CheckCircle2, Circle, ChevronDown, ChevronRight,
  Upload, Download, Trash2, Paperclip, FileText, Image as ImageIcon,
  Edit3, Calendar, AlertTriangle, Target, Zap, BarChart2, ListChecks,
} from 'lucide-react';
import {
  Project, SOP_PHASES, PHASE_MAP, RISK_CONFIG,
  computePhaseProgress, computeOverallProgress, getPhaseStatus,
  TaskDetails, FileAttachment, formatBytes,
} from '@/lib/data';
import { ProgressBar } from '@/components/shared/ProgressBar';
import { GanttView } from './GanttView';

const MAX_FILE_SIZE = 2 * 1024 * 1024;

interface ProjectDetailViewProps {
  project: Project;
  onUpdate: (project: Project) => void;
  onBack: () => void;
}

function EditableText({
  value, onChange, className = '', placeholder = '点击编辑', inputClassName = '',
}: {
  value: string; onChange: (v: string) => void; className?: string; placeholder?: string; inputClassName?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        autoFocus
        className={`bg-amber-50 border-b-2 border-amber-500 outline-none px-1 ${inputClassName || className}`}
        placeholder={placeholder}
      />
    );
  }
  return (
    <span
      onClick={() => { setDraft(value || ''); setEditing(true); }}
      className={`${className} cursor-text hover:bg-amber-50/40 rounded px-1 -mx-1 group inline-flex items-center gap-1`}
    >
      {value || <span className="text-stone-400 italic">{placeholder}</span>}
      <Edit3 size={11} className="inline-block ml-1.5 text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity" />
    </span>
  );
}

function EditableSelect({
  value, options, onChange, className = '',
}: {
  value: string; options: string[]; onChange: (v: string) => void; className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        value={value}
        onChange={(e) => { onChange(e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)}
        autoFocus
        className={`bg-amber-50 border-b-2 border-amber-500 outline-none px-1 ${className}`}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`${className} cursor-pointer hover:bg-amber-50/40 rounded px-1 -mx-1`}
    >
      {value}
    </span>
  );
}

function FileUploadArea({
  files, onAdd, onRemove,
}: {
  files: FileAttachment[]; onAdd: (files: FileAttachment[]) => void; onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');

  const handleFiles = async (fileList: FileList) => {
    setError('');
    const newFiles: FileAttachment[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_SIZE) { setError(`文件 "${file.name}" 超出 2MB 限制`); continue; }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        newFiles.push({
          id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name, size: file.size, type: file.type || 'application/octet-stream',
          uploadDate: new Date().toISOString().slice(0, 10), dataUrl,
        });
      } catch { setError(`读取文件 "${file.name}" 失败`); }
    }
    if (newFiles.length > 0) onAdd(newFiles);
  };

  const downloadFile = (file: FileAttachment) => {
    const a = document.createElement('a');
    a.href = file.dataUrl; a.download = file.name; a.click();
  };

  const getIcon = (type: string) => type?.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />;

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
        className={`border-2 border-dashed p-4 text-center cursor-pointer transition-colors ${dragOver ? 'border-amber-500 bg-amber-50' : 'border-stone-300 hover:border-stone-400'}`}
      >
        <input ref={inputRef} type="file" multiple onChange={(e) => handleFiles(e.target.files!)} className="hidden" />
        <Upload size={18} className="mx-auto text-stone-400 mb-2" />
        <div className="text-sm text-stone-700"><span className="font-medium">点击上传</span>或拖拽文件</div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400 mt-1">
          单个文件最大 {formatBytes(MAX_FILE_SIZE)} · 支持 PDF / 图片 / Office 文档
        </div>
      </div>
      {error && <div className="mt-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 px-3 py-1.5">{error}</div>}
      {files && files.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {files.map((file) => (
            <div key={file.id} className="flex items-center gap-3 p-2.5 bg-white border border-stone-200 group">
              <span className="text-stone-500 shrink-0">{getIcon(file.type)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-stone-900 truncate">{file.name}</div>
                <div className="text-[10px] font-mono text-stone-500">{formatBytes(file.size)}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); downloadFile(file); }} className="p-1.5 text-stone-400 hover:text-stone-900 hover:bg-stone-100 transition-colors">
                <Download size={13} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); if (confirm('删除文件？')) onRemove(file.id); }} className="p-1.5 text-stone-400 hover:text-rose-600 hover:bg-rose-50 transition-colors">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskDetail({
  taskId, taskDetails, onUpdate,
}: {
  taskId: string; taskDetails: TaskDetails; onUpdate: (details: TaskDetails) => void;
}) {
  const [draft, setDraft] = useState(taskDetails?.instructions || '');
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = (val: string) => {
    setDraft(val); setDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onUpdate({ ...taskDetails, instructions: val }); setDirty(false);
    }, 800);
  };

  const handleBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (draft !== taskDetails?.instructions) { onUpdate({ ...taskDetails, instructions: draft }); setDirty(false); }
  };

  return (
    <div className="mt-3 border-t border-stone-100 pt-3 space-y-3">
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5">执行说明</div>
        <div className="relative">
          <textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            rows={4}
            placeholder="记录执行说明、注意事项、进展备注..."
            className="w-full px-3 py-2 border border-stone-200 focus:border-stone-400 outline-none text-xs text-stone-700 resize-none transition-colors"
          />
          {dirty && <div className="absolute bottom-2 right-2 text-[9px] font-mono text-stone-400">保存中...</div>}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1.5 flex items-center gap-1.5">
          <Paperclip size={10} />附件
        </div>
        <FileUploadArea
          files={taskDetails?.files || []}
          onAdd={(newFiles) => onUpdate({ ...taskDetails, files: [...(taskDetails?.files || []), ...newFiles] })}
          onRemove={(id) => onUpdate({ ...taskDetails, files: (taskDetails?.files || []).filter((f) => f.id !== id) })}
        />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function ProjectDetailView({ project, onUpdate, onBack }: ProjectDetailViewProps) {
  const [activePhaseId, setActivePhaseId] = useState(project.currentPhase);
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [mainTab, setMainTab] = useState<'tasks' | 'gantt'>('tasks');

  const activePhase = PHASE_MAP[activePhaseId];
  const activePhaseData = project.phases[activePhaseId];
  const activeProgress = computePhaseProgress(activePhaseData, activePhaseId);
  const overallProgress = computeOverallProgress(project);
  const risk = RISK_CONFIG[project.risk];

  const updateField = (field: keyof Project, value: string) => onUpdate({ ...project, [field]: value });

  const toggleTask = (taskId: string) => {
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      tasks: { ...activePhaseData.tasks, [taskId]: !activePhaseData.tasks[taskId] },
    };
    const newProgress = computePhaseProgress(newProject.phases[activePhaseId], activePhaseId);
    if (newProgress === 100) {
      const idx = SOP_PHASES.findIndex((p) => p.id === activePhaseId);
      if (idx < SOP_PHASES.length - 1 && activePhaseId === project.currentPhase) {
        newProject.currentPhase = SOP_PHASES[idx + 1].id;
      }
    }
    onUpdate(newProject);
  };

  const updateTaskDetails = (taskId: string, details: TaskDetails) => {
    const newProject = { ...project };
    newProject.phases = { ...project.phases };
    newProject.phases[activePhaseId] = {
      ...activePhaseData,
      taskDetails: { ...activePhaseData.taskDetails, [taskId]: details },
    };
    onUpdate(newProject);
  };

  const toggleExpand = (taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  // When user clicks a phase bar in Gantt, switch to tasks tab and jump to that phase
  const handleGanttPhaseClick = (phaseId: string) => {
    setActivePhaseId(phaseId);
    setMainTab('tasks');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-mono text-stone-500 hover:text-stone-900 transition-colors mb-4"
        >
          <ArrowLeft size={14} /> 返回项目列表
        </button>
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-1">
              <EditableText value={project.code} onChange={(v) => updateField('code', v)} className="text-[10px] font-mono uppercase tracking-widest text-stone-400" />
            </div>
            <h1 className="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight">
              <EditableText
                value={project.name}
                onChange={(v) => updateField('name', v)}
                className="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight"
                inputClassName="font-serif text-3xl lg:text-4xl text-stone-900 leading-tight w-full"
              />
            </h1>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-3 text-xs text-stone-500">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">类型</span>
                <EditableSelect
                  value={project.type}
                  options={['可穿戴', '音频', '影像', 'IoT', '移动设备', '其他']}
                  onChange={(v) => updateField('type', v)}
                  className="text-xs text-stone-700"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">PM</span>
                <EditableText value={project.pm} onChange={(v) => updateField('pm', v)} className="text-xs text-stone-700" />
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-stone-400" />
                <EditableText value={project.startDate} onChange={(v) => updateField('startDate', v)} className="text-xs font-mono text-stone-700" placeholder="开始日期" />
                <span className="text-stone-300">→</span>
                <EditableText value={project.targetDate} onChange={(v) => updateField('targetDate', v)} className="text-xs font-mono text-stone-700" placeholder="目标日期" />
              </div>
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-stone-400" />
                <EditableSelect
                  value={risk.label + '风险'}
                  options={['低风险', '中风险', '高风险']}
                  onChange={(v) => updateField('risk', v === '低风险' ? 'low' : v === '中风险' ? 'medium' : 'high')}
                  className={`text-xs font-medium ${risk.color}`}
                />
              </div>
            </div>
          </div>
          {/* Overall Progress */}
          <div className="lg:w-48 shrink-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">整体进度</span>
              <span className="text-lg font-serif font-semibold text-stone-900">{overallProgress}%</span>
            </div>
            <ProgressBar value={overallProgress} color="bg-stone-900" height="h-2" />
          </div>
        </div>
      </div>

      {/* Main Tab Bar: Tasks / Gantt */}
      <div className="flex items-center gap-0 border-b border-stone-200">
        <button
          onClick={() => setMainTab('tasks')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'tasks'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <ListChecks size={14} />
          任务清单
        </button>
        <button
          onClick={() => setMainTab('gantt')}
          className={`flex items-center gap-2 px-5 py-3 text-xs font-mono uppercase tracking-wider border-b-2 transition-all ${
            mainTab === 'gantt'
              ? 'border-b-stone-900 text-stone-900'
              : 'border-b-transparent text-stone-400 hover:text-stone-700'
          }`}
        >
          <BarChart2 size={14} />
          甘特图
        </button>
      </div>

      {/* ── Gantt Tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'gantt' && (
        <GanttView project={project} onUpdate={onUpdate} onPhaseClick={handleGanttPhaseClick} />
      )}

      {/* ── Tasks Tab ─────────────────────────────────────────────────────── */}
      {mainTab === 'tasks' && (
        <>
          {/* Phase Navigation */}
          <div className="bg-white border border-stone-200 overflow-x-auto">
            <div className="flex min-w-max">
              {SOP_PHASES.map((phase) => {
                const status = getPhaseStatus(project, phase.id);
                const isActive = phase.id === activePhaseId;
                return (
                  <button
                    key={phase.id}
                    onClick={() => setActivePhaseId(phase.id)}
                    className={`flex-1 min-w-[80px] p-3 text-left transition-all border-b-2 ${
                      isActive
                        ? 'border-b-stone-900 bg-stone-50'
                        : 'border-b-transparent hover:bg-stone-50'
                    }`}
                  >
                    <div className="text-[9px] font-mono uppercase tracking-widest text-stone-400 mb-0.5">{phase.code}</div>
                    <div className={`text-xs font-medium ${isActive ? 'text-stone-900' : 'text-stone-500'}`}>
                      {phase.nameEn}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      {status === 'completed' ? (
                        <CheckCircle2 size={10} className="text-emerald-500 shrink-0" />
                      ) : status === 'active' ? (
                        <Zap size={10} className="text-amber-500 shrink-0" />
                      ) : (
                        <Circle size={10} className="text-stone-300 shrink-0" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Task List */}
            <div className="lg:col-span-2 space-y-3">
              {/* Phase Header */}
              <div className="bg-white border border-stone-200 p-5" style={{ borderLeftWidth: 4, borderLeftColor: activePhase?.color }}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-stone-400">{activePhase?.code}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-300">·</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{activePhase?.duration}</span>
                    </div>
                    <h2 className="font-serif text-2xl text-stone-900">{activePhase?.name}</h2>
                    <p className="text-sm text-stone-500 mt-1">{activePhase?.desc}</p>
                  </div>
                  <div className="text-right shrink-0 ml-4">
                    <div className="text-2xl font-serif font-semibold text-stone-900">{activeProgress}%</div>
                    <div className="text-[10px] font-mono text-stone-400">完成</div>
                  </div>
                </div>
                <ProgressBar value={activeProgress} color="bg-amber-500" height="h-1.5" />
                <div className="mt-3 flex items-center gap-1.5">
                  <Target size={12} className="text-amber-600" />
                  <span className="text-xs font-medium text-stone-700">Gate: {activePhase?.gate}</span>
                </div>
              </div>

              {/* Tasks */}
              <div className="space-y-2">
                {activePhase?.tasks.map((task) => {
                  const checked = activePhaseData?.tasks[task.id] || false;
                  const details = activePhaseData?.taskDetails?.[task.id];
                  const expanded = expandedTasks.has(task.id);
                  const hasInstructions = !!(details?.instructions || '').trim();
                  const fileCount = (details?.files || []).length;

                  return (
                    <div
                      key={task.id}
                      className={`border transition-all ${checked ? 'border-l-2 border-l-stone-900 border-stone-200 bg-stone-50/50' : 'border-stone-200 bg-white'}`}
                    >
                      <div className="flex items-start gap-3 p-3 group">
                        <button onClick={() => toggleTask(task.id)} className="mt-0.5 shrink-0">
                          {checked ? (
                            <CheckCircle2 size={18} className="text-stone-900" />
                          ) : (
                            <Circle size={18} className="text-stone-300 hover:text-stone-500 transition-colors" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(task.id)}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${checked ? 'text-stone-500 line-through' : 'text-stone-900'}`}>
                              {task.name}
                            </span>
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{task.id}</span>
                            {hasInstructions && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-amber-600 flex items-center gap-0.5">
                                <Edit3 size={9} /> 已批注
                              </span>
                            )}
                            {fileCount > 0 && (
                              <span className="text-[10px] font-mono uppercase tracking-wider text-stone-400 flex items-center gap-0.5">
                                <Paperclip size={9} /> {fileCount}
                              </span>
                            )}
                          </div>
                          <p className={`text-xs mt-1 ${checked ? 'text-stone-400' : 'text-stone-500'}`}>
                            {task.desc}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleExpand(task.id)}
                          className="shrink-0 mt-0.5 text-stone-400 hover:text-stone-600 transition-colors"
                        >
                          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                      </div>

                      {expanded && (
                        <div className="px-3 pb-3">
                          {task.guide && (
                            <div className="p-3 border-l-2 border-amber-500 bg-amber-50 mb-3">
                              <div className="text-[10px] font-mono uppercase tracking-widest text-amber-600 mb-1.5">操作指南</div>
                              <pre className="text-xs text-stone-700 whitespace-pre-wrap font-sans leading-relaxed">{task.guide}</pre>
                            </div>
                          )}
                          <TaskDetail
                            taskId={task.id}
                            taskDetails={details || { instructions: '', files: [] }}
                            onUpdate={(d) => updateTaskDetails(task.id, d)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side Panel: Deliverables + Notes */}
            <div className="space-y-4">
              {/* Deliverables */}
              <div className="bg-white border border-stone-200 p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">交付物</div>
                <div className="space-y-1.5">
                  {activePhase?.deliverables.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-stone-700">
                      <span className="text-stone-300 mt-0.5">▸</span>
                      <span>{d}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Phase Notes */}
              <div className="bg-white border border-stone-200 p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">阶段备注</div>
                <textarea
                  value={activePhaseData?.notes || ''}
                  onChange={(e) => {
                    const newProject = { ...project };
                    newProject.phases = { ...project.phases };
                    newProject.phases[activePhaseId] = { ...activePhaseData, notes: e.target.value };
                    onUpdate(newProject);
                  }}
                  rows={5}
                  placeholder="记录阶段备注、决策记录、风险说明..."
                  className="w-full text-xs text-stone-700 border border-stone-200 focus:border-stone-400 outline-none px-3 py-2 resize-none transition-colors"
                />
              </div>

              {/* Phase Progress Summary */}
              <div className="bg-white border border-stone-200 p-5">
                <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mb-3">全阶段进度</div>
                <div className="space-y-3">
                  {SOP_PHASES.map((phase) => {
                    const pd = project.phases[phase.id];
                    const prog = computePhaseProgress(pd, phase.id);
                    const status = getPhaseStatus(project, phase.id);
                    return (
                      <div
                        key={phase.id}
                        className="cursor-pointer"
                        onClick={() => setActivePhaseId(phase.id)}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: phase.color }} />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-stone-500">{phase.code}</span>
                          </div>
                          <span className="text-[10px] font-mono text-stone-500">{prog}%</span>
                        </div>
                        <ProgressBar
                          value={prog}
                          color={status === 'completed' ? 'bg-emerald-500' : status === 'active' ? 'bg-amber-500' : 'bg-stone-200'}
                          height="h-1"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

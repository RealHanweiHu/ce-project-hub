// Design: Industrial Precision - stone/amber color system
// GlobalSearch: Ctrl+K command palette for searching projects, tasks, SOP, issues

import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, FolderKanban, CheckSquare, BookOpen, AlertTriangle, ChevronRight, X, Hash } from 'lucide-react';
import { Project } from '@/lib/data';
import { getProjectPhases } from '@/lib/data';
import { getPhasesForCategory } from '@/lib/sop-templates';
import { registerGetPhasesForCategory } from '@/lib/data';

// Register the category resolver once
registerGetPhasesForCategory(getPhasesForCategory);

type ResultType = 'project' | 'task' | 'sop' | 'issue';

interface SearchResult {
  id: string;
  type: ResultType;
  title: string;
  subtitle: string;
  meta?: string;
  projectId?: string;
  phaseId?: string;
  taskId?: string;
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  onNavigate: (result: SearchResult) => void;
}

const TYPE_CONFIG: Record<ResultType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  project: { label: '项目', icon: FolderKanban, color: 'text-amber-600', bg: 'bg-amber-50' },
  task: { label: '任务', icon: CheckSquare, color: 'text-blue-600', bg: 'bg-blue-50' },
  sop: { label: 'SOP', icon: BookOpen, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  issue: { label: '问题', icon: AlertTriangle, color: 'text-rose-600', bg: 'bg-rose-50' },
};

function highlight(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-amber-200 text-amber-900 rounded-sm px-0.5 not-italic font-semibold">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function GlobalSearch({ open, onClose, projects, onNavigate }: GlobalSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build search index from all data
  const buildResults = useCallback((q: string): SearchResult[] => {
    if (!q.trim()) return [];
    const lower = q.toLowerCase();
    const out: SearchResult[] = [];

    for (const project of projects) {
      // ── Project match ──────────────────────────────────────────────────
      if (
        project.name.toLowerCase().includes(lower) ||
        project.code.toLowerCase().includes(lower) ||
        project.pm.toLowerCase().includes(lower) ||
        project.type.toLowerCase().includes(lower)
      ) {
        out.push({
          id: `proj-${project.id}`,
          type: 'project',
          title: project.name,
          subtitle: `${project.code} · PM: ${project.pm} · ${project.type}`,
          meta: project.risk === 'high' ? '红灯项目' : project.risk === 'medium' ? '黄灯项目' : '',
          projectId: project.id,
        });
      }

      // ── Task match ─────────────────────────────────────────────────────
      const phases = getProjectPhases(project);
      for (const phase of phases) {
        for (const task of phase.tasks) {
          if (
            task.name.toLowerCase().includes(lower) ||
            task.desc.toLowerCase().includes(lower) ||
            task.guide.toLowerCase().includes(lower)
          ) {
            const phaseData = project.phases[phase.id];
            const done = phaseData?.tasks?.[task.id] ?? false;
            out.push({
              id: `task-${project.id}-${phase.id}-${task.id}`,
              type: 'task',
              title: task.name,
              subtitle: `${project.name} → ${phase.code} ${phase.name}`,
              meta: done ? '已完成' : '待完成',
              projectId: project.id,
              phaseId: phase.id,
              taskId: task.id,
            });
          }
        }

        // ── Issue match ──────────────────────────────────────────────────
        const issues = project.phases[phase.id]?.issues ?? [];
        for (const issue of issues) {
          if (
            issue.title.toLowerCase().includes(lower) ||
            issue.desc.toLowerCase().includes(lower) ||
            (issue.rootCause ?? '').toLowerCase().includes(lower) ||
            issue.owner.toLowerCase().includes(lower)
          ) {
            out.push({
              id: `issue-${project.id}-${phase.id}-${issue.id}`,
              type: 'issue',
              title: issue.title,
              subtitle: `${project.name} → ${phase.code} ${phase.name}`,
              meta: `${issue.severity} · ${issue.status === 'open' ? '待处理' : issue.status === 'resolved' ? '已解决' : issue.status === 'closed' ? '已关闭' : issue.status}`,
              projectId: project.id,
              phaseId: phase.id,
            });
          }
        }
      }
    }

    // ── SOP match (global SOP library) ────────────────────────────────────
    const allPhases = getPhasesForCategory('npd');
    for (const phase of allPhases) {
      for (const task of phase.tasks) {
        if (
          task.name.toLowerCase().includes(lower) ||
          task.desc.toLowerCase().includes(lower) ||
          task.guide.toLowerCase().includes(lower)
        ) {
          out.push({
            id: `sop-${phase.id}-${task.id}`,
            type: 'sop',
            title: task.name,
            subtitle: `SOP 流程库 → ${phase.code} ${phase.name}`,
            meta: task.owner,
          });
        }
      }
    }

    // Deduplicate and limit
    const seen = new Set<string>();
    return out.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).slice(0, 20);
  }, [projects]);

  useEffect(() => {
    const res = buildResults(query);
    setResults(res);
    setActiveIndex(0);
  }, [query, buildResults]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[activeIndex]) {
          onNavigate(results[activeIndex]);
          onClose();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, results, activeIndex, onNavigate, onClose]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  // Group results by type
  const grouped: Partial<Record<ResultType, SearchResult[]>> = {};
  for (const r of results) {
    if (!grouped[r.type]) grouped[r.type] = [];
    grouped[r.type]!.push(r);
  }
  const typeOrder: ResultType[] = ['project', 'task', 'issue', 'sop'];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className="relative w-full max-w-2xl mx-4 bg-white shadow-2xl border border-stone-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '70vh' }}
      >
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-stone-200 bg-stone-50">
          <Search size={16} className="text-stone-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索项目、任务、问题、SOP..."
            className="flex-1 bg-transparent text-stone-900 text-sm placeholder:text-stone-400 outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-stone-400 hover:text-stone-600 transition-colors">
              <X size={14} />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono text-stone-400 bg-stone-200 border border-stone-300">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 60px)' }}>
          {!query.trim() && (
            <div className="px-4 py-8 text-center">
              <div className="w-12 h-12 bg-stone-100 flex items-center justify-center mx-auto mb-3">
                <Search size={20} className="text-stone-400" />
              </div>
              <p className="text-sm text-stone-500">输入关键词搜索</p>
              <p className="text-xs text-stone-400 mt-1 font-mono">项目名称 · 任务 · 问题 · SOP 内容</p>
              <div className="flex items-center justify-center gap-4 mt-4">
                <span className="flex items-center gap-1 text-[10px] font-mono text-stone-400">
                  <kbd className="px-1 py-0.5 bg-stone-100 border border-stone-200 text-stone-500">↑↓</kbd>
                  导航
                </span>
                <span className="flex items-center gap-1 text-[10px] font-mono text-stone-400">
                  <kbd className="px-1 py-0.5 bg-stone-100 border border-stone-200 text-stone-500">↵</kbd>
                  跳转
                </span>
                <span className="flex items-center gap-1 text-[10px] font-mono text-stone-400">
                  <kbd className="px-1 py-0.5 bg-stone-100 border border-stone-200 text-stone-500">ESC</kbd>
                  关闭
                </span>
              </div>
            </div>
          )}

          {query.trim() && results.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-stone-500">未找到与 "<span className="text-stone-700 font-medium">{query}</span>" 相关的内容</p>
              <p className="text-xs text-stone-400 mt-1">尝试搜索项目名称、任务名称或负责人</p>
            </div>
          )}

          {query.trim() && results.length > 0 && (
            <div className="py-1">
              {typeOrder.map((type) => {
                const group = grouped[type];
                if (!group?.length) return null;
                const cfg = TYPE_CONFIG[type];
                const Icon = cfg.icon;

                // Compute flat index offset for keyboard nav
                let flatOffset = 0;
                for (const t of typeOrder) {
                  if (t === type) break;
                  flatOffset += grouped[t]?.length ?? 0;
                }

                return (
                  <div key={type}>
                    {/* Group header */}
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-stone-50 border-y border-stone-100">
                      <Icon size={11} className={cfg.color} />
                      <span className={`text-[10px] font-mono uppercase tracking-widest ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-[10px] font-mono text-stone-400 ml-auto">{group.length}</span>
                    </div>

                    {/* Items */}
                    {group.map((result, i) => {
                      const flatIdx = flatOffset + i;
                      const isActive = flatIdx === activeIndex;
                      return (
                        <button
                          key={result.id}
                          data-index={flatIdx}
                          onClick={() => { onNavigate(result); onClose(); }}
                          onMouseEnter={() => setActiveIndex(flatIdx)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                            isActive ? 'bg-amber-50 border-l-2 border-amber-500' : 'border-l-2 border-transparent hover:bg-stone-50'
                          }`}
                        >
                          <div className={`w-6 h-6 flex items-center justify-center shrink-0 ${cfg.bg}`}>
                            <Icon size={12} className={cfg.color} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-stone-900 truncate">
                              {highlight(result.title, query)}
                            </div>
                            <div className="text-[11px] text-stone-400 font-mono truncate mt-0.5">
                              {result.subtitle}
                            </div>
                          </div>
                          {result.meta && (
                            <span className={`text-[10px] font-mono px-1.5 py-0.5 shrink-0 ${
                              result.meta.includes('红灯') ? 'bg-rose-100 text-rose-700' :
                              result.meta.includes('P0') ? 'bg-rose-100 text-rose-700' :
                              result.meta.includes('P1') ? 'bg-orange-100 text-orange-700' :
                              result.meta.includes('已完成') ? 'bg-emerald-100 text-emerald-700' :
                              'bg-stone-100 text-stone-500'
                            }`}>
                              {result.meta}
                            </span>
                          )}
                          {isActive && <ChevronRight size={12} className="text-amber-500 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                );
              })}

              <div className="px-4 py-2 border-t border-stone-100 flex items-center gap-1 text-[10px] font-mono text-stone-400">
                <Hash size={10} />
                共 {results.length} 条结果
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

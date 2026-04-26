// Design: Industrial Precision - stone/amber color system
// Main application with sidebar navigation and view routing
// Font: Playfair Display (serif) + JetBrains Mono (mono) + Source Sans 3 (body)
// Colors: stone-900 sidebar, stone-50 background, amber-500 accent

import { useState, useEffect, useRef } from 'react';
import {
  LayoutDashboard, FolderKanban, BookOpen, Save, CheckCircle2,
  ChevronRight, Menu, X, Cpu,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import {
  Project, SAMPLE_PROJECTS, normalizeProject,
} from '@/lib/data';
import { DashboardView } from '@/components/views/DashboardView';
import { ProjectListView } from '@/components/views/ProjectListView';
import { ProjectDetailView } from '@/components/views/ProjectDetailView';
import { SOPLibraryView } from '@/components/views/SOPLibraryView';

type View = 'dashboard' | 'projects' | 'sop';

const STORAGE_KEY = 'ce_projects_v2';

export default function Home() {
  const [view, setView] = useState<View>('dashboard');
  const [projects, setProjects] = useState<Project[]>(
    SAMPLE_PROJECTS.map(normalizeProject)
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved) && saved.length > 0) {
          setProjects(saved.map(normalizeProject));
        }
      }
    } catch {}
    setLoaded(true);
  }, []);

  // Auto-save
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
        setSaveStatus('saved');
      } catch {}
    }, 600);
  }, [projects, loaded]);

  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) || null
    : null;

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    setView('projects');
    setSidebarOpen(false);
  };

  const handleUpdateProject = (updated: Project) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleAddProject = (data: Omit<Project, 'id' | 'phases'>) => {
    const newProject = normalizeProject({
      ...data,
      id: nanoid(8),
      phases: {},
    } as Project);
    setProjects((prev) => [...prev, newProject]);
  };

  const handleDeleteProject = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (selectedProjectId === id) setSelectedProjectId(null);
  };

  const navItems = [
    { id: 'dashboard' as View, label: '仪表盘', labelEn: 'Dashboard', icon: LayoutDashboard },
    { id: 'projects' as View, label: '项目管理', labelEn: 'Projects', icon: FolderKanban },
    { id: 'sop' as View, label: 'SOP 流程库', labelEn: 'SOP Library', icon: BookOpen },
  ];

  const handleNavClick = (v: View) => {
    setView(v);
    if (v !== 'projects') setSelectedProjectId(null);
    setSidebarOpen(false);
  };

  const viewLabels: Record<View, string> = {
    dashboard: 'Dashboard',
    projects: 'Projects',
    sop: 'SOP Library',
  };

  return (
    <div className="min-h-screen flex bg-stone-50">
      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-stone-900/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-60 bg-stone-900 flex flex-col z-40 shrink-0 transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="p-5 border-b border-stone-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-amber-500 flex items-center justify-center shrink-0">
                <Cpu size={16} className="text-stone-900" />
              </div>
              <div>
                <h1 className="font-serif text-base text-stone-50 leading-tight">CE Project Hub</h1>
                <p className="text-[9px] font-mono uppercase tracking-widest text-stone-500 mt-0.5">
                  Product Dev
                </p>
              </div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-stone-500 hover:text-stone-300 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ id, label, labelEn, icon: Icon }) => {
            const isActive = view === id;
            return (
              <button
                key={id}
                onClick={() => handleNavClick(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all group ${
                  isActive
                    ? 'bg-stone-800 text-stone-50'
                    : 'text-stone-400 hover:bg-stone-800/60 hover:text-stone-200'
                }`}
              >
                <Icon size={15} className={isActive ? 'text-amber-400' : 'text-stone-500 group-hover:text-stone-400'} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">{label}</div>
                  <div className="text-[9px] font-mono uppercase tracking-widest text-stone-600 leading-tight mt-0.5">{labelEn}</div>
                </div>
                {isActive && <ChevronRight size={13} className="text-amber-400 shrink-0" />}
              </button>
            );
          })}

          {/* Recent Projects (when in projects view) */}
          {view === 'projects' && projects.length > 0 && (
            <div className="mt-4">
              <div className="text-[9px] font-mono uppercase tracking-widest text-stone-600 mb-1.5 px-3">
                最近项目
              </div>
              {projects.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectProject(p.id)}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors truncate ${
                    selectedProjectId === p.id
                      ? 'text-amber-400 bg-stone-800'
                      : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/40'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* Save Status */}
        <div className="p-4 border-t border-stone-800">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            {saveStatus === 'saved' ? (
              <>
                <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                <span className="text-stone-500">已自动保存</span>
              </>
            ) : (
              <>
                <Save size={11} className="text-amber-400 animate-pulse shrink-0" />
                <span className="text-stone-500">保存中...</span>
              </>
            )}
          </div>
          <div className="mt-2 text-[9px] font-mono text-stone-700">
            {projects.length} PROJECTS · LOCAL STORAGE
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="sticky top-0 z-20 bg-stone-50/95 backdrop-blur-sm border-b border-stone-200 px-4 lg:px-8 py-3.5 flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-stone-500 hover:text-stone-900 transition-colors"
          >
            <Menu size={20} />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-[11px] font-mono text-stone-400 min-w-0">
            <span className="uppercase tracking-wider hidden sm:inline">CE Project Hub</span>
            <ChevronRight size={11} className="hidden sm:inline shrink-0" />
            <span className="uppercase tracking-wider text-stone-700">
              {viewLabels[view]}
            </span>
            {selectedProject && (
              <>
                <ChevronRight size={11} className="shrink-0" />
                <span className="text-stone-500 truncate">{selectedProject.name}</span>
              </>
            )}
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-stone-400">
              {saveStatus === 'saved' ? (
                <><CheckCircle2 size={11} className="text-emerald-500" /> 已保存</>
              ) : (
                <><Save size={11} className="text-amber-400 animate-pulse" /> 保存中</>
              )}
            </div>
            <div className="text-[10px] font-mono text-stone-400 hidden md:block bg-stone-100 px-2 py-1">
              {projects.length} PROJECTS
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-auto">
          {view === 'dashboard' && (
            <DashboardView projects={projects} onSelectProject={handleSelectProject} />
          )}
          {view === 'projects' && !selectedProject && (
            <ProjectListView
              projects={projects}
              onSelectProject={handleSelectProject}
              onAddProject={handleAddProject}
              onDeleteProject={handleDeleteProject}
            />
          )}
          {view === 'projects' && selectedProject && (
            <ProjectDetailView
              project={selectedProject}
              onUpdate={handleUpdateProject}
              onBack={() => setSelectedProjectId(null)}
            />
          )}
          {view === 'sop' && <SOPLibraryView />}
        </main>
      </div>
    </div>
  );
}

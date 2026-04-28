// Design: Industrial Precision - stone/amber color system
// Main application with sidebar navigation and view routing
// Font: Playfair Display (serif) + JetBrains Mono (mono) + Source Sans 3 (body)
// Colors: stone-900 sidebar, stone-50 background, amber-500 accent

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import {
  LayoutDashboard, FolderKanban, BookOpen, Save, CheckCircle2,
  ChevronRight, Menu, X, Cpu, Search, LogIn, Loader2, Cloud, Shield, KeyRound,
} from 'lucide-react';
import { GlobalSearch } from '@/components/GlobalSearch';
import { nanoid } from 'nanoid';
import {
  Project, normalizeProject,
} from '@/lib/data';
import { buildPhasesDataForCategory, getPhasesForCategory } from '@/lib/sop-templates';
import { DashboardView } from '@/components/views/DashboardView';
import { ProjectListView } from '@/components/views/ProjectListView';
import { ProjectDetailView } from '@/components/views/ProjectDetailView';
import { SOPLibraryView } from '@/components/views/SOPLibraryView';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { getLoginUrl } from '@/const';
import { useQueryClient } from '@tanstack/react-query';
import { getQueryKey } from '@trpc/react-query';
import { ChangePasswordDialog } from '@/components/ChangePasswordDialog';

type View = 'dashboard' | 'projects' | 'sop';

// Helper: convert Project to API input shape
function projectToApiInput(p: Project) {
  const { id, name, code, category, pm, risk, currentPhase, startDate, targetDate, phases, phaseDates, changeLog } = p;
  return {
    id,
    name: name || '',
    projectNumber: code || '',
    category: category || 'npd',
    pm: pm || '',
    risk: risk || 'low',
    currentPhase: currentPhase || 'concept',
    progress: 0,
    startDate: startDate || null,
    targetDate: targetDate || null,
    data: { phases, phaseDates, changeLog } as Record<string, unknown>,
  };
}

// Helper: convert API row back to Project
function rowToProject(row: {
  id: string; name: string; projectNumber: string; category: string;
  pm: string; risk: string; currentPhase: string; progress: number;
  startDate: string | null; targetDate: string | null;
  data: Record<string, unknown>;
}): Project {
  const { data, projectNumber, ...meta } = row;
  return normalizeProject({
    ...meta,
    code: projectNumber || '',
    type: (data.type as string) || '',
    phases: (data.phases as Record<string, unknown>) || {},
    phaseDates: data.phaseDates as Record<string, unknown> | undefined,
    changeLog: data.changeLog as unknown[] | undefined,
  } as unknown as Project);
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const isAdmin = (user as (typeof user & { role?: string }) | null)?.role === 'admin';
  // canCreateProject is derived from auth.me (admin always true, others need explicit grant)
  const canCreateProject = !!(user as (typeof user & { canCreateProject?: boolean }) | null)?.canCreateProject;
  const queryClient = useQueryClient();

  const [view, setView] = useState<View>('dashboard');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── tRPC queries & mutations ─────────────────────────────────────────────
  const { data: projectRows = [], isLoading: projectsLoading } = trpc.projects.list.useQuery(
    undefined,
    { enabled: !!user }
  );

  const projects: Project[] = projectRows.map(rowToProject);

  const createMutation = trpc.projects.create.useMutation();
  const updateMutation = trpc.projects.update.useMutation();
  const deleteMutation = trpc.projects.delete.useMutation();
  const bulkImportMutation = trpc.projects.bulkImport.useMutation();

  const invalidateProjects = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getQueryKey(trpc.projects.list) });
  }, [queryClient]);

  // ── Ctrl+K global shortcut ───────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearchNavigate = useCallback((result: { type: string; projectId?: string }) => {
    if (result.projectId) {
      setSelectedProjectId(result.projectId);
      setView('projects');
    } else if (result.type === 'sop') {
      setView('sop');
      setSelectedProjectId(null);
    }
  }, []);

  // ── Project CRUD ─────────────────────────────────────────────────────────
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId) || null
    : null;

  const handleSelectProject = (id: string) => {
    setSelectedProjectId(id);
    setView('projects');
    setSidebarOpen(false);
  };

  const handleUpdateProject = async (updated: Project) => {
    setSaveStatus('saving');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await updateMutation.mutateAsync(projectToApiInput(updated));
        invalidateProjects();
        setSaveStatus('saved');
        setLastSavedAt(new Date());
      } catch {
        setSaveStatus('error');
      }
    }, 600);
  };

  const handleAddProject = async (data: Omit<Project, 'id' | 'phases'>) => {
    const newProject = normalizeProject({
      ...data,
      id: nanoid(8),
      phases: {},
    } as Project);
    try {
      await createMutation.mutateAsync(projectToApiInput(newProject));
      invalidateProjects();
    } catch {
      setSaveStatus('error');
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteMutation.mutateAsync({ id });
      invalidateProjects();
      if (selectedProjectId === id) setSelectedProjectId(null);
    } catch {
      setSaveStatus('error');
    }
  };

  const handleCloneProject = async (sourceId: string, overrides: Partial<Omit<Project, 'id' | 'phases'>>) => {
    const source = projects.find((p) => p.id === sourceId);
    if (!source) return;
    const category = source.category || 'npd';
    const phases = getPhasesForCategory(category);
    const firstPhaseId = phases[0]?.id || 'concept';
    const freshPhases = buildPhasesDataForCategory(category, firstPhaseId);
    const cloned = normalizeProject({
      ...source,
      ...overrides,
      id: nanoid(8),
      currentPhase: firstPhaseId,
      phases: freshPhases,
      phaseDates: undefined,
    } as Project);
    try {
      await createMutation.mutateAsync(projectToApiInput(cloned));
      invalidateProjects();
      setSelectedProjectId(cloned.id);
      setView('projects');
    } catch {
      setSaveStatus('error');
    }
  };

  // ── Navigation ───────────────────────────────────────────────────────────
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

  // ── Auth loading / login gate ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 bg-amber-500 flex items-center justify-center">
            <Cpu size={20} className="text-stone-900" />
          </div>
          <Loader2 size={20} className="animate-spin text-stone-400" />
          <p className="text-sm font-mono text-stone-400 uppercase tracking-widest">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="text-center space-y-6 max-w-sm px-6">
          <div className="flex justify-center">
            <div className="w-14 h-14 bg-amber-500 flex items-center justify-center">
              <Cpu size={26} className="text-stone-900" />
            </div>
          </div>
          <div>
            <h1 className="font-serif text-2xl text-stone-900 mb-2">CE Project Hub</h1>
            <p className="text-[11px] font-mono uppercase tracking-widest text-stone-400">
              Consumer Electronics · Product Development
            </p>
          </div>
          <p className="text-sm text-stone-500">
            请登录以访问您的项目数据，支持多人多设备实时同步。
          </p>
          <a
            href={getLoginUrl()}
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-stone-900 font-medium px-6 py-3 transition-colors text-sm"
          >
            <LogIn size={16} />
            登录 / 注册
          </a>
        </div>
      </div>
    );
  }

  // ── Main App ─────────────────────────────────────────────────────────────
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

          {/* Recent Projects */}
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

        {/* Save Status + User */}
        <div className="p-4 border-t border-stone-800 space-y-2">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider">
            {saveStatus === 'saved' ? (
              <>
                <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />
                <span className="text-stone-500">已同步至云端</span>
              </>
            ) : saveStatus === 'error' ? (
              <>
                <span className="text-[10px] text-rose-400 shrink-0">✕</span>
                <span className="text-rose-400">同步失败</span>
              </>
            ) : (
              <>
                <Save size={11} className="text-amber-400 animate-pulse shrink-0" />
                <span className="text-stone-500">同步中...</span>
              </>
            )}
          </div>
          {lastSavedAt && saveStatus === 'saved' && (
            <div className="text-[9px] font-mono text-stone-600">
              {lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
          )}
          <div className="text-[9px] font-mono text-stone-700">
            {projects.length} PROJECTS · CLOUD DB
          </div>
          {/* Admin link - only visible to admin users */}
          {isAdmin && (
            <button
              onClick={() => navigate('/admin')}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-amber-500 hover:text-amber-300 hover:bg-stone-800/60 transition-colors"
            >
              <Shield size={12} className="shrink-0" />
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider">系统管理</div>
                <div className="text-[9px] font-mono text-stone-600">Admin Panel</div>
              </div>
            </button>
          )}

          {/* User info + change password */}
          <div className="pt-1 flex items-center gap-2 group">
            <div className="w-5 h-5 bg-amber-600 flex items-center justify-center text-[9px] font-mono text-stone-900 uppercase shrink-0">
              {(user.name || user.email || 'U').charAt(0)}
            </div>
            <span className="text-[10px] text-stone-500 truncate flex-1">{user.name || user.email}</span>
            <button
              onClick={() => setChangePasswordOpen(true)}
              title="修改密码"
              className="opacity-0 group-hover:opacity-100 transition-opacity text-stone-600 hover:text-amber-400"
            >
              <KeyRound size={11} />
            </button>
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

          <div className="ml-auto flex items-center gap-3">
            {/* Search trigger */}
            <button
              onClick={() => setSearchOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 border border-stone-200 bg-white hover:border-stone-400 transition-colors text-stone-400 hover:text-stone-700"
            >
              <Search size={13} />
              <span className="text-[11px] font-mono hidden sm:inline">搜索</span>
              <kbd className="hidden md:flex items-center gap-0.5 text-[9px] font-mono text-stone-300 bg-stone-100 px-1 py-0.5 border border-stone-200">
                ⌘K
              </kbd>
            </button>

            {/* Sync status */}
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
              {saveStatus === 'saving' ? (
                <span className="flex items-center gap-1.5 text-stone-400">
                  <Save size={11} className="text-amber-400 animate-pulse" />
                  <span>同步中...</span>
                </span>
              ) : saveStatus === 'error' ? (
                <span className="flex items-center gap-1.5 text-rose-500">
                  <span>✕</span><span>同步失败</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 text-stone-400">
                  <Cloud size={11} className="text-emerald-500" />
                  <span>已同步</span>
                  {lastSavedAt && (
                    <span className="text-stone-300 normal-case tracking-normal">
                      {lastSavedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="text-[10px] font-mono text-stone-400 hidden md:block bg-stone-100 px-2 py-1">
              {projectsLoading ? '...' : `${projects.length} PROJECTS`}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 p-4 lg:p-8 overflow-auto">
          {projectsLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3">
                <Loader2 size={24} className="animate-spin text-amber-500" />
                <p className="text-sm font-mono text-stone-400 uppercase tracking-widest">加载项目数据...</p>
              </div>
            </div>
          ) : (
            <>
              {view === 'dashboard' && (
                <DashboardView projects={projects} onSelectProject={handleSelectProject} />
              )}
              {view === 'projects' && !selectedProject && (
                <ProjectListView
                  projects={projects}
                  onSelectProject={handleSelectProject}
                  onAddProject={handleAddProject}
                  onDeleteProject={handleDeleteProject}
                  onCloneProject={handleCloneProject}
                  canCreateProject={canCreateProject}
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
            </>
          )}
        </main>
      </div>

      {/* Global Search */}
      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        projects={projects}
        onNavigate={handleSearchNavigate}
      />
      {/* Change Password Dialog */}
      <ChangePasswordDialog
        open={changePasswordOpen}
        onOpenChange={setChangePasswordOpen}
      />
    </div>
  );
}

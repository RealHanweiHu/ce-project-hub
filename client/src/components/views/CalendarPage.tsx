import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, Clock, Flag, ListChecks, Loader2,
  MapPin, Plus, Rocket, Save, ShieldCheck, UserRound, X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getPhasesForCategory } from "@/lib/sop-templates";

type CalendarEvent = {
  date: string;
  type: "task" | "phase" | "gate" | "target" | "schedule";
  projectId: string;
  projectName: string;
  label: string;
  startTime?: string | null;
  durationMin?: number | null;
  dingtalkSyncStatus?: string | null;
  phaseId?: string | null;
  taskId?: string | null;
  status?: string | null;
  priority?: string | null;
  ownerLabel?: string | null;
};

type ProjectOption = {
  id: string;
  name: string;
  projectNumber?: string;
  code?: string;
};

type Tab = "calendar" | "milestones";
type Filter = "all" | CalendarEvent["type"];
type Lens = "manager" | "pm" | "rd";

type WorkbenchTask = {
  id: number;
  projectId: string;
  phaseId: string;
  taskId: string;
  projectName: string;
  projectCategory: string;
  dueDate: string | null;
  status: string;
  priority: string | null;
};

type WorkbenchRole = {
  projectId: string;
  role: string;
};

type WorkbenchData = {
  systemRole?: string;
  roles?: WorkbenchRole[];
  tasks?: WorkbenchTask[];
};

const TYPE_META: Record<CalendarEvent["type"], { label: string; cls: string; icon: React.ReactNode }> = {
  task: { label: "任务", cls: "bg-stone-50 text-stone-700 border-stone-200", icon: <ListChecks size={11} /> },
  schedule: { label: "日程", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <Clock size={11} /> },
  gate: { label: "Gate", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: <ShieldCheck size={11} /> },
  phase: { label: "阶段", cls: "bg-blue-50 text-blue-700 border-blue-200", icon: <Flag size={11} /> },
  target: { label: "目标", cls: "bg-rose-50 text-rose-700 border-rose-200", icon: <Rocket size={11} /> },
};

const LENS_META: Record<Lens, { label: string; icon: React.ReactNode }> = {
  manager: { label: "管理层", icon: <BriefcaseBusiness size={13} /> },
  pm: { label: "PM", icon: <Flag size={13} /> },
  rd: { label: "我的", icon: <UserRound size={13} /> },
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

function addMinutes(time: string, mins: number) {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
}

function inWindow(date: string | null | undefined, fromDate: string, toDate: string) {
  return !!date && date >= fromDate && date <= toDate;
}

function taskName(task: WorkbenchTask) {
  const phase = getPhasesForCategory(task.projectCategory as "npd" | "eco" | "idr" | "jdm" | "obt")
    .find((item) => item.id === task.phaseId);
  return phase?.tasks.find((item) => item.id === task.taskId)?.name ?? task.taskId;
}

function priorityLabel(priority: string | null | undefined) {
  if (priority === "critical") return "P0";
  if (priority === "high") return "P1";
  if (priority === "medium") return "P2";
  if (priority === "low") return "P3";
  return null;
}

function statusLabel(status: string) {
  if (status === "todo") return "待开始";
  if (status === "in_progress") return "进行中";
  if (status === "blocked") return "阻塞";
  if (status === "done") return "已完成";
  if (status === "skipped") return "跳过";
  return status;
}

function calendarEventKey(event: CalendarEvent) {
  return [
    event.type,
    event.projectId,
    event.phaseId ?? "",
    event.taskId ?? "",
    event.date,
    event.startTime ?? "",
    event.label,
  ].join("|");
}

function mergeCalendarEvents(...groups: CalendarEvent[][]) {
  const byKey = new Map<string, CalendarEvent>();
  for (const group of groups) {
    for (const event of group) {
      const key = calendarEventKey(event);
      if (!byKey.has(key)) byKey.set(key, event);
    }
  }
  return Array.from(byKey.values());
}

export function CalendarPage({ projects, onSelectProject }: { projects: ProjectOption[]; onSelectProject: (id: string) => void }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const [tab, setTab] = useState<Tab>("calendar");
  const [filter, setFilter] = useState<Filter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const first = new Date(ym.year, ym.month, 1);
  const daysInMonth = new Date(ym.year, ym.month + 1, 0).getDate();
  const fromDate = ymd(ym.year, ym.month, 1);
  const toDate = ymd(ym.year, ym.month, daysInMonth);

  const calendarQ = trpc.projects.calendar.useQuery({ fromDate, toDate });
  const { data: workbench } = trpc.workbench.mine.useQuery();
  const workbenchData = workbench as WorkbenchData | undefined;
  const projectEvents = (calendarQ.data ?? []) as CalendarEvent[];
  const taskEvents = useMemo<CalendarEvent[]>(() => {
    return (workbenchData?.tasks ?? [])
      .filter((task) => inWindow(task.dueDate, fromDate, toDate))
      .map((task) => ({
        date: task.dueDate!,
        type: "task",
        projectId: task.projectId,
        projectName: task.projectName,
        label: taskName(task),
        phaseId: task.phaseId,
        taskId: task.taskId,
        status: task.status,
        priority: task.priority,
        ownerLabel: "我负责",
      }));
  }, [fromDate, toDate, workbenchData?.tasks]);

  const creatableProjectIds = useMemo(() => {
    if (workbenchData?.systemRole === "admin") return new Set(projects.map((project) => project.id));
    return new Set((workbenchData?.roles ?? [])
      .filter((role) => ["owner", "manager", "pm"].includes(role.role))
      .map((role) => role.projectId));
  }, [projects, workbenchData]);
  const creatableProjects = useMemo(
    () => projects.filter((project) => creatableProjectIds.has(project.id)),
    [projects, creatableProjectIds],
  );

  const roleProjectIds = useMemo(() => new Set((workbenchData?.roles ?? []).map((role) => role.projectId)), [workbenchData?.roles]);
  const pmProjectIds = useMemo(() => new Set((workbenchData?.roles ?? [])
    .filter((role) => ["owner", "pm"].includes(role.role))
    .map((role) => role.projectId)), [workbenchData?.roles]);
  const taskProjectIds = useMemo(() => new Set(taskEvents.map((event) => event.projectId)), [taskEvents]);
  const availableLenses = useMemo<Lens[]>(() => {
    const list: Lens[] = [];
    if (workbenchData?.systemRole === "admin" || (workbenchData?.roles ?? []).some((role) => role.role === "manager")) list.push("manager");
    if (pmProjectIds.size > 0 || creatableProjectIds.size > 0) list.push("pm");
    list.push("rd");
    return Array.from(new Set(list));
  }, [creatableProjectIds, pmProjectIds.size, workbenchData?.roles, workbenchData?.systemRole]);
  const [lens, setLens] = useState<Lens | null>(null);
  const activeLens = lens && availableLenses.includes(lens) ? lens : availableLenses[0];

  const scopedEvents = useMemo(() => {
    if (activeLens === "manager") {
      return projectEvents;
    }
    if (activeLens === "pm") {
      const scope = pmProjectIds.size > 0 ? pmProjectIds : creatableProjectIds;
      return mergeCalendarEvents(
        taskEvents.filter((event) => scope.has(event.projectId)),
        projectEvents.filter((event) => scope.has(event.projectId)),
      );
    }
    return mergeCalendarEvents(
      taskEvents,
      projectEvents.filter((event) => roleProjectIds.has(event.projectId) || taskProjectIds.has(event.projectId)),
    );
  }, [activeLens, creatableProjectIds, pmProjectIds, projectEvents, roleProjectIds, taskEvents, taskProjectIds]);

  const filteredEvents = useMemo(
    () => {
      const items = filter === "all" ? scopedEvents : scopedEvents.filter((event) => event.type === filter);
      return [...items].sort((a, b) => a.date.localeCompare(b.date) || eventRank(a.type) - eventRank(b.type) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    },
    [scopedEvents, filter],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of filteredEvents) {
      const bucket = map.get(event.date) ?? [];
      bucket.push(event);
      map.set(event.date, bucket);
    }
    Array.from(map.values()).forEach((bucket: CalendarEvent[]) => {
      bucket.sort((a: CalendarEvent, b: CalendarEvent) =>
        eventRank(a.type) - eventRank(b.type) || (a.startTime ?? "").localeCompare(b.startTime ?? ""),
      );
    });
    return map;
  }, [filteredEvents]);

  const counts = useMemo(() => ({
    task: scopedEvents.filter((event) => event.type === "task").length,
    schedule: scopedEvents.filter((event) => event.type === "schedule").length,
    gate: scopedEvents.filter((event) => event.type === "gate").length,
    phase: scopedEvents.filter((event) => event.type === "phase").length,
    target: scopedEvents.filter((event) => event.type === "target").length,
  }), [scopedEvents]);

  const shift = (delta: number) => setYm(({ year, month }) => {
    const d = new Date(year, month + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  return (
    <div className="ce-page">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-serif text-xl text-stone-900">日历与里程碑</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => shift(-1)} className="ce-control border border-stone-200 bg-white p-2 text-stone-500 hover:text-stone-900" title="上个月">
            <ChevronLeft size={15} />
          </button>
          <div className="ce-control min-w-[112px] border border-stone-200 bg-white px-3 py-2 text-center text-sm font-mono text-stone-700">
            {ym.year}-{pad(ym.month + 1)}
          </div>
          <button onClick={() => shift(1)} className="ce-control border border-stone-200 bg-white p-2 text-stone-500 hover:text-stone-900" title="下个月">
            <ChevronRight size={15} />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            disabled={creatableProjects.length === 0}
            className="ce-control inline-flex items-center gap-2 bg-stone-900 px-3 py-2 text-xs font-mono uppercase tracking-wider text-stone-50 hover:bg-stone-700 disabled:opacity-40"
          >
            <Plus size={13} />
            创建日程
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="任务截止" value={counts.task} tone="stone" />
        <Stat label="项目日程" value={counts.schedule} tone="emerald" />
        <Stat label="Gate 评审" value={counts.gate} tone="amber" />
        <Stat label="阶段截止" value={counts.phase} tone="blue" />
        <Stat label="目标交付" value={counts.target} tone="rose" />
      </div>

      <div className="ce-panel p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex w-fit border border-stone-200 bg-stone-50 p-1">
              <TabButton active={tab === "calendar"} onClick={() => setTab("calendar")} icon={<CalendarDays size={13} />}>日历</TabButton>
              <TabButton active={tab === "milestones"} onClick={() => setTab("milestones")} icon={<Flag size={13} />}>截止清单</TabButton>
            </div>
            {availableLenses.length > 1 && (
              <div className="inline-flex w-fit border border-stone-200 bg-white p-1">
                {availableLenses.map((item) => (
                  <TabButton key={item} active={activeLens === item} onClick={() => setLens(item)} icon={LENS_META[item].icon}>
                    {LENS_META[item].label}
                  </TabButton>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "task", "schedule", "gate", "phase", "target"] as Filter[]).map((item) => (
              <button
                key={item}
                onClick={() => setFilter(item)}
                className={`border px-2 py-1 text-[10px] font-mono transition-colors ${
                  filter === item
                    ? "border-stone-900 bg-stone-900 text-white"
                    : "border-stone-200 bg-white text-stone-500 hover:border-stone-400"
                }`}
              >
                {item === "all" ? "全部" : TYPE_META[item].label}
              </button>
            ))}
          </div>
        </div>

        {calendarQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-stone-400">
            <Loader2 size={16} className="animate-spin" />
            加载日历…
          </div>
        ) : tab === "calendar" ? (
          <MonthGrid first={first} daysInMonth={daysInMonth} ym={ym} byDay={byDay} onSelectProject={onSelectProject} />
        ) : (
          <MilestoneList events={filteredEvents} onSelectProject={onSelectProject} />
        )}
      </div>

      {createOpen && (
        <CreateScheduleDialog
          projects={creatableProjects}
          defaultDate={ymd(ym.year, ym.month, Math.min(now.getDate(), daysInMonth))}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            calendarQ.refetch();
            setCreateOpen(false);
          }}
        />
      )}
    </div>
  );
}

function eventRank(type: CalendarEvent["type"]) {
  if (type === "task") return 0;
  if (type === "schedule") return 1;
  if (type === "gate") return 2;
  if (type === "target") return 3;
  return 4;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "stone" | "emerald" | "amber" | "blue" | "rose" }) {
  const cls = tone === "stone" ? "text-stone-900" : tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : tone === "blue" ? "text-blue-700" : "text-rose-700";
  return (
    <div className="ce-card p-4">
      <div className="text-[10px] font-mono uppercase tracking-wider text-stone-400">{label}</div>
      <div className={`mt-1 text-2xl font-serif font-semibold ${cls}`}>{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
        active ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function MonthGrid({
  first,
  daysInMonth,
  ym,
  byDay,
  onSelectProject,
}: {
  first: Date;
  daysInMonth: number;
  ym: { year: number; month: number };
  byDay: Map<string, CalendarEvent[]>;
  onSelectProject: (id: string) => void;
}) {
  const cells: (number | null)[] = [
    ...Array(first.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  return (
    <div className="mt-4">
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[10px] font-mono text-stone-400">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => <div key={day}>{day}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, index) => {
          if (day === null) return <div key={`blank-${index}`} className="min-h-[88px]" />;
          const date = ymd(ym.year, ym.month, day);
          const events = byDay.get(date) ?? [];
          return (
            <div key={date} className="min-h-[92px] border border-stone-100 bg-white p-1.5">
              <div className="text-[10px] font-mono text-stone-400">{day}</div>
              <div className="mt-1 space-y-1">
                {events.slice(0, 3).map((event, eventIndex) => (
                  <EventPill key={`${event.type}-${event.projectId}-${eventIndex}`} event={event} onSelectProject={onSelectProject} />
                ))}
                {events.length > 3 && <div className="text-[9px] font-mono text-stone-400">+{events.length - 3}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventPill({ event, onSelectProject }: { event: CalendarEvent; onSelectProject: (id: string) => void }) {
  const meta = TYPE_META[event.type];
  const text = event.type === "schedule"
    ? `${event.startTime ? `${event.startTime} ` : ""}${event.label}`
    : event.label;
  return (
    <button
      onClick={() => onSelectProject(event.projectId)}
      title={`${event.projectName} · ${event.label}`}
      className={`block w-full truncate border px-1 py-0.5 text-left text-[9px] ${meta.cls}`}
    >
      {text}
    </button>
  );
}

function MilestoneList({ events, onSelectProject }: { events: CalendarEvent[]; onSelectProject: (id: string) => void }) {
  if (events.length === 0) {
    return (
      <div className="mt-4 border border-dashed border-stone-200 bg-stone-50 p-10 text-center text-sm text-stone-400">
        当前月份没有匹配的任务、日程或里程碑。
      </div>
    );
  }
  return (
    <div className="mt-4 divide-y divide-stone-100">
      {events.map((event, index) => {
        const meta = TYPE_META[event.type];
        return (
          <button
            key={`${event.date}-${event.type}-${event.projectId}-${index}`}
            onClick={() => onSelectProject(event.projectId)}
            className="flex w-full items-start gap-3 py-3 text-left hover:bg-stone-50/70 -mx-2 px-2 transition-colors"
          >
            <span className={`mt-0.5 inline-flex items-center gap-1 border px-1.5 py-0.5 text-[10px] font-mono ${meta.cls}`}>
              {meta.icon}
              {meta.label}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stone-900">{event.label}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500">
                <span>{event.projectName}</span>
                <span>{event.date}{event.startTime ? ` ${event.startTime}-${addMinutes(event.startTime, event.durationMin ?? 60)}` : ""}</span>
                {event.ownerLabel && <span>{event.ownerLabel}</span>}
                {priorityLabel(event.priority) && <span>{priorityLabel(event.priority)}</span>}
                {event.status && <span>{statusLabel(event.status)}</span>}
                {event.type === "schedule" && <SyncBadge status={event.dingtalkSyncStatus ?? "not_synced"} />}
              </div>
            </div>
            <MapPin size={13} className="mt-1 text-stone-300" />
          </button>
        );
      })}
    </div>
  );
}

function SyncBadge({ status }: { status: string }) {
  const label = status === "synced" ? "已同步钉钉" : status === "group_push" ? "已发项目群" : status === "pending" ? "同步中" : "未同步钉钉";
  const cls = status === "synced"
    ? "text-emerald-700"
    : status === "group_push"
      ? "text-amber-700"
      : "text-stone-400";
  return <span className={cls}>{label}</span>;
}

function CreateScheduleDialog({
  projects,
  defaultDate,
  onClose,
  onCreated,
}: {
  projects: ProjectOption[];
  defaultDate: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    projectId: projects[0]?.id ?? "",
    title: "",
    date: defaultDate,
    time: "10:00",
    durationMin: 60,
    description: "",
    syncDingtalk: true,
  });
  const create = trpc.meetings.createEvent.useMutation({
    onSuccess: (result) => {
      if (result.syncStatus === "synced") toast.success("日程已创建，并已同步到钉钉");
      else if (result.syncStatus === "group_push") toast.success("日程已创建，钉钉日历未同步，已发项目群提醒");
      else toast.success("日程已创建，钉钉日历未同步");
      onCreated();
    },
    onError: (error) => toast.error(error.message),
  });
  const canSubmit = form.projectId && form.title.trim() && form.date && form.time;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-stone-200 p-5">
          <div>
            <h3 className="font-serif text-xl text-stone-900">创建项目日程</h3>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700" title="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-stone-500">项目</label>
            <select
              value={form.projectId}
              onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}
              className="w-full border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-900"
            >
              {projects.map((project) => {
                const projectCode = project.projectNumber ?? project.code;
                return (
                  <option key={project.id} value={project.id}>{project.name}{projectCode ? ` · ${projectCode}` : ""}</option>
                );
              })}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-stone-500">主题</label>
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
              placeholder="例如：DVT 风险评审 / 客户包装确认"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-stone-500">日期</label>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-stone-500">时间</label>
              <input
                type="time"
                value={form.time}
                onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                className="w-full border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-stone-500">时长</label>
              <select
                value={form.durationMin}
                onChange={(event) => setForm((prev) => ({ ...prev, durationMin: Number(event.target.value) }))}
                className="w-full border border-stone-300 bg-white px-3 py-2 text-sm outline-none focus:border-stone-900"
              >
                {[30, 45, 60, 90, 120, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[10px] font-mono uppercase tracking-widest text-stone-500">说明</label>
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              rows={3}
              className="w-full resize-none border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-900"
              placeholder="议题、输入材料或需要拍板的问题"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.syncDingtalk}
              onChange={(event) => setForm((prev) => ({ ...prev, syncDingtalk: event.target.checked }))}
              className="accent-stone-900"
            />
            同步到钉钉日历
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-200 p-5">
          <button onClick={onClose} className="border border-stone-300 px-4 py-2 text-xs font-mono text-stone-600 hover:bg-stone-50">取消</button>
          <button
            disabled={!canSubmit || create.isPending}
            onClick={() => create.mutate({
              projectId: form.projectId,
              title: form.title.trim(),
              description: form.description.trim() || null,
              date: form.date,
              time: form.time,
              durationMin: form.durationMin,
              syncDingtalk: form.syncDingtalk,
            })}
            className="inline-flex items-center gap-2 bg-stone-900 px-4 py-2 text-xs font-mono text-white hover:bg-stone-700 disabled:opacity-40"
          >
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            保存日程
          </button>
        </div>
      </div>
    </div>
  );
}

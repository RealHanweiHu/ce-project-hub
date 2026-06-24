import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BriefcaseBusiness, CalendarDays, ChevronLeft, ChevronRight, Clock, Flag, ListChecks, Loader2,
  MapPin, Plus, Rocket, Save, ShieldCheck, UserRound, X, ListFilter, ChevronDown,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { getPhasesForCategory } from "@/lib/sop-templates";
import { LinearCard, PageHeader, SegToggle } from "@/components/linear/primitives";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";

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

const TYPE_META: Record<CalendarEvent["type"], { label: string; cls: string; chip: string; icon: React.ReactNode }> = {
  task: {
    label: "任务",
    cls: "bg-secondary text-muted-foreground border-border",
    chip: "bg-secondary text-[color:var(--secondary-foreground)]",
    icon: <ListChecks size={11} />,
  },
  schedule: {
    label: "日程",
    cls: "bg-[color:var(--success-soft)] text-[color:var(--success)] border-[color:var(--success-soft)]",
    chip: "bg-[color:var(--success-soft)] text-[color:var(--success)]",
    icon: <Clock size={11} />,
  },
  gate: {
    label: "Gate",
    cls: "bg-[color:var(--acc-soft)] text-primary border-[color:var(--acc-border)]",
    chip: "bg-[color:var(--acc-soft)] text-primary",
    icon: <ShieldCheck size={11} />,
  },
  phase: {
    label: "阶段",
    cls: "bg-[color:var(--warning-soft)] text-[color:var(--warning)] border-[color:var(--warning-soft)]",
    chip: "bg-[color:var(--warning-soft)] text-[color:var(--warning)]",
    icon: <Flag size={11} />,
  },
  target: {
    label: "目标",
    cls: "bg-[color:var(--destructive-soft)] text-[color:var(--destructive)] border-[color:var(--destructive-soft)]",
    chip: "bg-[color:var(--destructive-soft)] text-[color:var(--destructive)]",
    icon: <Rocket size={11} />,
  },
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
  const [mineOnly, setMineOnly] = useState(false);
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
  // 视角按账户角色自动决定（availableLenses 已按 manager>pm>rd 优先级排序）；不再手动切换。
  const activeLens = availableLenses[0];

  const scopedEvents = useMemo(() => {
    if (mineOnly) {
      // 只看我负责的：我的任务 + 我有角色/有任务的项目的事件（覆盖当前视角）
      return mergeCalendarEvents(
        taskEvents,
        projectEvents.filter((event) => roleProjectIds.has(event.projectId) || taskProjectIds.has(event.projectId)),
      );
    }
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
  }, [mineOnly, activeLens, creatableProjectIds, pmProjectIds, projectEvents, roleProjectIds, taskEvents, taskProjectIds]);

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
    <div className="p-7">
      <PageHeader
        title="日历与里程碑"
        sub={<><span className="num">{ym.year}</span> 年 <span className="num">{pad(ym.month + 1)}</span> 月 · Gate / 里程碑 / 截止</>}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => shift(-1)} className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="上个月">
              <ChevronLeft size={15} />
            </button>
            <div className="num inline-flex h-[30px] min-w-[96px] items-center justify-center rounded-[7px] border border-border bg-card px-3 text-[12.5px] font-semibold text-foreground">
              {ym.year}-{pad(ym.month + 1)}
            </div>
            <button onClick={() => shift(1)} className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-border bg-card text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="下个月">
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => setYm({ year: now.getFullYear(), month: now.getMonth() })}
              className="inline-flex h-[30px] items-center rounded-[7px] border border-border bg-card px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              title="回到本月"
            >
              今天
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              disabled={creatableProjects.length === 0}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40"
            >
              <Plus size={13} />
              创建日程
            </button>
          </div>
        )}
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="任务截止" value={counts.task} tone="task" />
        <Stat label="项目日程" value={counts.schedule} tone="schedule" />
        <Stat label="Gate 评审" value={counts.gate} tone="gate" />
        <Stat label="阶段截止" value={counts.phase} tone="phase" />
        <Stat label="目标交付" value={counts.target} tone="target" />
      </div>

      <LinearCard className="mt-3 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <SegToggle<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: "calendar", label: <span className="flex items-center gap-1.5"><CalendarDays size={13} />日历</span> },
                { value: "milestones", label: <span className="flex items-center gap-1.5"><Flag size={13} />截止清单</span> },
              ]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => setMineOnly((v) => !v)}
              className={`flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mineOnly
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-[color:var(--acc-border)]"
              }`}
            >
              <UserRound size={12} />只看我负责的
            </button>
            <span className="mx-0.5 h-4 w-px bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 rounded-[6px] border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-[color:var(--acc-border)]">
                  <ListFilter size={12} className="text-muted-foreground" />
                  {filter === "all" ? "全部类型" : TYPE_META[filter].label}
                  <ChevronDown size={12} className="text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                  <DropdownMenuRadioItem value="all">全部类型</DropdownMenuRadioItem>
                  {(["task", "schedule", "gate", "phase", "target"] as CalendarEvent["type"][]).map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>
                      <span className="flex items-center gap-1.5">{TYPE_META[t].icon}{TYPE_META[t].label}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {calendarQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            加载日历…
          </div>
        ) : tab === "calendar" ? (
          <MonthGrid first={first} daysInMonth={daysInMonth} ym={ym} byDay={byDay} onSelectProject={onSelectProject} />
        ) : (
          <MilestoneList events={filteredEvents} onSelectProject={onSelectProject} />
        )}
      </LinearCard>

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

function Stat({ label, value, tone }: { label: string; value: number; tone: CalendarEvent["type"] }) {
  const cls = tone === "task"
    ? "text-foreground"
    : tone === "schedule"
      ? "text-[color:var(--success)]"
      : tone === "gate"
        ? "text-primary"
        : tone === "phase"
          ? "text-[color:var(--warning)]"
          : "text-[color:var(--destructive)]";
  return (
    <LinearCard className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</div>
      <div className={`num mt-1 text-2xl font-bold ${cls}`}>{value}</div>
    </LinearCard>
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
  const todayStr = (() => {
    const t = new Date();
    return ymd(t.getFullYear(), t.getMonth(), t.getDate());
  })();
  const cells: (number | null)[] = [
    ...Array(first.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  return (
    <div className="mt-4">
      <div className="grid grid-cols-7 overflow-hidden rounded-t-[11px] border-l border-t border-border">
        {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
          <div key={day} className="border-b border-r border-border bg-secondary py-2 text-center text-[11.5px] font-semibold text-muted-foreground">
            {day}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-b-[11px] border-l border-border">
        {cells.map((day, index) => {
          if (day === null) return <div key={`blank-${index}`} className="min-h-[96px] border-b border-r border-border bg-secondary" />;
          const date = ymd(ym.year, ym.month, day);
          const events = byDay.get(date) ?? [];
          const isToday = date === todayStr;
          return (
            <div key={date} className="flex min-h-[96px] flex-col gap-1 border-b border-r border-border bg-card p-2">
              <span className={`num flex h-6 w-6 items-center justify-center text-[12.5px] font-semibold ${
                isToday ? "rounded-full bg-primary text-primary-foreground" : "text-foreground"
              }`}>
                {day}
              </span>
              <div className="flex flex-col gap-1">
                {events.slice(0, 3).map((event, eventIndex) => (
                  <EventPill key={`${event.type}-${event.projectId}-${eventIndex}`} event={event} onSelectProject={onSelectProject} />
                ))}
                {events.length > 3 && <div className="num px-1 text-[10px] font-medium text-muted-foreground">+{events.length - 3}</div>}
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
      className={`flex w-full items-center gap-1.5 truncate rounded-[5px] px-1.5 py-0.5 text-left text-[10.5px] font-medium ${meta.chip}`}
    >
      <span className="h-[5px] w-[5px] shrink-0 rounded-full bg-current" />
      <span className="truncate">{text}</span>
    </button>
  );
}

function MilestoneList({ events, onSelectProject }: { events: CalendarEvent[]; onSelectProject: (id: string) => void }) {
  if (events.length === 0) {
    return (
      <div className="mt-4 rounded-[11px] border border-dashed border-border bg-secondary p-10 text-center text-sm text-muted-foreground">
        当前月份没有匹配的任务、日程或里程碑。
      </div>
    );
  }
  return (
    <div className="mt-4 divide-y divide-border">
      {events.map((event, index) => {
        const meta = TYPE_META[event.type];
        return (
          <button
            key={`${event.date}-${event.type}-${event.projectId}-${index}`}
            onClick={() => onSelectProject(event.projectId)}
            className="-mx-2 flex w-full items-start gap-3 rounded-[7px] px-2 py-3 text-left transition-colors hover:bg-secondary"
          >
            <span className={`mt-0.5 inline-flex items-center gap-1 rounded-[6px] border px-1.5 py-0.5 text-[11px] font-semibold ${meta.cls}`}>
              {meta.icon}
              {meta.label}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">{event.label}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
                <span>{event.projectName}</span>
                <span className="num">{event.date}{event.startTime ? ` ${event.startTime}-${addMinutes(event.startTime, event.durationMin ?? 60)}` : ""}</span>
                {event.ownerLabel && <span>{event.ownerLabel}</span>}
                {priorityLabel(event.priority) && <span className="num">{priorityLabel(event.priority)}</span>}
                {event.status && <span>{statusLabel(event.status)}</span>}
                {event.type === "schedule" && <SyncBadge status={event.dingtalkSyncStatus ?? "not_synced"} />}
              </div>
            </div>
            <MapPin size={13} className="mt-1 text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}

function SyncBadge({ status }: { status: string }) {
  const label = status === "synced" ? "已同步钉钉" : status === "group_push" ? "已发项目群" : status === "pending" ? "同步中" : "未同步钉钉";
  const cls = status === "synced"
    ? "text-[color:var(--success)]"
    : status === "group_push"
      ? "text-[color:var(--warning)]"
      : "text-muted-foreground";
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[12px] border border-border bg-card shadow-[0_24px_60px_rgb(0_0_0/0.22)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h3 className="text-lg font-bold tracking-[-0.3px] text-foreground">创建项目日程</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground transition-colors hover:text-foreground" title="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">项目</label>
            <select
              value={form.projectId}
              onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}
              className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
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
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">主题</label>
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
              placeholder="例如：DVT 风险评审 / 客户包装确认"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">日期</label>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
                className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">时间</label>
              <input
                type="time"
                value={form.time}
                onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">时长</label>
              <select
                value={form.durationMin}
                onChange={(event) => setForm((prev) => ({ ...prev, durationMin: Number(event.target.value) }))}
                className="w-full rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
              >
                {[30, 45, 60, 90, 120, 180].map((minutes) => <option key={minutes} value={minutes}>{minutes} 分钟</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">说明</label>
            <textarea
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              rows={3}
              className="w-full resize-none rounded-[7px] border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-[color:var(--acc-border)]"
              placeholder="议题、输入材料或需要拍板的问题"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={form.syncDingtalk}
              onChange={(event) => setForm((prev) => ({ ...prev, syncDingtalk: event.target.checked }))}
              className="accent-[color:var(--primary)]"
            />
            同步到钉钉日历
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-5">
          <button onClick={onClose} className="rounded-[7px] border border-border bg-card px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary">取消</button>
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
            className="inline-flex items-center gap-2 rounded-[7px] bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-40"
          >
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            保存日程
          </button>
        </div>
      </div>
    </div>
  );
}

// 立项向导:一步完成「开始日期(生成排期) → 各角色配人 → 确认并按角色派任务+钉钉通知」。
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { X, ChevronLeft, ChevronRight, Rocket, CalendarRange, Users, CheckCircle2, Loader2, MessagesSquare, CalendarClock } from 'lucide-react';
import { toLocalISODate } from '@/lib/utils';

const KEY_ROLES = [
  { role: 'project_manager', label: '项目经理 / PMO', hint: 'PMO · 计划 / Gate / 协调' },
  { role: 'pm', label: '产品经理', hint: '产品 · PRD / 范围 / 成本' },
  { role: 'rd_hw', label: '硬件研发', hint: 'EE · 原理图 / PCB' },
  { role: 'rd_mech', label: '结构 / ID', hint: 'MD/ID · 结构 / 外观' },
  { role: 'rd_sw', label: '软件研发', hint: 'SW · 固件 / APP' },
  { role: 'qa', label: '测试 / 品质', hint: 'QA · EVT/DVT' },
  { role: 'scm', label: '供应链', hint: 'SCM · BOM / 供应商' },
  { role: 'pe', label: '工艺 / 设备', hint: 'PE · DFM / 量产准备' },
  { role: 'mfg', label: '生产', hint: 'MFG · 试产 / 爬坡' },
  { role: 'cert', label: '认证', hint: 'CERT · 安规 / Gate 会签' },
] as const;

const DEFAULT_MEETING = { enabled: true, weekday: 3, time: '15:00', durationMin: 60, title: '项目周会' };

type UserRow = { id: number; name: string | null; username: string };

// 模块级定义：避免在父组件渲染体内重建组件类型；当前步 step 通过 props 传入。
function StepDot({ n, label, step }: { n: number; label: string; step: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 flex items-center justify-center text-[11px] num rounded-[6px] border ${step >= n ? 'bg-primary text-primary-foreground border-primary' : 'border-border text-muted-foreground'}`}>
        {step > n ? <CheckCircle2 size={13} /> : n}
      </div>
      <span className={`text-xs ${step >= n ? 'text-foreground' : 'text-muted-foreground'}`}>{label}</span>
    </div>
  );
}

export function KickoffWizard({ project, onClose }: {
  project: { id: string; name: string; category: string; pmUserId: number | null; startDate: string | null };
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const membersQuery = trpc.members.list.useQuery({ projectId: project.id });
  const members = membersQuery.data ?? [];
  const userRows = users as UserRow[];

  const today = toLocalISODate();
  // 创建项目时已填开始日期 → 跳过第 1 步直达角色分工；点「上一步」仍可回去改日期
  const [step, setStep] = useState(project.startDate ? 2 : 1);
  const [startDate, setStartDate] = useState(project.startDate || today);
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  const [notify, setNotify] = useState(true);
  const [createGroup, setCreateGroup] = useState(true);
  const [setupMeeting, setSetupMeeting] = useState(true);

  // 预填:已有成员按角色带入,PM 用项目 pmUserId
  useEffect(() => {
    if (seeded) return;
    if (!membersQuery.isSuccess) return;
    const init: Record<string, string> = {};
    for (const r of KEY_ROLES) {
      const m = (members as Array<{ userId: number; role: string }>).find((x) => x.role === r.role);
      if (m) init[r.role] = String(m.userId);
    }
    if (project.pmUserId) init['project_manager'] = init['project_manager'] ?? String(project.pmUserId);
    if (Object.keys(init).length) setStaff(init);
    setSeeded(true);
  }, [members, membersQuery.isSuccess, project.pmUserId, seeded]);

  const userName = (id: number) => {
    const u = userRows.find((x) => x.id === id);
    return u ? (u.name || u.username) : `#${id}`;
  };
  const staffedCount = useMemo(() => Object.values(staff).filter(Boolean).length, [staff]);

  const kickoff = trpc.projects.kickoff.useMutation();
  const createGroupMutation = trpc.projects.createDingtalkGroup.useMutation();
  const setMeetingMutation = trpc.meetings.setConfig.useMutation();

  const submit = async () => {
    const staffing = Object.entries(staff)
      .filter(([, uid]) => uid !== '')
      .map(([role, uid]) => ({ role: role as typeof KEY_ROLES[number]['role'], userId: Number(uid) }));
    try {
      const r = await kickoff.mutateAsync({ projectId: project.id, startDate: startDate || null, staffing, notify });
      let groupResult = '';
      if (createGroup) {
        try {
          const g = await createGroupMutation.mutateAsync({ projectId: project.id });
          groupResult = g.already ? ' · 项目群已存在' : ' · 已建项目群';
        } catch (e) {
          toast.warning(`项目群未创建：${(e as Error).message}`);
        }
      }
      let meetingResult = '';
      if (setupMeeting) {
        try {
          await setMeetingMutation.mutateAsync({ projectId: project.id, config: DEFAULT_MEETING });
          meetingResult = ' · 周会已设置';
        } catch (e) {
          toast.warning(`周会未设置：${(e as Error).message}`);
        }
      }
      await Promise.all([
        utils.tasks.list.invalidate({ projectId: project.id }),
        utils.members.list.invalidate({ projectId: project.id }),
        utils.projects.get.invalidate({ id: project.id }),
        utils.meetings.getConfig.invalidate({ projectId: project.id }),
      ]);
      toast.success(`立项完成：配置 ${r.staffed} 人 · 分配 ${r.assigned} 项任务给 ${r.recipients} 人${r.notified ? ` · 聚合通知 ${r.notified} 人` : ''}${groupResult}${meetingResult}`);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-foreground/40 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div className="relative w-full max-w-xl h-fit my-auto bg-card border border-border rounded-[11px] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-primary" />
            <div>
              <div className="text-sm font-semibold text-foreground">立项向导</div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-0.5">「{project.name}」</div>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        {/* 步骤指示 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary">
          <StepDot n={1} label="开始日期" step={step} />
          <div className="flex-1 h-px bg-border mx-2" />
          <StepDot n={2} label="角色分工" step={step} />
          <div className="flex-1 h-px bg-border mx-2" />
          <StepDot n={3} label="确认启动" step={step} />
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                <CalendarRange size={12} />项目开始日期
              </div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-[7px] border border-border focus:border-primary outline-none text-sm num" />
              <p className="text-xs text-muted-foreground leading-relaxed bg-secondary border border-border rounded-[7px] px-3 py-2">
                设置开始日后,系统会按 IPD 依赖图和工厂工作日历生成任务起止日期。当前按周一至周六工作、周日休息计算,暂未自动扣除法定节假日。
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                <Users size={12} />各角色负责人(选填,留空则该角色任务暂不指派)
              </div>
              {KEY_ROLES.map((r) => (
                <div key={r.role} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <div className="text-sm text-foreground">{r.label}</div>
                    <div className="text-[10px] text-muted-foreground">{r.hint}</div>
                  </div>
                  <select
                    value={staff[r.role] ?? ''}
                    onChange={(e) => setStaff((p) => ({ ...p, [r.role]: e.target.value }))}
                    className="flex-1 px-2 py-2 rounded-[7px] border border-border bg-card text-sm outline-none focus:border-primary"
                  >
                    <option value="">— 未指定 —</option>
                    {userRows.map((u) => (
                      <option key={u.id} value={u.id}>{u.name || u.username}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="bg-secondary border border-border rounded-[9px] divide-y divide-border">
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-muted-foreground">开始日期</span><span className="num text-foreground">{startDate || '未设置'}</span>
                </div>
                <div className="px-3 py-2">
                  <div className="text-sm text-muted-foreground mb-1.5">角色分工（{staffedCount}）</div>
                  {staffedCount === 0 ? <div className="text-xs text-muted-foreground">未配置负责人</div> : (
                    <div className="space-y-1">
                      {KEY_ROLES.filter((r) => staff[r.role]).map((r) => (
                        <div key={r.role} className="flex justify-between text-xs">
                          <span className="text-muted-foreground">{r.label}</span>
                          <span className="text-foreground">{userName(Number(staff[r.role]))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-[color:var(--primary)]" />
                给每位负责人发送聚合任务通知(含任务清单与截止日)
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={createGroup} onChange={(e) => setCreateGroup(e.target.checked)} className="accent-[color:var(--primary)]" />
                <MessagesSquare size={13} className="text-muted-foreground" />创建 / 绑定钉钉项目群
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={setupMeeting} onChange={(e) => setSetupMeeting(e.target.checked)} className="accent-[color:var(--primary)]" />
                <CalendarClock size={13} className="text-muted-foreground" />启用默认项目周会
              </label>
              <p className="text-xs text-muted-foreground leading-relaxed">
                确认后将:生成排期 → 把所选成员按角色加入项目 → 按任务责任角色把<strong>未分配</strong>任务派给对应负责人{createGroup ? ' → 创建项目群' : ''}{setupMeeting ? ' → 设置周会' : ''}{notify ? ' → 发聚合通知' : ''}。已手动分配的任务不会被覆盖。
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-border">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-muted-foreground rounded-[7px] border border-border hover:bg-secondary"
          >
            <ChevronLeft size={13} />{step > 1 ? '上一步' : '取消'}
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-[7px] bg-primary text-primary-foreground hover:opacity-90">
              下一步<ChevronRight size={13} />
            </button>
          ) : (
            <button onClick={submit} disabled={kickoff.isPending || createGroupMutation.isPending || setMeetingMutation.isPending} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[7px] bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {kickoff.isPending || createGroupMutation.isPending || setMeetingMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}启动项目
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

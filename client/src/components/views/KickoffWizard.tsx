// 立项向导:一步完成「开始日期(生成排期) → 各角色配人 → 确认并按角色派任务+钉钉通知」。
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { X, ChevronLeft, ChevronRight, Rocket, CalendarRange, Users, CheckCircle2, Loader2 } from 'lucide-react';

const KEY_ROLES = [
  { role: 'pm', label: '产品经理', hint: 'PM · 立项 / Gate / 协调' },
  { role: 'rd_hw', label: '硬件研发', hint: 'EE · 原理图 / PCB' },
  { role: 'rd_mech', label: '结构 / ID', hint: 'MD/ID · 结构 / 外观' },
  { role: 'rd_sw', label: '软件研发', hint: 'SW · 固件 / APP' },
  { role: 'qa', label: '测试 / 品质', hint: 'QA · EVT/DVT' },
  { role: 'scm', label: '供应链', hint: 'SCM · BOM / 供应商' },
  { role: 'pe', label: '工艺 / 设备', hint: 'PE · DFM / 量产准备' },
  { role: 'mfg', label: '生产', hint: 'MFG · 试产 / 爬坡' },
  { role: 'cert', label: '认证', hint: 'CERT · 安规 / Gate 会签' },
] as const;

type UserRow = { id: number; name: string | null; username: string };

export function KickoffWizard({ project, onClose }: {
  project: { id: string; name: string; category: string; pmUserId: number | null; startDate: string | null };
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const { data: users = [] } = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const { data: members = [] } = trpc.members.list.useQuery({ projectId: project.id });
  const userRows = users as UserRow[];

  const today = new Date().toISOString().slice(0, 10);
  const [step, setStep] = useState(1);
  const [startDate, setStartDate] = useState(project.startDate || today);
  const [staff, setStaff] = useState<Record<string, string>>({});
  const [seeded, setSeeded] = useState(false);
  const [notify, setNotify] = useState(true);

  // 预填:已有成员按角色带入,PM 用项目 pmUserId
  useEffect(() => {
    if (seeded) return;
    const init: Record<string, string> = {};
    for (const r of KEY_ROLES) {
      const m = (members as Array<{ userId: number; role: string }>).find((x) => x.role === r.role);
      if (m) init[r.role] = String(m.userId);
    }
    if (project.pmUserId) init['pm'] = init['pm'] ?? String(project.pmUserId);
    if (Object.keys(init).length) { setStaff(init); setSeeded(true); }
  }, [members, project.pmUserId, seeded]);

  const userName = (id: number) => {
    const u = userRows.find((x) => x.id === id);
    return u ? (u.name || u.username) : `#${id}`;
  };
  const staffedCount = useMemo(() => Object.values(staff).filter(Boolean).length, [staff]);

  const kickoff = trpc.projects.kickoff.useMutation({
    onSuccess: (r) => {
      utils.tasks.list.invalidate({ projectId: project.id });
      utils.members.list.invalidate({ projectId: project.id });
      utils.projects.get.invalidate({ id: project.id });
      toast.success(`立项完成：配置 ${r.staffed} 人 · 分配 ${r.assigned} 项任务给 ${r.recipients} 人${r.notified ? ` · 钉钉通知 ${r.notified} 人` : ''}`);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const staffing = Object.entries(staff)
      .filter(([, uid]) => uid !== '')
      .map(([role, uid]) => ({ role: role as typeof KEY_ROLES[number]['role'], userId: Number(uid) }));
    kickoff.mutate({ projectId: project.id, startDate: startDate || null, staffing, notify });
  };

  const StepDot = ({ n, label }: { n: number; label: string }) => (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 flex items-center justify-center text-[11px] font-mono border ${step >= n ? 'bg-stone-900 text-white border-stone-900' : 'border-stone-300 text-stone-400'}`}>
        {step > n ? <CheckCircle2 size={13} /> : n}
      </div>
      <span className={`text-xs ${step >= n ? 'text-stone-900' : 'text-stone-400'}`}>{label}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-stone-900/40 backdrop-blur-sm p-4 sm:p-8" onClick={onClose}>
      <div className="relative w-full max-w-xl h-fit my-auto bg-white border border-stone-200 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Rocket size={16} className="text-amber-500" />
            <div>
              <div className="text-sm font-semibold text-stone-900">立项向导</div>
              <div className="text-[10px] font-mono uppercase tracking-widest text-stone-400 mt-0.5">「{project.name}」</div>
            </div>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-700"><X size={18} /></button>
        </div>

        {/* 步骤指示 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-100 bg-stone-50/60">
          <StepDot n={1} label="开始日期" />
          <div className="flex-1 h-px bg-stone-200 mx-2" />
          <StepDot n={2} label="角色分工" />
          <div className="flex-1 h-px bg-stone-200 mx-2" />
          <StepDot n={3} label="确认启动" />
        </div>

        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {step === 1 && (
            <div className="space-y-4">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400">
                <CalendarRange size={12} />项目开始日期
              </div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 focus:border-stone-900 outline-none text-sm" />
              <p className="text-xs text-stone-500 leading-relaxed bg-stone-50 border border-stone-200 px-3 py-2">
                设置开始日后,系统会按 IPD 依赖图自动生成整套任务的起止日期(关键路径约 3-4 个月,认证/开模在设计冻结即并行启动)。
              </p>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest text-stone-400">
                <Users size={12} />各角色负责人(选填,留空则该角色任务暂不指派)
              </div>
              {KEY_ROLES.map((r) => (
                <div key={r.role} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <div className="text-sm text-stone-800">{r.label}</div>
                    <div className="text-[10px] font-mono text-stone-400">{r.hint}</div>
                  </div>
                  <select
                    value={staff[r.role] ?? ''}
                    onChange={(e) => setStaff((p) => ({ ...p, [r.role]: e.target.value }))}
                    className="flex-1 px-2 py-2 border border-stone-300 bg-white text-sm outline-none focus:border-stone-900"
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
              <div className="bg-stone-50 border border-stone-200 divide-y divide-stone-100">
                <div className="flex justify-between px-3 py-2 text-sm">
                  <span className="text-stone-500">开始日期</span><span className="font-mono text-stone-800">{startDate || '未设置'}</span>
                </div>
                <div className="px-3 py-2">
                  <div className="text-sm text-stone-500 mb-1.5">角色分工（{staffedCount}）</div>
                  {staffedCount === 0 ? <div className="text-xs text-stone-400">未配置负责人</div> : (
                    <div className="space-y-1">
                      {KEY_ROLES.filter((r) => staff[r.role]).map((r) => (
                        <div key={r.role} className="flex justify-between text-xs">
                          <span className="text-stone-500">{r.label}</span>
                          <span className="text-stone-800">{userName(Number(staff[r.role]))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer">
                <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-stone-900" />
                给每位负责人发送钉钉任务通知(含任务清单与截止日)
              </label>
              <p className="text-xs text-stone-500 leading-relaxed">
                确认后将:生成排期 → 把所选成员按角色加入项目 → 按任务责任角色把<strong>未分配</strong>任务派给对应负责人{notify ? ' → 发钉钉通知' : ''}。已手动分配的任务不会被覆盖。
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 border-t border-stone-100">
          <button
            onClick={() => (step > 1 ? setStep(step - 1) : onClose())}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs text-stone-600 border border-stone-300 hover:bg-stone-50"
          >
            <ChevronLeft size={13} />{step > 1 ? '上一步' : '取消'}
          </button>
          {step < 3 ? (
            <button onClick={() => setStep(step + 1)} className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-stone-900 text-white hover:bg-stone-700">
              下一步<ChevronRight size={13} />
            </button>
          ) : (
            <button onClick={submit} disabled={kickoff.isPending} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
              {kickoff.isPending ? <Loader2 size={13} className="animate-spin" /> : <Rocket size={13} />}启动项目
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

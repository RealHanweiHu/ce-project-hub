import { useState } from 'react';
import { CheckCircle2, Clock3, Plus, ShieldCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import {
  CERTIFICATE_SCOPE_TYPES,
  CERTIFICATE_TYPE_LABELS,
  CERTIFICATE_TYPES,
  certificationRequirementLabel,
  type CertificateScopeType,
  type CertificateType,
} from '@shared/certification';

const SCOPE_LABELS: Record<CertificateScopeType, string> = {
  project: '本项目版本',
  product_family: '产品族覆盖',
  revision: '基线 Revision 复用',
};

export function CertificationCoveragePanel({
  projectId,
  canEdit,
  canReview,
}: {
  projectId: string;
  canEdit: boolean;
  canReview: boolean;
}) {
  const utils = trpc.useUtils();
  const certificates = trpc.certificates.list.useQuery({ projectId });
  const coverage = trpc.certificates.coverage.useQuery({ projectId });
  const users = trpc.admin.listUsersForSelect.useQuery(undefined, { staleTime: 60_000 });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    type: 'market_access' as CertificateType,
    scopeType: 'project' as CertificateScopeType,
    certificateNumber: '',
    issuingBody: '',
    targetMarkets: '',
    validUntil: '',
    evidenceReference: '',
    reuseApproved: false,
    reuseBasis: '',
  });

  const refresh = async () => {
    await Promise.all([
      utils.certificates.list.invalidate({ projectId }),
      utils.certificates.coverage.invalidate({ projectId }),
      utils.projects.riskScope.invalidate({ projectId }),
    ]);
  };
  const create = trpc.certificates.create.useMutation({
    onSuccess: async () => { await refresh(); setShowForm(false); toast.success('证书已登记，等待认证/QA 确认'); },
    onError: (error) => toast.error(error.message),
  });
  const review = trpc.certificates.review.useMutation({
    onSuccess: async (_, variables) => { await refresh(); toast.success(variables.status === 'valid' ? '证书已确认有效' : '证书已撤销'); },
    onError: (error) => toast.error(error.message),
  });
  const updateRenewal = trpc.certificates.updateRenewal.useMutation({
    onSuccess: async () => { await refresh(); toast.success('续期计划已更新'); },
    onError: (error) => toast.error(error.message),
  });

  const updateRenewalPlan = (certificate: NonNullable<typeof certificates.data>[number], patch: {
    renewalOwnerUserId?: number;
    renewalStatus?: 'not_started' | 'planned' | 'in_progress' | 'renewed';
    replacementCertificateId?: number | null;
  }) => {
    const ownerUserId = patch.renewalOwnerUserId ?? certificate.renewalOwnerUserId;
    const renewalStatus = (patch.renewalStatus ?? certificate.renewalStatus) as 'not_started' | 'planned' | 'in_progress' | 'renewed';
    if (!ownerUserId) return toast.error('请先指定续期责任人');
    let replacementCertificateId = patch.replacementCertificateId ?? certificate.replacementCertificateId ?? null;
    if (renewalStatus === 'renewed' && !replacementCertificateId) {
      const raw = window.prompt('请输入同一产品中新登记的替代证书 ID（证书卡片标题后可见）');
      if (!raw || !Number(raw)) return;
      replacementCertificateId = Number(raw);
    }
    updateRenewal.mutate({
      projectId,
      certificateId: certificate.id,
      renewalOwnerUserId: ownerUserId,
      renewalStatus,
      renewalNotes: certificate.renewalNotes ?? null,
      replacementCertificateId,
    });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[11px] uppercase tracking-widest text-muted-foreground">证书台账与覆盖</h3>
        <span className={`text-[10px] font-semibold ${coverage.data?.covered ? 'text-[color:var(--success)]' : 'text-[color:var(--warning)]'}`}>
          {coverage.data?.covered ? '覆盖完整' : `缺口 ${coverage.data?.missing.length ?? 0} 项`}
        </span>
      </div>
      <div className="rounded-[11px] border border-border bg-card p-4">
        {(coverage.data?.requirements.length ?? 0) === 0 ? (
          <p className="text-xs text-muted-foreground">当前结构化变更范围没有触发证书覆盖要求。</p>
        ) : (
          <div className="mb-4 grid gap-2 md:grid-cols-2">
            {coverage.data?.coveredByRequirement.map((item) => (
              <div key={`${item.requirement.type}:${item.requirement.market ?? '*'}`} className="flex items-center gap-2 rounded-[7px] border border-border bg-background px-3 py-2 text-xs">
                {item.certificateId ? <CheckCircle2 size={13} className="text-[color:var(--success)]" /> : <XCircle size={13} className="text-[color:var(--warning)]" />}
                <span>{certificationRequirementLabel(item.requirement)}</span>
              </div>
            ))}
          </div>
        )}
        {coverage.data?.coverageThroughISO && (
          <div className="mb-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock3 size={12} />覆盖校验基准日：{coverage.data.coverageThroughISO}（项目目标日与今天取较晚者）
          </div>
        )}

        <div className="space-y-2">
          {(certificates.data ?? []).map((certificate) => (
            <div key={certificate.id} className="rounded-[8px] border border-border bg-secondary/20 px-3 py-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium text-foreground">{CERTIFICATE_TYPE_LABELS[certificate.type]} · {certificate.certificateNumber || certificate.evidenceReference} <span className="text-[10px] text-muted-foreground">#{certificate.id}</span></div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {SCOPE_LABELS[certificate.scopeType]}{certificate.targetMarkets.length ? ` · ${certificate.targetMarkets.join(', ')}` : ''}{certificate.validUntil ? ` · 有效至 ${certificate.validUntil}` : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-1 text-[10px] ${certificate.status === 'valid' ? 'bg-[color:var(--success-soft)] text-[color:var(--success)]' : certificate.status === 'revoked' ? 'bg-[color:var(--destructive-soft)] text-destructive' : 'bg-secondary text-muted-foreground'}`}>
                  {certificate.status === 'valid' ? '有效' : certificate.status === 'revoked' ? '已撤销' : certificate.status === 'expired' ? '已过期' : '待确认'}
                </span>
                {canReview && certificate.status !== 'valid' && certificate.status !== 'revoked' && (
                  <button type="button" onClick={() => review.mutate({ projectId, certificateId: certificate.id, status: 'valid' })} className="text-[10px] text-primary hover:underline">确认有效</button>
                )}
                {canReview && certificate.status === 'valid' && (
                  <button type="button" onClick={() => review.mutate({ projectId, certificateId: certificate.id, status: 'revoked' })} className="text-[10px] text-destructive hover:underline">撤销</button>
                )}
              </div>
              </div>
              {canEdit && certificate.validUntil && (
                <div className="mt-2 grid gap-2 border-t border-border/70 pt-2 md:grid-cols-[1fr_1fr_2fr]">
                  <select
                    value={certificate.renewalOwnerUserId ?? ''}
                    onChange={(event) => event.target.value && updateRenewalPlan(certificate, { renewalOwnerUserId: Number(event.target.value) })}
                    className="rounded border border-border bg-card px-2 py-1.5 text-[11px]"
                  >
                    <option value="">续期责任人</option>
                    {(users.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name || item.username}</option>)}
                  </select>
                  <select
                    value={certificate.renewalStatus}
                    onChange={(event) => updateRenewalPlan(certificate, { renewalStatus: event.target.value as 'not_started' | 'planned' | 'in_progress' | 'renewed' })}
                    className="rounded border border-border bg-card px-2 py-1.5 text-[11px]"
                  >
                    <option value="not_started">未开始</option>
                    <option value="planned">已计划</option>
                    <option value="in_progress">续期中</option>
                    <option value="renewed">已续期（需关联新证书）</option>
                  </select>
                  <span className="self-center text-[10px] text-muted-foreground">到期前 90/30 天自动提醒责任人；同一证书同一提醒窗口只发送一次。</span>
                </div>
              )}
            </div>
          ))}
        </div>

        {canEdit && !showForm && (
          <button type="button" onClick={() => setShowForm(true)} className="mt-3 inline-flex items-center gap-1 rounded-[7px] border border-border px-2.5 py-1.5 text-xs hover:bg-secondary"><Plus size={12} />登记证书</button>
        )}
        {showForm && (
          <div className="mt-4 grid gap-3 rounded-[8px] border border-border bg-secondary/20 p-3 md:grid-cols-2">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">证书类型
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CertificateType })} className="mt-1 w-full rounded border border-border bg-card px-2 py-2 text-xs normal-case">
                {CERTIFICATE_TYPES.map((type) => <option key={type} value={type}>{CERTIFICATE_TYPE_LABELS[type]}</option>)}
              </select>
            </label>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">覆盖范围
              <select value={form.scopeType} onChange={(e) => setForm({ ...form, scopeType: e.target.value as CertificateScopeType })} className="mt-1 w-full rounded border border-border bg-card px-2 py-2 text-xs normal-case">
                {CERTIFICATE_SCOPE_TYPES.map((scope) => <option key={scope} value={scope}>{SCOPE_LABELS[scope]}</option>)}
              </select>
            </label>
            <input value={form.certificateNumber} onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })} placeholder="证书编号" className="rounded border border-border bg-card px-2 py-2 text-xs" />
            <input value={form.issuingBody} onChange={(e) => setForm({ ...form, issuingBody: e.target.value })} placeholder="签发机构" className="rounded border border-border bg-card px-2 py-2 text-xs" />
            <input value={form.targetMarkets} onChange={(e) => setForm({ ...form, targetMarkets: e.target.value })} placeholder="覆盖市场，例如 EU, US" className="rounded border border-border bg-card px-2 py-2 text-xs" />
            <input type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} className="rounded border border-border bg-card px-2 py-2 text-xs" />
            <input value={form.evidenceReference} onChange={(e) => setForm({ ...form, evidenceReference: e.target.value })} placeholder="证据引用/受控文件编号" className="rounded border border-border bg-card px-2 py-2 text-xs md:col-span-2" />
            {form.scopeType === 'revision' && (
              <>
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.reuseApproved} onChange={(e) => setForm({ ...form, reuseApproved: e.target.checked })} />已批准复用</label>
                <input value={form.reuseBasis} onChange={(e) => setForm({ ...form, reuseBasis: e.target.value })} placeholder="复用边界和批准依据" className="rounded border border-border bg-card px-2 py-2 text-xs" />
              </>
            )}
            <div className="flex justify-end gap-2 md:col-span-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs text-muted-foreground">取消</button>
              <button type="button" disabled={create.isPending} onClick={() => create.mutate({
                projectId,
                type: form.type,
                scopeType: form.scopeType,
                certificateNumber: form.certificateNumber || null,
                issuingBody: form.issuingBody || null,
                targetMarkets: form.targetMarkets.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
                validUntil: form.validUntil || null,
                evidenceReference: form.evidenceReference || null,
                reuseApproved: form.scopeType === 'revision' && form.reuseApproved,
                reuseBasis: form.scopeType === 'revision' ? form.reuseBasis || null : null,
              })} className="inline-flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground"><ShieldCheck size={12} />保存</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 通用评论线程：挂在任意实体上（entityType+entityId）。支持 @用户名 提及。
import { useState } from 'react';
import { Send, Loader2, MessageSquare } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

type CommentRow = {
  id: number; body: string; authorId: number; authorName: string | null;
  mentions: number[] | null; createdAt: string | Date;
};

function renderBody(body: string) {
  // 高亮 @username
  return body.split(/(@[A-Za-z0-9_.\-]+)/g).map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="text-primary font-medium">{part}</span>
      : <span key={i}>{part}</span>
  );
}

export function CommentThread({ entityType, entityId, projectId }: { entityType: string; entityId: string; projectId?: string | null }) {
  const utils = trpc.useUtils();
  const { data: comments = [], isLoading } = trpc.comments.list.useQuery({ entityType, entityId });
  const addM = trpc.comments.add.useMutation({
    onSuccess: () => { utils.comments.list.invalidate({ entityType, entityId }); setBody(''); },
    onError: (e) => toast.error(e.message),
  });
  const [body, setBody] = useState('');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <MessageSquare size={12} /> 评论 · {comments.length}
      </div>

      {isLoading ? (
        <Loader2 className="animate-spin text-primary" size={16} />
      ) : (
        <div className="space-y-2.5">
          {(comments as CommentRow[]).map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <div className="w-6 h-6 shrink-0 bg-secondary flex items-center justify-center text-[10px] text-muted-foreground uppercase">
                {(c.authorName || 'U').charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-foreground">{c.authorName || '用户'}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="text-sm text-foreground whitespace-pre-wrap break-words">{renderBody(c.body)}</div>
              </div>
            </div>
          ))}
          {comments.length === 0 && <p className="text-xs text-muted-foreground">还没有评论。用 @用户名 可以提及并通知对方。</p>}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="写评论… 用 @用户名 提及"
          className="flex-1 border border-border text-sm px-2 py-1.5 bg-card focus:border-muted-foreground resize-none"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) addM.mutate({ entityType, entityId, projectId: projectId ?? null, body: body.trim() }); }}
        />
        <button
          disabled={!body.trim() || addM.isPending}
          onClick={() => addM.mutate({ entityType, entityId, projectId: projectId ?? null, body: body.trim() })}
          className="self-end bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground px-3 py-2 transition-colors"
          title="发送 (⌘+Enter)"
        ><Send size={14} /></button>
      </div>
    </div>
  );
}

type ExternalAudience = 'customer' | 'supplier';

const EXTERNAL_LABEL: Record<ExternalAudience, string> = {
  customer: '客户协作',
  supplier: '供应商协作',
};

export function ExternalCommentThread({ projectId, audience }: { projectId: string; audience: ExternalAudience }) {
  const utils = trpc.useUtils();
  const input = { projectId, audience };
  const { data: comments = [], isLoading } = trpc.comments.externalList.useQuery(input);
  const addM = trpc.comments.externalAdd.useMutation({
    onSuccess: () => { utils.comments.externalList.invalidate(input); setBody(''); },
    onError: (e) => toast.error(e.message),
  });
  const [body, setBody] = useState('');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        <MessageSquare size={12} /> {EXTERNAL_LABEL[audience]} · {comments.length}
      </div>

      {isLoading ? (
        <Loader2 className="animate-spin text-primary" size={16} />
      ) : (
        <div className="space-y-2.5">
          {(comments as CommentRow[]).map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <div className="w-6 h-6 shrink-0 bg-secondary flex items-center justify-center text-[10px] text-muted-foreground uppercase">
                {(c.authorName || 'U').charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-foreground">{c.authorName || '用户'}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="text-sm text-foreground whitespace-pre-wrap break-words">{renderBody(c.body)}</div>
              </div>
            </div>
          ))}
          {comments.length === 0 && <p className="text-xs text-muted-foreground">还没有外部协作留言。</p>}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder={`写${EXTERNAL_LABEL[audience]}留言…`}
          className="flex-1 border border-border text-sm px-2 py-1.5 bg-card focus:border-muted-foreground resize-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) {
              addM.mutate({ ...input, body: body.trim() });
            }
          }}
        />
        <button
          disabled={!body.trim() || addM.isPending}
          onClick={() => addM.mutate({ ...input, body: body.trim() })}
          className="self-end bg-primary hover:bg-primary/90 disabled:opacity-40 text-primary-foreground px-3 py-2 transition-colors"
          title="发送 (⌘+Enter)"
        ><Send size={14} /></button>
      </div>
    </div>
  );
}

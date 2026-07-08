// 通用评论线程：挂在任意实体上（entityType+entityId）。支持 @用户名 提及。
import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Loader2, MessageSquare } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

type CommentRow = {
  id: number; body: string; authorId: number; authorName: string | null;
  mentions: number[] | null; createdAt: string | Date;
};

type MentionMember = {
  userId: number;
  role: string;
  jobTitle: string | null;
  userName: string | null;
  userEmail: string | null;
  mentionName: string | null;
  permissions?: { label?: string } | null;
};

type MentionTarget = { start: number; query: string };

function activeMention(body: string, cursor: number): MentionTarget | null {
  const beforeCursor = body.slice(0, cursor);
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCursor);
  if (!match) return null;
  return { start: match.index + match[1].length, query: match[2] ?? '' };
}

function memberLabel(member: MentionMember) {
  return member.userName || member.mentionName || member.userEmail || `用户 ${member.userId}`;
}

function memberMentionHandle(member: MentionMember) {
  return member.mentionName || `u${member.userId}`;
}

function memberRoleLabel(member: MentionMember) {
  return member.permissions?.label || member.jobTitle || member.role;
}

function renderBody(body: string) {
  // 高亮 @username
  return body.split(/(@[^\s@]+)/g).map((part, i) =>
    part.startsWith('@')
      ? <span key={i} className="text-primary font-medium">{part}</span>
      : <span key={i}>{part}</span>
  );
}

function MentionComposer({
  body,
  setBody,
  projectId,
  disabled,
  onSubmit,
  placeholder = '写评论… 用 @用户名 提及',
}: {
  body: string;
  setBody: (next: string) => void;
  projectId?: string | null;
  disabled?: boolean;
  onSubmit: () => void;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const { data: members = [] } = trpc.members.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId, staleTime: 60_000 },
  );

  const mention = useMemo(() => activeMention(body, cursor), [body, cursor]);
  const candidates = useMemo(() => {
    if (!mention || !projectId) return [];
    const q = mention.query.toLowerCase();
    return (members as MentionMember[])
      .filter((member) => {
        const handle = memberMentionHandle(member);
        const haystack = [
          handle,
          member.userName,
          member.userEmail,
          member.permissions?.label,
          member.jobTitle,
          member.role,
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [members, mention, projectId]);
  const mentionableMembers = useMemo(() => (members as MentionMember[]).slice(0, 10), [members]);

  useEffect(() => {
    setActiveIndex(0);
  }, [mention?.query]);

  const updateCursor = () => {
    const el = textareaRef.current;
    if (el) setCursor(el.selectionStart);
  };

  const insertMention = (member: MentionMember) => {
    if (!mention) return;
    const token = `@${memberMentionHandle(member)} `;
    const next = `${body.slice(0, mention.start)}${token}${body.slice(cursor)}`;
    const nextCursor = mention.start + token.length;
    setBody(next);
    setCursor(nextCursor);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  const appendMention = (member: MentionMember) => {
    if (mention) {
      insertMention(member);
      return;
    }
    const token = `@${memberMentionHandle(member)} `;
    const prefix = body && !/\s$/.test(body.slice(0, cursor)) ? ' ' : '';
    const next = `${body.slice(0, cursor)}${prefix}${token}${body.slice(cursor)}`;
    const nextCursor = cursor + prefix.length + token.length;
    setBody(next);
    setCursor(nextCursor);
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    }, 0);
  };

  return (
    <div className="relative flex-1">
      <textarea
        ref={textareaRef}
        disabled={disabled}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setCursor(e.target.selectionStart);
        }}
        onClick={updateCursor}
        onKeyUp={updateCursor}
        rows={2}
        placeholder={placeholder}
        className="w-full border border-border text-sm px-2 py-1.5 bg-card focus:border-muted-foreground resize-none disabled:opacity-50"
        onKeyDown={(e) => {
          if (candidates.length > 0 && mention && !(e.metaKey || e.ctrlKey)) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIndex((idx) => (idx + 1) % candidates.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIndex((idx) => (idx - 1 + candidates.length) % candidates.length);
              return;
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              insertMention(candidates[Math.min(activeIndex, candidates.length - 1)]);
              return;
            }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim()) onSubmit();
        }}
      />
      {projectId && mentionableMembers.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-widest text-muted-foreground">@</span>
          {mentionableMembers.map((member) => (
            <button
              key={member.userId}
              type="button"
              disabled={disabled}
              onMouseDown={(e) => {
                e.preventDefault();
                appendMention(member);
              }}
              className="max-w-[150px] truncate border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted disabled:opacity-50"
              title={`${memberLabel(member)} · ${memberRoleLabel(member)}`}
            >
              @{memberMentionHandle(member)}
            </button>
          ))}
          {(members as MentionMember[]).length > mentionableMembers.length && (
            <span className="text-[11px] text-muted-foreground">+{(members as MentionMember[]).length - mentionableMembers.length}</span>
          )}
        </div>
      )}
      {candidates.length > 0 && mention && (
        <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[240px] max-w-[320px] overflow-hidden border border-border bg-white shadow-lg">
          <div className="border-b border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
            项目成员
          </div>
          {candidates.map((member, index) => (
            <button
              key={member.userId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(member);
              }}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                index === activeIndex ? 'bg-secondary' : 'hover:bg-secondary'
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center bg-secondary text-[10px] uppercase text-muted-foreground">
                {memberLabel(member).charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{memberLabel(member)}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  @{memberMentionHandle(member)}{member.permissions?.label ? ` · ${member.permissions.label}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommentThread({ entityType, entityId, projectId }: { entityType: string; entityId: string; projectId?: string | null }) {
  const utils = trpc.useUtils();
  const { data: comments = [], isLoading } = trpc.comments.list.useQuery({ entityType, entityId });
  const [body, setBody] = useState('');
  const addM = trpc.comments.add.useMutation({
    onSuccess: () => { utils.comments.list.invalidate({ entityType, entityId }); setBody(''); },
    onError: (e) => toast.error(e.message),
  });
  const submit = () => addM.mutate({ entityType, entityId, projectId: projectId ?? null, body: body.trim() });

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
        <MentionComposer
          body={body}
          setBody={setBody}
          projectId={projectId}
          disabled={addM.isPending}
          onSubmit={submit}
        />
        <button
          disabled={!body.trim() || addM.isPending}
          onClick={submit}
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

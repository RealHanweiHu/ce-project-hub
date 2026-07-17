/**
 * ChangePasswordDialog - Self-service password change dialog
 * Used in the user profile area in the sidebar
 */
import { useRef, useState } from 'react';
import { KeyRound, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FieldErrors = { current?: string; next?: string; confirm?: string };

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const currentRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const changePasswordMutation = trpc.auth.changePassword.useMutation({
    onSuccess: () => {
      toast.success('密码已修改，下次登录请使用新密码');
      onOpenChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setErrors({});
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // 字段级校验：错误显示在对应字段附近，并聚焦第一个错误字段
    const next: FieldErrors = {};
    if (!currentPassword) next.current = '请输入当前密码';
    if (!newPassword) next.next = '请输入新密码';
    else if (newPassword.length < 6) next.next = '新密码至少 6 位';
    if (!confirmPassword) next.confirm = '请再次输入新密码';
    else if (newPassword && newPassword !== confirmPassword) next.confirm = '两次输入的新密码不一致';
    setErrors(next);
    if (next.current) { currentRef.current?.focus(); return; }
    if (next.next) { newRef.current?.focus(); return; }
    if (next.confirm) { confirmRef.current?.focus(); return; }
    changePasswordMutation.mutate({ currentPassword, newPassword });
  };

  const handleClose = () => {
    if (!changePasswordMutation.isPending) {
      onOpenChange(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setErrors({});
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound size={16} className="text-primary" />
            修改密码
          </DialogTitle>
          <DialogDescription>修改后需使用新密码重新登录其他设备。</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="current-password" className="text-sm text-foreground">
              当前密码 <span className="text-[color:var(--destructive)]">*</span>
            </Label>
            <div className="relative">
              <Input
                id="current-password"
                ref={currentRef}
                type={showCurrent ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="输入当前密码"
                autoComplete="current-password"
                aria-invalid={!!errors.current}
                aria-describedby={errors.current ? 'current-password-error' : undefined}
                className="pr-11 text-sm"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                aria-label={showCurrent ? '隐藏当前密码' : '显示当前密码'}
                aria-pressed={showCurrent}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {showCurrent ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            {errors.current && (
              <p id="current-password-error" role="alert" className="text-xs text-[color:var(--destructive)]">
                {errors.current}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="new-password" className="text-sm text-foreground">
              新密码 <span className="text-[color:var(--destructive)]">*</span>
            </Label>
            <div className="relative">
              <Input
                id="new-password"
                ref={newRef}
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="至少6位"
                autoComplete="new-password"
                aria-invalid={!!errors.next}
                aria-describedby={errors.next ? 'new-password-error' : undefined}
                className="pr-11 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                aria-label={showNew ? '隐藏新密码' : '显示新密码'}
                aria-pressed={showNew}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {showNew ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            {errors.next && (
              <p id="new-password-error" role="alert" className="text-xs text-[color:var(--destructive)]">
                {errors.next}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-password" className="text-sm text-foreground">
              确认新密码 <span className="text-[color:var(--destructive)]">*</span>
            </Label>
            <Input
              id="confirm-password"
              ref={confirmRef}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="再次输入新密码"
              autoComplete="new-password"
              aria-invalid={!!errors.confirm}
              aria-describedby={errors.confirm ? 'confirm-password-error' : undefined}
              className="text-sm"
            />
            {errors.confirm ? (
              <p id="confirm-password-error" role="alert" className="text-xs text-[color:var(--destructive)]">
                {errors.confirm}
              </p>
            ) : confirmPassword && newPassword && confirmPassword !== newPassword ? (
              <p className="text-xs text-[color:var(--destructive)]" aria-live="polite">两次输入不一致</p>
            ) : null}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={changePasswordMutation.isPending}
              className="text-sm"
            >
              取消
            </Button>
            <Button
              type="submit"
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm"
              disabled={changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending ? (
                <>
                  <Loader2 size={13} className="animate-spin mr-1.5" />
                  修改中...
                </>
              ) : (
                '确认修改'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

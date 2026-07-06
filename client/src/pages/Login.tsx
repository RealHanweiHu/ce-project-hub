import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Cpu, AlertCircle, Eye, EyeOff } from 'lucide-react';

type Mode = 'login' | 'register';

export default function Login() {
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>('login');

  // Shared fields
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  // Register-only fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const utils = trpc.useUtils();

  // 注册开关由服务端 ALLOW_REGISTRATION / REGISTRATION_INVITE_CODE 控制
  const { data: registration } = trpc.auth.registrationEnabled.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const registrationEnabled = registration?.enabled;
  const requiresInviteCode = registration?.requiresInviteCode === true;

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate('/');
    },
    onError: (err) => {
      setError(err.message || '登录失败，请重试');
    },
  });

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      navigate('/');
    },
    onError: (err) => {
      setError(err.message || '注册失败，请重试');
    },
  });

  const isPending = loginMutation.isPending || registerMutation.isPending;

  useEffect(() => {
    if (registrationEnabled === false && mode === 'register') {
      setMode('login');
    }
  }, [registrationEnabled, mode]);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setName('');
    setEmail('');
    setInviteCode('');
    setShowPassword(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'login') {
      if (!username.trim() || !password) {
        setError('请输入用户名和密码');
        return;
      }
      loginMutation.mutate({ username: username.trim(), password });
    } else {
      if (!name.trim()) {
        setError('请输入显示名称');
        return;
      }
      if (!email.trim()) {
        setError('请输入邮箱地址');
        return;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        setError('请输入有效的邮箱地址');
        return;
      }
      if (!username.trim()) {
        setError('请输入用户名');
        return;
      }
      if (!/^[a-zA-Z0-9_.\-]+$/.test(username.trim())) {
        setError('用户名只能包含字母、数字、下划线、点和横线');
        return;
      }
      if (password.length < 6) {
        setError('密码至少6位');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
      if (requiresInviteCode && !inviteCode.trim()) {
        setError('请输入邀请码');
        return;
      }
      registerMutation.mutate({
        username: username.trim(),
        password,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        inviteCode: requiresInviteCode ? inviteCode.trim() : undefined,
      });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-primary flex items-center justify-center">
            <Cpu size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl text-foreground leading-tight">CE Project Hub</h1>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Product Dev
            </p>
          </div>
        </div>

        <Card className="border-border shadow-sm">
          {/* Tab switcher */}
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex border-b border-border">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  mode === 'login'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                登录
              </button>
              {registrationEnabled !== false && (
                <button
                  type="button"
                  onClick={() => switchMode('register')}
                  className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    mode === 'register'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  注册
                </button>
              )}
            </div>
          </CardHeader>

          <CardContent className="pt-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}

              {/* Register-only: display name */}
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-foreground text-sm">
                    显示名称 <span className="text-[color:var(--destructive)]">*</span>
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例：张三"
                    autoFocus
                    disabled={isPending}
                    className="border-border focus:border-primary"
                  />
                </div>
              )}

              {/* Register-only: email */}
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-foreground text-sm">
                    邮箱 <span className="text-[color:var(--destructive)]">*</span>
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="example@company.com"
                    autoComplete="email"
                    disabled={isPending}
                    className="border-border focus:border-primary"
                  />
                </div>
              )}

              {/* Register-only: invite code (shown when server requires it) */}
              {mode === 'register' && requiresInviteCode && (
                <div className="space-y-1.5">
                  <Label htmlFor="inviteCode" className="text-foreground text-sm">
                    邀请码 <span className="text-[color:var(--destructive)]">*</span>
                  </Label>
                  <Input
                    id="inviteCode"
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    placeholder="请向管理员索取"
                    disabled={isPending}
                    className="border-border focus:border-primary"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-foreground text-sm">
                  用户名 {mode === 'register' && <span className="text-[color:var(--destructive)]">*</span>}
                </Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={mode === 'register' ? '字母、数字、下划线、点、横线' : '请输入用户名'}
                  autoComplete="username"
                  autoFocus={mode === 'login'}
                  disabled={isPending}
                  className="border-border focus:border-primary"
                />
                {mode === 'register' && (
                  <p className="text-[11px] text-muted-foreground">用于登录，创建后不可修改</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-foreground text-sm">
                  密码 {mode === 'register' && <span className="text-[color:var(--destructive)]">*</span>}
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'register' ? '至少6位' : '请输入密码'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    disabled={isPending}
                    className="border-border focus:border-primary pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Register-only: confirm password */}
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-foreground text-sm">
                    确认密码 <span className="text-[color:var(--destructive)]">*</span>
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                    disabled={isPending}
                    className="border-border focus:border-primary"
                  />
                  {confirmPassword && password && confirmPassword !== password && (
                    <p className="text-xs text-[color:var(--destructive)]">两次输入不一致</p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {mode === 'login' ? '登录中...' : '注册中...'}
                  </>
                ) : (
                  mode === 'login' ? '登录' : '注册账号'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {mode === 'register' && (
          <p className="text-center text-xs text-muted-foreground mt-4 leading-relaxed">
            注册后默认为成员，项目创建及其他权限<br />由管理员在后台授权
          </p>
        )}
      </div>
    </div>
  );
}

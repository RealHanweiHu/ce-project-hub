import { useState } from 'react';
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
  const [confirmPassword, setConfirmPassword] = useState('');

  const utils = trpc.useUtils();

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

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setUsername('');
    setPassword('');
    setConfirmPassword('');
    setName('');
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
      registerMutation.mutate({ username: username.trim(), password, name: name.trim() });
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-amber-500 flex items-center justify-center">
            <Cpu size={20} className="text-stone-900" />
          </div>
          <div>
            <h1 className="font-serif text-xl text-stone-900 leading-tight">CE Project Hub</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-500">
              Product Dev
            </p>
          </div>
        </div>

        <Card className="border-stone-200 shadow-sm">
          {/* Tab switcher */}
          <CardHeader className="pb-0 pt-4 px-4">
            <div className="flex border-b border-stone-200">
              <button
                type="button"
                onClick={() => switchMode('login')}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  mode === 'login'
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-stone-400 hover:text-stone-600'
                }`}
              >
                登录
              </button>
              <button
                type="button"
                onClick={() => switchMode('register')}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  mode === 'register'
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-stone-400 hover:text-stone-600'
                }`}
              >
                注册
              </button>
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
                  <Label htmlFor="name" className="text-stone-700 text-sm">
                    显示名称 <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例：张三"
                    autoFocus
                    disabled={isPending}
                    className="border-stone-300 focus:border-amber-400"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-stone-700 text-sm">
                  用户名 {mode === 'register' && <span className="text-rose-500">*</span>}
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
                  className="border-stone-300 focus:border-amber-400"
                />
                {mode === 'register' && (
                  <p className="text-[11px] text-stone-400">用于登录，创建后不可修改</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-stone-700 text-sm">
                  密码 {mode === 'register' && <span className="text-rose-500">*</span>}
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
                    className="border-stone-300 focus:border-amber-400 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition-colors"
                  >
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              {/* Register-only: confirm password */}
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className="text-stone-700 text-sm">
                    确认密码 <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                    disabled={isPending}
                    className="border-stone-300 focus:border-amber-400"
                  />
                  {confirmPassword && password && confirmPassword !== password && (
                    <p className="text-xs text-rose-500">两次输入不一致</p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-600 text-stone-900 font-medium"
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
          <p className="text-center text-xs text-stone-400 mt-4 leading-relaxed">
            注册后默认为普通用户，项目创建及其他权限<br />由管理员在后台授权
          </p>
        )}
      </div>
    </div>
  );
}

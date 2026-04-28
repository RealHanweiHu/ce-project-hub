import { useState } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Cpu, AlertCircle } from 'lucide-react';

export default function Login() {
  const [, navigate] = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    loginMutation.mutate({ username: username.trim(), password });
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
          <CardHeader className="pb-4">
            <CardTitle className="text-stone-900 text-lg">登录</CardTitle>
            <CardDescription className="text-stone-500 text-sm">
              请使用管理员分配的账号登录
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">{error}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="username" className="text-stone-700 text-sm">
                  用户名
                </Label>
                <Input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="请输入用户名"
                  autoComplete="username"
                  autoFocus
                  disabled={loginMutation.isPending}
                  className="border-stone-300 focus:border-amber-400 focus:ring-amber-400"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-stone-700 text-sm">
                  密码
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入密码"
                  autoComplete="current-password"
                  disabled={loginMutation.isPending}
                  className="border-stone-300 focus:border-amber-400 focus:ring-amber-400"
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-600 text-stone-900 font-medium"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  '登录'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-stone-400 mt-6">
          如需账号，请联系系统管理员
        </p>
      </div>
    </div>
  );
}

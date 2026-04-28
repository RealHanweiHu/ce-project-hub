/**
 * /setup - First-time admin initialization page
 * Only accessible when no users exist in the database.
 * Once any user is created, this page redirects to /login.
 */
import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { Cpu, ShieldCheck, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function Setup() {
  const [, navigate] = useLocation();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Check if setup is needed
  useEffect(() => {
    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((data: { needsSetup: boolean }) => {
        if (!data.needsSetup) {
          navigate('/login');
        } else {
          setNeedsSetup(true);
        }
      })
      .catch(() => {
        setFetchError(true);
      })
      .finally(() => setChecking(false));
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password || !name) {
      toast.error('请填写所有必填项');
      return;
    }
    if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) {
      toast.error('用户名只能包含字母、数字、下划线、点和横线');
      return;
    }
    if (password.length < 6) {
      toast.error('密码至少6位');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, name }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error || '创建失败');
        return;
      }
      toast.success('管理员账号创建成功！正在跳转到登录页...');
      setTimeout(() => navigate('/login'), 1500);
    } catch {
      toast.error('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center">
        <Loader2 size={24} className="text-stone-500 animate-spin" />
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <p className="text-stone-400 text-sm">无法连接到服务器，请检查网络后重试</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-amber-500 text-stone-900 text-sm font-medium hover:bg-amber-600 transition-colors"
            >
              重试
            </button>
            <button
              onClick={() => navigate('/login')}
              className="px-4 py-2 border border-stone-600 text-stone-400 text-sm hover:text-stone-200 transition-colors"
            >
              返回登录
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!needsSetup) return null;

  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 bg-amber-500 flex items-center justify-center">
            <Cpu size={20} className="text-stone-900" />
          </div>
          <div>
            <h1 className="font-serif text-xl text-stone-50 leading-tight">CE Project Hub</h1>
            <p className="text-[10px] font-mono uppercase tracking-widest text-stone-500">
              System Initialization
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-stone-800 border border-stone-700 p-8">
          {/* Header */}
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck size={18} className="text-amber-400" />
            <div>
              <h2 className="font-serif text-lg text-stone-50">初始化系统</h2>
              <p className="text-xs text-stone-400 mt-0.5">
                创建第一个管理员账号以开始使用
              </p>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/30 p-3 mb-6">
            <p className="text-xs text-amber-300 leading-relaxed">
              此页面仅在系统无用户时可访问。创建管理员后，此入口将自动关闭，后续用户由管理员在后台创建。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-sm text-stone-300">
                显示名称 <span className="text-amber-400">*</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例：张三"
                className="bg-stone-900 border-stone-600 text-stone-100 placeholder:text-stone-600 focus:border-amber-500"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-stone-300">
                用户名 <span className="text-amber-400">*</span>
              </Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="字母、数字、下划线、点、横线"
                className="bg-stone-900 border-stone-600 text-stone-100 placeholder:text-stone-600 focus:border-amber-500"
              />
              <p className="text-[11px] text-stone-500">用于登录，创建后不可修改</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-stone-300">
                密码 <span className="text-amber-400">*</span>
              </Label>
              <div className="relative">
                <Input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少6位"
                  className="bg-stone-900 border-stone-600 text-stone-100 placeholder:text-stone-600 focus:border-amber-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300 transition-colors"
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm text-stone-300">
                确认密码 <span className="text-amber-400">*</span>
              </Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次输入密码"
                className="bg-stone-900 border-stone-600 text-stone-100 placeholder:text-stone-600 focus:border-amber-500"
              />
            </div>

            <Button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-600 text-stone-900 font-semibold mt-2"
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={15} className="animate-spin mr-2" />
                  创建中...
                </>
              ) : (
                '创建管理员账号'
              )}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-stone-600 mt-4 font-mono">
          CE PROJECT HUB · SYSTEM SETUP
        </p>
      </div>
    </div>
  );
}

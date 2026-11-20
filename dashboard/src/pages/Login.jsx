import React, { useState } from 'react';
import GlassCard from '../components/GlassCard';
import { BrandLockup, SignalRail } from '../components/Brand';
import { Button } from '../components/ui';
import { login } from '../utils/auth';
import { useToast } from '../hooks/useToast';
import { Eye, EyeOff, Loader2, Lock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const { show } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    if (!password) {
      setErrorMessage('请输入管理员密码');
      return;
    }

    setLoading(true);
    try {
      const result = await login(password);
      show('登录成功', 'success');
      navigate(result?.recoveryRequired === true || result?.redirectPath === '/settings' ? '/settings' : '/', { replace: true });
    } catch (error) {
      console.error('Login failed:', error);
      const message = error.response?.data?.message || '登录失败，请检查密码';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page relative flex min-h-screen items-center justify-center overflow-hidden p-4">
      <div className="login-atmosphere" aria-hidden="true" />
      <div className="login-panel relative w-full max-w-[420px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <BrandLockup subtitle="QQ 群消息链接解析" />
          <SignalRail className="mt-4 w-44" label="群消息接入 · 短链解析 · 预览回传" />
        </div>

        <GlassCard className="login-card p-6 sm:p-8">
          <div className="mb-6">
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-muted)]">
              <Lock size={14} aria-hidden="true" />
              管理员认证
            </div>
            <h1 className="text-2xl font-semibold text-[var(--fg)]">管理员登录</h1>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--muted)]">
              解析 B站、抖音、小红书短链，还原完整链接并生成预览卡片。
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="mb-2 block text-sm font-medium text-[var(--fg)]">
                密码
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="field-control w-full px-4 py-3 pr-12 transition-colors"
                  placeholder="请输入管理员密码"
                  disabled={loading}
                  aria-invalid={errorMessage ? 'true' : 'false'}
                  aria-describedby={errorMessage ? 'password-error' : undefined}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute right-1 top-1/2 flex min-h-11 min-w-11 -translate-y-1/2 items-center justify-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errorMessage && (
                <p id="password-error" role="alert" className="mt-2 text-sm text-[var(--danger)]">
                  {errorMessage}
                </p>
              )}
            </div>

            <Button
              type="submit"
              disabled={loading}
              variant="primary"
              className="w-full py-3"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  验证中...
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>
        </GlassCard>

        <p className="mt-4 text-center text-xs text-[var(--muted)]">
          仅限已配置的管理员账户 · 登录状态保存在当前浏览器
        </p>
      </div>
    </main>
  );
};

export default Login;

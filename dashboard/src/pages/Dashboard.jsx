import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { AlertTriangle, Check, Clock3, Cpu, MemoryStick, Network, RefreshCw } from 'lucide-react';
import { Card, DataTable } from '../components/ui';
import { formatBytes, formatUptime, formatNetSpeed } from '../utils/format';
import api from '../utils/auth';

const HISTORY_STORAGE_KEY = 'bili-qq-bot.dashboard.history.v1';
const HISTORY_LIMIT = 60;

const PROCESS_ROWS = [
  { key: 'linkParsing', label: '链接解析' },
  { key: 'previewGeneration', label: '预览生成' },
  { key: 'subscriptionPush', label: '订阅推送' },
  { key: 'videoDownload', label: '视频下载' },
  { key: 'aiReply', label: 'AI 回复' },
  { key: 'toolCall', label: '工具调用' },
  { key: 'retryFailure', label: '失败重试' }
];

function normalizeProcessMetric(metric) {
  if (!metric) {
    return {
      total: '-',
      success: '-',
      failed: '-',
      latest: '暂无过程指标'
    };
  }
  return {
    total: metric.total ?? '-',
    success: metric.success ?? metric.ok ?? '-',
    failed: metric.failed ?? metric.error ?? '-',
    latest: metric.latest || metric.status || '-',
    lastAt: metric.lastAt || null,
    avgMs: metric.avgMs ?? null
  };
}

function numericValue(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function getMetricTone(value, warnAt, dangerAt) {
  const next = numericValue(value);
  if (next === null) return 'neutral';
  if (next >= dangerAt) return 'danger';
  if (next >= warnAt) return 'warn';
  return 'success';
}

function getProcessTone(metric) {
  const failed = numericValue(metric.failed);
  if (failed === null) return 'neutral';
  if (failed === 0) return 'success';
  return failed >= 5 ? 'danger' : 'warn';
}

function toneTextClass(tone) {
  switch (tone) {
    case 'success':
      return 'text-[color-mix(in_oklch,var(--success)_88%,var(--fg))]';
    case 'warn':
      return 'text-[color-mix(in_oklch,var(--warn)_88%,var(--fg))]';
    case 'danger':
      return 'text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]';
    case 'accent':
      return 'text-[var(--accent)]';
    default:
      return 'text-[var(--muted)]';
  }
}

function formatPercent(value) {
  const next = numericValue(value);
  return next === null ? '-' : `${next.toFixed(1)}%`;
}

function formatUpdatedAt(value) {
  if (!value) return '尚未更新';
  return value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (!Number.isFinite(Number(entry.cpu)) || !Number.isFinite(Number(entry.memory))) return null;
  return {
    time: entry.time || new Date(entry.timestamp || Date.now()).toLocaleTimeString(),
    timestamp: Number(entry.timestamp || Date.now()),
    cpu: Number(entry.cpu),
    memory: Number(entry.memory),
    memoryFormatted: entry.memoryFormatted || formatBytes(Number(entry.memory))
  };
}

function readPersistedHistory() {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeHistoryEntry).filter(Boolean).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function persistHistory(history) {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-HISTORY_LIMIT)));
  } catch {
    // The live chart can continue with its in-memory history.
  }
}

function getProviderPresentation(provider) {
  if (!provider) {
    return {
      label: 'QQ Provider',
      detail: '当前没有活动连接',
      state: '未连接',
      tone: 'danger'
    };
  }

  const state = String(provider.connectionState || provider.state || '').toLowerCase();
  const ready = state === 'ready' || state === 'open';
  const pending = ['connecting', 'authenticating', 'identifying', 'resuming', 'reconnecting'].includes(state);
  return {
    label: provider.name || provider.id || 'QQ Provider',
    detail: provider.id === 'official' ? 'QQ 官方接口' : 'WebSocket 连接',
    state: ready ? '在线' : (pending ? '连接中' : '离线'),
    tone: ready ? 'success' : (pending ? 'warn' : 'danger')
  };
}

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [provider, setProvider] = useState(undefined);
  const [history, setHistory] = useState(() => readPersistedHistory());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const mountedRef = useRef(true);
  const requestInFlightRef = useRef(false);

  const fetchData = useCallback(async () => {
    if (requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    setRefreshing(true);
    const [monitorResult, providerResult] = await Promise.allSettled([
      api.get('/api/monitor'),
      api.get('/api/qq-provider/status')
    ]);

    if (!mountedRef.current) {
      requestInFlightRef.current = false;
      return;
    }

    if (monitorResult.status === 'fulfilled') {
      const data = monitorResult.value.data;
      const now = Date.now();
      setStats(data);
      setLastUpdatedAt(new Date(now));
      setFetchError('');
      setHistory((previous) => {
        const newEntry = {
          time: new Date(now).toLocaleTimeString(),
          timestamp: now,
          cpu: data.cpu,
          memory: data.memory.used,
          memoryFormatted: formatBytes(data.memory.used)
        };
        const nextHistory = [...previous, newEntry].slice(-HISTORY_LIMIT);
        persistHistory(nextHistory);
        return nextHistory;
      });
    } else {
      setFetchError('系统指标暂时无法更新');
    }

    if (providerResult.status === 'fulfilled') {
      setProvider(providerResult.value.data?.provider || null);
    } else {
      setProvider(undefined);
    }
    requestInFlightRef.current = false;
    setRefreshing(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const initialFetch = setTimeout(fetchData, 0);
    const interval = setInterval(fetchData, 2000);
    return () => {
      mountedRef.current = false;
      clearTimeout(initialFetch);
      clearInterval(interval);
    };
  }, [fetchData]);

  if (!stats) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]">
        {fetchError ? (
          <>
            <AlertTriangle size={20} className="text-[var(--warn)]" />
            <span>{fetchError}</span>
            <button type="button" onClick={fetchData} className="font-semibold text-[var(--accent)]">重新尝试</button>
          </>
        ) : (
          <>
            <RefreshCw size={16} className="animate-spin" />
            <span>正在加载系统状态</span>
          </>
        )}
      </div>
    );
  }

  const memoryUsed = stats.memory?.used ?? 0;
  const memoryTotal = stats.memory?.total ?? 0;
  const memoryPercent = memoryTotal ? (memoryUsed / memoryTotal) * 100 : null;
  const cpuTone = getMetricTone(stats.cpu, 70, 90);
  const memoryTone = getMetricTone(memoryPercent, 75, 90);
  const providerView = getProviderPresentation(provider);
  const processRows = PROCESS_ROWS.map((row) => {
    const metric = normalizeProcessMetric(stats.processReport?.[row.key]);
    return { ...row, metric, tone: getProcessTone(metric) };
  });
  const attentionCount = [cpuTone, memoryTone, providerView.tone]
    .filter((tone) => tone === 'warn' || tone === 'danger').length;
  const healthy = attentionCount === 0 && !fetchError;

  const kpis = [
    {
      label: 'CPU 负载',
      value: formatPercent(stats.cpu),
      detail: cpuTone === 'success' ? '运行平稳' : '负载偏高',
      tone: cpuTone,
      icon: Cpu
    },
    {
      label: '内存使用',
      value: formatBytes(memoryUsed),
      detail: memoryTotal ? `共 ${formatBytes(memoryTotal)}` : '总量未知',
      tone: memoryTone,
      icon: MemoryStick
    },
    {
      label: '网络流量',
      value: `↑ ${formatNetSpeed(stats.network?.up ?? 0)}`,
      detail: `↓ ${formatNetSpeed(stats.network?.down ?? 0)}`,
      tone: 'accent',
      icon: Network
    },
    {
      label: '运行时间',
      value: formatUptime(stats.uptime),
      detail: '当前进程',
      tone: 'success',
      icon: Clock3
    }
  ];

  const kpiIconClass = {
    success: 'bg-[var(--success-soft)] text-[color-mix(in_oklch,var(--success)_88%,var(--fg))]',
    warn: 'bg-[var(--warn-soft)] text-[color-mix(in_oklch,var(--warn)_88%,var(--fg))]',
    danger: 'bg-[var(--danger-soft)] text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]',
    accent: 'bg-[var(--accent-soft)] text-[var(--accent)]'
  };

  const healthRows = [
    providerView,
    {
      label: 'CPU 资源',
      detail: formatPercent(stats.cpu),
      state: cpuTone === 'success' ? '正常' : (cpuTone === 'warn' ? '偏高' : '过高'),
      tone: cpuTone
    },
    {
      label: '内存资源',
      detail: memoryTotal ? `${formatPercent(memoryPercent)} 已使用` : formatBytes(memoryUsed),
      state: memoryTone === 'success' ? '正常' : (memoryTone === 'warn' ? '偏高' : '过高'),
      tone: memoryTone
    },
    {
      label: '网络吞吐',
      detail: `上行 ${formatNetSpeed(stats.network?.up ?? 0)}`,
      state: '监控中',
      tone: 'success'
    }
  ];

  const processColumns = [
    { key: 'label', title: '流程', className: 'font-medium' },
    { key: 'total', title: '总量', className: 'font-mono text-[var(--muted)]', render: (row) => row.metric.total },
    { key: 'success', title: '成功', className: 'font-mono text-[var(--muted)]', render: (row) => row.metric.success },
    { key: 'failed', title: '失败', className: 'font-mono text-[var(--muted)]', render: (row) => row.metric.failed },
    {
      key: 'latest',
      title: '最近状态',
      render: (row) => (
        <span className={`text-xs font-semibold ${toneTextClass(row.tone)}`}>
          {row.metric.latest || '-'}
        </span>
      )
    }
  ];

  return (
    <div className="pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--fg)] md:text-[30px]">运行状态</h1>
          <p className="mt-1.5 text-xs text-[var(--muted)]">查看服务健康、资源使用和自动化流程。</p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-[var(--subtle)]">
          <span>最后更新：{formatUpdatedAt(lastUpdatedAt)}</span>
          <button
            type="button"
            onClick={fetchData}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            刷新
          </button>
        </div>
      </header>

      <Card className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${healthy ? 'bg-[var(--success-soft)] text-[var(--success)]' : 'bg-[var(--warn-soft)] text-[var(--warn)]'}`}>
          {healthy ? <Check size={17} /> : <AlertTriangle size={16} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <strong className="text-sm font-semibold text-[var(--fg)]">
            {healthy ? '核心运行状态正常' : `${attentionCount || 1} 项状态需要关注`}
          </strong>
          <span className="text-xs text-[var(--muted)]">
            {fetchError || `${providerView.label} ${providerView.state}，系统资源监控已连接`}
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <Clock3 size={13} className="text-[var(--subtle)]" />
          已运行 {formatUptime(stats.uptime)}
        </span>
      </Card>

      <section className="dashboard-metrics mt-4">
        {kpis.map((kpi) => {
          const KpiIcon = kpi.icon;
          return (
            <Card key={kpi.label}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-medium text-[var(--muted)]">{kpi.label}</div>
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${kpiIconClass[kpi.tone] || kpiIconClass.accent}`}>
                  <KpiIcon size={15} />
                </span>
              </div>
              <div className="mt-3 text-[22px] font-semibold leading-7 tracking-[-0.01em] tabular-nums text-[var(--fg)]">
                {kpi.value}
              </div>
              <div className={`mt-1.5 text-[11px] ${toneTextClass(kpi.tone)}`}>{kpi.detail}</div>
            </Card>
          );
        })}
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card padded={false} className="overflow-hidden">
          <div className="flex items-start justify-between gap-4 px-5 pt-5">
            <div>
              <h2 className="text-base font-semibold text-[var(--fg)]">资源趋势</h2>
              <p className="mt-1 text-[11px] text-[var(--muted)]">最近 60 个采样点，每 2 秒更新</p>
            </div>
            <div className="flex items-center gap-4 pt-0.5 text-[10px] text-[var(--muted)]">
              <span className="font-semibold text-[var(--accent)]">实时</span>
              <span>CPU</span>
              <span>内存</span>
            </div>
          </div>
          <div className="h-64 px-2 pb-2 pt-4 md:h-72">
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              minHeight={256}
              initialDimension={{ width: 900, height: 288 }}
            >
              <AreaChart data={history} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--border-subtle)" />
                <XAxis dataKey="time" axisLine={false} tickLine={false} fontSize={10} tick={{ fill: 'var(--subtle)' }} minTickGap={36} />
                <YAxis yAxisId="cpu" domain={[0, 100]} axisLine={false} tickLine={false} fontSize={10} tick={{ fill: 'var(--subtle)' }} />
                <YAxis yAxisId="memory" hide orientation="right" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--surface-raised)',
                    borderColor: 'var(--border)',
                    borderRadius: 10,
                    boxShadow: 'var(--shadow-floating)',
                    color: 'var(--fg)',
                    fontSize: 12
                  }}
                  itemStyle={{ color: 'var(--fg)' }}
                  labelStyle={{ color: 'var(--muted)' }}
                  formatter={(value, name) => (
                    name === 'Memory' ? [formatBytes(value), '内存'] : [`${Number(value).toFixed(1)}%`, 'CPU']
                  )}
                />
                <Area yAxisId="cpu" type="monotone" dataKey="cpu" stroke="var(--accent)" strokeWidth={2.5} fill="url(#colorCpu)" name="CPU %" isAnimationActive={false} />
                <Area yAxisId="memory" type="monotone" dataKey="memory" stroke="var(--purple)" strokeWidth={2} fill="transparent" name="Memory" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-[var(--fg)]">运行健康</h2>
          <p className="mt-1 text-[11px] text-[var(--muted)]">来自当前运行时的实时状态</p>
          <div className="mt-3 divide-y divide-[var(--border-subtle)]">
            {healthRows.map((row) => (
              <div key={row.label} className="flex min-h-14 items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--fg)]">
                    <span className={`h-1.5 w-1.5 rounded-full bg-current ${toneTextClass(row.tone)}`} />
                    <span className="truncate">{row.label}</span>
                  </div>
                  <div className="mt-1 truncate pl-3.5 text-[10px] text-[var(--muted)]">{row.detail}</div>
                </div>
                <span className={`shrink-0 text-[10px] font-semibold ${toneTextClass(row.tone)}`}>{row.state}</span>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card padded={false} className="mt-4 overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 className="text-base font-semibold text-[var(--fg)]">自动化流程</h2>
            <p className="mt-1 text-[11px] text-[var(--muted)]">处理数量、失败情况与最近状态</p>
          </div>
          <span className="font-mono text-[10px] text-[var(--subtle)]">{processRows.length} 个流程</span>
        </div>
        <div className="mt-3">
          <DataTable columns={processColumns} rows={processRows} getRowKey={(row) => row.key} />
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;

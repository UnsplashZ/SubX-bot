import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import SettingRow from '../../../../components/SettingRow';
import { ToggleSwitch } from '../../../../components/ui';
import { LABEL_CONFIG_ITEMS } from '../../constants/labelConfig';

const NIGHT_MODE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'on', label: '开启' },
  { value: 'timed', label: '定时' }
];

const SegmentedControl = ({ value, onChange, options, label }) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="inline-grid w-full grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-1 sm:w-auto"
  >
    {options.map((option) => {
      const active = value === option.value;
      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(option.value)}
          className={clsx(
            'h-9 min-w-20 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]',
            active
              ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm'
              : 'text-[var(--muted)] hover:text-[var(--fg)]'
          )}
        >
          {option.label}
        </button>
      );
    })}
  </div>
);

const LabelVisibilityOption = ({ label, enabled, onChange }) => (
  <label
    className={clsx(
      'flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors focus-within:ring-2 focus-within:ring-[var(--accent)]',
      enabled
        ? 'border-[color-mix(in_oklch,var(--accent)_32%,var(--border))] bg-[var(--accent-soft)] text-[var(--fg)]'
        : 'border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-quiet)]'
    )}
  >
    <span className="min-w-0 truncate font-medium">{label}</span>
    <span
      aria-hidden="true"
      className={clsx(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
        enabled
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)]'
          : 'border-[var(--border-muted)] bg-[var(--surface)]'
      )}
    >
      {enabled && <Check size={13} strokeWidth={3} />}
    </span>
    <input
      type="checkbox"
      checked={enabled}
      onChange={(event) => onChange(event.target.checked)}
      className="sr-only"
    />
  </label>
);

const GeneralTab = ({ formData, setFormData }) => {
  return (
    <div className="space-y-5 md:space-y-6 focus:outline-none">
      <div className="divide-y divide-[var(--border-subtle)]">
        <SettingRow
          title="链接缓存超时"
          description="同一链接重复解析的群组级冷却时间。"
          status="秒"
          control={
          <input
            type="number"
            value={formData.linkCacheTimeout}
            onChange={(e) => setFormData({ ...formData, linkCacheTimeout: parseInt(e.target.value, 10) || 0 })}
            className="field-control w-full px-3 py-2 md:w-40"
          />
          }
        />

        <SettingRow
          title="显示 UID"
          description="关闭后，用户相关卡片与列表将隐藏 UID。"
          control={
          <ToggleSwitch
            checked={!!formData.showId}
            onChange={(checked) => setFormData({ ...formData, showId: checked })}
            label="显示 UID"
          />
          }
        />

        <div className="py-4">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="block text-sm font-medium text-[var(--fg)]">深色模式</span>
            </div>
            <SegmentedControl
              value={formData.nightMode.mode}
              options={NIGHT_MODE_OPTIONS}
              label="深色模式"
              onChange={(mode) => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode } })}
            />
          </div>

          {formData.nightMode.mode === 'timed' && (
            <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--muted)]">开始时间</span>
                  <input
                    type="time"
                    value={formData.nightMode.startTime}
                    onChange={(e) => setFormData({
                      ...formData,
                      nightMode: { ...formData.nightMode, startTime: e.target.value }
                    })}
                    className="field-control w-full px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-[var(--muted)]">结束时间</span>
                  <input
                    type="time"
                    value={formData.nightMode.endTime}
                    onChange={(e) => setFormData({
                      ...formData,
                      nightMode: { ...formData.nightMode, endTime: e.target.value }
                    })}
                    className="field-control w-full px-3 py-2"
                  />
                </label>
              </div>
              <p className="text-xs text-[var(--muted)]">
                支持跨天时段（例如 21:00–06:00）
              </p>
            </div>
          )}
        </div>

        <div className="py-4">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium text-[var(--fg)]">预览卡片标签</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">选择在预览卡片中显示的内容标签。</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs text-[var(--muted)]">
                {LABEL_CONFIG_ITEMS.filter((item) => formData.labelConfig?.[item.key]).length}/{LABEL_CONFIG_ITEMS.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  const allEnabled = LABEL_CONFIG_ITEMS.every((item) => formData.labelConfig?.[item.key]);
                  const labelConfig = { ...formData.labelConfig };
                  for (const item of LABEL_CONFIG_ITEMS) labelConfig[item.key] = !allEnabled;
                  setFormData({ ...formData, labelConfig });
                }}
                className="rounded-md px-2 py-1 text-xs font-semibold text-[var(--accent-muted)] transition-colors hover:bg-[var(--accent-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                {LABEL_CONFIG_ITEMS.every((item) => formData.labelConfig?.[item.key]) ? '全部隐藏' : '全部显示'}
              </button>
            </div>
          </div>
          <div role="group" aria-label="预览卡片标签可见性" className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {LABEL_CONFIG_ITEMS.map((item) => (
              <LabelVisibilityOption
                key={item.key}
                label={item.label}
                enabled={!!formData.labelConfig?.[item.key]}
                onChange={(checked) => setFormData({
                  ...formData,
                  labelConfig: { ...formData.labelConfig, [item.key]: checked }
                })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GeneralTab;

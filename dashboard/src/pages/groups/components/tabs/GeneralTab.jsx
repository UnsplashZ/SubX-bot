import { clsx } from 'clsx';
import SettingRow from '../../../../components/SettingRow';
import { ToggleSwitch } from '../../../../components/ui';
import { LABEL_CONFIG_ITEMS } from '../../constants/labelConfig';

const NIGHT_MODE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'on', label: '开启' },
  { value: 'timed', label: '定时' }
];

const SegmentedControl = ({ value, onChange, options }) => (
  <div className="inline-grid w-full grid-cols-3 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-1 sm:w-auto">
    {options.map((option) => {
      const active = value === option.value;
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            'h-8 min-w-20 rounded-md px-3 text-sm font-medium transition-colors',
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

const LabelVisibilityRow = ({ label, enabled, onChange }) => (
  <button
    type="button"
    onClick={() => onChange(!enabled)}
    className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-muted)]"
  >
    <span className="min-w-0 truncate text-sm font-medium text-[var(--fg)]">{label}</span>
    <span
      className={clsx(
        'font-mono text-xs font-semibold',
        enabled ? 'text-[var(--accent)]' : 'text-[var(--muted)]'
      )}
    >
      {enabled ? '显示' : '隐藏'}
    </span>
  </button>
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
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <span className="block text-sm font-medium text-[var(--fg)]">预览卡片标签</span>
            </div>
            <span className="font-mono text-xs text-[var(--muted)]">
              {LABEL_CONFIG_ITEMS.filter((item) => formData.labelConfig?.[item.key]).length}/{LABEL_CONFIG_ITEMS.length}
            </span>
          </div>
          <div className="grid overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] sm:grid-cols-2">
            {LABEL_CONFIG_ITEMS.map((item) => (
              <LabelVisibilityRow
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

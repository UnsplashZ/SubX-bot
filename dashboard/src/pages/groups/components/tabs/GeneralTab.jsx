import { clsx } from 'clsx';
import SettingRow from '../../../../components/SettingRow';
import { ToggleSwitch } from '../../../../components/ui';
import { LABEL_CONFIG_ITEMS } from '../../constants/labelConfig';
import { QuietButton } from './settingsPrimitives';

const NIGHT_MODE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'on', label: '开启' },
  { value: 'timed', label: '定时' }
];

const SegmentedControl = ({ value, onChange, options, label }) => (
  <div
    role="radiogroup"
    aria-label={label}
    className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-0.5"
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
            'h-8 min-w-16 rounded-[5px] px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)]',
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
  <label className="group flex min-h-8 cursor-pointer items-center gap-2 text-sm text-[var(--fg)]">
    <input
      type="checkbox"
      checked={enabled}
      onChange={(event) => onChange(event.target.checked)}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded-[3px] border-[var(--border-muted)] accent-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
    />
    <span className="min-w-0 truncate">{label}</span>
  </label>
);

const GeneralTab = ({ formData, setFormData }) => {
  const enabledLabelCount = LABEL_CONFIG_ITEMS.filter((item) => formData.labelConfig?.[item.key]).length;
  const allLabelsEnabled = enabledLabelCount === LABEL_CONFIG_ITEMS.length;

  return (
    <div className="focus:outline-none">
      <div className="divide-y divide-[var(--border-subtle)]">
        <SettingRow
          className="py-3.5"
          title="链接缓存超时"
          description="同一链接重复解析的群组级冷却时间。"
          status="秒"
          control={
            <input
              type="number"
              value={formData.linkCacheTimeout}
              onChange={(e) => setFormData({ ...formData, linkCacheTimeout: parseInt(e.target.value, 10) || 0 })}
              className="field-control w-full px-3 py-2 text-right text-sm md:w-32"
            />
          }
        />

        <SettingRow
          className="py-3.5"
          title="显示 UID"
          description="关闭后，用户相关卡片与列表将隐藏 UID。"
          control={
            <ToggleSwitch
              tone="neutral"
              checked={!!formData.showId}
              onChange={(checked) => setFormData({ ...formData, showId: checked })}
              label="显示 UID"
            />
          }
        />

        <div className="py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-[var(--fg)]">深色模式</div>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">控制预览卡片的主题切换方式。</p>
            </div>
            <SegmentedControl
              value={formData.nightMode.mode}
              options={NIGHT_MODE_OPTIONS}
              label="深色模式"
              onChange={(mode) => setFormData({ ...formData, nightMode: { ...formData.nightMode, mode } })}
            />
          </div>

          {formData.nightMode.mode === 'timed' && (
            <div className="mt-3 grid max-w-md grid-cols-2 gap-4">
              <label className="block">
                <span className="mb-1 block text-xs text-[var(--muted)]">开始时间</span>
                <input
                  type="time"
                  value={formData.nightMode.startTime}
                  onChange={(e) => setFormData({
                    ...formData,
                    nightMode: { ...formData.nightMode, startTime: e.target.value }
                  })}
                  className="field-control w-full px-3 py-2 text-sm"
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
                  className="field-control w-full px-3 py-2 text-sm"
                />
              </label>
              <p className="col-span-2 text-xs text-[var(--muted)]">支持跨天时段，例如 21:00–06:00。</p>
            </div>
          )}
        </div>

        <div className="py-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="flex items-baseline gap-2">
                <h3 className="text-sm font-medium text-[var(--fg)]">预览卡片标签</h3>
                <span className="font-mono text-[11px] text-[var(--muted)]">
                  {enabledLabelCount}/{LABEL_CONFIG_ITEMS.length}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">选择在预览卡片中显示的内容标签。</p>
            </div>
            <QuietButton
              onClick={() => {
                const labelConfig = { ...formData.labelConfig };
                for (const item of LABEL_CONFIG_ITEMS) labelConfig[item.key] = !allLabelsEnabled;
                setFormData({ ...formData, labelConfig });
              }}
            >
              {allLabelsEnabled ? '全部隐藏' : '全部显示'}
            </QuietButton>
          </div>
          <div
            role="group"
            aria-label="预览卡片标签可见性"
            className="mt-3 grid grid-cols-2 gap-x-8 gap-y-0.5 sm:grid-cols-3 xl:grid-cols-4"
          >
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

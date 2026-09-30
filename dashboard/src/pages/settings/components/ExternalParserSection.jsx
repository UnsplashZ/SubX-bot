import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import { Button, ToggleSwitch } from '../../../components/ui'

const ExternalParserSection = ({
  config,
  onChange,
  onClearCookie,
  disabled = false
}) => (
  <section>
    <h2 className="mb-4 text-xl font-semibold text-[var(--fg)]">外部平台解析</h2>
    <GlassCard>
      <div className="divide-y divide-[var(--border-subtle)]">
        <SettingRow
          title="启用抖音解析"
          description="识别抖音视频、图集和 Live Photo 分享链接。"
          control={(
            <ToggleSwitch
              checked={!!config.douyinEnabled}
              onChange={(checked) => onChange('douyinEnabled', checked)}
              label="启用抖音解析"
              disabled={disabled}
            />
          )}
        />
        <SettingRow
          title="启用抖音媒体下载"
          description="在解析抖音链接后下载并发送视频或图集。"
          control={(
            <ToggleSwitch
              checked={!!config.douyinDownloadEnabled}
              onChange={(checked) => onChange('douyinDownloadEnabled', checked)}
              label="启用抖音媒体下载"
              disabled={disabled}
            />
          )}
        />
        <SettingRow
          title="启用小红书解析"
          description="识别小红书图文和视频笔记。"
          control={(
            <ToggleSwitch
              checked={!!config.xiaohongshuEnabled}
              onChange={(checked) => onChange('xiaohongshuEnabled', checked)}
              label="启用小红书解析"
              disabled={disabled}
            />
          )}
        />
        <SettingRow
          title="抖音下载最大时长"
          description="超过此时长的抖音视频不下载，0 表示不限制。"
          status="秒"
          control={(
            <input
              type="number"
              min="0"
              max="600"
              value={config.douyinDownloadMaxDurationSeconds}
              onChange={(event) => onChange('douyinDownloadMaxDurationSeconds', parseInt(event.target.value, 10) || 0)}
              disabled={disabled}
              className="field-control w-24 px-3 py-1.5 text-right text-sm"
            />
          )}
        />
        <SettingRow
          title="抖音下载最大文件大小"
          description="超过此大小的抖音媒体不下载。"
          status="MB"
          control={(
            <input
              type="number"
              min="1"
              max="500"
              value={config.douyinDownloadMaxFileSizeMB}
              onChange={(event) => onChange('douyinDownloadMaxFileSizeMB', parseInt(event.target.value, 10) || 0)}
              disabled={disabled}
              className="field-control w-24 px-3 py-1.5 text-right text-sm"
            />
          )}
        />
        <SettingRow
          title="小红书下载最大时长"
          description="超过此时长的小红书视频不下载，0 表示不限制。"
          status="秒"
          control={(
            <input
              type="number"
              min="0"
              max="600"
              value={config.xiaohongshuDownloadMaxDurationSeconds}
              onChange={(event) => onChange('xiaohongshuDownloadMaxDurationSeconds', parseInt(event.target.value, 10) || 0)}
              disabled={disabled}
              className="field-control w-24 px-3 py-1.5 text-right text-sm"
            />
          )}
        />
        <SettingRow
          title="小红书下载最大文件大小"
          description="超过此大小的小红书媒体不下载。"
          status="MB"
          control={(
            <input
              type="number"
              min="1"
              max="500"
              value={config.xiaohongshuDownloadMaxFileSizeMB}
              onChange={(event) => onChange('xiaohongshuDownloadMaxFileSizeMB', parseInt(event.target.value, 10) || 0)}
              disabled={disabled}
              className="field-control w-24 px-3 py-1.5 text-right text-sm"
            />
          )}
        />
        <SettingRow
          title="小红书登录 Cookie"
          description="从浏览器开发者工具复制 Cookie 粘贴到这里。凭据不会回显或写入日志。"
          control={(
            <div className="flex w-full flex-col gap-2 sm:w-[28rem] sm:flex-row sm:items-center">
              <input
                type="password"
                value={config.xiaohongshuCookie || ''}
                onChange={(event) => onChange('xiaohongshuCookie', event.target.value)}
                placeholder={config.xiaohongshuCookieConfigured ? '已配置，输入新 Cookie 可覆盖' : '粘贴 Cookie'}
                disabled={disabled}
                autoComplete="new-password"
                className="field-control min-w-0 flex-1 px-3 py-2 text-sm"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={onClearCookie}
                disabled={disabled || !config.xiaohongshuCookieConfigured}
              >
                清除
              </Button>
            </div>
          )}
        />
      </div>
    </GlassCard>
  </section>
)

export default ExternalParserSection

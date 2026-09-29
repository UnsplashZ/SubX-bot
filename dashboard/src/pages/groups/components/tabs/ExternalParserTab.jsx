import SettingRow from '../../../../components/SettingRow';
import { ToggleSwitch } from '../../../../components/ui';

const ExternalParserTab = ({ formData, setFormData }) => (
  <div className="focus:outline-none">
    <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-xs leading-relaxed text-[var(--muted)]">
      群级开启可以覆盖全局关闭；群级关闭不会覆盖全局开启。登录凭据请在系统设置中管理。
    </div>
    <div className="divide-y divide-[var(--border-subtle)]">
      <SettingRow
        title="启用抖音解析"
        description="识别抖音视频、图集和 Live Photo 分享链接。"
        control={(
          <ToggleSwitch
            checked={!!formData.douyinEnabled}
            onChange={(checked) => setFormData({ ...formData, douyinEnabled: checked })}
            label="启用抖音解析"
          />
        )}
      />
      <SettingRow
        title="启用抖音媒体下载"
        description="下载并发送抖音视频或图集媒体。"
        control={(
          <ToggleSwitch
            checked={!!formData.douyinDownloadEnabled}
            onChange={(checked) => setFormData({ ...formData, douyinDownloadEnabled: checked })}
            label="启用抖音媒体下载"
          />
        )}
      />
      <SettingRow
        title="启用小红书解析"
        description="识别小红书图文和视频笔记。"
        control={(
          <ToggleSwitch
            checked={!!formData.xiaohongshuEnabled}
            onChange={(checked) => setFormData({ ...formData, xiaohongshuEnabled: checked })}
            label="启用小红书解析"
          />
        )}
      />
    </div>
  </div>
);

export default ExternalParserTab;

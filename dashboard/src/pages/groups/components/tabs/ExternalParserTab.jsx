import SettingRow from '../../../../components/SettingRow';
import { ToggleSwitch } from '../../../../components/ui';
import { SettingsSection } from './settingsPrimitives';

// 群级外部平台字段：null = 跟随全局（保存时后端删除覆盖键），其余为群级覆盖值
const EXTERNAL_KEYS = [
  'douyinEnabled',
  'douyinDownloadEnabled',
  'xiaohongshuEnabled',
  'douyinDownloadMaxDurationSeconds',
  'douyinDownloadMaxFileSizeMB',
  'xiaohongshuDownloadMaxDurationSeconds',
  'xiaohongshuDownloadMaxFileSizeMB'
];

const isFollowingGlobal = (formData) => EXTERNAL_KEYS.every((key) => formData[key] === null || formData[key] === undefined);

const ExternalParserTab = ({ formData, setFormData, globalConfig = {} }) => {
  const followingGlobal = isFollowingGlobal(formData);

  const setFollowGlobal = (checked) => {
    setFormData((prev) => {
      if (checked) {
        return EXTERNAL_KEYS.reduce((next, key) => ({ ...next, [key]: null }), { ...prev });
      }
      // 取消跟随：以群级覆盖值为准，无覆盖的字段回退到全局当前值
      return EXTERNAL_KEYS.reduce(
        (next, key) => ({ ...next, [key]: prev[key] ?? globalConfig[key] ?? null }),
        { ...prev }
      );
    });
  };

  const setField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const setNumberField = (key) => (event) => {
    const parsed = parseInt(event.target.value, 10);
    if (Number.isNaN(parsed)) {
      // 输入为空时回退到当前生效值，避免写入非法值
      setFormData((prev) => ({ ...prev, [key]: prev[key] ?? globalConfig[key] ?? null }));
      return;
    }
    setField(key, parsed);
  };

  const customValue = (key) => formData[key] ?? globalConfig[key];

  return (
    <div className="divide-y divide-[var(--border-subtle)] focus:outline-none">
      <div className="py-1">
        <SettingRow
          className="border-b-0 py-3.5"
          title="跟随全局设置"
          description="开启后，本群直接使用系统设置中的外部平台配置。"
          control={(
            <ToggleSwitch
              tone="neutral"
              checked={followingGlobal}
              onChange={setFollowGlobal}
              label="跟随全局设置"
            />
          )}
        />
      </div>

      <SettingsSection
        title="抖音"
        meta="视频 / 图集 / Live Photo"
      >
        <div className="divide-y divide-[var(--border-subtle)]">
          <SettingRow
            className="py-3"
            title="启用解析"
            description="识别抖音视频、图集和 Live Photo 分享链接。"
            control={(
              <ToggleSwitch
                tone="neutral"
                checked={!!customValue('douyinEnabled')}
                onChange={(checked) => setField('douyinEnabled', checked)}
                label="启用抖音解析"
                disabled={followingGlobal}
              />
            )}
          />
          <SettingRow
            className="py-3"
            title="启用媒体下载"
            description="下载并发送抖音视频或图集媒体。"
            control={(
              <ToggleSwitch
                tone="neutral"
                checked={!!customValue('douyinDownloadEnabled')}
                onChange={(checked) => setField('douyinDownloadEnabled', checked)}
                label="启用抖音媒体下载"
                disabled={followingGlobal}
              />
            )}
          />
          <SettingRow
            className="py-3"
            title="下载最大时长"
            description="超过时长的视频不下载，0 表示不限制。"
            status="秒"
            control={(
              <input
                type="number"
                min="0"
                max="600"
                value={customValue('douyinDownloadMaxDurationSeconds') ?? ''}
                onChange={setNumberField('douyinDownloadMaxDurationSeconds')}
                disabled={followingGlobal}
                className="field-control w-full px-3 py-2 text-right text-sm disabled:opacity-45 md:w-28"
              />
            )}
          />
          <SettingRow
            className="py-3"
            title="下载最大文件大小"
            description="超过大小的媒体不下载。"
            status="MB"
            control={(
              <input
                type="number"
                min="1"
                max="500"
                value={customValue('douyinDownloadMaxFileSizeMB') ?? ''}
                onChange={setNumberField('douyinDownloadMaxFileSizeMB')}
                disabled={followingGlobal}
                className="field-control w-full px-3 py-2 text-right text-sm disabled:opacity-45 md:w-28"
              />
            )}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="小红书"
        meta="图文 / 视频笔记"
      >
        <div className="divide-y divide-[var(--border-subtle)]">
          <SettingRow
            className="py-3"
            title="启用解析"
            description="识别小红书图文和视频笔记。"
            control={(
              <ToggleSwitch
                tone="neutral"
                checked={!!customValue('xiaohongshuEnabled')}
                onChange={(checked) => setField('xiaohongshuEnabled', checked)}
                label="启用小红书解析"
                disabled={followingGlobal}
              />
            )}
          />
          <SettingRow
            className="py-3"
            title="下载最大时长"
            description="超过时长的视频不下载，0 表示不限制。"
            status="秒"
            control={(
              <input
                type="number"
                min="0"
                max="600"
                value={customValue('xiaohongshuDownloadMaxDurationSeconds') ?? ''}
                onChange={setNumberField('xiaohongshuDownloadMaxDurationSeconds')}
                disabled={followingGlobal}
                className="field-control w-full px-3 py-2 text-right text-sm disabled:opacity-45 md:w-28"
              />
            )}
          />
          <SettingRow
            className="py-3"
            title="下载最大文件大小"
            description="超过大小的媒体不下载。"
            status="MB"
            control={(
              <input
                type="number"
                min="1"
                max="500"
                value={customValue('xiaohongshuDownloadMaxFileSizeMB') ?? ''}
                onChange={setNumberField('xiaohongshuDownloadMaxFileSizeMB')}
                disabled={followingGlobal}
                className="field-control w-full px-3 py-2 text-right text-sm disabled:opacity-45 md:w-28"
              />
            )}
          />
        </div>
      </SettingsSection>
    </div>
  );
};

export default ExternalParserTab;

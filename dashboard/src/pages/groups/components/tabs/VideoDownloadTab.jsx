import SettingRow from '../../../../components/SettingRow';
import { Button, ToggleSwitch } from '../../../../components/ui';

const CUSTOM_DEFAULTS = {
  videoDownloadEnabled: false,
  videoDownloadResolution: '1080p',
  videoDownloadMaxDuration: 600
};

const RESOLUTION_OPTIONS = ['360p', '480p', '720p', '1080p', '1080p+'];

function isFollowingGlobal(config) {
  return (
    config.videoDownloadEnabled === null &&
    config.videoDownloadResolution === null &&
    config.videoDownloadMaxDuration === null
  );
}

function toCustomConfig(config, fallbackConfig = CUSTOM_DEFAULTS) {
  return {
    videoDownloadEnabled: config.videoDownloadEnabled ?? fallbackConfig.videoDownloadEnabled ?? CUSTOM_DEFAULTS.videoDownloadEnabled,
    videoDownloadResolution: config.videoDownloadResolution ?? fallbackConfig.videoDownloadResolution ?? CUSTOM_DEFAULTS.videoDownloadResolution,
    videoDownloadMaxDuration: config.videoDownloadMaxDuration ?? fallbackConfig.videoDownloadMaxDuration ?? CUSTOM_DEFAULTS.videoDownloadMaxDuration
  };
}

const VideoDownloadTab = ({
  videoDownloadConfig,
  globalVideoDownloadConfig,
  setVideoDownloadConfig,
  actionLoading,
  onResetVideoDownloadConfig
}) => {
  const followingGlobal = isFollowingGlobal(videoDownloadConfig);
  const customConfig = toCustomConfig(videoDownloadConfig, globalVideoDownloadConfig);

  const setFollowGlobal = (checked) => {
    setVideoDownloadConfig((prev) => (
      checked
        ? {
            videoDownloadEnabled: null,
            videoDownloadResolution: null,
            videoDownloadMaxDuration: null
          }
        : toCustomConfig(prev, globalVideoDownloadConfig)
    ));
  };

  return (
    <div className="focus:outline-none">
      <div className="divide-y divide-[var(--border-subtle)]">
        <SettingRow
          className="py-3.5"
          title="跟随全局设置"
          description="开启后，本群直接使用系统设置中的视频下载配置。"
          control={
            <ToggleSwitch
              tone="neutral"
              checked={followingGlobal}
              onChange={setFollowGlobal}
              label="跟随全局设置"
            />
          }
        />

        <SettingRow
          className="py-3.5"
          title="启用视频下载"
          description="群组级视频下载开关。"
          control={
            <ToggleSwitch
              tone="neutral"
              checked={!!customConfig.videoDownloadEnabled}
              disabled={followingGlobal}
              onChange={(checked) => setVideoDownloadConfig((prev) => ({
                ...toCustomConfig(prev, globalVideoDownloadConfig),
                videoDownloadEnabled: checked
              }))}
              label="启用视频下载"
            />
          }
        />

        <SettingRow
          className="py-3.5"
          title="默认分辨率"
          description="DASH 流画质上限。"
          control={
            <select
              value={customConfig.videoDownloadResolution}
              disabled={followingGlobal}
              onChange={(event) => setVideoDownloadConfig((prev) => ({
                ...toCustomConfig(prev, globalVideoDownloadConfig),
                videoDownloadResolution: event.target.value
              }))}
              className="field-control w-full px-3 py-2 text-sm disabled:opacity-45 md:w-36"
            >
              {RESOLUTION_OPTIONS.map((resolution) => (
                <option key={resolution} value={resolution}>{resolution}</option>
              ))}
            </select>
          }
        />

        <SettingRow
          className="py-3.5"
          title="最大时长限制"
          description="超过时长的视频不下载，0 表示不限制。"
          status="秒"
          control={
            <input
              type="number"
              min="0"
              value={customConfig.videoDownloadMaxDuration}
              disabled={followingGlobal}
              onChange={(event) => setVideoDownloadConfig((prev) => ({
                ...toCustomConfig(prev, globalVideoDownloadConfig),
                videoDownloadMaxDuration: parseInt(event.target.value, 10) || 0
              }))}
              placeholder="秒"
              className="field-control w-full px-3 py-2 text-right text-sm disabled:opacity-45 md:w-28"
            />
          }
        />

        <div className="flex justify-end py-4">
          <Button
            type="button"
            onClick={onResetVideoDownloadConfig}
            disabled={actionLoading.videoConfig}
            variant="ghost"
            size="sm"
          >
            {actionLoading.videoConfig ? '处理中…' : '重置为全局默认'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default VideoDownloadTab;

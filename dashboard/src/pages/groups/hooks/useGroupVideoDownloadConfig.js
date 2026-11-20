import { useCallback, useState } from 'react';
import api from '../../../utils/auth';

const DEFAULT_GLOBAL_VIDEO_DOWNLOAD_CONFIG = {
  videoDownloadEnabled: false,
  videoDownloadResolution: '1080p',
  videoDownloadMaxDuration: 600
};

const createDefaultVideoDownloadConfig = () => ({
  videoDownloadEnabled: null,
  videoDownloadResolution: null,
  videoDownloadMaxDuration: null
});

function isFollowingGlobal(config) {
  return (
    config.videoDownloadEnabled === null &&
    config.videoDownloadResolution === null &&
    config.videoDownloadMaxDuration === null
  );
}

function normalizeGlobalVideoDownloadConfig(config = {}) {
  return {
    videoDownloadEnabled: config.videoDownloadEnabled ?? DEFAULT_GLOBAL_VIDEO_DOWNLOAD_CONFIG.videoDownloadEnabled,
    videoDownloadResolution: config.videoDownloadResolution ?? DEFAULT_GLOBAL_VIDEO_DOWNLOAD_CONFIG.videoDownloadResolution,
    videoDownloadMaxDuration: config.videoDownloadMaxDuration ?? DEFAULT_GLOBAL_VIDEO_DOWNLOAD_CONFIG.videoDownloadMaxDuration
  };
}

function normalizeGroupVideoDownloadConfig(groupConfig, globalConfig) {
  if (isFollowingGlobal(groupConfig)) {
    return createDefaultVideoDownloadConfig();
  }

  const normalizedGlobalConfig = normalizeGlobalVideoDownloadConfig(globalConfig);
  return {
    videoDownloadEnabled: groupConfig.videoDownloadEnabled ?? normalizedGlobalConfig.videoDownloadEnabled,
    videoDownloadResolution: groupConfig.videoDownloadResolution ?? normalizedGlobalConfig.videoDownloadResolution,
    videoDownloadMaxDuration: groupConfig.videoDownloadMaxDuration ?? normalizedGlobalConfig.videoDownloadMaxDuration
  };
}

const useGroupVideoDownloadConfig = ({
  selectedGroupId,
  runLockedAction,
  show,
  requireExpectedGeneration,
  syncConfigGeneration
}) => {
  const [videoDownloadConfig, setVideoDownloadConfig] = useState(createDefaultVideoDownloadConfig());
  const [globalVideoDownloadConfig, setGlobalVideoDownloadConfig] = useState(DEFAULT_GLOBAL_VIDEO_DOWNLOAD_CONFIG);
  const [videoDownloadDirty, setVideoDownloadDirty] = useState(false);
  const [videoDownloadResetPending, setVideoDownloadResetPending] = useState(false);

  const updateVideoDownloadConfig = useCallback((updater) => {
    setVideoDownloadConfig((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      return next;
    });
    setVideoDownloadDirty(true);
    setVideoDownloadResetPending(false);
  }, []);

  const fetchVideoDownloadConfig = useCallback(async (groupId) => {
    try {
      const [resp, globalResp] = await Promise.all([
        api.get(`/api/groups/${groupId}/video-download-config`),
        api.get('/api/config').catch((globalError) => {
          console.warn('Failed to fetch global video download config, using defaults:', globalError);
          return { data: DEFAULT_GLOBAL_VIDEO_DOWNLOAD_CONFIG };
        })
      ]);
      const groupConfig = {
        ...createDefaultVideoDownloadConfig(),
        ...(resp.data || {})
      };
      const globalConfig = normalizeGlobalVideoDownloadConfig(globalResp.data);

      setGlobalVideoDownloadConfig(globalConfig);
      setVideoDownloadConfig(normalizeGroupVideoDownloadConfig(groupConfig, globalConfig));
      setVideoDownloadDirty(false);
      setVideoDownloadResetPending(false);
    } catch (error) {
      console.error('Failed to fetch video download config:', error);
    }
  }, []);

  const saveVideoDownloadConfig = useCallback(async () => {
    if (!videoDownloadDirty && !videoDownloadResetPending) {
      return true;
    }
    if (!selectedGroupId) {
      return false;
    }
    return runLockedAction('videoConfig', async () => {
      try {
        if (videoDownloadResetPending) {
          const response = await api.delete(`/api/groups/${selectedGroupId}/video-download-config`, {
            data: { expectedGeneration: requireExpectedGeneration() }
          });
          syncConfigGeneration(response.data);
        } else {
          const response = await api.put(`/api/groups/${selectedGroupId}/video-download-config`, {
            ...videoDownloadConfig,
            expectedGeneration: requireExpectedGeneration()
          });
          syncConfigGeneration(response.data);
        }
        setVideoDownloadDirty(false);
        setVideoDownloadResetPending(false);
        show('视频下载配置已更新', 'success');
        return true;
      } catch (error) {
        console.error('Failed to save video download config:', error);
        show('更新失败', 'error');
        return false;
      }
    });
  }, [runLockedAction, selectedGroupId, videoDownloadConfig, videoDownloadDirty, videoDownloadResetPending, show, requireExpectedGeneration, syncConfigGeneration]);

  const resetVideoDownloadConfig = useCallback(() => {
    setVideoDownloadConfig(createDefaultVideoDownloadConfig());
    setVideoDownloadDirty(false);
    setVideoDownloadResetPending(true);
    show('已设为跟随全局，保存后生效', 'success');
  }, [show]);

  const discardVideoDownloadChanges = useCallback(async () => {
    if (!selectedGroupId) return;
    await fetchVideoDownloadConfig(selectedGroupId);
  }, [selectedGroupId, fetchVideoDownloadConfig]);

  return {
    videoDownloadConfig,
    globalVideoDownloadConfig,
    setVideoDownloadConfig: updateVideoDownloadConfig,
    videoDownloadDirty,
    videoDownloadResetPending,
    fetchVideoDownloadConfig,
    saveVideoDownloadConfig,
    resetVideoDownloadConfig,
    discardVideoDownloadChanges
  };
};

export default useGroupVideoDownloadConfig;

import { createDefaultAtAllRules, normalizeAtAllRules } from './atAllRules';
import { createDefaultLabelConfig, mergeLabelConfig } from '../constants/labelConfig';

const createDefaultNightMode = () => ({
  mode: 'off',
  startTime: '21:00',
  endTime: '06:00'
});

export const createDefaultGroupFormData = () => ({
  linkCacheTimeout: 5,
  showId: true,
  labelConfig: createDefaultLabelConfig(),
  enableCookieSync: false,
  subscriptionAtAll: false,
  subscriptionAtAllRules: createDefaultAtAllRules(),
  cookieSyncGroupNames: [],
  blacklistedQQs: [],
  admins: [],
  nightMode: createDefaultNightMode(),
  douyinEnabled: null,
  douyinDownloadEnabled: null,
  xiaohongshuEnabled: null,
  douyinDownloadMaxDurationSeconds: null,
  douyinDownloadMaxFileSizeMB: null,
  xiaohongshuDownloadMaxDurationSeconds: null,
  xiaohongshuDownloadMaxFileSizeMB: null
});

const resolveCookieSyncGroupNames = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

export const mapGroupConfigToFormData = (config, globalShowId) => {
  const safeConfig = config || {};
  const labels = safeConfig.labelConfig || {};

  return {
    linkCacheTimeout: safeConfig.linkCacheTimeout ?? 5,
    showId: safeConfig.showId ?? globalShowId ?? true,
    labelConfig: mergeLabelConfig(labels),
    enableCookieSync: safeConfig.enableCookieSync ?? false,
    subscriptionAtAll: safeConfig.subscriptionAtAll ?? false,
    subscriptionAtAllRules: normalizeAtAllRules(safeConfig.subscriptionAtAllRules),
    cookieSyncGroupNames: resolveCookieSyncGroupNames(safeConfig.cookieSyncGroupNames),
    blacklistedQQs: Array.isArray(safeConfig.blacklistedQQs) ? safeConfig.blacklistedQQs : [],
    admins: Array.isArray(safeConfig.admins) ? safeConfig.admins : [],
    nightMode: safeConfig.nightMode || createDefaultNightMode(),
    // 外部平台字段：null = 跟随全局（键缺席），布尔值 / 整数 = 群级覆盖
    douyinEnabled: safeConfig.douyinEnabled ?? null,
    douyinDownloadEnabled: safeConfig.douyinDownloadEnabled ?? null,
    xiaohongshuEnabled: safeConfig.xiaohongshuEnabled ?? null,
    douyinDownloadMaxDurationSeconds: safeConfig.douyinDownloadMaxDurationSeconds ?? null,
    douyinDownloadMaxFileSizeMB: safeConfig.douyinDownloadMaxFileSizeMB ?? null,
    xiaohongshuDownloadMaxDurationSeconds: safeConfig.xiaohongshuDownloadMaxDurationSeconds ?? null,
    xiaohongshuDownloadMaxFileSizeMB: safeConfig.xiaohongshuDownloadMaxFileSizeMB ?? null
  };
};

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
  douyinEnabled: false,
  douyinDownloadEnabled: false,
  xiaohongshuEnabled: false
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
    douyinEnabled: safeConfig.douyinEnabled ?? false,
    douyinDownloadEnabled: safeConfig.douyinDownloadEnabled ?? false,
    xiaohongshuEnabled: safeConfig.xiaohongshuEnabled ?? false
  };
};

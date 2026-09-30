import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../utils/auth';
import { normalizeAtAllRules } from '../utils/atAllRules';
import { createDefaultGroupFormData, mapGroupConfigToFormData } from '../utils/groupForm';
import { validateNightMode } from '../utils/validators';

const DEFAULT_GLOBAL_CONFIG = {
  rootAdminQQ: undefined,
  showId: true,
  douyinEnabled: false,
  douyinDownloadEnabled: false,
  xiaohongshuEnabled: false,
  douyinDownloadMaxDurationSeconds: 120,
  douyinDownloadMaxFileSizeMB: 50,
  xiaohongshuDownloadMaxDurationSeconds: 120,
  xiaohongshuDownloadMaxFileSizeMB: 50
};

const useGroupForm = ({
  selectedGroupId,
  groups,
  setGroups,
  show,
  atAllTargets,
  requireExpectedGeneration,
  syncConfigGeneration
}) => {
  const [formData, setFormData] = useState(createDefaultGroupFormData());
  const [saving, setSaving] = useState(false);
  const [globalConfig, setGlobalConfig] = useState(DEFAULT_GLOBAL_CONFIG);
  const [globalConfigLoading, setGlobalConfigLoading] = useState(true);

  useEffect(() => {
    const fetchGlobalConfig = async () => {
      setGlobalConfigLoading(true);
      try {
        const res = await api.get('/api/config');
        if (res.data) {
          setGlobalConfig({
            rootAdminQQ: res.data.rootAdminQQ,
            showId: res.data.showId ?? true,
            douyinEnabled: res.data.douyinEnabled ?? false,
            douyinDownloadEnabled: res.data.douyinDownloadEnabled ?? false,
            xiaohongshuEnabled: res.data.xiaohongshuEnabled ?? false,
            douyinDownloadMaxDurationSeconds: res.data.douyinDownloadMaxDurationSeconds ?? 120,
            douyinDownloadMaxFileSizeMB: res.data.douyinDownloadMaxFileSizeMB ?? 50,
            xiaohongshuDownloadMaxDurationSeconds: res.data.xiaohongshuDownloadMaxDurationSeconds ?? 120,
            xiaohongshuDownloadMaxFileSizeMB: res.data.xiaohongshuDownloadMaxFileSizeMB ?? 50
          });
        }
      } catch (err) {
        console.error('Failed to fetch global config:', err);
      } finally {
        setGlobalConfigLoading(false);
      }
    };

    fetchGlobalConfig();
  }, []);

  useEffect(() => {
    if (!selectedGroupId) return;

    const group = groups.find((item) => item.id === selectedGroupId);
    if (!group) return;

    setFormData(mapGroupConfigToFormData(group.config || {}, globalConfig.showId));
  }, [selectedGroupId, groups, globalConfig.showId]);

  const handleSave = useCallback(async () => {
    if (!selectedGroupId) return false;

    const nightModeError = validateNightMode(formData.nightMode);
    if (nightModeError) {
      show(nightModeError, 'error');
      return false;
    }

    setSaving(true);
    try {
      const payload = {
        ...formData,
        cookieSyncGroupNames: formData.cookieSyncGroupNames
      };

      const response = await api.post(`/api/groups/${selectedGroupId}/config`, {
        ...payload,
        expectedGeneration: requireExpectedGeneration()
      });
      syncConfigGeneration(response.data);

      const res = await api.get('/api/groups');
      syncConfigGeneration(res.headers?.['x-config-generation']);
      if (Array.isArray(res.data)) {
        setGroups(res.data);
      }

      show('配置保存成功', 'success');
      return true;
    } catch (err) {
      console.error('Failed to save config', err);
      show('保存配置失败', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [selectedGroupId, formData, setGroups, show, requireExpectedGeneration, syncConfigGeneration]);

  const toggleSyncGroup = useCallback((groupName) => {
    setFormData((prev) => {
      const current = prev.cookieSyncGroupNames;
      if (current.includes(groupName)) {
        return { ...prev, cookieSyncGroupNames: current.filter((name) => name !== groupName) };
      }
      return { ...prev, cookieSyncGroupNames: [...current, groupName] };
    });
  }, []);

  const setAtAllRules = useCallback((updater) => {
    setFormData((prev) => {
      const currentRules = normalizeAtAllRules(prev.subscriptionAtAllRules);
      const nextRules = typeof updater === 'function' ? updater(currentRules) : updater;
      return {
        ...prev,
        subscriptionAtAllRules: normalizeAtAllRules(nextRules)
      };
    });
  }, []);

  const toggleAtAllSource = useCallback((sourceKey, enabled) => {
    setAtAllRules((rules) => ({
      ...rules,
      sources: {
        ...rules.sources,
        [sourceKey]: enabled
      }
    }));
  }, [setAtAllRules]);

  const toggleAtAllCategory = useCallback((categoryKey, enabled) => {
    setAtAllRules((rules) => ({
      ...rules,
      categories: {
        ...rules.categories,
        [categoryKey]: enabled
      }
    }));
  }, [setAtAllRules]);

  const setAllAtAllIdsEnabled = useCallback((sourceKey, enabled) => {
    const listKey = sourceKey === 'cookieSync' ? 'cookieSyncDisabledIds' : 'manualDisabledIds';
    const sourceUsers = sourceKey === 'cookieSync' ? atAllTargets.cookieUsers : atAllTargets.manualUsers;
    const allIds = sourceUsers
      .map((user) => String(user?.uid || '').trim())
      .filter((uid) => /^\d+$/.test(uid));

    setAtAllRules((rules) => {
      if (enabled) {
        return { ...rules, [listKey]: [] };
      }
      return { ...rules, [listKey]: Array.from(new Set(allIds)) };
    });
  }, [atAllTargets, setAtAllRules]);

  const toggleAtAllUser = useCallback((sourceKey, uid, enabled) => {
    const normalizedUid = String(uid || '').trim();
    if (!/^\d+$/.test(normalizedUid)) return;

    const listKey = sourceKey === 'cookieSync' ? 'cookieSyncDisabledIds' : 'manualDisabledIds';
    setAtAllRules((rules) => {
      const current = Array.isArray(rules[listKey]) ? [...rules[listKey]] : [];
      const exists = current.includes(normalizedUid);

      if (enabled && exists) {
        return { ...rules, [listKey]: current.filter((value) => value !== normalizedUid) };
      }
      if (!enabled && !exists) {
        current.push(normalizedUid);
      }

      return { ...rules, [listKey]: current };
    });
  }, [setAtAllRules]);

  const isAtAllUserEnabled = useCallback((sourceKey, uid) => {
    const normalizedUid = String(uid || '').trim();
    if (!/^\d+$/.test(normalizedUid)) return false;

    const rules = normalizeAtAllRules(formData.subscriptionAtAllRules);
    const disabled = sourceKey === 'cookieSync' ? rules.cookieSyncDisabledIds : rules.manualDisabledIds;
    return !disabled.includes(normalizedUid);
  }, [formData.subscriptionAtAllRules]);

  const isCookieUserInSelectedSyncGroups = useCallback((cookieUser) => {
    const selectedGroups = Array.isArray(formData.cookieSyncGroupNames) ? formData.cookieSyncGroupNames : [];
    if (selectedGroups.length === 0) return true;

    const userGroups = Array.isArray(cookieUser?.biliGroups) ? cookieUser.biliGroups : [];
    return selectedGroups.some((tag) => userGroups.includes(tag));
  }, [formData.cookieSyncGroupNames]);

  const atAllRules = useMemo(
    () => normalizeAtAllRules(formData.subscriptionAtAllRules),
    [formData.subscriptionAtAllRules]
  );

  return {
    formData,
    setFormData,
    saving,
    handleSave,
    globalConfig,
    globalConfigLoading,
    toggleSyncGroup,
    toggleAtAllSource,
    toggleAtAllCategory,
    setAllAtAllIdsEnabled,
    toggleAtAllUser,
    isAtAllUserEnabled,
    isCookieUserInSelectedSyncGroups,
    atAllRules
  };
};

export default useGroupForm;

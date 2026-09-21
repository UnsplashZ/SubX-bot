import React, { useEffect, useState } from 'react';
import GlassCard from '../components/GlassCard';
import ModernTabs from '../components/ModernTabs';
import { Button } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { Save, MessageSquare } from 'lucide-react';
import GroupListPanel from './groups/components/GroupListPanel';
import AddSubscriptionModal from './groups/components/AddSubscriptionModal';
import GeneralTab from './groups/components/tabs/GeneralTab';
import SubscriptionsTab from './groups/components/tabs/SubscriptionsTab';
import PermissionsTab from './groups/components/tabs/PermissionsTab';
import SyncTab from './groups/components/tabs/SyncTab';
import VideoDownloadTab from './groups/components/tabs/VideoDownloadTab';
import { AT_ALL_CATEGORY_ITEMS } from './groups/constants/atAll';
import { GROUP_TAB_CATEGORIES } from './groups/constants/tabs';
import useActionLock from './groups/hooks/useActionLock';
import useGroupList from './groups/hooks/useGroupList';
import useGroupSyncConfig from './groups/hooks/useGroupSyncConfig';
import useSubscriptions from './groups/hooks/useSubscriptions';
import useGroupForm from './groups/hooks/useGroupForm';
import useGroupPermissions from './groups/hooks/useGroupPermissions';
import useGroupVideoDownloadConfig from './groups/hooks/useGroupVideoDownloadConfig';

const SUB_TYPES = [
  { value: 'user', label: 'UP主' },
  { value: 'bangumi', label: '番剧' }
];

function Groups() {
  const { show } = useToast();
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);

  const { actionLoading, runLockedAction } = useActionLock();

  const {
    groups,
    setGroups,
    selectedGroupId,
    setSelectedGroupId,
    loading,
    handleToggleGroup,
    handleDeleteConfig,
    requireExpectedGeneration,
    syncConfigGeneration
  } = useGroupList({ show });

  const {
    biliGroups,
    biliGroupsLoading,
    atAllTargets,
    atAllTargetsLoading,
    globalBiliStatus,
    fetchBiliGroups,
    fetchAtAllTargets,
    checkGlobalBiliStatus
  } = useGroupSyncConfig();

  const {
    formData,
    setFormData,
    saving,
    handleSave,
    globalConfig,
    toggleSyncGroup,
    toggleAtAllSource,
    toggleAtAllCategory,
    setAllAtAllIdsEnabled,
    toggleAtAllUser,
    isAtAllUserEnabled,
    isCookieUserInSelectedSyncGroups,
    atAllRules
  } = useGroupForm({
    selectedGroupId,
    groups,
    setGroups,
    show,
    atAllTargets,
    requireExpectedGeneration,
    syncConfigGeneration
  });

  const {
    subscriptions,
    subsLoading,
    isSubModalOpen,
    setIsSubModalOpen,
    subForm,
    setSubForm,
    fetchSubscriptions,
    handleAddSubscription,
    handleDeleteSubscription
  } = useSubscriptions({
    selectedGroupId,
    show,
    refreshAtAllTargets: fetchAtAllTargets
  });

  const {
    blacklistInput,
    setBlacklistInput,
    adminInput,
    setAdminInput,
    handleAddBlacklist,
    handleRemoveBlacklist,
    handleAddAdmin,
    handleRemoveAdmin
  } = useGroupPermissions({
    selectedGroupId,
    groups,
    setGroups,
    formData,
    setFormData,
    runLockedAction,
    show,
    requireExpectedGeneration,
    syncConfigGeneration
  });

  const {
    videoDownloadConfig,
    globalVideoDownloadConfig,
    setVideoDownloadConfig,
    fetchVideoDownloadConfig,
    saveVideoDownloadConfig,
    videoDownloadDirty,
    videoDownloadResetPending,
    resetVideoDownloadConfig
  } = useGroupVideoDownloadConfig({
    selectedGroupId,
    runLockedAction,
    show,
    requireExpectedGeneration,
    syncConfigGeneration
  });

  const VIDEO_DOWNLOAD_TAB_INDEX = GROUP_TAB_CATEGORIES.findIndex((category) => category.name === '视频下载');

  const handleSaveAll = async () => {
    const configSaved = await handleSave();
    if (!configSaved) return;
    if (videoDownloadDirty || videoDownloadResetPending) {
      await saveVideoDownloadConfig();
    }
  };

  useEffect(() => {
    if (!selectedGroupId) return;

    if (selectedTabIndex === 1) {
      fetchSubscriptions(selectedGroupId);
    }
    if (GROUP_TAB_CATEGORIES[selectedTabIndex]?.name === '关注同步') {
      fetchBiliGroups(selectedGroupId);
      fetchAtAllTargets(selectedGroupId);
      checkGlobalBiliStatus();
    }
    if (selectedTabIndex === VIDEO_DOWNLOAD_TAB_INDEX) {
      fetchVideoDownloadConfig(selectedGroupId);
    }
  }, [
    selectedTabIndex,
    selectedGroupId,
    groups,
    fetchSubscriptions,
    fetchBiliGroups,
    fetchAtAllTargets,
    checkGlobalBiliStatus,
    fetchVideoDownloadConfig,
    VIDEO_DOWNLOAD_TAB_INDEX
  ]);

  return (
    <div className="admin-page space-y-4 md:space-y-6">
      <header>
        <div className="font-mono text-xs font-semibold uppercase text-[var(--accent)]">Configure</div>
        <h1 className="mt-1 text-3xl font-semibold text-[var(--fg)]">群组管理</h1>
        <p className="mt-1.5 text-xs text-[var(--muted)]">管理群组配置、订阅、权限与同步策略。</p>
      </header>

      <div className="flex flex-col lg:flex-row gap-3 sm:gap-4 md:gap-6 lg:h-[calc(100vh-9rem)]">
        <GroupListPanel
          groups={groups}
          loading={loading}
          selectedGroupId={selectedGroupId}
          onSelectGroup={setSelectedGroupId}
          onToggleGroup={handleToggleGroup}
          onDeleteConfig={handleDeleteConfig}
        />

        <div className="w-full lg:w-2/3 flex flex-col">
          {selectedGroupId ? (
            <GlassCard className="flex flex-1 flex-col overflow-hidden p-0">
              <div className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-[var(--fg)]">
                    {groups.find((group) => group.id === selectedGroupId)?.name || '群组设置'}
                  </h2>
                  <div className="mt-1 text-xs text-[var(--muted)]">ID: {selectedGroupId}</div>
                </div>
                <Button
                  onClick={handleSaveAll}
                  disabled={saving || actionLoading.videoConfig}
                  variant="primary"
                  icon={Save}
                  className="w-full sm:w-auto"
                >
                  {saving || actionLoading.videoConfig ? '保存中...' : '保存更改'}
                </Button>
              </div>
              <ModernTabs
                tabs={GROUP_TAB_CATEGORIES}
                selectedIndex={selectedTabIndex}
                onChange={setSelectedTabIndex}
              >
                <GeneralTab formData={formData} setFormData={setFormData} />
                <SubscriptionsTab
                  subsLoading={subsLoading}
                  subscriptions={subscriptions}
                  subTypes={SUB_TYPES}
                  onOpenAddModal={() => setIsSubModalOpen(true)}
                  onDeleteSubscription={handleDeleteSubscription}
                />
                <PermissionsTab
                  globalConfig={globalConfig}
                  adminInput={adminInput}
                  setAdminInput={setAdminInput}
                  onAddAdmin={handleAddAdmin}
                  onRemoveAdmin={handleRemoveAdmin}
                  blacklistInput={blacklistInput}
                  setBlacklistInput={setBlacklistInput}
                  onAddBlacklist={handleAddBlacklist}
                  onRemoveBlacklist={handleRemoveBlacklist}
                  formData={formData}
                  actionLoading={actionLoading}
                />
                <SyncTab
                  formData={formData}
                  setFormData={setFormData}
                  atAllRules={atAllRules}
                  atAllCategoryItems={AT_ALL_CATEGORY_ITEMS}
                  toggleAtAllSource={toggleAtAllSource}
                  toggleAtAllCategory={toggleAtAllCategory}
                  setAllAtAllIdsEnabled={setAllAtAllIdsEnabled}
                  atAllTargetsLoading={atAllTargetsLoading}
                  atAllTargets={atAllTargets}
                  isAtAllUserEnabled={isAtAllUserEnabled}
                  toggleAtAllUser={toggleAtAllUser}
                  isCookieUserInSelectedSyncGroups={isCookieUserInSelectedSyncGroups}
                  globalBiliStatus={globalBiliStatus}
                  biliGroupsLoading={biliGroupsLoading}
                  biliGroups={biliGroups}
                  toggleSyncGroup={toggleSyncGroup}
                />
                <VideoDownloadTab
                  videoDownloadConfig={videoDownloadConfig}
                  globalVideoDownloadConfig={globalVideoDownloadConfig}
                  setVideoDownloadConfig={setVideoDownloadConfig}
                  actionLoading={actionLoading}
                  onResetVideoDownloadConfig={resetVideoDownloadConfig}
                />
              </ModernTabs>
            </GlassCard>
          ) : (
            <GlassCard className="flex-1 flex flex-col items-center justify-center text-center text-[var(--muted)]">
              <MessageSquare size={48} className="mb-4 opacity-50" />
              <h3 className="mb-2 text-xl font-medium text-[var(--fg)]">选择一个群组</h3>
              <p className="text-[var(--muted)]">从列表中选择一个群组以查看和编辑其配置。</p>
            </GlassCard>
          )}
        </div>
      </div>

      <AddSubscriptionModal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        subForm={subForm}
        setSubForm={setSubForm}
        subTypes={SUB_TYPES}
        onAddSubscription={handleAddSubscription}
      />
    </div>
  );
}

export default Groups;

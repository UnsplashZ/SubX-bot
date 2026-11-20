import React, { useEffect, useRef, useState } from 'react';
import GlassCard from '../components/GlassCard';
import ModernTabs from '../components/ModernTabs';
import { Button } from '../components/ui';
import { useToast } from '../hooks/useToast';
import { Save, MessageSquare } from 'lucide-react';
import GroupListPanel from './groups/components/GroupListPanel';
import UnsavedChangesDialog from './groups/components/UnsavedChangesDialog';
import AddSubscriptionModal from './groups/components/AddSubscriptionModal';
import GeneralTab from './groups/components/tabs/GeneralTab';
import SubscriptionsTab from './groups/components/tabs/SubscriptionsTab';
import PermissionsTab from './groups/components/tabs/PermissionsTab';
import SyncTab from './groups/components/tabs/SyncTab';
import VideoDownloadTab from './groups/components/tabs/VideoDownloadTab';
import ExternalParserTab from './groups/components/tabs/ExternalParserTab';
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
  const [pendingGroupId, setPendingGroupId] = useState(null);
  const editorRef = useRef(null);

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
    isDirty,
    discardChanges,
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
    resetVideoDownloadConfig,
    discardVideoDownloadChanges
  } = useGroupVideoDownloadConfig({
    selectedGroupId,
    runLockedAction,
    show,
    requireExpectedGeneration,
    syncConfigGeneration
  });

  const VIDEO_DOWNLOAD_TAB_INDEX = GROUP_TAB_CATEGORIES.findIndex((category) => category.name === '视频下载');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);
  const hasPendingChanges = isDirty || videoDownloadDirty || videoDownloadResetPending;
  const savePending = saving || actionLoading.videoConfig;

  const handleSaveAll = async () => {
    if (isDirty) {
      const configSaved = await handleSave();
      if (!configSaved) return false;
    }
    if (videoDownloadDirty || videoDownloadResetPending) {
      const videoSaved = await saveVideoDownloadConfig();
      if (videoSaved === false) return false;
    }
    return true;
  };

  const requestSelectGroup = (groupId) => {
    if (groupId === selectedGroupId) return;
    if (isDirty || videoDownloadDirty || videoDownloadResetPending) {
      setPendingGroupId(groupId);
      return;
    }
    setSelectedGroupId(groupId);
  };

  const handleDiscardAndSwitch = async () => {
    if (!pendingGroupId) return;
    discardChanges();
    if (videoDownloadDirty || videoDownloadResetPending) {
      await discardVideoDownloadChanges();
    }
    setSelectedGroupId(pendingGroupId);
    setPendingGroupId(null);
  };

  const handleSaveAndSwitch = async () => {
    if (!pendingGroupId) return;
    const saved = await handleSaveAll();
    if (!saved) return;
    setSelectedGroupId(pendingGroupId);
    setPendingGroupId(null);
  };

  useEffect(() => {
    if (!selectedGroupId || !editorRef.current) return;
    if (window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() => {
        editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }, [selectedGroupId]);

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
    <div className="admin-page space-y-6">
      <header>
        <h1 className="text-3xl font-semibold text-[var(--fg)]">群组管理</h1>
        <p className="mt-1.5 text-sm text-[var(--muted)]">管理群组配置、订阅、权限与同步策略。</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <GroupListPanel
          groups={groups}
          loading={loading}
          selectedGroupId={selectedGroupId}
          onSelectGroup={requestSelectGroup}
          onToggleGroup={handleToggleGroup}
          onDeleteConfig={handleDeleteConfig}
        />

        <div ref={editorRef} className="min-w-0 scroll-mt-40 lg:scroll-mt-24">
          {selectedGroupId ? (
            <section className="min-w-0" aria-label={selectedGroup?.name ? `${selectedGroup.name} 设置` : '群组设置'}>
              <GlassCard className="overflow-hidden p-0">
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
                  <ExternalParserTab formData={formData} setFormData={setFormData} globalConfig={globalConfig} />
                </ModernTabs>
                <div className="flex justify-end border-t border-[var(--border-subtle)] bg-[var(--surface)] px-4 py-3 sm:px-5">
                  <Button
                    onClick={handleSaveAll}
                    disabled={savePending || !hasPendingChanges}
                    variant="primary"
                    icon={Save}
                    className="w-full sm:w-auto"
                  >
                    {savePending ? '保存中...' : hasPendingChanges ? '保存更改' : '已保存'}
                  </Button>
                </div>
              </GlassCard>
            </section>
          ) : (
            <section className="min-w-0" aria-label="群组配置">
              <GlassCard className="flex min-h-[360px] flex-col items-center justify-center text-center text-[var(--muted)]">
                <MessageSquare size={48} className="mb-4 opacity-50" aria-hidden="true" />
                <h3 className="mb-2 text-xl font-medium text-[var(--fg)]">选择一个群组</h3>
                <p className="text-[var(--muted)]">从列表中选择一个群组以查看和编辑其配置。</p>
              </GlassCard>
            </section>
          )}
        </div>
      </div>

      <UnsavedChangesDialog
        open={Boolean(pendingGroupId)}
        groupName={selectedGroup?.name}
        saving={savePending}
        onCancel={() => setPendingGroupId(null)}
        onDiscard={handleDiscardAndSwitch}
        onSaveAndSwitch={handleSaveAndSwitch}
      />

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

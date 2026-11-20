import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ToggleSwitch } from '../../../../components/ui';
import { EmptyLine, QuietButton, SettingsSection } from './settingsPrimitives';

const ToggleRow = ({ title, description, checked, disabled = false, onChange }) => (
  <div className={clsx('flex items-start justify-between gap-4 py-3.5', disabled && 'opacity-45')}>
    <div className="min-w-0 max-w-2xl">
      <div className="text-sm font-medium text-[var(--fg)]">{title}</div>
      {description && <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{description}</p>}
    </div>
    <ToggleSwitch tone="neutral" checked={!!checked} disabled={disabled} onChange={onChange} label={title} />
  </div>
);

const ToggleLine = ({ title, meta, checked, disabled = false, onChange, className }) => (
  <div className={clsx('flex min-h-10 items-center justify-between gap-3 py-2', disabled && 'opacity-45', className)}>
    <div className="min-w-0">
      <div className="break-words text-sm text-[var(--fg)]">{title}</div>
      {meta && <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--muted)]">{meta}</div>}
    </div>
    <ToggleSwitch tone="neutral" checked={!!checked} disabled={disabled} onChange={onChange} label={title} />
  </div>
);

const UserList = ({ title, users = [], loading, emptyText, isEnabled, onToggle, onToggleAll, disabled, renderTitle }) => (
  <SettingsSection
    title={title}
    meta={`${users.length} 人`}
    action={
      <div className="flex items-center gap-1">
        <QuietButton onClick={() => onToggleAll(true)} disabled={disabled}>全部开启</QuietButton>
        <QuietButton onClick={() => onToggleAll(false)} disabled={disabled}>全部关闭</QuietButton>
      </div>
    }
  >
    {loading ? (
      <div className="flex items-center gap-2 py-3 text-sm text-[var(--muted)]">
        <Loader2 size={14} className="animate-spin" />
        正在加载 UID 列表…
      </div>
    ) : users.length === 0 ? (
      <EmptyLine>{emptyText}</EmptyLine>
    ) : (
      <div className="grid gap-x-8 sm:grid-cols-2">
        {users.map((user) => (
          <ToggleLine
            key={user.uid}
            className="border-b border-[var(--border-subtle)]"
            title={renderTitle ? renderTitle(user) : user.name}
            meta={`UID ${user.uid}`}
            checked={isEnabled(user.uid)}
            disabled={disabled}
            onChange={(checked) => onToggle(user.uid, checked)}
          />
        ))}
      </div>
    )}
  </SettingsSection>
);

const SyncTab = ({
  formData,
  setFormData,
  atAllRules,
  atAllCategoryItems,
  toggleAtAllSource,
  toggleAtAllCategory,
  setAllAtAllIdsEnabled,
  atAllTargetsLoading,
  atAllTargets,
  isAtAllUserEnabled,
  toggleAtAllUser,
  isCookieUserInSelectedSyncGroups,
  globalBiliStatus,
  biliGroupsLoading,
  biliGroups,
  toggleSyncGroup
}) => {
  const subscriptionAtAllEnabled = !!formData.subscriptionAtAll;
  const cookieSyncEnabled = !!formData.enableCookieSync;
  const selectedSyncGroupCount = formData.cookieSyncGroupNames?.length || 0;

  return (
    <div className="divide-y divide-[var(--border-subtle)] focus:outline-none">
      <div className="py-4 first:pt-1">
        <ToggleRow
          title="订阅推送 @全体成员"
          description="开启后，订阅与关注同步推送会附带 @全体成员，需机器人具备权限。"
          checked={subscriptionAtAllEnabled}
          onChange={(checked) => setFormData({ ...formData, subscriptionAtAll: checked })}
        />
      </div>

      <div className={clsx('py-5', !subscriptionAtAllEnabled && 'opacity-45')}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--fg)]">细粒度规则</h3>
          <span className="text-[11px] text-[var(--muted)]">仅作用于订阅推送</span>
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          总开关、来源、分类与该来源下的 UID 开关需要同时开启，才会命中 @全体。
        </p>
        <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">
          收藏夹、音频、话题、文集等链接解析卡片不在此范围内。
        </p>

        <div className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <section>
            <h4 className="text-xs font-medium text-[var(--muted)]">来源</h4>
            <div className="mt-1 divide-y divide-[var(--border-subtle)]">
              <ToggleLine
                title="手动订阅"
                checked={!!atAllRules.sources.manual}
                disabled={!subscriptionAtAllEnabled}
                onChange={(checked) => toggleAtAllSource('manual', checked)}
              />
              <ToggleLine
                title="关注同步"
                checked={!!atAllRules.sources.cookieSync}
                disabled={!subscriptionAtAllEnabled}
                onChange={(checked) => toggleAtAllSource('cookieSync', checked)}
              />
            </div>
          </section>

          <section>
            <h4 className="text-xs font-medium text-[var(--muted)]">分类</h4>
            <div className="mt-1 grid grid-cols-1 gap-x-6 xl:grid-cols-2">
              {atAllCategoryItems.map((item) => (
                <ToggleLine
                  key={item.key}
                  className="border-b border-[var(--border-subtle)]"
                  title={item.label}
                  checked={!!atAllRules.categories[item.key]}
                  disabled={!subscriptionAtAllEnabled}
                  onChange={(checked) => toggleAtAllCategory(item.key, checked)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>

      <UserList
        title="手动订阅用户"
        users={atAllTargets.manualUsers}
        loading={atAllTargetsLoading}
        emptyText="暂无手动订阅用户"
        disabled={!subscriptionAtAllEnabled}
        isEnabled={(uid) => isAtAllUserEnabled('manual', uid)}
        onToggle={(uid, checked) => toggleAtAllUser('manual', uid, checked)}
        onToggleAll={(enabled) => setAllAtAllIdsEnabled('manual', enabled)}
      />

      <UserList
        title="关注同步用户"
        users={atAllTargets.cookieUsers}
        loading={atAllTargetsLoading}
        emptyText="暂无关注同步用户"
        disabled={!subscriptionAtAllEnabled}
        isEnabled={(uid) => isAtAllUserEnabled('cookieSync', uid)}
        onToggle={(uid, checked) => toggleAtAllUser('cookieSync', uid, checked)}
        onToggleAll={(enabled) => setAllAtAllIdsEnabled('cookieSync', enabled)}
        renderTitle={(user) => `${user.name}${isCookieUserInSelectedSyncGroups(user) ? ' · 命中同步分组' : ' · 不在当前同步分组'}`}
      />

      {!globalBiliStatus.isLoggedIn && (
        <div className="py-5">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--fg)]">未检测到全局 B 站登录</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              关注列表同步需要先在系统设置中登录 B 站账号。
            </p>
            <Link
              to="/settings"
              className="mt-2 inline-flex text-xs font-medium text-[var(--fg)] underline decoration-[var(--border)] underline-offset-4 transition-colors hover:decoration-[var(--fg)]"
            >
              前往系统设置
            </Link>
          </div>
        </div>
      )}

      {globalBiliStatus.isLoggedIn && (
        <div className="py-5">
          <div className="mb-1 flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--success)]" aria-hidden="true" />
            <span className="break-all">
              已连接 {globalBiliStatus.username}，UID {globalBiliStatus.uid}
            </span>
          </div>

          <ToggleRow
            title="启用关注列表同步"
            description="自动同步所选分组的 UP 主更新。"
            checked={cookieSyncEnabled}
            onChange={(checked) => setFormData({ ...formData, enableCookieSync: checked })}
          />

          <div className={clsx('pt-3', !cookieSyncEnabled && 'pointer-events-none opacity-45')}>
            <div className="flex items-baseline justify-between gap-3">
              <h4 className="text-sm font-medium text-[var(--fg)]">选择要同步的关注分组</h4>
              <span className="font-mono text-[11px] text-[var(--muted)]">
                已选 {selectedSyncGroupCount}
              </span>
            </div>

            {biliGroupsLoading ? (
              <div className="mt-3 flex items-center gap-2 text-sm text-[var(--muted)]">
                <Loader2 size={16} className="animate-spin" />
                正在获取分组…
              </div>
            ) : biliGroups.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">当前账号没有可用的关注分组。</p>
            ) : (
              <div className="mt-1 grid gap-x-8 sm:grid-cols-2">
                {biliGroups.map((group) => {
                  const groupName = typeof group === 'string' ? group : group.name;
                  return (
                    <ToggleLine
                      key={groupName}
                      className="border-b border-[var(--border-subtle)]"
                      title={groupName}
                      checked={formData.cookieSyncGroupNames?.includes(groupName)}
                      onChange={() => toggleSyncGroup(groupName)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SyncTab;

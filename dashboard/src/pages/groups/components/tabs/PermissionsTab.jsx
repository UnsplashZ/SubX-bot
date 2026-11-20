import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { EmptyLine, SettingsSection } from './settingsPrimitives';

const PermissionsTab = ({
  globalConfig,
  adminInput,
  setAdminInput,
  onAddAdmin,
  onRemoveAdmin,
  blacklistInput,
  setBlacklistInput,
  onAddBlacklist,
  onRemoveBlacklist,
  formData,
  actionLoading
}) => {
  const adminCount = formData.admins?.length || 0;
  const blacklistCount = formData.blacklistedQQs?.length || 0;

  return (
    <div className="divide-y divide-[var(--border-subtle)] focus:outline-none">
      <SettingsSection
        title="群组管理员"
        meta={`${adminCount} 人`}
        description={
          globalConfig.rootAdminQQ
            ? `群组管理员可以使用所有机器人指令，不受其他限制。根管理员为 ${globalConfig.rootAdminQQ}。`
            : '群组管理员可以使用所有机器人指令，不受其他限制。'
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            placeholder="QQ 号或 OpenID"
            aria-label="添加群管理员 QQ 号或 OpenID"
            value={adminInput}
            onChange={(e) => setAdminInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onAddAdmin()}
            className="field-control min-w-0 flex-1 px-3 py-2 text-sm"
          />
          <Button
            onClick={onAddAdmin}
            disabled={!adminInput || actionLoading.admins}
            variant="secondary"
            className="sm:w-auto"
          >
            添加管理员
          </Button>
        </div>

        {adminCount > 0 ? (
          <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
            {formData.admins.map((qq) => (
              <li key={qq} className="flex min-h-11 items-center justify-between gap-3">
                <span className="font-mono text-sm text-[var(--fg)]">{qq}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAdmin(qq)}
                  disabled={actionLoading.admins}
                  aria-label={`移除管理员 ${qq}`}
                  className="rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-quiet)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>暂无管理员</EmptyLine>
        )}
      </SettingsSection>

      <SettingsSection
        title="黑名单"
        meta={`${blacklistCount} 人`}
        description="黑名单中的用户不会触发链接解析与命令响应。"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            placeholder="QQ 号或 OpenID"
            aria-label="添加群黑名单 QQ 号或 OpenID"
            value={blacklistInput}
            onChange={(e) => setBlacklistInput(e.target.value)}
            className="field-control min-w-0 flex-1 px-3 py-2 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && onAddBlacklist()}
          />
          <Button
            onClick={onAddBlacklist}
            disabled={!blacklistInput || actionLoading.blacklist}
            variant="secondary"
            icon={Plus}
            className="sm:w-auto"
          >
            加入黑名单
          </Button>
        </div>

        {blacklistCount > 0 ? (
          <ul className="mt-2 divide-y divide-[var(--border-subtle)]">
            {formData.blacklistedQQs.map((qq) => (
              <li key={qq} className="flex min-h-11 items-center justify-between gap-3">
                <span className="font-mono text-sm text-[var(--fg)]">{qq}</span>
                <button
                  type="button"
                  onClick={() => onRemoveBlacklist(qq)}
                  disabled={actionLoading.blacklist}
                  className="rounded px-1.5 py-1 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-quiet)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyLine>无黑名单记录</EmptyLine>
        )}
      </SettingsSection>
    </div>
  );
};

export default PermissionsTab;

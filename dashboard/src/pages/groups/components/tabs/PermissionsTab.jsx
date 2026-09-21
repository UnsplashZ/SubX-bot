import { Ban, Plus, Shield, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui';

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
  return (
    <div className="focus:outline-none">
      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--accent)]" />
            <h3 className="text-lg font-semibold text-[var(--fg)]">群组管理员</h3>
          </div>

          <div className="rounded-lg border border-[color-mix(in_oklch,var(--accent)_26%,var(--border-subtle))] bg-[var(--accent-soft)] p-4">
            <p className="text-sm text-[var(--muted)]">
              群组管理员可以使用所有机器人指令，不受其他限制。
              {globalConfig.rootAdminQQ && (
                <span className="block mt-2 text-[var(--accent-muted)]">
                  根管理员: {globalConfig.rootAdminQQ}
                </span>
              )}
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入 QQ 号或 OpenID..."
              value={adminInput}
              onChange={(e) => setAdminInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAddAdmin()}
              className="field-control flex-1 px-3 py-2"
            />
            <Button
              onClick={onAddAdmin}
              disabled={!adminInput || actionLoading.admins}
              variant="primary"
            >
              添加
            </Button>
          </div>

          <div className="space-y-2">
            {formData.admins && formData.admins.length > 0 ? (
              formData.admins.map((qq) => (
                <div key={qq} className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)] p-3">
                  <div className="flex items-center gap-3">
                    <Shield className="w-5 h-5 text-[var(--accent-muted)]" />
                    <span className="font-mono text-[var(--fg)]">{qq}</span>
                  </div>
                  <button
                    onClick={() => onRemoveAdmin(qq)}
                    disabled={actionLoading.admins}
                    className="text-[var(--muted)] transition-colors hover:text-[var(--danger)] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center text-[var(--muted)] py-4">
                暂无管理员
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 pt-6 border-t border-[var(--border-subtle)]">
          <div className="flex items-center gap-2">
            <Ban className="w-5 h-5 text-[var(--danger)]" />
            <h3 className="text-lg font-semibold text-[var(--fg)]">黑名单</h3>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="输入 QQ 号或 OpenID..."
              value={blacklistInput}
              onChange={(e) => setBlacklistInput(e.target.value)}
              className="field-control flex-1 px-3 py-2"
              onKeyDown={(e) => e.key === 'Enter' && onAddBlacklist()}
            />
            <Button
              onClick={onAddBlacklist}
              disabled={!blacklistInput || actionLoading.blacklist}
              variant="danger"
              icon={Plus}
            >
              添加黑名单
            </Button>
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)]">
            <div className="p-3 bg-[var(--surface-quiet)] text-sm font-medium text-[var(--muted)]">已拉黑 QQ 用户 ({formData.blacklistedQQs.length})</div>
            {formData.blacklistedQQs.length === 0 ? (
              <div className="p-8 text-center text-[var(--muted)]">无黑名单记录</div>
            ) : (
              <ul className="divide-y divide-[var(--border-subtle)]">
                {formData.blacklistedQQs.map((qq) => (
                  <li key={qq} className="flex justify-between items-center p-3 transition-colors hover:bg-[var(--surface-hover)]">
                    <span className="font-mono text-[var(--fg)]">{qq}</span>
                    <button
                      onClick={() => onRemoveBlacklist(qq)}
                      disabled={actionLoading.blacklist}
                      className="rounded px-2 py-1 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--danger)] flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PermissionsTab;

import { Power, Trash2, MessageSquare } from 'lucide-react';
import { clsx } from 'clsx';
import GlassCard from '../../../components/GlassCard';

const GroupListPanel = ({
  groups,
  loading,
  selectedGroupId,
  onSelectGroup,
  onToggleGroup,
  onDeleteConfig
}) => {
  return (
    <GlassCard className="flex max-h-[38vh] w-full flex-col overflow-hidden p-0 sm:max-h-[45vh] lg:max-h-none lg:w-1/3 lg:border-r lg:pr-5">
      <div className="border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <MessageSquare size={18} />
          群组 ({groups.length})
        </h2>
      </div>
      <div className="min-h-0 flex-1 space-y-0 overflow-y-auto py-2">
        {loading ? (
          <div className="text-center p-4 text-[var(--muted)]">加载中...</div>
        ) : groups.length === 0 ? (
          <div className="text-center p-4 text-[var(--muted)]">未找到群组</div>
        ) : (
          groups.map((group) => (
            <div
              key={group.id}
              onClick={() => onSelectGroup(group.id)}
              className={clsx(
                'relative flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-3 transition-colors last:border-b-0 sm:gap-3 sm:px-4',
                'hover:bg-[var(--surface-quiet)]',
                selectedGroupId === group.id
                  ? 'bg-[var(--accent-soft)]'
                  : 'bg-transparent',
                !group.isEnabled && 'opacity-50',
                !group.isInGroup && 'opacity-60 grayscale'
              )}
            >
              {group.isInGroup ? (
                <button
                  type="button"
                  onClick={(e) => onToggleGroup(e, group)}
                  className="p-1 rounded-lg transition-colors hover:bg-[var(--surface-hover)]"
                  title={group.isEnabled ? '禁用群组' : '启用群组'}
                >
                  <Power
                    className={clsx(
                      'w-4 h-4',
                      group.isEnabled
                        ? 'text-[color-mix(in_oklch,var(--success)_85%,var(--fg))]'
                        : 'text-[var(--muted)]'
                    )}
                  />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={(e) => onDeleteConfig(e, group)}
                  className="p-1 rounded-lg transition-colors hover:bg-[var(--danger-soft)]"
                  title="删除配置"
                >
                  <Trash2 className="w-4 h-4 text-[color-mix(in_oklch,var(--danger)_85%,var(--fg))]" />
                </button>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate font-medium text-[var(--fg)]">{group.name || `Group ${group.id}`}</div>
                  {!group.isInGroup && (
                    <span className="shrink-0 text-xs font-medium text-[color-mix(in_oklch,var(--danger)_85%,var(--fg))]">
                      已退群
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--muted)]">ID: {group.id}</div>
              </div>
              {group.isInGroup && !group.isEnabled && (
                <span className="text-xs text-[var(--muted)]">
                  已禁用
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </GlassCard>
  );
};

export default GroupListPanel;

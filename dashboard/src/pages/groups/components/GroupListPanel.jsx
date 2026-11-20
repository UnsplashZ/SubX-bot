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
          <MessageSquare size={18} aria-hidden="true" />
          群组 ({groups.length})
        </h2>
      </div>
      <div role="list" className="min-h-0 flex-1 space-y-0 overflow-y-auto py-2">
        {loading ? (
          <div role="status" className="p-4 text-center text-[var(--muted)]">加载中...</div>
        ) : groups.length === 0 ? (
          <div role="status" className="p-4 text-center text-[var(--muted)]">未找到群组</div>
        ) : (
          groups.map((group) => {
            const active = selectedGroupId === group.id;
            return (
              <div
                key={group.id}
                role="listitem"
                className={clsx(
                  'flex items-center gap-2.5 border-b border-[var(--border-subtle)] px-3 py-2 transition-colors last:border-b-0 sm:gap-3 sm:px-4',
                  active ? 'bg-[var(--accent-soft)]' : 'bg-transparent hover:bg-[var(--surface-quiet)]',
                  !group.isEnabled && 'opacity-60',
                  !group.isInGroup && 'opacity-60 grayscale'
                )}
              >
                {group.isInGroup ? (
                  <button
                    type="button"
                    onClick={(event) => onToggleGroup(event, group)}
                    className="flex min-h-11 min-w-11 items-center justify-center md:min-h-9 md:min-w-9 rounded-lg p-1.5 transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    aria-label={group.isEnabled ? `禁用群组 ${group.name || group.id}` : `启用群组 ${group.name || group.id}`}
                    title={group.isEnabled ? '禁用群组' : '启用群组'}
                  >
                    <Power
                      aria-hidden="true"
                      className={clsx(
                        'h-4 w-4',
                        group.isEnabled
                          ? 'text-[color-mix(in_oklch,var(--success)_85%,var(--fg))]'
                          : 'text-[var(--muted)]'
                      )}
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={(event) => onDeleteConfig(event, group)}
                    className="flex min-h-11 min-w-11 items-center justify-center md:min-h-9 md:min-w-9 rounded-lg p-1.5 transition-colors hover:bg-[var(--danger-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)]"
                    aria-label={`删除已退群群组 ${group.name || group.id} 的配置`}
                    title="删除配置"
                  >
                    <Trash2 aria-hidden="true" className="h-4 w-4 text-[color-mix(in_oklch,var(--danger)_85%,var(--fg))]" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => onSelectGroup(group.id)}
                  aria-current={active ? 'true' : undefined}
                  className="min-w-0 flex-1 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium text-[var(--fg)]">{group.name || `Group ${group.id}`}</span>
                    {!group.isInGroup && (
                      <span className="shrink-0 text-xs font-medium text-[color-mix(in_oklch,var(--danger)_85%,var(--fg))]">
                        已退群
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--muted)]">ID: {group.id}</span>
                </button>

                {group.isInGroup && !group.isEnabled && (
                  <span className="shrink-0 text-xs text-[var(--muted)]">已禁用</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </GlassCard>
  );
};

export default GroupListPanel;

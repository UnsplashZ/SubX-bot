import { Power, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';

const GroupListPanel = ({
  groups,
  loading,
  selectedGroupId,
  onSelectGroup,
  onToggleGroup,
  onDeleteConfig
}) => {
  return (
    <nav
      aria-label="群组列表"
      className="sticky top-14 z-20 -mx-3 flex gap-1 overflow-x-auto border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 md:top-0 lg:top-8 lg:mx-0 lg:block lg:max-h-[calc(100dvh-4rem)] lg:space-y-0.5 lg:overflow-y-auto lg:border-0 lg:bg-transparent lg:px-0 lg:py-0"
    >
      {loading ? (
        <div role="status" className="shrink-0 px-3 py-4 text-sm text-[var(--muted)]">
          加载中...
        </div>
      ) : groups.length === 0 ? (
        <div role="status" className="shrink-0 px-3 py-4 text-sm text-[var(--muted)]">
          未找到群组
        </div>
      ) : (
        groups.map((group) => {
          const active = selectedGroupId === group.id;
          return (
            <div
              key={group.id}
              className={clsx(
                'flex w-[200px] shrink-0 items-center rounded-md transition-colors lg:w-full',
                active ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-quiet)]',
                !group.isEnabled && 'opacity-75',
                !group.isInGroup && 'opacity-75'
              )}
            >
              <button
                type="button"
                onClick={() => onSelectGroup(group.id)}
                aria-current={active ? 'page' : undefined}
                className="min-w-0 flex-1 rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span
                  className={clsx(
                    'block truncate text-sm',
                    active
                      ? 'font-semibold text-[var(--accent-muted)]'
                      : 'font-medium text-[var(--fg)]'
                  )}
                >
                  {group.name || `Group ${group.id}`}
                </span>
                <span
                  className={clsx(
                    'mt-0.5 flex items-center gap-2 text-xs',
                    active ? 'text-[var(--accent-muted)]' : 'text-[var(--muted)]'
                  )}
                >
                  <span className="whitespace-nowrap">ID: {group.id}</span>
                  {!group.isInGroup && (
                    <span className="shrink-0 font-medium text-[color-mix(in_oklch,var(--danger)_85%,var(--fg))]">
                      已退群
                    </span>
                  )}
                  {group.isInGroup && !group.isEnabled && (
                    <span className="shrink-0">已禁用</span>
                  )}
                </span>
              </button>

              {group.isInGroup ? (
                <button
                  type="button"
                  onClick={(event) => onToggleGroup(event, group)}
                  className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] lg:h-8 lg:w-8"
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
                  className="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--danger-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger)] lg:h-8 lg:w-8"
                  aria-label={`删除已退群群组 ${group.name || group.id} 的配置`}
                  title="删除配置"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4 text-[color-mix(in_oklch,var(--danger)_85%,var(--fg))]" />
                </button>
              )}
            </div>
          );
        })
      )}
    </nav>
  );
};

export default GroupListPanel;

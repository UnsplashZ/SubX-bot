import { Bell, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui';
import personalVerifyBadgeUrl from '../../../../assets/verify/PERSONAL_OFFICIAL_VERIFY.svg';
import organizationVerifyBadgeUrl from '../../../../assets/verify/ORGANIZATION_OFFICIAL_VERIFY.svg';

const DEFAULT_AVATAR_URL = 'https://i0.hdslb.com/bfs/face/member/noface.jpg';
const VERIFY_BADGE_ICON_MAP = {
  0: personalVerifyBadgeUrl,
  1: organizationVerifyBadgeUrl
};

const normalizeVerifyInfo = (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const type = Number(raw.type);
  if (!Number.isFinite(type) || ![0, 1].includes(type)) return null;
  return {
    type,
    desc: String(raw.desc || raw.title || '').trim()
  };
};

const getVerifyInfo = (sub) => {
  const candidates = [
    sub?.officialVerify,
    sub?.official_verify,
    sub?.dynamic?.modules?.module_author?.official_verify
  ];

  for (const candidate of candidates) {
    const normalized = normalizeVerifyInfo(candidate);
    if (normalized) return normalized;
  }

  return null;
};

const handleAvatarError = (event) => {
  if (event.currentTarget.src === DEFAULT_AVATAR_URL) return;
  event.currentTarget.src = DEFAULT_AVATAR_URL;
};

const VerifyBadge = ({ verifyInfo }) => {
  if (!verifyInfo) return null;

  const iconSrc = VERIFY_BADGE_ICON_MAP[verifyInfo.type];
  if (!iconSrc) return null;

  const title = verifyInfo.desc
    ? `认证用户：${verifyInfo.desc}`
    : '认证用户';

  return (
    <span
      title={title}
      className="absolute -right-0.5 -bottom-0.5 w-4 h-4 drop-shadow-[0_2px_4px_rgba(0,0,0,0.35)]"
    >
      <img
        src={iconSrc}
        alt="用户认证图标"
        className="block w-full h-full"
      />
    </span>
  );
};

const SubscriptionsTab = ({
  subsLoading,
  subscriptions,
  subTypes,
  onOpenAddModal,
  onDeleteSubscription
}) => {
  return (
    <div className="focus:outline-none h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-[var(--fg)]">订阅列表</h3>
        <Button
          onClick={onOpenAddModal}
          variant="primary"
          size="sm"
          icon={Plus}
        >
          添加订阅
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-muted)]">
        {subsLoading ? (
          <div className="p-4 text-center text-[var(--muted)]">加载订阅中...</div>
        ) : subscriptions.length === 0 ? (
          <div className="p-8 text-center text-[var(--muted)] flex flex-col items-center">
            <Bell size={32} className="mb-2 opacity-30" />
            暂无订阅
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--surface-quiet)] text-[var(--muted)] font-medium">
              <tr>
                <th className="p-3">用户</th>
                <th className="p-3">值 / ID</th>
                <th className="p-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {subscriptions.map((sub, idx) => (
                <tr key={idx} className="transition-colors hover:bg-[var(--surface-hover)]">
                  <td className="p-3 text-[var(--accent-muted)]">
                    {subTypes.find((type) => type.value === sub.type)?.label || sub.type}
                  </td>
                  <td className="p-3 text-[var(--fg)]">
                    {(sub.name || sub.title) ? (
                      <div className="flex items-center gap-3 min-w-0">
                        {sub.type === 'user' && (
                          <div className="relative shrink-0">
                            <img
                              src={sub.face || DEFAULT_AVATAR_URL}
                              alt={sub.name || '用户头像'}
                              onError={handleAvatarError}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-full object-cover border border-[var(--border)] bg-[var(--surface-muted)]"
                            />
                            <VerifyBadge verifyInfo={getVerifyInfo(sub)} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium truncate">{sub.name || sub.title}</div>
                          <div className="text-xs text-[var(--muted)] font-mono">{sub.value}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono">{sub.value}</div>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => onDeleteSubscription(sub)}
                      className="rounded p-1.5 text-[color-mix(in_oklch,var(--danger)_84%,var(--fg))] transition-colors hover:bg-[var(--danger-soft)]"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SubscriptionsTab;

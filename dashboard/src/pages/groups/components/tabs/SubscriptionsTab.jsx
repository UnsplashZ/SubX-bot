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
      className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"
    >
      <img
        src={iconSrc}
        alt="用户认证图标"
        className="block h-full w-full"
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
    <div className="flex h-full min-h-0 flex-col focus:outline-none">
      <div className="flex items-center justify-between gap-4 py-3">
        <span className="text-xs text-[var(--muted)]" aria-live="polite">
          {subscriptions.length} 个订阅
        </span>
        <Button
          onClick={onOpenAddModal}
          variant="secondary"
          size="sm"
          icon={Plus}
        >
          添加订阅
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {subsLoading ? (
          <div className="py-10 text-center text-sm text-[var(--muted)]">加载订阅中…</div>
        ) : subscriptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-sm text-[var(--muted)]">
            <Bell size={24} className="mb-2 opacity-40" />
            暂无订阅
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--surface)]">
              <tr className="border-b border-[var(--border)] text-[11px] font-medium text-[var(--muted)]">
                <th scope="col" className="w-16 px-2 py-2 font-medium first:pl-0">类型</th>
                <th scope="col" className="px-2 py-2 font-medium">订阅对象</th>
                <th scope="col" className="w-10 px-2 py-2 text-right font-medium last:pr-0">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {subscriptions.map((sub, idx) => (
                <tr key={idx} className="group transition-colors hover:bg-[var(--surface-quiet)]">
                  <td className="px-2 py-2.5 align-middle text-xs text-[var(--muted)] first:pl-0">
                    {subTypes.find((type) => type.value === sub.type)?.label || sub.type}
                  </td>
                  <td className="px-2 py-2.5 align-middle text-[var(--fg)]">
                    {(sub.name || sub.title) ? (
                      <div className="flex min-w-0 items-center gap-3">
                        {sub.type === 'user' && (
                          <div className="relative shrink-0">
                            <img
                              src={sub.face || DEFAULT_AVATAR_URL}
                              alt={sub.name || '用户头像'}
                              onError={handleAvatarError}
                              referrerPolicy="no-referrer"
                              className="h-8 w-8 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-muted)] object-cover"
                            />
                            <VerifyBadge verifyInfo={getVerifyInfo(sub)} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{sub.name || sub.title}</div>
                          <div className="truncate font-mono text-[11px] text-[var(--muted)]">{sub.value}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-sm">{sub.value}</div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right align-middle last:pr-0">
                    <button
                      type="button"
                      onClick={() => onDeleteSubscription(sub)}
                      className="rounded p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)]"
                      title="删除"
                      aria-label="删除订阅"
                    >
                      <Trash2 size={15} />
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

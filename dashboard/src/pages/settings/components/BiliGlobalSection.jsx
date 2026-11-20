import GlassCard from '../../../components/GlassCard'
import { Button } from '../../../components/ui'

function formatBiliTimestamp(value) {
    if (!value) return '未知'
    const timestamp = typeof value === 'number'
        ? (value < 1e12 ? value * 1000 : value)
        : Date.parse(value)
    if (Number.isNaN(timestamp)) return '未知'
    return new Date(timestamp).toLocaleString('zh-CN', { hour12: false })
}

const BiliGlobalSection = ({ biliGlobalStatus, biliLoading, onLogin, onLogout }) => {
    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <svg
                    className="w-5 h-5 text-[var(--accent)]"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                >
                    <path d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z" />
                </svg>
                <h2 className="text-xl font-semibold text-[var(--fg)]">B站全局Cookie</h2>
            </div>
            <GlassCard>
                {biliGlobalStatus.isLoggedIn ? (
                    <div className="space-y-4">
                        <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-quiet)] p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)] shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent)_16%,transparent)]" />
                                <div className="min-w-0">
                                    <p className="truncate font-medium text-[var(--fg)]">
                                        {biliGlobalStatus.username}{' '}
                                        <span className="text-[var(--muted)]">
                                            (UID: {biliGlobalStatus.uid})
                                        </span>
                                    </p>
                                    <p className="text-xs text-[var(--muted)] mt-1">
                                        更新时间：{formatBiliTimestamp(biliGlobalStatus.timestamp)}
                                    </p>
                                </div>
                            </div>
                            <div className="flex shrink-0 gap-2">
                                <Button
                                    type="button"
                                    onClick={onLogout}
                                    disabled={biliLoading}
                                    variant="danger"
                                    size="sm"
                                >
                                    退出登录
                                </Button>
                                <Button
                                    type="button"
                                    onClick={onLogin}
                                    disabled={biliLoading}
                                    variant="secondary"
                                    size="sm"
                                >
                                    重新登录
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col gap-4 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-quiet)] p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3">
                            <span className="h-2.5 w-2.5 rounded-full bg-[var(--muted)]" />
                            <p className="text-[var(--muted)]">未登录</p>
                        </div>
                        <Button
                            type="button"
                            onClick={onLogin}
                            disabled={biliLoading}
                            variant="primary"
                        >
                            {biliLoading ? '加载中...' : '扫码登录'}
                        </Button>
                    </div>
                )}
            </GlassCard>
        </section>
    )
}

export default BiliGlobalSection

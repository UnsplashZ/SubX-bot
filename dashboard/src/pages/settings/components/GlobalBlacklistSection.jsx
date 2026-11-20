import GlassCard from '../../../components/GlassCard'
import { Shield, X } from 'lucide-react'
import { Button } from '../../../components/ui'

const GlobalBlacklistSection = ({
    blacklist,
    newBlacklistQQ,
    addingBlacklist,
    onNewBlacklistQQChange,
    onAddBlacklist,
    onRemoveBlacklist,
    disabled = false
}) => {
    return (
        <section>
            <div className="flex items-center gap-2 mb-4">
                <Shield className="text-[var(--danger)]" />
                <h2 className="text-xl font-semibold text-[var(--fg)]">全局黑名单</h2>
            </div>
            <GlassCard>
                <div className="mb-4">
                    <div className="flex gap-2">
                        <input
                            type="text"
                            aria-label="输入要加入黑名单的 QQ 号或 OpenID"
                            value={newBlacklistQQ}
                            disabled={disabled}
                            onChange={(e) => onNewBlacklistQQChange(e.target.value)}
                            placeholder="输入 QQ 号或 OpenID..."
                            className="field-control flex-1 px-3 py-2"
                            onKeyDown={(e) => e.key === 'Enter' && onAddBlacklist()}
                        />
                        <Button
                            type="button"
                            onClick={onAddBlacklist}
                            disabled={disabled || addingBlacklist || !newBlacklistQQ}
                            variant="danger"
                        >
                            添加
                        </Button>
                    </div>
                </div>

                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                    {blacklist.length === 0 ? (
                        <div className="text-center text-[var(--muted)] py-4">黑名单为空</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {blacklist.map((qq) => (
                                <div key={qq} className="flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--danger)_34%,var(--border))] bg-[var(--danger-soft)] px-3 py-1.5 text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]">
                                    <span>{qq}</span>
                                    <button
                                        type="button"
                                        aria-label={`从黑名单移除 ${qq}`}
                                        disabled={disabled}
                                        onClick={() => onRemoveBlacklist(qq)}
                                        className="grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] transition-colors hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] max-md:min-h-11 max-md:min-w-11"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </GlassCard>
        </section>
    )
}

export default GlobalBlacklistSection

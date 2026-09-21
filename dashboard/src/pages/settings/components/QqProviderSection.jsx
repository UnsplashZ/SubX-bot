import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import { Button, ToggleSwitch, StatusPill } from '../../../components/ui'
import { Network, KeyRound } from 'lucide-react'

function asOpenidText(value) {
    return Array.isArray(value) ? value.join(',') : String(value || '')
}

const QqProviderSection = ({
    config,
    status,
    onClearSecret,
    onClearToken,
    onChange,
    disabled = false
}) => {
    const provider = config.qqProvider === 'official' ? 'official' : 'napcat'
    const statusProvider = status?.id === 'official' ? 'QQ Official' : status?.id === 'napcat' ? 'OneBot' : '未连接'
    const connectionState = status?.connectionState || status?.state || 'unknown'
    const gatewayState = status?.gateway?.state || ''
    const tokenTtlSeconds = Number(status?.token?.tokenTtlSeconds || 0)
    const tokenText = tokenTtlSeconds > 0 ? `${Math.round(tokenTtlSeconds / 60)} 分钟` : ''
    const statusTone = connectionState === 'ready' || connectionState === 'open' ? 'success' : 'neutral'

    return (
        <section>
            <div className="mb-4 flex items-center gap-2">
                <Network className="text-[var(--accent)]" />
                <h2 className="text-xl font-semibold text-[var(--fg)]">QQ 连接模式</h2>
                <StatusPill tone="accent">受控热重载</StatusPill>
            </div>
            <GlassCard>
                <div className="divide-y divide-[var(--border-subtle)]">
                    <SettingRow
                        title="当前运行"
                        description={gatewayState ? `Gateway: ${gatewayState}` : '当前 Bot 进程中的连接状态。'}
                        status={<StatusPill tone={statusTone}>{connectionState}</StatusPill>}
                        control={
                            <div className="flex flex-wrap justify-end gap-2 text-sm text-[var(--muted)]">
                                <StatusPill>{statusProvider}</StatusPill>
                                {tokenText && <StatusPill>Token {tokenText}</StatusPill>}
                            </div>
                        }
                    />

                    <SettingRow
                        title="连接 Provider"
                        description="OneBot 为默认兼容模式，适配各类 OneBot v11 实现；QQ Official 使用官方机器人开放平台。"
                        control={
                            <select
                                value={provider}
                                disabled={disabled}
                                onChange={(event) => onChange('qqProvider', event.target.value)}
                                className="field-control w-full px-3 py-2 md:w-56"
                            >
                                <option value="napcat">OneBot</option>
                                <option value="official">QQ Official</option>
                            </select>
                        }
                    />

                    {provider !== 'official' && (
                        <>
                            <SettingRow
                                title="WebSocket 地址"
                                description="OneBot v11 服务的 WebSocket 地址，例如 ws://napcat:3001。"
                                control={
                                    <input
                                        type="text"
                                        value={config.wsUrl || ''}
                                        disabled={disabled}
                                        onChange={(event) => onChange('wsUrl', event.target.value)}
                                        className="field-control w-full px-3 py-2 md:w-72"
                                    />
                                }
                            />

                            <SettingRow
                                title="Access Token"
                                description={config.wsTokenConfigured ? '已配置；留空不会覆盖当前值，清除必须显式操作。' : '尚未配置；服务端未开启鉴权时可留空。'}
                                status={<KeyRound size={14} />}
                                control={
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input
                                            type="password"
                                            value={config.wsToken || ''}
                                            disabled={disabled}
                                            onChange={(event) => onChange('wsToken', event.target.value)}
                                            placeholder={config.wsTokenConfigured ? '已配置，留空不变' : ''}
                                            className="field-control w-full px-3 py-2 md:w-72"
                                        />
                                        {config.wsTokenConfigured && (
                                            <Button type="button" size="sm" variant="danger" disabled={disabled} onClick={onClearToken}>
                                                显式清除
                                            </Button>
                                        )}
                                    </div>
                                }
                            />
                        </>
                    )}

                    {provider === 'official' && (
                        <>
                            <SettingRow
                                title="AppID"
                                description="QQ 开放平台机器人 AppID。"
                                control={
                                    <input
                                        type="text"
                                        value={config.qqOfficialAppId || ''}
                                        disabled={disabled}
                                        onChange={(event) => onChange('qqOfficialAppId', event.target.value)}
                                        className="field-control w-full px-3 py-2 md:w-72"
                                    />
                                }
                            />

                            <SettingRow
                                title="Secret"
                                description={config.qqOfficialClientSecretConfigured ? '已配置；留空不会覆盖当前值，清除必须显式操作。' : '尚未配置。'}
                                status={<KeyRound size={14} />}
                                control={
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input
                                            type="password"
                                            value={config.qqOfficialClientSecret || ''}
                                            disabled={disabled}
                                            onChange={(event) => onChange('qqOfficialClientSecret', event.target.value)}
                                            placeholder={config.qqOfficialClientSecretConfigured ? '已配置，留空不变' : ''}
                                            className="field-control w-full px-3 py-2 md:w-72"
                                        />
                                        {config.qqOfficialClientSecretConfigured && (
                                            <Button type="button" size="sm" variant="danger" disabled={disabled} onClick={onClearSecret}>
                                                显式清除
                                            </Button>
                                        )}
                                    </div>
                                }
                            />

                            <SettingRow
                                title="Root OpenID"
                                description="Official 模式的 Root 管理员 OpenID，多个用逗号分隔。"
                                control={
                                    <input
                                        type="text"
                                        value={asOpenidText(config.qqOfficialRootOpenids)}
                                        disabled={disabled}
                                        onChange={(event) => onChange('qqOfficialRootOpenids', event.target.value)}
                                        className="field-control w-full px-3 py-2 md:w-72"
                                    />
                                }
                            />

                            <SettingRow
                                title="分片 Gateway"
                                description="优先使用 /gateway/bot 获取 WSS 地址和 shard 信息。"
                                control={
                                    <ToggleSwitch
                                        checked={config.qqOfficialUseShardedGateway !== false}
                                        onChange={(checked) => onChange('qqOfficialUseShardedGateway', checked)}
                                        label="分片 Gateway"
                                        disabled={disabled}
                                    />
                                }
                            />

                            <SettingRow
                                title="媒体上传策略"
                                description="hybrid 优先 base64，公网 URL 用于本地文件和视频。"
                                control={
                                    <select
                                        value={config.qqOfficialMediaUploadMode || 'hybrid'}
                                        disabled={disabled}
                                        onChange={(event) => onChange('qqOfficialMediaUploadMode', event.target.value)}
                                        className="field-control w-full px-3 py-2 md:w-56"
                                    >
                                        <option value="hybrid">hybrid</option>
                                        <option value="url_only">url_only</option>
                                        <option value="file_data">file_data</option>
                                    </select>
                                }
                            />

                            <SettingRow
                                title="临时公网 Base URL"
                                description="用于 Official 发送本地文件或视频；必须是公网 http/https。"
                                control={
                                    <input
                                        type="url"
                                        value={config.qqOfficialTempPublicBaseUrl || ''}
                                        disabled={disabled}
                                        onChange={(event) => onChange('qqOfficialTempPublicBaseUrl', event.target.value)}
                                        className="field-control w-full px-3 py-2 md:w-72"
                                    />
                                }
                            />

                            <SettingRow
                                title="QPM"
                                description="账号总 QPM 与单群 QPM。"
                                control={
                                    <div className="grid grid-cols-2 gap-2 md:w-56">
                                        <input
                                            type="number"
                                            min="1"
                                            disabled={disabled}
                                            value={config.qqOfficialAccountQpm || 30}
                                            onChange={(event) => onChange('qqOfficialAccountQpm', parseInt(event.target.value, 10) || 30)}
                                            className="field-control w-full px-3 py-2"
                                        />
                                        <input
                                            type="number"
                                            min="1"
                                            disabled={disabled}
                                            value={config.qqOfficialGroupQpm || 20}
                                            onChange={(event) => onChange('qqOfficialGroupQpm', parseInt(event.target.value, 10) || 20)}
                                            className="field-control w-full px-3 py-2"
                                        />
                                    </div>
                                }
                            />
                        </>
                    )}
                </div>
            </GlassCard>
        </section>
    )
}

export default QqProviderSection

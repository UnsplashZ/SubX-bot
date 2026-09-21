import { Activity, AlertTriangle } from 'lucide-react'
import GlassCard from '../../../components/GlassCard'
import { Button } from '../../../components/ui'

const SystemControlSection = ({ onRestart }) => {
    return (
        <section>
            <h2 className="text-xl font-semibold text-[var(--fg)] mb-4 flex items-center gap-2">
                <Activity className="text-[var(--danger)]" />
                系统控制
            </h2>
            <GlassCard>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-[var(--muted)]">重启会短暂中断当前服务。</p>
                    <Button
                        type="button"
                        onClick={onRestart}
                        variant="danger"
                        icon={AlertTriangle}
                        className="w-full sm:w-auto"
                    >
                        重启系统
                    </Button>
                </div>
            </GlassCard>
        </section>
    )
}

export default SystemControlSection

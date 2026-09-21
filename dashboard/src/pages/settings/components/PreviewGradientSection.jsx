import { useEffect, useMemo, useRef, useState } from 'react'
import GlassCard from '../../../components/GlassCard'
import SettingRow from '../../../components/SettingRow'
import { Button } from '../../../components/ui'
import GradientColorPickerPopover from './GradientColorPickerPopover'
import PreviewGradientModal from './PreviewGradientModal'
import { Eye, Palette, RotateCcw, Save } from 'lucide-react'
import {
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    DEFAULT_PREVIEW_ATMOSPHERE_COLOR2,
    FIELD_DESCRIPTIONS,
    FIELD_LABELS,
    resolveEffectivePreviewGradientColors
} from './previewGradientModel'

const HEX_COLOR_PATTERN = /^#([0-9A-F]{6})$/i

function normalizeHexColor(value) {
    return String(value || '').trim().toUpperCase()
}

function isValidHexColor(value) {
    return HEX_COLOR_PATTERN.test(normalizeHexColor(value))
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max)
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex).replace('#', '')
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    }
}

function rgbToHex({ r, g, b }) {
    const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase()
}

function mixHexColors(left, right, ratio = 0.5) {
    const weight = Math.min(Math.max(Number(ratio) || 0, 0), 1)
    const leftRgb = hexToRgb(left)
    const rightRgb = hexToRgb(right)
    return rgbToHex({
        r: leftRgb.r + (rightRgb.r - leftRgb.r) * weight,
        g: leftRgb.g + (rightRgb.g - leftRgb.g) * weight,
        b: leftRgb.b + (rightRgb.b - leftRgb.b) * weight
    })
}

function buildChipPreview(color) {
    const lighter = mixHexColors(color, '#FFFFFF', 0.28)
    const darker = mixHexColors(color, '#000000', 0.16)
    return {
        backgroundImage: `radial-gradient(circle at 72% 24%, rgba(255,255,255,0.18), transparent 24%), linear-gradient(135deg, ${lighter} 0%, ${color} 52%, ${darker} 100%)`
    }
}

const GRADIENT_FIELDS = ['previewGradientColor1', 'previewGradientColor2']
const DEFAULT_GRADIENT_INPUTS = {
    previewGradientColor1: DEFAULT_PREVIEW_ATMOSPHERE_COLOR1,
    previewGradientColor2: DEFAULT_PREVIEW_ATMOSPHERE_COLOR2
}
const DEFAULT_PICKER_SIZE = {
    width: 408,
    height: 420
}

const PreviewGradientSection = ({
    previewGradientConfig,
    onPreviewGradientChange,
    onResetPreviewGradient,
    onSavePreviewGradient,
    saving = false,
    className = ''
}) => {
    const [gradientInputs, setGradientInputs] = useState(previewGradientConfig)
    const [gradientErrors, setGradientErrors] = useState({})
    const [pickerState, setPickerState] = useState(null)
    const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false)
    const previewGradientSectionRef = useRef(null)
    const pickerRef = useRef(null)
    const triggerRefs = useRef({})

    useEffect(() => {
        const frameId = window.requestAnimationFrame(() => {
            setGradientInputs(previewGradientConfig)
            setGradientErrors({})
        })

        return () => window.cancelAnimationFrame(frameId)
    }, [previewGradientConfig])

    const effectivePreviewColors = useMemo(
        () => resolveEffectivePreviewGradientColors(gradientInputs, previewGradientConfig),
        [gradientInputs, previewGradientConfig]
    )

    const updatePickerPlacement = (field) => {
        const container = previewGradientSectionRef.current
        const trigger = triggerRefs.current[field]
        if (!container || !trigger) return

        const containerRect = container.getBoundingClientRect()
        const triggerRect = trigger.getBoundingClientRect()
        const pickerRect = pickerRef.current?.getBoundingClientRect()
        const pickerWidth = pickerRect?.width || DEFAULT_PICKER_SIZE.width
        const pickerHeight = pickerRect?.height || DEFAULT_PICKER_SIZE.height
        const padding = 16

        const rawLeft = triggerRect.left - containerRect.left - pickerWidth + triggerRect.width + 96
        const rawTop = triggerRect.top - containerRect.top - 64
        const maxLeft = Math.max(padding, containerRect.width - pickerWidth - padding)
        const maxTop = Math.max(padding, containerRect.height - pickerHeight - padding)
        const left = clamp(rawLeft, padding, maxLeft)
        const top = clamp(rawTop, padding, maxTop)
        const triggerCenterX = triggerRect.left - containerRect.left + (triggerRect.width / 2)
        const arrowLeft = clamp(triggerCenterX - left, 48, pickerWidth - 48)

        setPickerState(prev => (
            prev?.field === field
                ? { ...prev, top, left, arrowLeft }
                : { field, top, left, arrowLeft }
        ))
    }

    useEffect(() => {
        if (!pickerState?.field) return undefined

        const frameId = window.requestAnimationFrame(() => {
            updatePickerPlacement(pickerState.field)
        })

        const handleResize = () => updatePickerPlacement(pickerState.field)
        window.addEventListener('resize', handleResize)

        return () => {
            window.cancelAnimationFrame(frameId)
            window.removeEventListener('resize', handleResize)
        }
    }, [pickerState?.field])

    useEffect(() => {
        if (!pickerState?.field) return undefined

        const handlePointerDown = (event) => {
            const pickerElement = pickerRef.current
            const triggerElement = triggerRefs.current[pickerState.field]
            if (pickerElement?.contains(event.target) || triggerElement?.contains(event.target)) {
                return
            }
            setPickerState(null)
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setPickerState(null)
            }
        }

        document.addEventListener('pointerdown', handlePointerDown)
        window.addEventListener('keydown', handleKeyDown)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [pickerState])

    const handleGradientInputChange = (field, rawValue) => {
        const nextValue = rawValue.toUpperCase()
        setGradientInputs(prev => ({ ...prev, [field]: nextValue }))

        if (isValidHexColor(nextValue)) {
            const normalized = normalizeHexColor(nextValue)
            onPreviewGradientChange(field, normalized)
            setGradientInputs(prev => ({ ...prev, [field]: normalized }))
            setGradientErrors(prev => ({ ...prev, [field]: '' }))
        } else {
            setGradientErrors(prev => ({ ...prev, [field]: '请输入 #RRGGBB 格式颜色值' }))
        }
    }

    const handleApplyPickerColor = (field, nextColor) => {
        const normalized = normalizeHexColor(nextColor)
        setGradientInputs(prev => ({ ...prev, [field]: normalized }))
        setGradientErrors(prev => ({ ...prev, [field]: '' }))
        onPreviewGradientChange(field, normalized)
        setPickerState(null)
    }

    const handleResetPreviewGradient = () => {
        setPickerState(null)
        setIsPreviewModalOpen(false)
        setGradientInputs(DEFAULT_GRADIENT_INPUTS)
        setGradientErrors({})
        onResetPreviewGradient()
    }

    const handleTogglePicker = (field) => {
        setIsPreviewModalOpen(false)
        if (pickerState?.field === field) {
            setPickerState(null)
            return
        }

        setPickerState({ field, top: 16, left: 16, arrowLeft: 56 })
    }

    const handleOpenPreviewModal = () => {
        setPickerState(null)
        setIsPreviewModalOpen(true)
    }

    return (
        <div ref={previewGradientSectionRef} className="relative">
        <GlassCard className={className || ''}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-2">
                    <Palette className="text-[var(--accent)]" size={18} />
                    <div>
                        <h2 className="text-base font-semibold text-[var(--fg)]">预览图氛围色</h2>
                        <p className="mt-1 text-xs text-[var(--muted)]">调整 B 站链接解析预览图的背景氛围色。</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        type="button"
                        onClick={handleResetPreviewGradient}
                        variant="ghost"
                        icon={RotateCcw}
                        size="sm"
                    >
                        恢复默认氛围色
                    </Button>
                    {onSavePreviewGradient && (
                        <Button
                            type="button"
                            onClick={onSavePreviewGradient}
                            disabled={saving || Object.values(gradientErrors).some(Boolean)}
                            variant="secondary"
                            icon={Save}
                            size="sm"
                        >
                            {saving ? '保存中...' : '保存氛围色'}
                        </Button>
                    )}
                </div>
            </div>

            <div className="divide-y divide-[var(--border-subtle)]">
                {GRADIENT_FIELDS.map((field) => (
                    <SettingRow
                        key={field}
                        title={FIELD_LABELS[field]}
                        description={FIELD_DESCRIPTIONS[field]}
                        control={
                            <div>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        ref={(node) => {
                                            triggerRefs.current[field] = node
                                        }}
                                        onClick={() => handleTogglePicker(field)}
                                        className={`grid h-14 w-14 place-items-center rounded-lg border bg-[var(--surface-quiet)] transition-colors ${pickerState?.field === field ? 'border-[color-mix(in_oklch,var(--accent)_48%,var(--border))]' : 'border-[var(--border-subtle)] hover:border-[var(--border-muted)]'}`}
                                    >
                                        <span className="h-10 w-10 rounded-md shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.22)]" style={buildChipPreview(effectivePreviewColors[field])} />
                                    </button>
                                    <input
                                        type="text"
                                        value={gradientInputs[field]}
                                        onChange={(event) => handleGradientInputChange(field, event.target.value)}
                                        className={`field-control h-11 w-36 px-4 font-mono text-sm tracking-[0.03em] ${gradientErrors[field] ? 'border-[color-mix(in_oklch,var(--danger)_70%,var(--border))]' : ''}`}
                                    />
                                </div>
                                {gradientErrors[field] && (
                                    <p className="mt-2 text-xs text-[color-mix(in_oklch,var(--danger)_88%,var(--fg))]">{gradientErrors[field]}</p>
                                )}
                            </div>
                        }
                    />
                ))}

                <SettingRow
                    title="预览效果"
                    description="查看当前氛围色合成后的卡片观感"
                    control={
                        <Button
                            type="button"
                            onClick={handleOpenPreviewModal}
                            variant="secondary"
                            icon={Eye}
                        >
                            查看预览
                        </Button>
                    }
                />
            </div>

            {pickerState?.field && (
                <GradientColorPickerPopover
                    popoverRef={pickerRef}
                    style={{ top: `${pickerState.top}px`, left: `${pickerState.left}px` }}
                    arrowLeft={pickerState.arrowLeft}
                    fieldLabel={FIELD_LABELS[pickerState.field]}
                    value={effectivePreviewColors[pickerState.field]}
                    onApply={(color) => handleApplyPickerColor(pickerState.field, color)}
                    onClose={() => setPickerState(null)}
                />
            )}

            <PreviewGradientModal
                isOpen={isPreviewModalOpen}
                onClose={() => setIsPreviewModalOpen(false)}
                color1={effectivePreviewColors.previewGradientColor1}
                color2={effectivePreviewColors.previewGradientColor2}
            />
        </GlassCard>
        </div>
    )
}

export default PreviewGradientSection

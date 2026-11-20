import React from 'react';
import { clsx } from 'clsx';
import botIcon from '../assets/bili-qq-bot-icon.png';

export const BrandIcon = ({ className = '' }) => (
  <div
    className={clsx(
      'relative grid shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[var(--accent)]',
      className
    )}
  >
    <img
      src={botIcon}
      alt=""
      className="h-full w-full object-contain p-1"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
        event.currentTarget.nextElementSibling?.removeAttribute('hidden');
      }}
    />
    <span hidden className="font-mono text-xs font-bold text-[var(--accent-contrast)]">
      S
    </span>
    <span
      aria-hidden="true"
      className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-[var(--success)]"
    />
  </div>
);

export const BrandLockup = ({ compact = false, subtitle = '群聊链接解析与预览', className = '' }) => (
  <div className={clsx('flex min-w-0 items-center gap-2.5', className)}>
    <BrandIcon className={compact ? 'h-8 w-8' : 'h-9 w-9'} />
    <div className="min-w-0">
      <div className="truncate text-sm font-semibold leading-5 text-[var(--fg)]">SubX-bot</div>
      {subtitle && (
        <div className="mt-0.5 truncate text-xs leading-4 text-[var(--muted)]">{subtitle}</div>
      )}
    </div>
  </div>
);

export const SignalRail = ({ className = '', label }) => (
  <div
    aria-hidden="true"
    className={clsx('flex items-center gap-1.5', className)}
    title={label}
  >
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
    <span className="h-px flex-1 bg-[color-mix(in_oklch,var(--accent)_30%,var(--border-subtle))]" />
    <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--accent-muted)]" />
    <span className="h-px flex-1 bg-[color-mix(in_oklch,var(--accent)_22%,var(--border-subtle))]" />
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color-mix(in_oklch,var(--accent)_58%,var(--border))]" />
  </div>
);

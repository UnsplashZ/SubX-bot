import React from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const SettingRow = ({
  title,
  description,
  control,
  status,
  children,
  className
}) => {
  return (
    <div
      className={twMerge(
        clsx(
          'grid gap-3 border-b border-[var(--border-subtle)] px-0 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
          className
        )
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-[var(--fg)]">{title}</div>
        {description && (
          <div className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{description}</div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 md:justify-self-end">
        <div className="min-w-0 flex-1 md:flex-initial">{control || children}</div>
        {status && (
          <span className="shrink-0 text-xs font-medium text-[var(--muted)]">{status}</span>
        )}
      </div>
    </div>
  );
};

export default SettingRow;

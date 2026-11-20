import { clsx } from 'clsx';

export const SettingsSection = ({
  title,
  description,
  meta,
  action,
  children,
  className
}) => (
  <section className={clsx('py-5 first:pt-1 last:pb-1', className)}>
    {(title || description || action) && (
      <div className="mb-3 flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-w-0 items-baseline gap-2">
            <h3 className="text-sm font-semibold text-[var(--fg)]">{title}</h3>
            {meta && <span className="font-mono text-[11px] font-normal text-[var(--muted)]">{meta}</span>}
          </div>
          {description && (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--muted)]">{description}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    )}
    {children}
  </section>
);

export const QuietButton = ({ children, className, ...props }) => (
  <button
    type="button"
    className={clsx(
      'rounded px-1.5 py-0.5 text-xs font-medium text-[var(--muted)] transition-colors hover:bg-[var(--surface-quiet)] hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fg)] disabled:pointer-events-none disabled:opacity-45',
      className
    )}
    {...props}
  >
    {children}
  </button>
);

export const EmptyLine = ({ children }) => (
  <p className="py-5 text-sm text-[var(--muted)]">{children}</p>
);

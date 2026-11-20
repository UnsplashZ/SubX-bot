import React, { useId } from 'react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const isNativeFieldElement = (child) => (
  React.isValidElement(child)
  && typeof child.type === 'string'
  && ['input', 'select', 'textarea'].includes(child.type)
);

function findFirstNativeField(node) {
  let found = null;
  React.Children.forEach(node, (child) => {
    if (found || !React.isValidElement(child)) return;
    if (isNativeFieldElement(child)) {
      found = child;
      return;
    }
    if (child.props?.children) {
      found = findFirstNativeField(child.props.children);
    }
  });
  return found;
}

const SettingRow = ({
  title,
  description,
  control,
  status,
  children,
  className,
  id
}) => {
  const reactId = useId();
  const controlId = id || `setting-${reactId.replace(/:/g, '')}`;
  const titleId = `${controlId}-title`;
  const descriptionId = `${controlId}-description`;
  const controlNode = control || children;
  const firstField = findFirstNativeField(controlNode);
  const labelFieldTree = (node) => React.Children.map(node, (child) => {
    if (!React.isValidElement(child)) return child;
    if (isNativeFieldElement(child)) {
      const nextProps = {
        'aria-labelledby':
          child.props['aria-labelledby'] ||
          (child.props['aria-label'] ? undefined : titleId),
        'aria-describedby':
          child.props['aria-describedby'] || (description ? descriptionId : undefined)
      };
      if (child === firstField) nextProps.id = controlId;
      return React.cloneElement(child, nextProps);
    }
    if (child.props?.children) {
      return React.cloneElement(child, { children: labelFieldTree(child.props.children) });
    }
    return child;
  });
  const labelledControl = labelFieldTree(controlNode);

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={twMerge(
        clsx(
          'grid gap-3 border-b border-[var(--border-subtle)] px-0 py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
          className
        )
      )}
    >
      <div className="min-w-0">
        <label
          id={titleId}
          htmlFor={controlId}
          className="block text-sm font-medium text-[var(--fg)]"
        >
          {title}
        </label>
        {description && (
          <div id={descriptionId} className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            {description}
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2 md:justify-self-end">
        <div className="min-w-0 flex-1 md:flex-initial">{labelledControl}</div>
        {status && (
          <span className="shrink-0 text-xs font-medium text-[var(--muted)]">{status}</span>
        )}
      </div>
    </div>
  );
};

export default SettingRow;

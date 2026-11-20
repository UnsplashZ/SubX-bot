import React, { useId, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';

const ModernTabs = ({ tabs, selectedIndex, onChange, children }) => {
  const safeIndex = Math.max(0, Math.min(selectedIndex, tabs.length - 1));
  const [direction, setDirection] = useState('forward');
  const tabRefs = useRef([]);
  const baseId = useId().replace(/:/g, '');
  const activeLeft = useMemo(() => `${(safeIndex / tabs.length) * 100}%`, [safeIndex, tabs.length]);
  const activeWidth = useMemo(() => `${100 / tabs.length}%`, [tabs.length]);

  const handleSelect = (index, focus = false) => {
    setDirection(index >= safeIndex ? 'forward' : 'backward');
    onChange(index);
    if (focus) {
      requestAnimationFrame(() => tabRefs.current[index]?.focus());
    }
  };

  const handleKeyDown = (event, index) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    handleSelect(nextIndex, true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--border-subtle)] px-3 py-3 lg:hidden">
        <label htmlFor={`${baseId}-mobile-tabs`} className="sr-only">
          群组设置分类
        </label>
        <select
          id={`${baseId}-mobile-tabs`}
          className="field-control min-h-11 w-full px-3 py-2 text-sm"
          value={safeIndex}
          onChange={(event) => handleSelect(Number(event.target.value))}
        >
          {tabs.map((tab, index) => (
            <option key={tab.name} value={index}>
              {tab.name}
            </option>
          ))}
        </select>
      </div>

      <div className="relative hidden overflow-x-auto border-b border-[var(--border-subtle)] px-2 lg:block">
        <div
          role="tablist"
          aria-label="群组设置分类"
          aria-orientation="horizontal"
          className="relative grid min-w-max"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(7rem, 1fr))` }}
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.name}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${index}`}
              aria-selected={index === safeIndex}
              aria-controls={`${baseId}-panel`}
              tabIndex={index === safeIndex ? 0 : -1}
              onClick={() => handleSelect(index)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={clsx(
                'relative z-10 flex shrink-0 items-center justify-center gap-2 px-3 py-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-inset sm:px-4',
                index === safeIndex ? 'text-[var(--accent-muted)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'
              )}
            >
              {tab.icon && <tab.icon size={16} />}
              <span>{tab.name}</span>
            </button>
          ))}
          <div
            aria-hidden="true"
            className="absolute bottom-0 h-0.5 rounded-full bg-[var(--accent-muted)] transition-[left,width] duration-200 ease-out motion-reduce:transition-none"
            style={{ left: activeLeft, width: activeWidth }}
          />
        </div>
      </div>

      <div
        key={safeIndex}
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${safeIndex}`}
        tabIndex={0}
        className={`min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] motion-reduce:animate-none ${
          direction === 'forward'
            ? 'animate-[tab-panel-forward_180ms_ease-out]'
            : 'animate-[tab-panel-backward_180ms_ease-out]'
        }`}
      >
        {React.Children.toArray(children)[safeIndex]}
      </div>
    </div>
  );
};

export default ModernTabs;

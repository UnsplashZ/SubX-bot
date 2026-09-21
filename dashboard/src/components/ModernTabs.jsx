import React, { useMemo, useState } from 'react';
import { clsx } from 'clsx';

const ModernTabs = ({ tabs, selectedIndex, onChange, children }) => {
  const safeIndex = Math.max(0, Math.min(selectedIndex, tabs.length - 1));
  const [direction, setDirection] = useState('forward');
  const activeLeft = useMemo(() => `${(safeIndex / tabs.length) * 100}%`, [safeIndex, tabs.length]);
  const activeWidth = useMemo(() => `${100 / tabs.length}%`, [tabs.length]);
  const handleSelect = (index) => {
    setDirection(index >= safeIndex ? 'forward' : 'backward');
    onChange(index);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative overflow-x-auto border-b border-[var(--border-subtle)] px-2 sm:px-3">
        <div
          className="relative grid min-w-max"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(7rem, 1fr))` }}
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.name}
              type="button"
              onClick={() => handleSelect(index)}
              className={clsx(
                'relative z-10 flex shrink-0 items-center justify-center gap-2 px-3 py-3 text-xs font-medium transition-colors focus:outline-none sm:px-4',
                index === safeIndex ? 'text-[var(--accent-muted)]' : 'text-[var(--muted)] hover:text-[var(--fg)]'
              )}
            >
              {tab.icon && <tab.icon size={16} />}
              <span>{tab.name}</span>
            </button>
          ))}
          <div
            className="absolute bottom-0 h-px bg-[var(--accent-muted)] transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
            style={{ left: activeLeft, width: activeWidth }}
          />
        </div>
      </div>
      <div
        key={safeIndex}
        className={`min-h-0 flex-1 overflow-y-auto py-5 motion-reduce:animate-none ${
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

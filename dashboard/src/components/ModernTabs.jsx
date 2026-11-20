import React, { useEffect, useId, useRef } from 'react';
import { clsx } from 'clsx';

const ModernTabs = ({ tabs, selectedIndex, onChange, children }) => {
  const safeIndex = Math.max(0, Math.min(selectedIndex, tabs.length - 1));
  const tabRefs = useRef([]);
  const tabListRef = useRef(null);
  const baseId = useId().replace(/:/g, '');

  useEffect(() => {
    const list = tabListRef.current;
    const tab = tabRefs.current[safeIndex];
    if (!list || !tab) return;

    const left = tab.offsetLeft;
    const right = left + tab.offsetWidth;
    if (left < list.scrollLeft) {
      list.scrollTo({ left: Math.max(0, left - 12), behavior: 'smooth' });
    } else if (right > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: right - list.clientWidth + 12, behavior: 'smooth' });
    }
  }, [safeIndex]);

  const handleSelect = (index, focus = false) => {
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
      <div
        ref={tabListRef}
        className="overflow-x-auto border-b border-[var(--border-subtle)] px-4 [-ms-overflow-style:none] [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden"
      >
        <div
          role="tablist"
          aria-label="群组设置分类"
          aria-orientation="horizontal"
          className="flex gap-4 sm:gap-5"
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
                '-mb-px min-h-11 shrink-0 border-b-2 py-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fg)]',
                index === safeIndex
                  ? 'border-[var(--fg)] font-semibold text-[var(--fg)]'
                  : 'border-transparent font-medium text-[var(--muted)] hover:text-[var(--fg)]'
              )}
            >
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${safeIndex}`}
        tabIndex={0}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-1 focus-visible:outline-none sm:px-5"
      >
        {React.Children.toArray(children)[safeIndex]}
      </div>
    </div>
  );
};

export default ModernTabs;

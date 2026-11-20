import React, { useEffect, useRef } from 'react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { BrandLockup, SignalRail } from './Brand';
import { NAV_GROUPS } from './navigation';
import { Button } from './ui';
import { useTheme } from '../hooks/useTheme';

const THEME_LABELS = {
  system: '跟随系统',
  light: '浅色模式',
  dark: '深色模式',
};

const THEME_ICONS = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const MobileMenuItem = ({ icon, label, href, active, onClick }) => {
  return (
    <Link
      to={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`relative flex min-h-11 items-center gap-3 rounded-lg px-4 py-2.5 transition-colors duration-150 sm:px-5 ${
        active
          ? 'bg-[color-mix(in_oklch,var(--fg)_7%,transparent)] font-semibold text-[var(--fg)]'
          : 'text-[var(--muted)] hover:bg-[color-mix(in_oklch,var(--fg)_4%,transparent)] hover:text-[var(--fg)]'
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        {React.createElement(icon, {
          size: 19,
          className: active ? 'text-[var(--accent)]' : 'text-[var(--subtle)]'
        })}
        <span className="text-sm font-medium sm:text-base">{label}</span>
      </span>
    </Link>
  );
};

const MobileMenu = ({ isOpen, onClose }) => {
  const location = useLocation();
  const path = location.pathname;
  const { themePreference, cycleThemePreference } = useTheme();
  const ThemeIcon = THEME_ICONS[themePreference] || Monitor;
  const themeLabel = THEME_LABELS[themePreference] || THEME_LABELS.system;
  const panelRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    previousFocusRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="md:hidden">
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-menu-title"
        className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[86vw] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-muted)] sm:w-80"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4 sm:p-5">
          <div className="min-w-0">
            <div id="mobile-menu-title">
              <BrandLockup subtitle="群聊链接解析与预览" />
            </div>
            <SignalRail className="mt-3 w-32" label="群消息接入 · 短链解析 · 预览回传" />
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="grid h-11 w-11 place-items-center rounded-lg text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--fg)]"
            aria-label="关闭导航"
          >
            <X size={22} className="sm:h-6 sm:w-6" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 p-3 sm:p-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 text-xs font-semibold tracking-[0.04em] text-[var(--muted)]">
                {group.label}
              </div>
              <div className="mt-1.5 grid gap-0.5">
                {group.items.map((item) => (
                  <MobileMenuItem
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    active={path === item.href}
                    onClick={onClose}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-[var(--border)] p-3">
          <Button
            variant="ghost"
            className="w-full justify-start"
            icon={ThemeIcon}
            onClick={cycleThemePreference}
            aria-label={`切换主题，当前为${themeLabel}`}
          >
            {themeLabel}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MobileMenu;

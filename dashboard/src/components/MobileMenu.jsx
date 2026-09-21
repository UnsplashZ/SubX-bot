import React from 'react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { NAV_GROUPS } from './navigation';
import { Button } from './ui';
import { useTheme } from '../hooks/useTheme';
import botIcon from '../assets/bili-qq-bot-icon.png';

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

const BrandIcon = () => (
  <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-lg bg-[var(--accent)] shadow-sm">
    <img
      src={botIcon}
      alt="SubX-bot"
      className="h-full w-full object-contain p-1"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
        event.currentTarget.nextElementSibling?.removeAttribute('hidden');
      }}
    />
    <span hidden className="font-mono text-xs font-bold text-[var(--accent)]">
      BQ
    </span>
  </div>
);

const MobileMenuItem = ({ icon, label, href, active, onClick }) => {
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`relative flex items-center gap-3 rounded-lg px-4 py-2.5 transition-colors duration-150 sm:px-5 ${
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

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[86vw] flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface-muted)] sm:w-80 md:hidden">
        <div className="flex items-center justify-between border-b border-[var(--border)] p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <BrandIcon />
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-[var(--fg)]">
                SubX-bot
              </h1>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">管理控制台</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--surface-muted)] hover:text-[var(--fg)] sm:p-2"
            aria-label="关闭导航"
          >
            <X size={22} className="sm:h-6 sm:w-6" />
          </button>
        </div>

        <nav className="flex-1 space-y-5 p-3 sm:p-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">
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
          >
            {themeLabel}
          </Button>
        </div>
      </div>
    </>
  );
};

export default MobileMenu;

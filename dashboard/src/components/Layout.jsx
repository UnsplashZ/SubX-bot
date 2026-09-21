import React, { useState } from 'react';
import { Menu, Monitor, Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import MobileMenu from './MobileMenu';
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

const BrandIcon = ({ className = '' }) => (
  <div
    className={`grid place-items-center overflow-hidden rounded-[10px] bg-[var(--accent)] ${className}`}
  >
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

const SidebarItem = ({ icon, label, href, active }) => {
  return (
    <Link
      to={href}
      className={`group relative flex min-h-9 items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150 ${
        active
          ? 'bg-[color-mix(in_oklch,var(--fg)_7%,transparent)] font-semibold text-[var(--fg)]'
          : 'text-[var(--muted)] hover:bg-[color-mix(in_oklch,var(--fg)_4%,transparent)] hover:text-[var(--fg)]'
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        {React.createElement(icon, {
          size: 17,
          className: active ? 'text-[var(--accent)]' : 'text-[var(--subtle)] group-hover:text-[var(--muted)]'
        })}
        <span className="truncate font-medium">{label}</span>
      </span>
    </Link>
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const path = location.pathname;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { themePreference, cycleThemePreference } = useTheme();
  const ThemeIcon = THEME_ICONS[themePreference] || Monitor;
  const themeLabel = THEME_LABELS[themePreference] || THEME_LABELS.system;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      <header className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--surface)_90%,transparent)] px-3 backdrop-blur-xl sm:h-16 sm:px-4 md:hidden">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="rounded-lg p-1.5 text-[var(--fg)] transition-colors hover:bg-[var(--surface-muted)] sm:p-2"
          aria-label="打开导航"
        >
          <Menu size={22} className="sm:h-6 sm:w-6" />
        </button>
        <BrandIcon className="ml-2.5 h-8 w-8 sm:ml-3 sm:h-9 sm:w-9" />
        <h1 className="ml-2.5 text-base font-semibold text-[var(--fg)] sm:ml-3 sm:text-lg">
          SubX-bot
        </h1>
      </header>

      <aside className="fixed left-0 top-0 z-50 hidden h-full w-56 border-r border-[var(--border)] bg-[color-mix(in_oklch,var(--surface-muted)_86%,transparent)] backdrop-blur-xl md:flex md:flex-col">
        <div className="px-5 pb-6 pt-5">
          <div className="flex items-center gap-3">
            <BrandIcon className="h-8 w-8" />
            <div>
              <h1 className="text-sm font-semibold text-[var(--fg)]">SubX-bot</h1>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">管理控制台</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">
                {group.label}
              </div>
              <div className="mt-1.5 grid gap-0.5">
                {group.items.map((item) => (
                  <SidebarItem
                    key={item.href}
                    icon={item.icon}
                    label={item.label}
                    href={item.href}
                    active={path === item.href}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[var(--border)] p-3">
          <Button
            variant="ghost"
            className="w-full justify-start text-xs"
            icon={ThemeIcon}
            onClick={cycleThemePreference}
          >
            {themeLabel}
          </Button>
        </div>
      </aside>

      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
      />

      <main className="p-3 pt-14 sm:p-4 sm:pt-16 md:ml-56 md:px-9 md:py-8">
        <div className="mx-auto max-w-[1280px]">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;

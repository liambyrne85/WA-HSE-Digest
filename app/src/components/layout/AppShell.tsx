import { clsx } from 'clsx';
import { Bell, ChevronRight, LogOut, Menu, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import { ROLE_COLOR, ROLE_LABEL, formatDate } from '../../lib/labels';
import type { Notification } from '../../lib/types';
import { Avatar, Badge } from '../ui';
import { BrandLockup } from './BrandMark';
import { navFor, SECTION_LABEL, type NavItem } from './nav';
import { quickActionsFor } from './quickActions';

function Brand({ dark = true }: { dark?: boolean }) {
  return (
    <Link to="/" aria-label="Home">
      <BrandLockup dark={dark} size="sm" />
    </Link>
  );
}

function NavList({ items, onNavigate }: { items: (NavItem & { label: string })[]; onNavigate?: () => void }) {
  const sections = (['main', 'modules', 'admin', 'account'] as const)
    .map((s) => ({ s, items: items.filter((i) => i.section === s) }))
    .filter((x) => x.items.length);
  return (
    <nav className="space-y-5">
      {sections.map(({ s, items }) => (
        <div key={s}>
          {SECTION_LABEL[s] && <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-widest text-steel-500">{SECTION_LABEL[s]}</p>}
          <ul className="space-y-0.5">
            {items.map((n) => (
              <li key={n.to}>
                <NavLink
                  to={n.to}
                  end={n.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => clsx(
                    'group flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-[15px] font-semibold transition-colors',
                    isActive ? 'bg-brand-500 text-white' : 'text-steel-300 hover:bg-steel-800 hover:text-white',
                  )}
                >
                  <n.icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1 truncate">{n.label}</span>
                  {n.phase2 && <span className="rounded bg-steel-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-steel-300 group-[.active]:bg-brand-600">Soon</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserChip({ compact }: { compact?: boolean }) {
  const { profile, role } = useAuth();
  if (!profile || !role) return null;
  return (
    <div className="flex items-center gap-3">
      <Avatar name={profile.full_name} />
      {!compact && (
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white">{profile.full_name}</p>
          <Badge color={ROLE_COLOR[role]} className="mt-0.5">{ROLE_LABEL[role]}</Badge>
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const location = useLocation();
  useEffect(() => {
    api.listNotifications().then(setItems).catch(() => setItems([]));
  }, [location.pathname]);
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="relative">
      <button
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-11 w-11 items-center justify-center rounded-lg text-steel-600 hover:bg-steel-100"
      >
        <Bell className="h-6 w-6" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">{unread}</span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-steel-200 bg-white shadow-xl">
            <p className="border-b border-steel-200 px-4 py-3 font-display text-lg font-bold uppercase">Notifications</p>
            {items.length === 0 && <p className="px-4 py-6 text-center text-sm text-steel-500">You're all caught up.</p>}
            <ul className="max-h-80 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    className={clsx('flex w-full gap-3 px-4 py-3 text-left hover:bg-steel-50', !n.read_at && 'bg-brand-50/60')}
                    onClick={async () => {
                      if (!n.read_at) await api.markNotificationRead(n.id);
                      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
                      setOpen(false);
                      if (n.link) nav(n.link);
                    }}
                  >
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read_at ? 'bg-transparent' : 'bg-brand-500')} />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-steel-900">{n.title}</span>
                      {n.body && <span className="block text-sm text-steel-600">{n.body}</span>}
                      <span className="mt-0.5 block text-xs text-steel-400">{formatDate(n.created_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

function QuickLogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role } = useAuth();
  if (!open || !role) return null;
  const actions = quickActionsFor(role);
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Quick actions">
      <div className="absolute inset-0 bg-steel-950/60" onClick={onClose} />
      <div className="pb-safe absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-4 shadow-2xl">
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-steel-300" />
        <p className="mb-3 font-display text-xl font-bold uppercase">Quick Log</p>
        <div className="grid grid-cols-2 gap-3">
          {actions.map((a) => (
            <Link
              key={a.to + a.label}
              to={a.to}
              onClick={onClose}
              className={clsx('flex min-h-[96px] flex-col items-start justify-between rounded-xl p-3', a.className)}
            >
              <a.icon className="h-7 w-7" />
              <span className="text-base font-bold leading-tight">{a.label}</span>
            </Link>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-xl bg-steel-100 font-semibold text-steel-700">
          Cancel
        </button>
      </div>
    </div>
  );
}

function MobileMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { role, signOut } = useAuth();
  if (!open || !role) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-steel-950/60" onClick={onClose} />
      <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-steel-900 p-4">
        <div className="mb-6 flex items-center justify-between">
          <Brand />
          <button onClick={onClose} aria-label="Close menu" className="flex h-11 w-11 items-center justify-center rounded-lg text-steel-300 hover:bg-steel-800">
            <X className="h-6 w-6" />
          </button>
        </div>
        <div className="mb-5 rounded-xl bg-steel-800 p-3"><UserChip /></div>
        <div className="flex-1 overflow-y-auto"><NavList items={navFor(role)} onNavigate={onClose} /></div>
        <button onClick={() => { onClose(); void signOut(); }} className="mt-4 flex min-h-[48px] items-center gap-3 rounded-lg px-3 font-semibold text-steel-300 hover:bg-steel-800 hover:text-white">
          <LogOut className="h-5 w-5" /> Sign out
        </button>
      </aside>
    </div>
  );
}

function BottomNav({ onQuick, onMenu }: { onQuick: () => void; onMenu: () => void }) {
  const { role } = useAuth();
  const training = role === 'worker' ? 'Licences' : 'Licences';
  const item = 'flex min-h-[60px] flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold uppercase tracking-wide';
  const cls = ({ isActive }: { isActive: boolean }) => clsx(item, isActive ? 'text-brand-600' : 'text-steel-500');
  const navItems = navFor(role!);
  const Home = navItems.find((n) => n.to === '/')!.icon;
  const Projects = navItems.find((n) => n.to === '/projects')!.icon;
  const Training = navItems.find((n) => n.to === '/training')!.icon;
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t-2 border-steel-200 bg-white lg:hidden" aria-label="Primary">
      <div className="mx-auto flex max-w-lg items-stretch">
        <NavLink to="/" end className={cls}><Home className="h-6 w-6" />Home</NavLink>
        <NavLink to="/projects" className={cls}><Projects className="h-6 w-6" />Sites</NavLink>
        <div className="flex flex-1 items-start justify-center">
          <button onClick={onQuick} aria-label="Quick log"
            className="-mt-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-hivis-500 text-steel-900 shadow-lg shadow-steel-900/30 ring-4 ring-white active:bg-hivis-400">
            <Plus className="h-8 w-8" strokeWidth={3} />
          </button>
        </div>
        <NavLink to="/training" className={cls}><Training className="h-6 w-6" />{training}</NavLink>
        <button onClick={onMenu} className={clsx(item, 'text-steel-500')}><Menu className="h-6 w-6" />More</button>
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { role, signOut, profile } = useAuth();
  const [quick, setQuick] = useState(false);
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [location.pathname]);
  if (!role) return null;

  return (
    <div className="min-h-screen lg:pl-72">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 flex-col bg-steel-900 px-4 py-5 lg:flex">
        <div className="mb-7 px-2"><Brand /></div>
        <div className="flex-1 overflow-y-auto pr-1"><NavList items={navFor(role)} /></div>
        <div className="mt-4 rounded-xl bg-steel-800 p-3">
          <div className="flex items-center justify-between gap-2">
            <UserChip />
            <button onClick={() => void signOut()} aria-label="Sign out" title="Sign out"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-steel-400 hover:bg-steel-700 hover:text-white">
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
        {api.mode === 'demo' && (
          <p className="mt-3 px-2 text-center text-[11px] font-semibold uppercase tracking-wider text-amber-400">Demo mode · local data</p>
        )}
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-steel-200 bg-white/95 px-4 backdrop-blur lg:px-8">
        <div className="lg:hidden"><Brand dark={false} /></div>
        <div className="hidden items-center gap-2 text-sm text-steel-500 lg:flex">
          <span className="font-semibold text-steel-700">{profile?.full_name}</span>
          <ChevronRight className="h-4 w-4" />
          <Badge color={ROLE_COLOR[role]}>{ROLE_LABEL[role]}</Badge>
          {api.mode === 'demo' && <Badge color="amber">Demo data</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <NotificationBell />
          <Link to="/profile" className="lg:hidden" aria-label="My profile"><Avatar name={profile?.full_name ?? ''} size="sm" /></Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-32 pt-5 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">{children}</main>

      <BottomNav onQuick={() => setQuick(true)} onMenu={() => setMenu(true)} />
      <QuickLogSheet open={quick} onClose={() => setQuick(false)} />
      <MobileMenu open={menu} onClose={() => setMenu(false)} />
    </div>
  );
}

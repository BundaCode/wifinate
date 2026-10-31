import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import {
  LayoutDashboard, Ticket, Package as PackageIcon, Activity, BarChart3, Router as RouterIcon, Settings,
  LogOut, Moon, Sun, Menu, X, Wifi, Users, Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

const nav = [
  { to: '/', label: 'Beranda', icon: LayoutDashboard, end: true, mobile: true },
  { to: '/voucher', label: 'Voucher', icon: Ticket, mobile: true },
  { to: '/pelanggan', label: 'Pelanggan', icon: Users, mobile: true },
  { to: '/paket', label: 'Paket Voucher', icon: PackageIcon },
  { to: '/monitor', label: 'Monitor', icon: Activity, mobile: true },
  { to: '/laporan', label: 'Laporan', icon: BarChart3, mobile: true },
  { to: '/kantor', label: 'Jaringan Kantor', icon: Building2, admin: true },
  { to: '/router', label: 'Router', icon: RouterIcon, admin: true },
  { to: '/pengaturan', label: 'Pengaturan', icon: Settings, admin: true },
];

export function Logo({ className }: { className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5', className)}>
      <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-600 text-white shadow-lg shadow-brand-600/30">
        <Wifi className="size-5" strokeWidth={2.5} />
      </span>
      <span className="text-lg font-extrabold tracking-tight">Wifinate</span>
    </div>
  );
}

export default function Layout() {
  const { user, signOut } = useAuth();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const items = nav.filter((n) => !n.admin || user?.role === 'admin');

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Logo />
        <button className="rounded-lg p-1.5 lg:hidden" onClick={() => setOpen(false)} aria-label="Tutup menu"><X className="size-5" /></button>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to} to={to} end={end} onClick={() => setOpen(false)}
            className={({ isActive }) => clsx(
              'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition',
              isActive ? 'bg-brand-600 text-white shadow-md shadow-brand-600/25' : 'text-muted hover:bg-[var(--surface-2)] hover:text-[var(--text)]',
            )}
          >
            <Icon className="size-[18px]" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-2xl border bg-[var(--surface-2)] p-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white">
            {user?.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{user?.name}</p>
            <p className="text-xs capitalize text-muted">{user?.role}</p>
          </div>
          <button onClick={signOut} className="rounded-lg p-2 text-muted hover:bg-[var(--surface)] hover:text-rose-600" title="Keluar">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );

  const current = items.find((n) => (n.end ? loc.pathname === n.to : loc.pathname.startsWith(n.to)));

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r bg-[var(--surface)] lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r bg-[var(--surface)] animate-[pop_.18s_ease-out]">{sidebar}</aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-[var(--bg)]/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <button className="-ml-1 rounded-lg p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu"><Menu className="size-5" /></button>
        <span className="font-bold lg:hidden">{current?.label}</span>
        <div className="flex-1" />
        <button onClick={toggle} className="rounded-xl border bg-[var(--surface)] p-2.5 text-muted transition hover:text-[var(--text)]" title={dark ? 'Mode terang' : 'Mode gelap'}>
          {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:pb-10">
        <Outlet />
      </main>

      {/* Navigasi bawah untuk HP */}
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t bg-[var(--surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {items.filter((n) => n.mobile).map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx('flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold', isActive ? 'text-brand-600' : 'text-muted')}>
            <Icon className="size-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

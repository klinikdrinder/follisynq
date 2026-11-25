'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useApp, Logo } from './AppProvider';
import { cx } from './ui';
import { LayoutDashboard, Users, Film, HardDrive, Settings, Wifi, WifiOff, RefreshCw, AlertTriangle, LogOut, CloudOff } from 'lucide-react';
import { syncNow } from '@/lib/sync';

const NAV = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients/', label: 'Patients', icon: Users },
  { href: '/media/', label: 'Media', icon: Film },
  { href: '/storage/', label: 'Storage', icon: HardDrive },
  { href: '/settings/', label: 'Settings', icon: Settings },
];

export function StatusPills() {
  const { online, sync, offlineAuth, demo } = useApp();
  return (
    <div className="flex items-center gap-2 text-xs font-medium">
      {demo && <span className="rounded-full bg-amber-400 px-2.5 py-1 text-navy-950">DEMO · synthetic data</span>}
      <span className={cx('flex items-center gap-1 rounded-full px-2.5 py-1', online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
        {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{online ? 'Online' : 'Offline'}
      </span>
      {!demo && (
        <button onClick={() => syncNow()} className={cx('flex items-center gap-1 rounded-full px-2.5 py-1', sync.conflicts ? 'bg-red-50 text-red-700' : sync.pending ? 'bg-sky-50 text-sky-700' : 'bg-navy-50 text-navy-600')}>
          {sync.conflicts ? <AlertTriangle className="h-3.5 w-3.5" /> : <RefreshCw className={cx('h-3.5 w-3.5', sync.running && 'animate-spin')} />}
          {sync.conflicts ? `${sync.conflicts} conflict${sync.conflicts > 1 ? 's' : ''}` : sync.pending ? `${sync.pending} pending` : 'Synced'}
        </button>
      )}
      {offlineAuth && <span className="flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-1 text-navy-600"><CloudOff className="h-3.5 w-3.5" />Offline auth</span>}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || '/';
  const { profile, signOut } = useApp();
  const active = (h: string) => (h === '/' ? path === '/' : path.startsWith(h.replace(/\/$/, '')));
  return (
    <div className="min-h-screen bg-[#f7f9fc] md:pl-[84px] lg:pl-60 pb-20 md:pb-0">
      <aside className="fixed inset-y-0 left-0 z-30 hidden md:flex w-[84px] lg:w-60 flex-col border-r border-navy-100 bg-white">
        <div className="flex items-center gap-3 px-5 py-5"><Logo className="h-9 w-9 shrink-0" /><span className="hidden lg:block text-lg font-semibold tracking-tight text-navy-900">Follisync</span></div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={cx('flex items-center gap-3 rounded-xl px-3 py-3 text-[15px] font-medium transition',
              active(n.href) ? 'bg-navy-800 text-white' : 'text-navy-600 hover:bg-navy-50')}>
              <n.icon className="h-5 w-5 shrink-0" /><span className="hidden lg:block">{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-navy-100 p-3">
          <div className="hidden lg:block px-2 pb-2">
            <div className="text-sm font-medium text-navy-900 truncate">{profile?.full_name}</div>
            <div className="text-xs capitalize text-navy-400">{profile?.role === 'nurse' ? 'Clinical assistant / nurse' : profile?.role}</div>
          </div>
          <button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-navy-500 hover:bg-navy-50"><LogOut className="h-5 w-5" /><span className="hidden lg:block">Sign out</span></button>
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-navy-100 bg-white/85 px-4 py-3 backdrop-blur md:px-8">
        <div className="flex items-center gap-2 md:hidden"><Logo className="h-8 w-8" /><span className="font-semibold text-navy-900">Follisync</span></div>
        <div className="hidden md:block text-sm text-navy-400">Klinik Dr Inder</div>
        <StatusPills />
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex md:hidden border-t border-navy-100 bg-white pb-[env(safe-area-inset-bottom)]">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className={cx('flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium', active(n.href) ? 'text-navy-900' : 'text-navy-400')}>
            <n.icon className="h-5 w-5" />{n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

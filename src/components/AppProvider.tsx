'use client';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { restoreSession, signOut as doSignOut, StaffProfile, getDeviceId, deviceModel, unlock } from '@/lib/auth';
import { setActor, onDataChange, save, one } from '@/lib/repo';
import { startAutoSync, stopAutoSync, onSync, SyncState, syncNow } from '@/lib/sync';
import { loadCatalog, RuntimeCatalog } from '@/lib/catalogStore';
import { all, isDemo } from '@/lib/db';
import { pendingRecoveries, recoverRecording } from '@/lib/media';
import { storageEstimate, requestPersistence } from '@/lib/storage/opfs';
import { DEFAULT_ORG } from '@/lib/supabase';
import { Login } from './Login';
import { Button, Input, Toaster, toast } from './ui';
import { Lock } from 'lucide-react';
import { seedDemo } from '@/lib/demo';

export interface OrgSettings { inactivity_lock_minutes: number; offline_auth_hours: number; storage_warn_pct: number; storage_critical_pct: number; consent_version: string; backup_reminder_hours: number; retention_years?: number }
const DEFAULT_SETTINGS: OrgSettings = { inactivity_lock_minutes: 10, offline_auth_hours: 72, storage_warn_pct: 80, storage_critical_pct: 92, consent_version: 'KDI-CONSENT-v1', backup_reminder_hours: 24 };

interface Ctx {
  profile: StaffProfile | null;
  offlineAuth: boolean;
  online: boolean;
  sync: SyncState;
  catalog: RuntimeCatalog | null;
  settings: OrgSettings;
  demo: boolean;
  tick: number;
  branches: any[];
  staff: any[];
  signOut: () => Promise<void>;
  refresh: () => void;
  setProfile: (p: StaffProfile) => void;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => { const c = useContext(AppCtx); if (!c) throw new Error('no app ctx'); return c; };

/** Re-renders when local data changes. */
export function useData<T>(loader: () => Promise<T>, deps: any[] = []): T | undefined {
  const { tick } = useApp();
  const [v, setV] = useState<T>();
  useEffect(() => {
    let alive = true;
    loader().then((x) => alive && setV(x)).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return v;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [offlineAuth, setOfflineAuth] = useState(false);
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<SyncState>({ running: false, pending: 0, conflicts: 0 });
  const [catalog, setCatalog] = useState<RuntimeCatalog | null>(null);
  const [settings, setSettings] = useState<OrgSettings>(DEFAULT_SETTINGS);
  const [tick, setTick] = useState(0);
  const [locked, setLocked] = useState(false);
  const [branches, setBranches] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const demo = typeof window !== 'undefined' && isDemo();
  const lastActive = useRef(Date.now());

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // service worker for offline shell
  useEffect(() => {
    if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('/sw.js').catch(() => {});
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await restoreSession(DEFAULT_SETTINGS.offline_auth_hours);
        if (r) { setProfile(r.profile); setOfflineAuth(r.offline); }
      } finally { setReady(true); }
    })();
  }, []);

  useEffect(() => onDataChange(refresh), [refresh]);
  useEffect(() => onSync((s) => { setSync(s); }), []);

  // after sign-in: actor, device registration, sync, catalog, recovery
  useEffect(() => {
    if (!profile) { stopAutoSync(); return; }
    setActor(profile.id, profile.org_id || DEFAULT_ORG);
    (async () => {
      if (demo) await seedDemo();
      await requestPersistence();
      if (!demo) {
        const id = getDeviceId();
        const existing = await one<any>('registered_devices', id);
        const est = await storageEstimate();
        await save('registered_devices', {
          ...(existing ?? { id, registered_by: profile.id, label: null, active: true, version: 1 }),
          model: deviceModel(), user_agent: navigator.userAgent.slice(0, 250), last_seen_at: new Date().toISOString(),
          storage_summary: { ...(existing?.storage_summary ?? {}), quota: est.quota, usage: est.usage, persisted: est.persisted, reported_at: new Date().toISOString() },
        });
        startAutoSync();
        // first administrator sign-in: install the default clinical catalogue into Supabase (idempotent)
        if (profile.role === 'admin' && navigator.onLine) {
          const { sb } = await import('@/lib/supabase');
          const { count } = await sb().from('procedure_stages').select('id', { count: 'exact', head: true });
          if (count === 0) {
            const { installDefaultCatalog } = await import('@/lib/catalogStore');
            try { await installDefaultCatalog(profile.org_id); toast.info('Default clinical catalogue installed'); const { syncNow } = await import('@/lib/sync'); syncNow(); } catch {}
          }
        }
      }
      const rec = await pendingRecoveries();
      for (const r of rec) {
        const res = await recoverRecording(r);
        res.ok ? toast.info(res.message) : toast.err(res.message);
      }
    })();
  }, [profile, demo]);

  // reference data
  useEffect(() => {
    if (!profile) return;
    (async () => {
      setCatalog(await loadCatalog());
      const orgs = await all('organizations');
      const org = orgs[0];
      if (org?.settings) setSettings({ ...DEFAULT_SETTINGS, ...org.settings });
      setBranches((await all('clinic_branches')).filter((b: any) => b.active));
      setStaff(await all('staff_profiles'));
    })();
  }, [profile, tick]);

  // inactivity lock
  useEffect(() => {
    if (!profile) return;
    const mark = () => { lastActive.current = Date.now(); };
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const t = setInterval(() => {
      const recording = document.body.dataset.recording === '1';
      if (!recording && settings.inactivity_lock_minutes > 0 && Date.now() - lastActive.current > settings.inactivity_lock_minutes * 60_000) setLocked(true);
    }, 15_000);
    return () => { clearInterval(t); ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.removeEventListener(e, mark)); };
  }, [profile, settings.inactivity_lock_minutes]);

  const signOut = useCallback(async () => {
    stopAutoSync();
    await doSignOut();
    setProfile(null);
  }, []);

  if (!ready) return <Splash />;
  if (!profile) return (<><Toaster /><Login onSignedIn={(p) => { setProfile(p); setOfflineAuth(false); }} /></>);

  return (
    <AppCtx.Provider value={{ profile, offlineAuth, online, sync, catalog, settings, demo, tick, branches, staff, signOut, refresh, setProfile }}>
      <Toaster />
      {locked ? <LockScreen name={profile.full_name} onUnlock={() => { lastActive.current = Date.now(); setLocked(false); syncNow(); }} onSignOut={signOut} /> : children}
    </AppCtx.Provider>
  );
}

function Splash() {
  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <div className="text-center">
        <Logo className="mx-auto h-14 w-14" />
        <p className="mt-3 text-navy-400 text-sm">Loading Follisync…</p>
      </div>
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#162542" />
      <path d="M20 46V18h22M20 31h17" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="45" cy="40" r="6" fill="#45b3a7" />
    </svg>
  );
}

function LockScreen({ name, onUnlock, onSignOut }: { name: string; onUnlock: () => void; onSignOut: () => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 p-6">
      <form className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-2xl" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        const ok = await unlock(pw).catch(() => false);
        setBusy(false);
        ok ? onUnlock() : setErr('Incorrect password, or offline authorisation has expired.');
      }}>
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-50"><Lock className="h-6 w-6 text-navy-700" /></div>
        <h1 className="text-xl font-semibold text-navy-900">Follisync locked</h1>
        <p className="mt-1 text-sm text-navy-500">Locked after inactivity. {name}, enter your password to continue.</p>
        <Input type="password" autoFocus className="mt-5" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" />
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <Button className="mt-4 w-full" size="lg" disabled={busy || !pw}>{busy ? 'Checking…' : 'Unlock'}</Button>
        <button type="button" onClick={onSignOut} className="mt-3 text-sm text-navy-500 hover:underline">Sign out</button>
      </form>
    </div>
  );
}

/** Authentication with secure, time-limited offline authorisation. Never bypasses roles. */
import { sb } from './supabase';
import { kvGet, kvSet, getDB } from './db';
import { uuid } from './naming';

export type Role = 'admin' | 'doctor' | 'nurse';
export interface StaffProfile {
  id: string; org_id: string; role: Role; full_name: string; email?: string | null; active: boolean;
  can_create_patients: boolean; all_branches: boolean; branch_ids: string[]; operator_profile?: Record<string, unknown>;
  staff_code?: string | null; professional_role?: string | null;
}
export interface OfflineGrant {
  user_id: string; profile: StaffProfile; verified_at: string; expires_at: string;
  pw: { salt: string; hash: string; iterations: number };
}

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function pbkdf2(password: string, salt: Uint8Array, iterations = 210000): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, key, 256);
  return b64(bits);
}

export function getDeviceId(): string {
  let id = '';
  try { id = localStorage.getItem('fs_device_id') || ''; } catch {}
  if (!id) {
    id = uuid();
    try { localStorage.setItem('fs_device_id', id); } catch {}
  }
  return id;
}
export const deviceSuffix = () => getDeviceId().replace(/-/g, '').slice(0, 2).toUpperCase();

export function deviceModel(): string | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android device';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return null; // unknown — never fabricated
}

async function loadProfile(userId: string): Promise<StaffProfile | null> {
  const { data, error } = await sb().from('staff_profiles').select('*').eq('id', userId).maybeSingle();
  if (error || !data) return null;
  return data as StaffProfile;
}

export async function signIn(email: string, password: string, offlineHours = 72): Promise<StaffProfile> {
  const { data, error } = await sb().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error || !data.user) throw new Error(error?.message === 'Invalid login credentials' ? 'Incorrect email or password' : error?.message || 'Sign-in failed');
  const profile = await loadProfile(data.user.id);
  if (!profile || !profile.active) {
    await sb().auth.signOut();
    throw new Error('This account is not an active Follisync staff member. Contact your administrator.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  await saveGrant(profile, offlineHours, { salt: b64(salt), hash, iterations: 210000 });
  return profile;
}

async function saveGrant(profile: StaffProfile, hours: number, pw?: OfflineGrant['pw']) {
  const prev = await kvGet<OfflineGrant>('grant', false);
  const now = new Date();
  const grant: OfflineGrant = {
    user_id: profile.id, profile, verified_at: now.toISOString(),
    expires_at: new Date(now.getTime() + hours * 3600_000).toISOString(),
    pw: pw ?? prev?.pw ?? { salt: '', hash: '', iterations: 0 },
  };
  await kvSet('grant', grant, false);
}

/** Restores the session: online → verify with Supabase and refresh grant; offline → honour unexpired grant only. */
export async function restoreSession(offlineHours = 72): Promise<{ profile: StaffProfile; offline: boolean } | null> {
  const grant = await kvGet<OfflineGrant>('grant', false);
  const { data } = await sb().auth.getSession();
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (online && data.session) {
    try {
      const { data: u, error } = await sb().auth.getUser();
      if (!error && u.user) {
        const profile = await loadProfile(u.user.id);
        if (!profile || !profile.active) { await signOut(); return null; }
        await saveGrant(profile, offlineHours);
        return { profile, offline: false };
      }
      if (error && /JWT|expired|invalid/i.test(error.message)) { await signOut(); return null; }
    } catch { /* network failure → fall through to offline */ }
  }
  if (grant && data.session && new Date(grant.expires_at) > new Date()) {
    return { profile: grant.profile, offline: true };
  }
  return null;
}

export async function grantInfo() {
  return kvGet<OfflineGrant>('grant', false);
}

/** Unlock after inactivity: verifies the password online, or offline against the stored PBKDF2 hash. */
export async function unlock(password: string): Promise<boolean> {
  const grant = await kvGet<OfflineGrant>('grant', false);
  if (!grant) return false;
  if (navigator.onLine) {
    const email = grant.profile.email;
    if (email) {
      const { error } = await sb().auth.signInWithPassword({ email, password });
      if (!error) return true;
      if (!/fetch|network/i.test(error.message)) return false;
    }
  }
  if (!grant.pw.hash || new Date(grant.expires_at) < new Date()) return false;
  const h = await pbkdf2(password, unb64(grant.pw.salt), grant.pw.iterations);
  return h === grant.pw.hash;
}

export async function signOut() {
  try { await sb().auth.signOut(); } catch {}
  const db = await getDB(false);
  await db.delete('kv', 'grant');
}

export const can = {
  admin: (p?: StaffProfile | null) => p?.role === 'admin',
  createPatient: (p?: StaffProfile | null) => !!p && (p.role !== 'nurse' || p.can_create_patients),
  clinical: (p?: StaffProfile | null) => !!p && ['admin', 'doctor', 'nurse'].includes(p.role),
};

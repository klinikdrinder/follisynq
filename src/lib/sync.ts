/** Idempotent push/pull synchronisation between IndexedDB and Supabase. Media binaries never leave the iPad. */
import { sb } from './supabase';
import { getDB, SYNC_TABLES, REF_TABLES, CURSOR_COL, pkOf, OutboxOp, Conflict, kvGet, kvSet, isDemo } from './db';
import { emitChange } from './repo';
import { getDeviceId } from './auth';

export interface SyncState { running: boolean; lastSync?: string; lastError?: string | null; pending: number; conflicts: number }
let state: SyncState = { running: false, pending: 0, conflicts: 0 };
const subs = new Set<(s: SyncState) => void>();
export const onSync = (f: (s: SyncState) => void) => { subs.add(f); f(state); return () => { subs.delete(f); }; };
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; subs.forEach((f) => f(state)); };

// Order matters for foreign keys.
const PUSH_ORDER = [
  'registered_devices', 'instrument_presets', 'patients', 'patient_demographics', 'patient_clinical_history',
  'patient_hair_characteristics', 'patient_scalp_characteristics', 'patient_consents', 'surgical_sessions',
  'clinical_encounters', 'procedure_instances', 'procedure_parameter_versions', 'donor_assessments', 'graft_batches',
  'graft_batch_assessments', 'clinical_events', 'follow_up_assessments', 'media_assets', 'media_metadata_snapshots',
  'media_storage_locations', 'media_metadata_amendments', 'export_records',
];

export async function refreshCounts() {
  if (isDemo()) return set({ pending: 0, conflicts: 0 });
  const db = await getDB();
  set({ pending: await db.count('outbox'), conflicts: await db.count('conflicts') });
}

let timer: ReturnType<typeof setInterval> | null = null;
export function startAutoSync() {
  if (timer || typeof window === 'undefined') return;
  window.addEventListener('online', () => syncNow());
  timer = setInterval(() => { if (navigator.onLine) syncNow(); }, 30_000);
  syncNow();
}
export function stopAutoSync() { if (timer) clearInterval(timer); timer = null; }

export async function syncNow(): Promise<void> {
  if (state.running || isDemo() || typeof navigator === 'undefined' || !navigator.onLine) return refreshCounts();
  const { data } = await sb().auth.getSession();
  if (!data.session) return refreshCounts();
  set({ running: true, lastError: null });
  try {
    await push();
    await pull();
    set({ lastSync: new Date().toISOString() });
    await kvSet('last_sync', new Date().toISOString());
  } catch (e: any) {
    set({ lastError: e?.message || 'Sync failed' });
  } finally {
    set({ running: false });
    await refreshCounts();
    emitChange();
  }
}

async function push() {
  const db = await getDB();
  for (let round = 0; round < 20; round++) {
    const ops: OutboxOp[] = await db.getAll('outbox');
    if (!ops.length) return;
    ops.sort((a, b) => PUSH_ORDER.indexOf(a.table) - PUSH_ORDER.indexOf(b.table) || a.created_at.localeCompare(b.created_at));
    const batch = ops.slice(0, 100);
    for (const o of batch) { o.inflight = true; await db.put('outbox', o); }
    const { data, error } = await sb().rpc('fs_sync_push', {
      ops: batch.map((o) => ({ op_id: o.op_id, table: o.table, data: o.data, base_version: o.base_version })),
      p_device_id: getDeviceId(),
    });
    if (error) {
      for (const o of batch) { o.inflight = false; o.attempts++; o.last_error = error.message; await db.put('outbox', o); }
      throw new Error(error.message);
    }
    let progressed = false;
    for (const r of data as any[]) {
      const op = batch.find((o) => o.op_id === r.op_id)!;
      const pk = pkOf(op.table);
      const id = (op.data as any)[pk];
      if (r.result === 'applied' || r.result === 'duplicate') {
        progressed = true;
        await db.delete('outbox', op.op_id);
        const local = await db.get(op.table, id);
        if (local && r.version != null) {
          local._server_version = r.version;
          local.version = r.version;
          await db.put(op.table, local);
        }
        // later ops for the same row must carry the new base version
        const rest: OutboxOp[] = (await db.getAll('outbox')).filter((x: OutboxOp) => x.table === op.table && (x.data as any)[pk] === id);
        for (const x of rest) { x.base_version = r.version ?? x.base_version; await db.put('outbox', x); }
      } else if (r.result === 'conflict') {
        progressed = true;
        const c: Conflict = { op_id: op.op_id, table: op.table, local: op.data, server: r.server, detected_at: new Date().toISOString() };
        await db.put('conflicts', c);
        await db.delete('outbox', op.op_id); // preserved in conflicts store until a clinician resolves it
      } else {
        op.inflight = false;
        op.attempts++;
        op.last_error = r.message;
        // parameter version number collision across devices → bump and retry
        if (op.table === 'procedure_parameter_versions' && r.code === '23505') {
          (op.data as any).version_no = Number((op.data as any).version_no || 0) + 1;
          progressed = true;
        }
        await db.put('outbox', op);
      }
    }
    if (!progressed) return; // remaining ops are failing; keep them queued (never discarded)
  }
}

async function pull() {
  const db = await getDB();
  const pendingIds = new Set(((await db.getAll('outbox')) as OutboxOp[]).map((o) => `${o.table}:${(o.data as any)[pkOf(o.table)]}`));
  for (const table of [...REF_TABLES, ...SYNC_TABLES]) {
    const col = CURSOR_COL[table] ?? 'updated_at';
    let cursor = (await kvGet<string>(`cursor:${table}`)) ?? '1970-01-01T00:00:00Z';
    for (let page = 0; page < 50; page++) {
      const { data, error } = await sb().from(table).select('*').gt(col, cursor).order(col, { ascending: true }).limit(500);
      if (error) { if (error.code === '42P01') break; throw new Error(`${table}: ${error.message}`); }
      if (!data?.length) break;
      const tx = db.transaction(table, 'readwrite');
      for (const row of data as any[]) {
        const key = `${table}:${row[pkOf(table)]}`;
        if (pendingIds.has(key)) continue; // never overwrite unsynchronised local edits
        const local = await tx.store.get(row[pkOf(table)]);
        await tx.store.put({ ...row, _server_version: row.version, _local_file: local?._local_file });
      }
      await tx.done;
      cursor = (data[data.length - 1] as any)[col];
      await kvSet(`cursor:${table}`, cursor);
      if (data.length < 500) break;
    }
  }
}

/** Admin-only tables fetched on demand (not cached for offline). */
export async function fetchAdmin(table: 'audit_logs' | 'migration_jobs', limit = 200) {
  const { data, error } = await sb().from(table).select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function resolveConflict(op_id: string, choice: 'mine' | 'server') {
  const db = await getDB();
  const c: Conflict | undefined = await db.get('conflicts', op_id);
  if (!c) return;
  const pk = pkOf(c.table);
  if (choice === 'server') {
    await db.put(c.table, { ...c.server, _server_version: (c.server as any).version });
  } else {
    // re-apply local values on top of the newest server version (explicit, audited overwrite)
    await db.put('outbox', {
      op_id: crypto.randomUUID(), table: c.table, data: { ...c.local, [pk]: (c.local as any)[pk] },
      base_version: (c.server as any).version ?? null, created_at: new Date().toISOString(), attempts: 0,
    } as OutboxOp);
  }
  await db.delete('conflicts', op_id);
  await refreshCounts();
  emitChange();
  syncNow();
}

export async function resetCursors() {
  const db = await getDB();
  const keys = (await db.getAllKeys('kv')).filter((k) => String(k).startsWith('cursor:'));
  for (const k of keys) await db.delete('kv', k);
}

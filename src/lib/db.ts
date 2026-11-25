/** IndexedDB: offline metadata cache + synchronisation queue. Media binaries are NOT stored here (they live in OPFS). */
import { openDB, IDBPDatabase } from 'idb';

export const SYNC_TABLES = [
  'patients', 'patient_demographics', 'patient_clinical_history', 'patient_hair_characteristics', 'patient_scalp_characteristics',
  'patient_consents', 'surgical_sessions', 'clinical_encounters', 'procedure_instances', 'procedure_parameter_versions',
  'donor_assessments', 'graft_batches', 'graft_batch_assessments', 'clinical_events', 'follow_up_assessments',
  'media_assets', 'media_metadata_snapshots', 'media_storage_locations', 'media_metadata_amendments', 'instrument_presets',
  'registered_devices', 'export_records',
] as const;

/** Reference tables pulled read-only (admins edit them online). */
export const REF_TABLES = [
  'organizations', 'clinic_branches', 'staff_profiles', 'procedure_stages', 'procedure_subcategories', 'anatomical_regions',
  'parameter_definitions', 'instrument_catalog',
] as const;

export const ADMIN_TABLES = ['audit_logs', 'migration_jobs'] as const;

export type TableName = (typeof SYNC_TABLES)[number] | (typeof REF_TABLES)[number];

export const PK: Partial<Record<TableName, string>> = {
  patient_demographics: 'patient_id', patient_clinical_history: 'patient_id',
  patient_hair_characteristics: 'patient_id', patient_scalp_characteristics: 'patient_id',
};
export const pkOf = (t: string) => PK[t as TableName] ?? 'id';

/** Tables without updated_at (append-only) are pulled by created_at. */
export const CURSOR_COL: Record<string, string> = {
  procedure_parameter_versions: 'created_at', media_metadata_snapshots: 'created_at', media_metadata_amendments: 'created_at',
  staff_roles: 'created_at',
};

export interface OutboxOp {
  op_id: string;
  table: string;
  data: Record<string, unknown>;
  base_version: number | null;
  created_at: string;
  attempts: number;
  last_error?: string | null;
  inflight?: boolean;
}

export interface Conflict {
  op_id: string;
  table: string;
  local: Record<string, unknown>;
  server: Record<string, unknown>;
  detected_at: string;
}

let dbp: Promise<IDBPDatabase> | null = null;
let currentName = '';

export function dbName(demo: boolean) {
  return demo ? 'follisync-demo' : 'follisync';
}

export function getDB(demo = isDemo()): Promise<IDBPDatabase> {
  const name = dbName(demo);
  if (dbp && currentName === name) return dbp;
  currentName = name;
  dbp = openDB(name, 2, {
    upgrade(db) {
      for (const t of [...SYNC_TABLES, ...REF_TABLES, ...ADMIN_TABLES]) {
        if (!db.objectStoreNames.contains(t)) db.createObjectStore(t, { keyPath: pkOf(t) });
      }
      if (!db.objectStoreNames.contains('outbox')) {
        const s = db.createObjectStore('outbox', { keyPath: 'op_id' });
        s.createIndex('created_at', 'created_at');
      }
      if (!db.objectStoreNames.contains('conflicts')) db.createObjectStore('conflicts', { keyPath: 'op_id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('inflight_recordings')) db.createObjectStore('inflight_recordings', { keyPath: 'media_id' });
    },
  });
  return dbp;
}

export function isDemo(): boolean {
  try { return typeof window !== 'undefined' && localStorage.getItem('fs_demo') === '1'; } catch { return false; }
}

export async function kvGet<T>(key: string, demo?: boolean): Promise<T | undefined> {
  return (await getDB(demo)).get('kv', key);
}
export async function kvSet(key: string, value: unknown, demo?: boolean) {
  return (await getDB(demo)).put('kv', value, key);
}

export async function all<T = any>(table: string): Promise<T[]> {
  return (await getDB()).getAll(table) as Promise<T[]>;
}
export async function get<T = any>(table: string, id: string): Promise<T | undefined> {
  if (!id) return undefined;
  return (await getDB()).get(table, id) as Promise<T | undefined>;
}

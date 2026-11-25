/** Local-first data access. Every write lands in IndexedDB first and is queued for idempotent sync. */
import { getDB, pkOf, OutboxOp, isDemo } from './db';
import { uuid } from './naming';

type Row = Record<string, any>;
const listeners = new Set<() => void>();
export function onDataChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function emitChange() { listeners.forEach((f) => { try { f(); } catch {} }); }

let userId: string | null = null;
let orgId: string | null = null;
export function setActor(u: string | null, o: string | null) { userId = u; orgId = o; }
export const actor = () => userId;
export const currentOrg = () => orgId;

const nowIso = () => new Date().toISOString();

/** Upsert a row locally and queue it. Missing values stay null — never zero-filled. */
export async function save(table: string, row: Row, opts: { insertOnly?: boolean } = {}): Promise<Row> {
  const db = await getDB();
  const pk = pkOf(table);
  if (!row[pk]) row[pk] = uuid();
  const existing: Row | undefined = await db.get(table, row[pk]);
  const merged: Row = {
    ...(existing ?? { created_at: nowIso(), version: 1 }),
    ...row,
    org_id: row.org_id ?? existing?.org_id ?? orgId,
    updated_at: nowIso(),
  };
  if (!existing && 'created_by' in merged === false && ['patients', 'surgical_sessions', 'clinical_encounters', 'donor_assessments', 'graft_batches', 'graft_batch_assessments', 'clinical_events', 'follow_up_assessments', 'procedure_parameter_versions'].includes(table)) {
    merged.created_by = userId;
  }
  if ('updated_by' in merged || ['patients', 'surgical_sessions', 'procedure_instances', 'patient_demographics', 'patient_clinical_history', 'patient_hair_characteristics', 'patient_scalp_characteristics'].includes(table)) {
    merged.updated_by = userId;
  }
  const tx = db.transaction([table, 'outbox'], 'readwrite');
  await tx.objectStore(table).put(merged);
  if (!isDemo()) {
    // merge with a not-yet-sent op for the same row to keep the queue compact
    const ops: OutboxOp[] = await tx.objectStore('outbox').getAll();
    const pending = ops.find((o) => o.table === table && (o.data as Row)[pk] === merged[pk] && !o.inflight);
    const data = stripLocal(merged);
    if (pending && !opts.insertOnly) {
      pending.data = data;
      await tx.objectStore('outbox').put(pending);
    } else {
      const op: OutboxOp = {
        op_id: uuid(), table, data, created_at: nowIso(), attempts: 0,
        base_version: existing && !opts.insertOnly ? (existing._server_version ?? null) : null,
      };
      await tx.objectStore('outbox').put(op);
    }
  }
  await tx.done;
  emitChange();
  return merged;
}

export function stripLocal(r: Row): Row {
  const o: Row = {};
  for (const k of Object.keys(r)) if (!k.startsWith('_')) o[k] = r[k];
  return o;
}

export async function list<T = Row>(table: string, filter?: (r: T) => boolean): Promise<T[]> {
  const rows = (await (await getDB()).getAll(table)) as T[];
  return filter ? rows.filter(filter) : rows;
}
export async function one<T = Row>(table: string, id?: string | null): Promise<T | undefined> {
  if (!id) return undefined;
  return (await (await getDB()).get(table, id)) as T | undefined;
}

export async function pendingCount(): Promise<number> {
  if (isDemo()) return 0;
  return (await getDB()).count('outbox');
}

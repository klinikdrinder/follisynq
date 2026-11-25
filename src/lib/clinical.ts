/** Clinical domain operations (patients, sessions, stage instances, versioned parameters). */
import { save, list, one, actor } from './repo';
import { uuid, nextPatientCode, nextSessionCode, deterministicUuid, isoDate, nextBatchCode } from './naming';
import { deviceSuffix } from './auth';

export type Val = { v: any; src?: string | null; unit?: string | null; method?: string | null; by?: string | null; at?: string | null };
export type Values = Record<string, Val>;

export const isFilled = (x?: Val | null) => x != null && x.v !== null && x.v !== undefined && x.v !== '' && !(Array.isArray(x.v) && !x.v.length);

export async function createPatient(input: { full_name?: string; mrn?: string; branch_id?: string | null; assigned_doctor_id?: string | null; online: boolean; serverCodes?: string[] }) {
  const codes = (await list<any>('patients')).map((p) => p.patient_code).concat(input.serverCodes ?? []);
  const code = nextPatientCode(codes, input.online ? undefined : deviceSuffix());
  const id = uuid();
  const p = await save('patients', {
    id, patient_code: code, full_name: input.full_name?.trim() || null, mrn: input.mrn?.trim() || null,
    branch_id: input.branch_id || null, assigned_doctor_id: input.assigned_doctor_id || null,
    registration_date: isoDate(new Date()), is_demo: false, created_by: actor(), version: 1,
  });
  return p;
}

export async function createSession(patientId: string, extra: Record<string, any> = {}) {
  const sessions = await list<any>('surgical_sessions', (s) => s.patient_id === patientId);
  const code = nextSessionCode(sessions.map((s) => s.session_code));
  return save('surgical_sessions', {
    id: uuid(), patient_id: patientId, session_code: code, surgery_date: isoDate(new Date()), status: 'in_progress',
    donor_regions: [], recipient_regions: [], data: {}, created_by: actor(), version: 1, ...extra,
  });
}

export async function instanceId(sessionId: string, stageCode: string, encounterId?: string | null) {
  return deterministicUuid(`${sessionId}:${stageCode}:${encounterId ?? ''}`);
}

export async function ensureInstance(sessionId: string, stageCode: string, encounterId?: string | null) {
  const id = await instanceId(sessionId, stageCode, encounterId);
  const ex = await one<any>('procedure_instances', id);
  if (ex) return ex;
  return save('procedure_instances', { id, session_id: sessionId, stage_code: stageCode, encounter_id: encounterId ?? null, status: 'not_started', notes: null, version: 1 });
}

export async function currentParams(instance?: any): Promise<{ version: any | null; values: Values }> {
  if (!instance) return { version: null, values: {} };
  const versions = await list<any>('procedure_parameter_versions', (v) => v.instance_id === instance.id);
  versions.sort((a, b) => b.version_no - a.version_no || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const cur = versions.find((v) => v.id === instance.current_parameter_version_id) ?? versions[0] ?? null;
  return { version: cur, values: (cur?.values as Values) ?? {} };
}

/** Saves a NEW immutable parameter version (previous versions and recording snapshots are untouched). */
export async function saveParamVersion(instance: any, values: Values, reason?: string, presetId?: string | null) {
  const versions = await list<any>('procedure_parameter_versions', (v) => v.instance_id === instance.id);
  const nextNo = versions.reduce((m, v) => Math.max(m, v.version_no), 0) + 1;
  const clean: Values = {};
  for (const [k, v] of Object.entries(values)) if (isFilled(v) || (v?.src && v.src !== '')) clean[k] = v;
  const ver = await save('procedure_parameter_versions', {
    id: uuid(), instance_id: instance.id, version_no: nextNo, values: clean, preset_id: presetId ?? null, reason: reason ?? null, created_by: actor(),
  }, { insertOnly: true });
  const status = instance.status === 'not_started' || instance.status === 'media_recorded' ? 'in_progress' : instance.status;
  await save('procedure_instances', { ...instance, current_parameter_version_id: ver.id, status });
  return ver;
}

export async function setConsent(patientId: string, type: string, patch: Record<string, any>) {
  const existing = (await list<any>('patient_consents', (c) => c.patient_id === patientId && c.consent_type === type))[0];
  return save('patient_consents', { ...(existing ?? { id: uuid(), patient_id: patientId, consent_type: type, version: 1 }), ...patch });
}

export async function consentsFor(patientId: string) {
  const rows = await list<any>('patient_consents', (c) => c.patient_id === patientId);
  const by: Record<string, any> = {};
  for (const r of rows) by[r.consent_type] = r;
  return by;
}

/** Whether recording of a given media type is permitted by documented consent. */
export function consentAllows(consents: Record<string, any>, mediaType: 'video' | 'photo' | 'audio') {
  const key = mediaType === 'photo' ? 'photography' : mediaType;
  return consents[key]?.status === 'granted';
}

export async function createBatch(sessionId: string, extra: Record<string, any> = {}) {
  const b = await list<any>('graft_batches', (x) => x.session_id === sessionId);
  return save('graft_batches', { id: uuid(), session_id: sessionId, batch_code: nextBatchCode(b.map((x) => x.batch_code)), data: {}, created_by: actor(), version: 1, ...extra });
}

export function completion(values: Values, defs: { key: string }[]) {
  if (!defs.length) return 0;
  return Math.round((defs.filter((d) => isFilled(values[d.key])).length / defs.length) * 100);
}

/** One tick = clinical photography, video and audio recording consent (research/AI consent stays separate). */
export async function grantRecordingConsent(patientId: string, confirmedBy: string | null, version: string | null) {
  const today = new Date().toISOString().slice(0, 10);
  for (const t of ['photography', 'video', 'audio']) {
    await setConsent(patientId, t, { status: 'granted', consent_date: today, consent_version: version, confirmed_by: confirmedBy, withdrawn_at: null, withdrawal_reason: null });
  }
}

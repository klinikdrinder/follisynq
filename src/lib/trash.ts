/** Delete / restore. Deleting moves records to "Recently deleted" (soft delete, restorable, audited).
 *  Only administrators can permanently erase the original media files from this iPad. */
import { save, list, one } from './repo';
import { opfs } from './storage/opfs';
import { getDeviceId } from './auth';
import { sidecarName } from './naming';

const now = () => new Date().toISOString();

export async function deleteMedia(m: any) {
  await save('media_assets', { ...m, deleted_at: now() });
}

export async function restoreMedia(m: any) {
  // a media item deleted together with its patient is restored with the patient
  await save('media_assets', { ...m, deleted_at: null });
}

/** Administrator only: erase the original file, sidecar and thumbnail from this iPad. Metadata stays (deleted) for the audit trail. */
export async function purgeMediaFiles(m: any, adminId: string) {
  const deviceId = getDeviceId();
  const locs = await list<any>('media_storage_locations', (l) => l.media_id === m.id && l.provider === 'local_opfs' && l.device_id === deviceId);
  for (const l of locs) {
    if (l.relative_path) {
      await opfs.delete(l.relative_path, { approvedBy: adminId, verifiedArchive: true }).catch(() => {});
      await opfs.delete(l.relative_path.replace(/[^/]+$/, sidecarName(m.filename)), { approvedBy: adminId, verifiedArchive: true }).catch(() => {});
    }
    await save('media_storage_locations', { ...l, availability: 'deleted_by_admin' });
  }
  await opfs.delete(`Follisync_Media/_thumbs/${m.id}.jpg`, { approvedBy: adminId, verifiedArchive: true }).catch(() => {});
  await save('media_assets', { ...m, deleted_at: m.deleted_at ?? now(), notes: [m.notes, 'Original file permanently erased by administrator'].filter(Boolean).join(' · ') });
}

/** Moves a patient and everything under them to Recently deleted, all with the same timestamp so restore is exact. */
export async function deletePatient(patientId: string) {
  const ts = now();
  const p = await one<any>('patients', patientId);
  if (!p) return { sessions: 0, media: 0 };
  const sessions = await list<any>('surgical_sessions', (s) => s.patient_id === patientId && !s.deleted_at);
  const encounters = await list<any>('clinical_encounters', (e) => e.patient_id === patientId && !e.deleted_at);
  const media = await list<any>('media_assets', (m) => m.patient_id === patientId && !m.deleted_at);
  for (const s of sessions) await save('surgical_sessions', { ...s, deleted_at: ts });
  for (const e of encounters) await save('clinical_encounters', { ...e, deleted_at: ts });
  for (const m of media) await save('media_assets', { ...m, deleted_at: ts });
  await save('patients', { ...p, deleted_at: ts });
  return { sessions: sessions.length, media: media.length };
}

export async function restorePatient(patientId: string) {
  const p = await one<any>('patients', patientId);
  if (!p?.deleted_at) return;
  const ts = p.deleted_at;
  for (const s of await list<any>('surgical_sessions', (x) => x.patient_id === patientId && x.deleted_at === ts)) await save('surgical_sessions', { ...s, deleted_at: null });
  for (const e of await list<any>('clinical_encounters', (x) => x.patient_id === patientId && x.deleted_at === ts)) await save('clinical_encounters', { ...e, deleted_at: null });
  for (const m of await list<any>('media_assets', (x) => x.patient_id === patientId && x.deleted_at === ts)) await save('media_assets', { ...m, deleted_at: null });
  await save('patients', { ...p, deleted_at: null });
}

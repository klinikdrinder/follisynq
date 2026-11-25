/** Media capture → verified local save → metadata registration pipeline. */
import { opfs, storageEstimate } from './storage/opfs';
import { save, list, one, actor } from './repo';
import { getDB } from './db';
import { mediaFilename, mediaFolder, sidecarName, sessionFolder, uuid, containerForMime, codecFromMime, isoDate } from './naming';
import { getDeviceId, deviceModel } from './auth';
import { APP_VERSION, METADATA_SCHEMA_VERSION } from './supabase';
import type { Values } from './clinical';

export type MediaType = 'video' | 'photo' | 'audio';

export interface CaptureContext {
  patient: any;
  session: any;
  stage: { code: string; folder: string; title: string };
  subcategory?: { code: string; label: string; folder: string } | null;
  region?: string | null;
  graftBatchId?: string | null;
  encounterId?: string | null;
  paramVersion?: any | null;
  values?: Values;
  recordingContext?: Record<string, any>;
  notes?: string | null;
  patientSummary?: Record<string, any>;
  operator?: { id: string; name: string; role: string };
}

export interface PreparedMedia {
  id: string; filename: string; folder: string; path: string; sequence: number; mime: string; startedAt: string;
}

export async function prepareMedia(ctx: CaptureContext, mime: string, originalName?: string): Promise<PreparedMedia> {
  const id = uuid();
  const existing = await list<any>('media_assets', (m) => m.session_id === ctx.session.id && m.stage_code === ctx.stage.code && (m.subcategory_code ?? 'GENERAL') === (ctx.subcategory?.code ?? 'GENERAL'));
  const sequence = existing.reduce((mx, m) => Math.max(mx, m.sequence_no ?? 0), 0) + 1;
  const date = ctx.session.surgery_date || isoDate(new Date());
  const filename = mediaFilename({
    patientCode: ctx.patient.patient_code, sessionCode: ctx.session.session_code, date: new Date(),
    stageCode: ctx.stage.code, subcategoryCode: ctx.subcategory?.code ?? 'GENERAL', sequence, mediaId: id, mime, originalName,
  });
  const folder = mediaFolder(ctx.patient.patient_code, ctx.session.session_code, date, ctx.stage.folder, ctx.subcategory?.folder);
  return { id, filename, folder, path: `${folder}/${filename}`, sequence, mime, startedAt: new Date().toISOString() };
}

export interface Technical {
  width?: number | null; height?: number | null; frameRate?: number | null; durationMs?: number | null; hasAudio?: boolean | null;
  facing?: string | null; orientation?: string | null; source: 'in_app' | 'native_capture' | 'import' | 'recovered'; endedAt?: string;
}

/**
 * Finalises an already-written file: verifies existence/size/checksum, writes the JSON sidecar and manifests,
 * then registers metadata locally + queues it for Supabase. Throws if verification fails — no false "saved" message.
 */
export async function registerMedia(ctx: CaptureContext, prep: PreparedMedia, type: MediaType, written: { size: number; sha256?: string }, tech: Technical) {
  const verify = await opfs.verify(prep.path, { size: written.size, sha256: written.sha256 });
  if (!verify.ok) throw new Error(`Local save could not be verified: ${verify.reason}`);
  const now = new Date().toISOString();
  const deviceId = getDeviceId();
  const media: Record<string, any> = {
    id: prep.id, patient_id: ctx.patient.id, session_id: ctx.session.id, encounter_id: ctx.encounterId ?? null,
    stage_code: ctx.stage.code, subcategory_code: ctx.subcategory?.code ?? null, region: ctx.region ?? null,
    graft_batch_id: ctx.graftBatchId ?? null, sequence_no: prep.sequence, media_type: type, filename: prep.filename,
    mime_type: prep.mime || null, container: containerForMime(prep.mime), video_codec: codecFromMime(prep.mime),
    has_audio: tech.hasAudio ?? null, duration_ms: tech.durationMs ?? null, width: tech.width ?? null, height: tech.height ?? null,
    frame_rate: tech.frameRate ?? null, size_bytes: verify.size, checksum_sha256: verify.sha256, device_id: deviceId,
    device_model: deviceModel(), camera_facing: tech.facing ?? null, orientation: tech.orientation ?? null,
    recording_source: tech.source, recorded_by: actor(), recorded_at: now, started_at: prep.startedAt, ended_at: tech.endedAt ?? now,
    parameter_version_id: ctx.paramVersion?.id ?? null, recording_context: ctx.recordingContext ?? {}, notes: ctx.notes ?? null,
    app_version: APP_VERSION, metadata_schema_version: METADATA_SCHEMA_VERSION,
    integrity_status: tech.source === 'recovered' ? 'partial_recovered' : 'verified', version: 1,
    _local_file: true,
  };
  const snapshot = {
    schema_version: METADATA_SCHEMA_VERSION,
    identification: { media_uuid: prep.id, patient_uuid: ctx.patient.id, patient_code: ctx.patient.patient_code, session_uuid: ctx.session.id,
      session_code: ctx.session.session_code, encounter_uuid: ctx.encounterId ?? null, stage_code: ctx.stage.code, stage_title: ctx.stage.title,
      subcategory_code: ctx.subcategory?.code ?? null, subcategory_label: ctx.subcategory?.label ?? null, region: ctx.region ?? null,
      graft_batch_id: ctx.graftBatchId ?? null, sequence_no: prep.sequence },
    clinical_context: {
      patient_characteristics: ctx.patientSummary ?? {}, operator: ctx.operator ?? null,
      parameter_version_id: ctx.paramVersion?.id ?? null, parameter_version_no: ctx.paramVersion?.version_no ?? null,
      parameters: ctx.values ?? {}, notes: ctx.notes ?? null,
    },
    technical: { created_at: now, started_at: prep.startedAt, ended_at: media.ended_at, duration_ms: media.duration_ms, width: media.width,
      height: media.height, frame_rate: media.frame_rate, mime_type: media.mime_type, container: media.container, video_codec: media.video_codec,
      has_audio: media.has_audio, size_bytes: media.size_bytes, checksum_sha256: media.checksum_sha256, device_uuid: deviceId,
      device_model: media.device_model, camera_facing: media.camera_facing, orientation: media.orientation, recording_source: tech.source,
      app_version: APP_VERSION, metadata_schema_version: METADATA_SCHEMA_VERSION },
    recording_context: ctx.recordingContext ?? {},
    storage: { provider: 'local_opfs', relative_path: prep.path, originating_device: deviceId, cloud_file_id: null, cloud_path: null },
  };
  // 1. JSON sidecar next to the media file
  await opfs.save(`${prep.folder}/${sidecarName(prep.filename)}`, JSON.stringify(snapshot, null, 2));
  // 2. metadata (local first, queued for sync)
  await save('media_assets', media);
  await save('media_metadata_snapshots', { id: uuid(), media_id: prep.id, snapshot, schema_version: METADATA_SCHEMA_VERSION }, { insertOnly: true });
  await save('media_storage_locations', {
    id: uuid(), media_id: prep.id, provider: 'local_opfs', device_id: deviceId, relative_path: prep.path, cloud_file_id: null, cloud_path: null,
    availability: 'available', backup_status: 'none', migration_status: 'pending', integrity_status: media.integrity_status,
    checksum_sha256: verify.sha256, size_bytes: verify.size, verified_at: now, version: 1,
  });
  // 3. stage instance status becomes "media recorded" if nothing else documented yet
  const { ensureInstance } = await import('./clinical');
  const inst = await ensureInstance(ctx.session.id, ctx.stage.code, ctx.encounterId);
  if (inst.status === 'not_started') await save('procedure_instances', { ...inst, status: 'media_recorded' });
  // 4. manifests
  await writeManifests(ctx.patient, ctx.session);
  // 5. thumbnail (best effort, local only)
  makeThumbnail(prep.id, prep.path, type).catch(() => {});
  return media;
}

export async function writeManifests(patient: any, session: any) {
  const folder = sessionFolder(patient.patient_code, session.session_code, session.surgery_date || isoDate(new Date()));
  const media = await list<any>('media_assets', (m) => m.session_id === session.id);
  const locs = await list<any>('media_storage_locations');
  const manifest = {
    generated_at: new Date().toISOString(), schema_version: METADATA_SCHEMA_VERSION, app_version: APP_VERSION,
    patient_uuid: patient.id, patient_code: patient.patient_code, session_uuid: session.id, session_code: session.session_code,
    device_uuid: getDeviceId(),
    items: media.map((m) => {
      const loc = locs.find((l) => l.media_id === m.id && l.provider === 'local_opfs');
      return { media_uuid: m.id, filename: m.filename, relative_path: loc?.relative_path ?? null, media_type: m.media_type,
        stage_code: m.stage_code, subcategory_code: m.subcategory_code, size_bytes: m.size_bytes, checksum_sha256: m.checksum_sha256,
        recorded_at: m.recorded_at, device_uuid: m.device_id, deleted: !!m.deleted_at };
    }),
  };
  // case metadata deliberately excludes the patient name and other direct identifiers
  const caseMeta = {
    generated_at: new Date().toISOString(), patient_uuid: patient.id, patient_code: patient.patient_code,
    session: { id: session.id, code: session.session_code, surgery_date: session.surgery_date, status: session.status,
      procedure_type: session.procedure_type, technique: session.technique, implantation_technique: session.implantation_technique,
      shave_type: session.shave_type, planned_graft_count: session.planned_graft_count, donor_regions: session.donor_regions, recipient_regions: session.recipient_regions },
  };
  await opfs.save(`${folder}/media_manifest.json`, JSON.stringify(manifest, null, 2));
  await opfs.save(`${folder}/case_metadata.json`, JSON.stringify(caseMeta, null, 2));
}

export async function makeThumbnail(mediaId: string, path: string, type: MediaType) {
  if (type === 'audio') return;
  const file = await opfs.retrieve(path);
  if (!file) return;
  let bmp: ImageBitmap | HTMLVideoElement;
  const url = URL.createObjectURL(file);
  try {
    if (type === 'photo') bmp = await createImageBitmap(file);
    else {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'metadata'; v.src = url;
      await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('thumb')); setTimeout(() => rej(new Error('timeout')), 8000); });
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
      await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 1500); });
      bmp = v;
    }
    const w0 = 'videoWidth' in bmp ? bmp.videoWidth : bmp.width;
    const h0 = 'videoHeight' in bmp ? bmp.videoHeight : bmp.height;
    if (!w0 || !h0) return;
    const scale = 320 / Math.max(w0, h0);
    const c = document.createElement('canvas');
    c.width = Math.round(w0 * scale); c.height = Math.round(h0 * scale);
    c.getContext('2d')!.drawImage(bmp as any, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.75));
    if (blob) await opfs.save(`Follisync_Media/_thumbs/${mediaId}.jpg`, blob);
  } finally { URL.revokeObjectURL(url); }
}

export async function thumbUrl(mediaId: string): Promise<string | null> {
  const f = await opfs.retrieve(`Follisync_Media/_thumbs/${mediaId}.jpg`);
  return f ? URL.createObjectURL(f) : null;
}

export async function localPathFor(mediaId: string): Promise<string | null> {
  const deviceId = getDeviceId();
  const locs = await list<any>('media_storage_locations', (l) => l.media_id === mediaId && l.provider === 'local_opfs');
  return (locs.find((l) => l.device_id === deviceId) ?? null)?.relative_path ?? null;
}

export type Availability = 'local' | 'other_device' | 'missing' | 'unknown';
export async function availabilityOf(m: any): Promise<{ status: Availability; path: string | null }> {
  const deviceId = getDeviceId();
  if (m.device_id && m.device_id !== deviceId) {
    const path = await localPathFor(m.id); // may have been restored from a backup onto this iPad
    if (path && (await opfs.retrieve(path))) return { status: 'local', path };
    return { status: 'other_device', path: null };
  }
  const path = await localPathFor(m.id);
  if (!path) return { status: 'unknown', path: null };
  const f = await opfs.retrieve(path);
  return { status: f && f.size > 0 ? 'local' : 'missing', path };
}

// ───────────── storage safety ─────────────
export interface StorageCheck { ok: boolean; level: 'ok' | 'low' | 'critical' | 'unknown'; available: number | null; pct: number | null; message?: string }
export async function checkStorage(thresholds = { warn: 80, critical: 92 }, minFreeBytes = 300 * 1024 * 1024): Promise<StorageCheck> {
  const e = await storageEstimate();
  if (e.quota == null || e.usage == null) return { ok: true, level: 'unknown', available: null, pct: null, message: 'Storage estimate unavailable on this browser' };
  const available = e.quota - e.usage;
  const pct = (e.usage / e.quota) * 100;
  if (available < minFreeBytes || pct >= thresholds.critical) return { ok: false, level: 'critical', available, pct, message: 'Critical storage: recording is blocked until media is exported/backed up and space is freed.' };
  if (pct >= thresholds.warn) return { ok: true, level: 'low', available, pct, message: 'Storage is running low — export and back up soon.' };
  return { ok: true, level: 'ok', available, pct };
}

// ───────────── interrupted recording journal ─────────────
export async function journalStart(entry: { media_id: string; path: string; type: MediaType; ctx: any; prep: PreparedMedia; tech: Partial<Technical> }) {
  await (await getDB()).put('inflight_recordings', { ...entry, started_at: new Date().toISOString() });
}
export async function journalEnd(mediaId: string) { await (await getDB()).delete('inflight_recordings', mediaId); }
export async function pendingRecoveries(): Promise<any[]> { return (await getDB()).getAll('inflight_recordings'); }

/** Attempts to recover a recording interrupted by a crash/kill. Partial files are flagged, never presented as complete. */
export async function recoverRecording(entry: any): Promise<{ ok: boolean; message: string }> {
  const v = await opfs.verify(entry.path);
  if (!v.ok || !v.size) {
    await journalEnd(entry.media_id);
    return { ok: false, message: `Recording ${entry.prep.filename} could not be recovered (${v.reason ?? 'no data written'}).` };
  }
  const patient = await one<any>('patients', entry.ctx.patientId);
  const session = await one<any>('surgical_sessions', entry.ctx.sessionId);
  if (!patient || !session) { await journalEnd(entry.media_id); return { ok: false, message: 'Case for interrupted recording not found on this iPad.' }; }
  await registerMedia({ ...entry.ctx.capture, patient, session, notes: 'Recovered after interruption — file may be truncated or unplayable.' },
    entry.prep, entry.type, { size: v.size!, sha256: v.sha256 }, { ...entry.tech, source: 'recovered', endedAt: new Date().toISOString() });
  await journalEnd(entry.media_id);
  return { ok: true, message: `Recovered partial recording ${entry.prep.filename} (${Math.round(v.size! / 1024)} KB). Marked as partial.` };
}

/** Amend media metadata with an auditable record per changed field. Permanent identifiers never change. */
export async function amendMedia(media: any, patch: Record<string, any>, reason: string) {
  const changed = Object.keys(patch).filter((k) => JSON.stringify(media[k] ?? null) !== JSON.stringify(patch[k] ?? null));
  if (!changed.length) return media;
  for (const k of changed) {
    await save('media_metadata_amendments', { id: uuid(), media_id: media.id, field: k, old_value: media[k] ?? null, new_value: patch[k] ?? null, reason, amended_by: actor() }, { insertOnly: true });
  }
  return save('media_assets', { ...media, ...patch });
}

export async function probeFile(file: File, type: MediaType): Promise<{ width?: number | null; height?: number | null; durationMs?: number | null }> {
  const url = URL.createObjectURL(file);
  try {
    if (type === 'photo') { const b = await createImageBitmap(file); return { width: b.width, height: b.height }; }
    const el = document.createElement(type === 'audio' ? 'audio' : 'video') as HTMLVideoElement;
    el.preload = 'metadata'; el.src = url;
    await new Promise<void>((res) => { el.onloadedmetadata = () => res(); el.onerror = () => res(); setTimeout(res, 5000); });
    return { width: (el as any).videoWidth || null, height: (el as any).videoHeight || null, durationMs: isFinite(el.duration) ? Math.round(el.duration * 1000) : null };
  } catch { return {}; } finally { URL.revokeObjectURL(url); }
}

/** Import an existing photo/video/audio file: copied (not transcoded) into OPFS, verified, registered. */
export async function importExternal(ctx: CaptureContext, file: File, source: 'native_capture' | 'import' = 'import') {
  const type: MediaType = file.type.startsWith('image/') ? 'photo' : file.type.startsWith('audio/') ? 'audio' : 'video';
  const prep = await prepareMedia(ctx, file.type || '', file.name);
  const w = await opfs.save(prep.path, file);
  const dims = await probeFile(file, type);
  return registerMedia(ctx, { ...prep, startedAt: new Date(file.lastModified || Date.now()).toISOString() }, type, w,
    { ...dims, source, hasAudio: type === 'photo' ? false : null });
}

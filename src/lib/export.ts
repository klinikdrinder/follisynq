/** Secure export & recovery. ZIP (store, no recompression) built from disk-backed OPFS Files in batches, optionally AES-256-GCM encrypted. */
import { opfs, hashFile, crcBlob, encryptToOpfs, decryptToOpfs, deleteTemp } from './storage/opfs';
import { list, save, actor, one } from './repo';
import { uuid, sidecarName, isoDate } from './naming';
import { getDeviceId } from './auth';
import { APP_VERSION } from './supabase';
import { writeManifests } from './media';

interface ZipEntry { name: string; blob: Blob; crc: number }

const enc = new TextEncoder();
function u16(n: number) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
function u32(n: number) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; }
function dosTime(d: Date) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** Builds a ZIP as a composite Blob. File parts stay disk-backed, so memory use stays small. Max 4 GB per archive. */
export function buildZip(entries: ZipEntry[]): Blob {
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  const { time, date } = dosTime(new Date());
  for (const e of entries) {
    const name = enc.encode(e.name);
    const size = e.blob.size;
    const local = [u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(e.crc), u32(size), u32(size), u16(name.length), u16(0), name];
    const localLen = 30 + name.length;
    parts.push(...local, e.blob);
    central.push(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(e.crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name);
    offset += localLen + size;
  }
  const cdSize = central.reduce((s, p) => s + (p as Uint8Array).length, 0);
  const end = [u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(cdSize), u32(offset), u16(0)];
  return new Blob([...parts, ...central, ...end], { type: 'application/zip' });
}

/** Parses a store-method ZIP created by Follisync. */
export async function readZip(blob: Blob): Promise<{ name: string; blob: Blob; crc: number }[]> {
  const tailLen = Math.min(blob.size, 65557);
  const tail = new DataView(await blob.slice(blob.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid ZIP archive');
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOff = tail.getUint32(eocd + 16, true);
  const cd = new DataView(await blob.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out: { name: string; blob: Blob; crc: number }[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory');
    const method = cd.getUint16(p + 10, true);
    const crc = cd.getUint32(p + 16, true);
    const size = cd.getUint32(p + 24, true);
    const nlen = cd.getUint16(p + 28, true), xlen = cd.getUint16(p + 30, true), clen = cd.getUint16(p + 32, true);
    const lho = cd.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (method !== 0) throw new Error(`Unsupported compression in ${name}`);
    const lh = new DataView(await blob.slice(lho, lho + 30).arrayBuffer());
    const start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    out.push({ name, blob: blob.slice(start, start + size), crc });
  }
  return out;
}

export interface ExportPlan { batches: { files: { path: string; size: number; mediaId?: string }[]; bytes: number }[]; mediaIds: string[]; totalBytes: number }

export async function planExport(sessionIds: string[], batchLimit = 1024 * 1024 * 1024): Promise<ExportPlan> {
  const deviceId = getDeviceId();
  const files: { path: string; size: number; mediaId?: string }[] = [];
  const mediaIds: string[] = [];
  for (const sid of sessionIds) {
    const session = await one<any>('surgical_sessions', sid);
    const patient = session && (await one<any>('patients', session.patient_id));
    if (!session || !patient) continue;
    await writeManifests(patient, session);
    const media = await list<any>('media_assets', (m) => m.session_id === sid && !m.deleted_at);
    const locs = await list<any>('media_storage_locations', (l) => l.provider === 'local_opfs' && l.device_id === deviceId);
    for (const m of media) {
      const loc = locs.find((l) => l.media_id === m.id);
      if (!loc?.relative_path) continue;
      const f = await opfs.retrieve(loc.relative_path);
      if (!f) continue;
      files.push({ path: loc.relative_path, size: f.size, mediaId: m.id });
      const sc = loc.relative_path.replace(/[^/]+$/, sidecarName(m.filename));
      const sf = await opfs.retrieve(sc);
      if (sf) files.push({ path: sc, size: sf.size });
      mediaIds.push(m.id);
    }
    const base = (await import('./naming')).sessionFolder(patient.patient_code, session.session_code, session.surgery_date || isoDate(new Date()));
    for (const n of ['media_manifest.json', 'case_metadata.json']) {
      const f = await opfs.retrieve(`${base}/${n}`);
      if (f) files.push({ path: `${base}/${n}`, size: f.size });
    }
  }
  const batches: ExportPlan['batches'] = [];
  let cur: ExportPlan['batches'][number] = { files: [], bytes: 0 };
  for (const f of files) {
    if (cur.files.length && cur.bytes + f.size > batchLimit) { batches.push(cur); cur = { files: [], bytes: 0 }; }
    cur.files.push(f); cur.bytes += f.size;
  }
  if (cur.files.length) batches.push(cur);
  return { batches, mediaIds, totalBytes: files.reduce((s, f) => s + f.size, 0) };
}

/** Produces one export batch file (zip or encrypted .fsenc). Caller delivers it via share/download. */
export async function buildBatch(batch: ExportPlan['batches'][number], index: number, total: number, password: string | null, onStep?: (m: string) => void): Promise<File> {
  const entries: ZipEntry[] = [];
  const manifest: any = { follisync_export: true, app_version: APP_VERSION, device_uuid: getDeviceId(), created_at: new Date().toISOString(), batch: index + 1, of: total, files: [] };
  for (const f of batch.files) {
    onStep?.(`Verifying ${f.path.split('/').pop()}`);
    const h = await hashFile(f.path, true);
    const file = await opfs.retrieve(f.path);
    if (!file) throw new Error(`Missing file during export: ${f.path}`);
    entries.push({ name: f.path, blob: file, crc: h.crc32! });
    manifest.files.push({ path: f.path, size: h.size, sha256: h.sha256, media_uuid: f.mediaId ?? null });
  }
  const mBlob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  entries.push({ name: 'Follisync_Media/export_manifest.json', blob: mBlob, crc: await crcBlob(mBlob) });
  const zip = buildZip(entries);
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const base = `Follisync_Export_${stamp}_part${index + 1}of${total}`;
  if (!password) return new File([zip], `${base}.zip`, { type: 'application/zip' });
  onStep?.('Encrypting (AES-256-GCM)…');
  const tmp = `Follisync_Tmp/${base}.fsenc`;
  await encryptToOpfs(zip, password, tmp, (d, t) => onStep?.(`Encrypting ${Math.round((d / t) * 100)}%`));
  const out = await opfs.retrieve(tmp);
  if (!out) throw new Error('Encrypted output missing');
  return new File([out], `${base}.fsenc`, { type: 'application/octet-stream' });
}

export async function deliverFile(file: File): Promise<'shared' | 'downloaded'> {
  const nav: any = navigator;
  if (nav.canShare && nav.canShare({ files: [file] })) {
    try { await nav.share({ files: [file], title: file.name }); return 'shared'; } catch (e: any) { if (e?.name === 'AbortError') throw new Error('Export cancelled'); }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}

export async function recordExport(mediaIds: string[], totalBytes: number, encrypted: boolean, scope: any) {
  await save('export_records', { id: uuid(), device_id: getDeviceId(), exported_by: actor(), scope, encrypted, media_count: mediaIds.length, total_bytes: totalBytes, status: 'completed' }, { insertOnly: true });
  const locs = await list<any>('media_storage_locations', (l) => mediaIds.includes(l.media_id) && l.provider === 'local_opfs');
  for (const l of locs) if (l.backup_status === 'none') await save('media_storage_locations', { ...l, backup_status: 'exported' });
}

export async function cleanupTemp() { await deleteTemp('Follisync_Tmp'); }

/**
 * Restore / verify a backup. Files are checked against the export manifest checksums.
 * mode 'verify' only checks integrity (marks backups verified); mode 'restore' also writes files back into OPFS.
 */
export async function restoreBackup(file: File, password: string | null, mode: 'verify' | 'restore', onStep?: (m: string) => void) {
  let zipBlob: Blob = file;
  if (file.name.endsWith('.fsenc')) {
    if (!password) throw new Error('This backup is encrypted — enter its password');
    onStep?.('Decrypting…');
    const tmp = `Follisync_Tmp/restore_${Date.now()}.zip`;
    await decryptToOpfs(file, password, tmp);
    zipBlob = (await opfs.retrieve(tmp))!;
  }
  const entries = await readZip(zipBlob);
  const mEntry = entries.find((e) => e.name.endsWith('export_manifest.json'));
  if (!mEntry) throw new Error('Backup manifest missing — not a Follisync export');
  const manifest = JSON.parse(await mEntry.blob.text());
  const results = { ok: 0, failed: [] as string[], restored: 0, verifiedMedia: [] as string[] };
  for (const f of manifest.files as any[]) {
    const e = entries.find((x) => x.name === f.path);
    if (!e) { results.failed.push(`${f.path}: missing from archive`); continue; }
    onStep?.(`Checking ${f.path.split('/').pop()}`);
    const tmpPath = mode === 'restore' ? f.path : `Follisync_Tmp/verify/${uuid()}`;
    const exists = mode === 'restore' ? await opfs.retrieve(f.path) : null;
    const written = exists && exists.size === f.size ? await hashFile(f.path) : await opfs.save(tmpPath, e.blob);
    if (written.size !== f.size || written.sha256 !== f.sha256) { results.failed.push(`${f.path}: checksum mismatch`); continue; }
    results.ok++;
    if (mode === 'restore' && !exists) results.restored++;
    if (f.media_uuid) results.verifiedMedia.push(f.media_uuid);
  }
  // mark backups verified for media originating on this iPad
  const locs = await list<any>('media_storage_locations', (l) => results.verifiedMedia.includes(l.media_id) && l.provider === 'local_opfs' && l.device_id === getDeviceId());
  for (const l of locs) await save('media_storage_locations', { ...l, backup_status: 'verified' });
  if (mode === 'restore') await reRegisterFromSidecars(entries, manifest);
  await cleanupTemp();
  return results;
}

/** After restoring onto an iPad, register a local storage location for restored files so they can be played here. */
async function reRegisterFromSidecars(entries: { name: string; blob: Blob }[], manifest: any) {
  const deviceId = getDeviceId();
  for (const f of manifest.files as any[]) {
    if (!f.media_uuid) continue;
    const have = await list<any>('media_storage_locations', (l) => l.media_id === f.media_uuid && l.device_id === deviceId && l.provider === 'local_opfs');
    if (have.length) continue;
    const media = await one<any>('media_assets', f.media_uuid);
    if (!media) {
      // metadata not yet on this device (e.g. offline restore) — keep sidecar so it can be reconciled after sync
      continue;
    }
    await save('media_storage_locations', {
      id: uuid(), media_id: f.media_uuid, provider: 'local_opfs', device_id: deviceId, relative_path: f.path,
      availability: 'available', backup_status: 'verified', migration_status: 'pending', integrity_status: 'verified',
      checksum_sha256: f.sha256, size_bytes: f.size, verified_at: new Date().toISOString(), version: 1,
    });
  }
  void entries;
}

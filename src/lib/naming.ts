/** Identifier, code and filename utilities. Pure functions (unit-tested). */

export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as Crypto).randomUUID === 'function') return (crypto as Crypto).randomUUID();
  const b = new Uint8Array(16);
  (globalThis.crypto as Crypto).getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Deterministic UUID from a string key (SHA-256 based, v8-style). Used so that two
 *  iPads creating the same stage instance offline converge on one record. */
export async function deterministicUuid(key: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('follisync:' + key));
  const b = new Uint8Array(buf).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const pad = (n: number, w: number) => String(n).padStart(w, '0');

/** Next patient code. Offline-created codes carry a 2-char device suffix to avoid collisions across iPads. */
export function nextPatientCode(existing: string[], deviceSuffix?: string): string {
  let max = 0;
  for (const c of existing) {
    const m = /^P(\d{6})/.exec(c);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `P${pad(max + 1, 6)}${deviceSuffix ? deviceSuffix.toUpperCase() : ''}`;
}

export function nextSessionCode(existing: string[]): string {
  let max = 0;
  for (const c of existing) {
    const m = /^S(\d+)/.exec(c);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `S${pad(max + 1, 2)}`;
}

export function nextBatchCode(existing: string[]): string {
  let max = 0;
  for (const c of existing) {
    const m = /^GB-(\d+)/.exec(c);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `GB-${pad(max + 1, 3)}`;
}

const MIME_EXT: Record<string, string> = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv', 'video/3gpp': '3gp',
  'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/webm': 'weba', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
};

/** File extension from the ACTUAL mime type produced by the browser (never assume mp4). */
export function extensionForMime(mime: string, fallbackName?: string): string {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXT[base]) return MIME_EXT[base];
  const fromName = fallbackName && /\.([a-z0-9]{2,5})$/i.exec(fallbackName)?.[1];
  if (fromName) return fromName.toLowerCase();
  const sub = base.split('/')[1];
  return sub && /^[a-z0-9]{2,5}$/.test(sub) ? sub : 'bin';
}

export function containerForMime(mime: string): string | null {
  const base = (mime || '').split(';')[0].trim().toLowerCase();
  if (!base) return null;
  if (base.endsWith('/mp4') || base === 'audio/x-m4a') return 'MPEG-4';
  if (base.endsWith('/quicktime')) return 'QuickTime';
  if (base.endsWith('/webm')) return 'WebM';
  if (base.endsWith('/ogg')) return 'Ogg';
  if (base.startsWith('image/')) return base.split('/')[1].toUpperCase();
  return base;
}

export function codecFromMime(mime: string): string | null {
  const m = /codecs="?([^";]+)"?/i.exec(mime || '');
  return m ? m[1] : null;
}

/** Sanitises a code fragment for filenames: uppercase, A–Z 0–9 and underscores only. */
export function safeCode(s: string, max = 24): string {
  return (s || 'NA').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, max) || 'NA';
}

export function compactDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}${pad(x.getMonth() + 1, 2)}${pad(x.getDate(), 2)}`;
}
export function isoDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return `${x.getFullYear()}-${pad(x.getMonth() + 1, 2)}-${pad(x.getDate(), 2)}`;
}

export interface FilenameParts {
  patientCode: string;
  sessionCode: string;
  date: Date | string;
  stageCode: string;
  subcategoryCode: string;
  sequence: number;
  mediaId: string;
  mime: string;
  originalName?: string;
}

/**
 * HT-{PATIENT_CODE}_{SESSION_CODE}_{DATE}_{STAGE_CODE}_{SUBCATEGORY}_{SEQUENCE}_{MEDIA_UUID8}.{EXT}
 * Never contains patient names, ethnicity, DOB or other direct identifiers.
 * Globally unique via the media UUID fragment; the full UUID is kept in metadata and manifests.
 */
export function mediaFilename(p: FilenameParts): string {
  const ext = extensionForMime(p.mime, p.originalName);
  return [
    `HT-${safeCode(p.patientCode, 16)}`,
    safeCode(p.sessionCode, 8),
    compactDate(p.date),
    safeCode(p.stageCode, 4),
    safeCode(p.subcategoryCode),
    pad(p.sequence, 3),
    p.mediaId.replace(/-/g, '').slice(0, 8).toLowerCase(),
  ].join('_') + '.' + ext;
}

export function sidecarName(filename: string) {
  return filename.replace(/\.[^.]+$/, '') + '.json';
}

/** Follisync_Media/P000125/S01_2026-11-25/06_FUE_Harvesting/Punching */
export function sessionFolder(patientCode: string, sessionCode: string, date: Date | string) {
  return `Follisync_Media/${safeCode(patientCode, 16)}/${safeCode(sessionCode, 8)}_${isoDate(date)}`;
}
export function mediaFolder(patientCode: string, sessionCode: string, date: Date | string, stageFolder: string, subFolder?: string) {
  return [sessionFolder(patientCode, sessionCode, date), stageFolder, subFolder].filter(Boolean).join('/');
}

export function formatBytes(n?: number | null): string {
  if (n == null || isNaN(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

export function formatDuration(ms?: number | null): string {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${pad(m, 2)}:${pad(ss, 2)}` : `${m}:${pad(ss, 2)}`;
}

export function daysBetween(a: string | Date, b: string | Date): number {
  const d1 = new Date(typeof a === 'string' ? a.slice(0, 10) + 'T00:00:00' : a);
  const d2 = new Date(typeof b === 'string' ? b.slice(0, 10) + 'T00:00:00' : b);
  d1.setHours(0, 0, 0, 0); d2.setHours(0, 0, 0, 0);
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

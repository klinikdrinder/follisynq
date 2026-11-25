/** Local OPFS storage provider (the only provider implemented in this MVP). */
import type { MediaStorageProvider, StoredFileInfo, StorageStatus } from './provider';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void }>();

function w(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, result, error, progress, done, total } = e.data;
      if (progress != null) { pending.get(progress)?.onProgress?.(done, total); return; }
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      error ? p.reject(new Error(error)) : p.resolve(result);
    };
    worker.onerror = (e) => {
      pending.forEach((p) => p.reject(new Error('Storage worker crashed: ' + (e.message || 'unknown'))));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

export function call<T = any>(msg: Record<string, any>, transfer: Transferable[] = [], onProgress?: (d: number, t: number) => void): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w().postMessage({ ...msg, id }, transfer);
  });
}

export async function opfsSupported(): Promise<{ opfs: boolean; sync: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return { opfs: false, sync: false };
  try {
    const r = await call<{ sync: boolean }>({ op: 'supported' });
    return { opfs: true, sync: r.sync };
  } catch { return { opfs: true, sync: false }; }
}

async function walk(path: string, create = false): Promise<FileSystemFileHandle | null> {
  try {
    const parts = path.split('/').filter(Boolean);
    const name = parts.pop()!;
    let dir = await navigator.storage.getDirectory();
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return await dir.getFileHandle(name, { create });
  } catch { return null; }
}

export async function storageEstimate(): Promise<{ quota: number | null; usage: number | null; persisted: boolean | null }> {
  try {
    const e = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
    return { quota: e.quota ?? null, usage: e.usage ?? null, persisted };
  } catch { return { quota: null, usage: null, persisted: null }; }
}

export async function requestPersistence(): Promise<boolean | null> {
  try { return navigator.storage.persist ? await navigator.storage.persist() : null; } catch { return null; }
}

export const opfs: MediaStorageProvider = {
  id: 'local_opfs',
  async beginWrite(path) { await call({ op: 'open', path }); },
  async appendChunk(path, chunk, flush) { const r = await call<{ size: number }>({ op: 'append', path, buf: chunk, flush }, [chunk]); return r.size; },
  async finishWrite(path) { const r = await call<{ size: number; written: number; sha256: string }>({ op: 'close', path }); return { path, size: r.size, sha256: r.sha256 }; },
  async abortWrite(path) { await call({ op: 'abort', path }); },
  async save(path, data) {
    if (typeof data === 'string') return { path, ...(await call<{ size: number; sha256: string }>({ op: 'writeFile', path, data })) };
    if (data instanceof ArrayBuffer) return { path, ...(await call<{ size: number; sha256: string }>({ op: 'writeFile', path, data }, [data])) };
    return { path, ...(await call<{ size: number; sha256: string }>({ op: 'importBlob', path, blob: data })) };
  },
  async retrieve(path) { const h = await walk(path); return h ? h.getFile() : null; },
  async verify(path, expected) {
    try {
      const r = await call<{ size: number; sha256: string }>({ op: 'hashFile', path });
      if (r.size <= 0) return { ok: false, ...r, reason: 'File is empty' };
      if (expected?.size != null && r.size !== expected.size) return { ok: false, ...r, reason: `Size mismatch (${r.size} vs ${expected.size})` };
      if (expected?.sha256 && r.sha256 !== expected.sha256) return { ok: false, ...r, reason: 'Checksum mismatch' };
      return { ok: true, ...r };
    } catch (e: any) { return { ok: false, reason: /NotFound|could not be found/i.test(e.message) ? 'File missing' : e.message }; }
  },
  async list(prefix) {
    const out: StoredFileInfo[] = [];
    async function rec(dir: FileSystemDirectoryHandle, base: string) {
      // @ts-ignore entries() is available on OPFS directory handles
      for await (const [name, h] of dir.entries()) {
        const p = base ? `${base}/${name}` : name;
        if (h.kind === 'directory') await rec(h as FileSystemDirectoryHandle, p);
        else out.push({ path: p, size: (await (h as FileSystemFileHandle).getFile()).size });
      }
    }
    try {
      let dir = await navigator.storage.getDirectory();
      for (const p of prefix.split('/').filter(Boolean)) dir = await dir.getDirectoryHandle(p);
      await rec(dir, prefix.replace(/\/$/, ''));
    } catch { /* empty */ }
    return out;
  },
  async exportFile(path) { return this.retrieve(path); },
  async delete(path, approval) {
    if (!approval.verifiedArchive || !approval.approvedBy) throw new Error('Original media can only be deleted by an administrator after verified archival');
    await call({ op: 'delete', path });
  },
  async status(): Promise<StorageStatus> {
    const est = await storageEstimate();
    const sup = await opfsSupported();
    return { provider: 'local_opfs', available: sup.opfs && sup.sync, quota: est.quota, usage: est.usage, persisted: est.persisted,
      note: 'Browser-private storage (OPFS). Not visible in the Files app. Not a permanent clinical archive — export and back up regularly.' };
  },
};

export async function hashFile(path: string, crc = false) {
  return call<{ size: number; sha256: string; crc32?: number }>({ op: 'hashFile', path, crc });
}
export async function crcBlob(blob: Blob) { return (await call<{ crc32: number }>({ op: 'crcBlob', blob })).crc32; }
export async function encryptToOpfs(blob: Blob, password: string, out: string, onProgress?: (d: number, t: number) => void) {
  return call<{ size: number }>({ op: 'encrypt', blob, password, out }, [], onProgress);
}
export async function decryptToOpfs(blob: Blob, password: string, out: string) {
  return call<{ size: number }>({ op: 'decrypt', blob, password, out });
}
export async function deleteTemp(path: string) { try { await call({ op: 'delete', path, recursive: true }); } catch {} }

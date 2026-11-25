/// <reference lib="webworker" />
/* OPFS worker: incremental, verified writes of clinical media using synchronous access handles.
 * Recording chunks are appended to disk as they arrive — never held whole in memory. */
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

declare const self: DedicatedWorkerGlobalScope;

type Handle = { access: any; offset: number; hasher: ReturnType<typeof sha256.create> };
const open = new Map<string, Handle>();

async function dirFor(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop()!;
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name };
}
async function fileHandle(path: string, create: boolean) {
  const { dir, name } = await dirFor(path, create);
  return dir.getFileHandle(name, { create });
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crcUpdate(crc: number, buf: Uint8Array) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function* readBlob(blob: Blob, chunk = 4 * 1024 * 1024) {
  for (let off = 0; off < blob.size; off += chunk) {
    yield new Uint8Array(await blob.slice(off, Math.min(off + chunk, blob.size)).arrayBuffer());
  }
}

async function deriveKey(password: string, salt: Uint8Array, iterations: number) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const MAGIC = new TextEncoder().encode('FSENC1');
const ENC_CHUNK = 4 * 1024 * 1024;

async function handle(msg: any): Promise<any> {
  switch (msg.op) {
    case 'supported':
      return { sync: typeof (FileSystemFileHandle.prototype as any).createSyncAccessHandle === 'function' };

    case 'open': {
      const fh: any = await fileHandle(msg.path, true);
      const access = await fh.createSyncAccessHandle();
      access.truncate(0);
      open.set(msg.path, { access, offset: 0, hasher: sha256.create() });
      return { ok: true };
    }
    case 'append': {
      const h = open.get(msg.path);
      if (!h) throw new Error('File not open: ' + msg.path);
      const buf = new Uint8Array(msg.buf);
      let written = 0;
      while (written < buf.length) written += h.access.write(buf.subarray(written), { at: h.offset + written });
      h.offset += written;
      h.hasher.update(buf);
      if (msg.flush) h.access.flush();
      return { size: h.offset };
    }
    case 'close': {
      const h = open.get(msg.path);
      if (!h) throw new Error('File not open: ' + msg.path);
      h.access.flush();
      const size = h.access.getSize();
      h.access.close();
      open.delete(msg.path);
      return { size, written: h.offset, sha256: bytesToHex(h.hasher.digest()) };
    }
    case 'abort': {
      const h = open.get(msg.path);
      if (h) { try { h.access.close(); } catch {} open.delete(msg.path); }
      return { ok: true };
    }
    case 'writeFile': {
      const fh: any = await fileHandle(msg.path, true);
      const access = await fh.createSyncAccessHandle();
      const data: Uint8Array = typeof msg.data === 'string' ? new TextEncoder().encode(msg.data) : new Uint8Array(msg.data);
      access.truncate(0);
      let w = 0;
      while (w < data.length) w += access.write(data.subarray(w), { at: w });
      access.flush();
      const size = access.getSize();
      access.close();
      return { size, sha256: bytesToHex(sha256(data)) };
    }
    case 'importBlob': {
      // stream a File/Blob (import, restore, decrypt output) into OPFS with hashing
      const fh: any = await fileHandle(msg.path, true);
      const access = await fh.createSyncAccessHandle();
      access.truncate(0);
      const hasher = sha256.create();
      let off = 0;
      for await (const chunk of readBlob(msg.blob)) {
        let w = 0;
        while (w < chunk.length) w += access.write(chunk.subarray(w), { at: off + w });
        off += chunk.length;
        hasher.update(chunk);
      }
      access.flush();
      const size = access.getSize();
      access.close();
      return { size, sha256: bytesToHex(hasher.digest()) };
    }
    case 'hashFile': {
      const fh = await fileHandle(msg.path, false);
      const file = await fh.getFile();
      const hasher = sha256.create();
      let crc = 0;
      for await (const chunk of readBlob(file)) { hasher.update(chunk); if (msg.crc) crc = crcUpdate(crc, chunk); }
      return { size: file.size, sha256: bytesToHex(hasher.digest()), crc32: msg.crc ? crc : undefined };
    }
    case 'crcBlob': {
      let crc = 0;
      for await (const chunk of readBlob(msg.blob)) crc = crcUpdate(crc, chunk);
      return { crc32: crc };
    }
    case 'delete': {
      const { dir, name } = await dirFor(msg.path, false);
      await dir.removeEntry(name, { recursive: !!msg.recursive });
      return { ok: true };
    }
    case 'encrypt': {
      // AES-256-GCM, PBKDF2-SHA256 key, chunked so large exports never sit in memory
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iterations = 310000;
      const key = await deriveKey(msg.password, salt, iterations);
      const fh: any = await fileHandle(msg.out, true);
      const access = await fh.createSyncAccessHandle();
      access.truncate(0);
      const header = new Uint8Array(6 + 16 + 4 + 4);
      header.set(MAGIC, 0); header.set(salt, 6);
      new DataView(header.buffer).setUint32(22, iterations); new DataView(header.buffer).setUint32(26, ENC_CHUNK);
      let off = access.write(header, { at: 0 });
      let idx = 0;
      for await (const chunk of readBlob(msg.blob, ENC_CHUNK)) {
        const iv = new Uint8Array(12);
        crypto.getRandomValues(iv.subarray(0, 8));
        new DataView(iv.buffer).setUint32(8, idx++);
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, chunk));
        const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, ct.length);
        off += access.write(iv, { at: off }); off += access.write(len, { at: off }); off += access.write(ct, { at: off });
        self.postMessage({ progress: msg.id, done: Math.min(idx * ENC_CHUNK, msg.blob.size), total: msg.blob.size });
      }
      access.flush();
      const size = access.getSize();
      access.close();
      return { size };
    }
    case 'decrypt': {
      const blob: Blob = msg.blob;
      const head = new Uint8Array(await blob.slice(0, 30).arrayBuffer());
      if (new TextDecoder().decode(head.subarray(0, 6)) !== 'FSENC1') throw new Error('Not a Follisync encrypted backup');
      const salt = head.slice(6, 22);
      const dv = new DataView(head.buffer);
      const key = await deriveKey(msg.password, salt, dv.getUint32(22));
      const fh: any = await fileHandle(msg.out, true);
      const access = await fh.createSyncAccessHandle();
      access.truncate(0);
      let pos = 30, out = 0;
      try {
        while (pos < blob.size) {
          const meta = new Uint8Array(await blob.slice(pos, pos + 16).arrayBuffer());
          const iv = meta.slice(0, 12);
          const len = new DataView(meta.buffer).getUint32(12);
          const ct = await blob.slice(pos + 16, pos + 16 + len).arrayBuffer();
          const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
          out += access.write(pt, { at: out });
          pos += 16 + len;
        }
      } catch (e) {
        access.close();
        throw new Error('Decryption failed — wrong password or damaged file');
      }
      access.flush();
      access.close();
      return { size: out };
    }
    default:
      throw new Error('Unknown op ' + msg.op);
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    const result = await handle(msg);
    self.postMessage({ id: msg.id, result });
  } catch (err: any) {
    self.postMessage({ id: msg.id, error: err?.name === 'QuotaExceededError' ? 'Insufficient storage on this iPad' : err?.message || String(err) });
  }
};

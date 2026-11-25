import { describe, it, expect } from 'vitest';
import { buildZip, readZip } from '@/lib/export';

function crc32(buf: Uint8Array) { let c = 0xffffffff; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; }

describe('export archive', () => {
  it('round-trips store-method ZIPs with correct CRCs', async () => {
    const a = new TextEncoder().encode('{"media_uuid":"x"}');
    const b = new Uint8Array(100_000).map((_, i) => i % 251);
    const zip = buildZip([{ name: 'Follisync_Media/P1/a.json', blob: new Blob([a]), crc: crc32(a) }, { name: 'Follisync_Media/P1/b.mp4', blob: new Blob([b]), crc: crc32(b) }]);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['Follisync_Media/P1/a.json', 'Follisync_Media/P1/b.mp4']);
    expect(new Uint8Array(await entries[1].blob.arrayBuffer())).toEqual(b);
    expect(entries[1].crc).toBe(crc32(b));
  });
});

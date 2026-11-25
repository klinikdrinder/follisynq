import { describe, it, expect } from 'vitest';
import { mediaFilename, extensionForMime, nextPatientCode, nextSessionCode, nextBatchCode, sessionFolder, mediaFolder, sidecarName, deterministicUuid, uuid, safeCode, daysBetween } from '@/lib/naming';

describe('file naming', () => {
  const base = { patientCode: 'P000125', sessionCode: 'S01', date: new Date(2026, 10, 25), stageCode: 'S06', subcategoryCode: 'PUNCHING', sequence: 1, mediaId: 'a8f3c21d-1111-4222-8333-444455556666' };
  it('matches the specified format', () => {
    expect(mediaFilename({ ...base, mime: 'video/mp4' })).toBe('HT-P000125_S01_20261125_S06_PUNCHING_001_a8f3c21d.mp4');
  });
  it('uses the actual container extension, never assuming mp4', () => {
    expect(mediaFilename({ ...base, mime: 'video/webm;codecs=vp9,opus' })).toMatch(/\.webm$/);
    expect(mediaFilename({ ...base, mime: 'video/quicktime' })).toMatch(/\.mov$/);
    expect(mediaFilename({ ...base, mime: 'audio/mp4' })).toMatch(/\.m4a$/);
    expect(mediaFilename({ ...base, mime: 'image/jpeg' })).toMatch(/\.jpg$/);
    expect(extensionForMime('', 'IMG_0001.HEIC')).toBe('heic');
  });
  it('never includes identifying text and sanitises codes', () => {
    const f = mediaFilename({ ...base, subcategoryCode: 'Graft extraction / forceps', mime: 'video/mp4' });
    expect(f).toMatch(/^HT-[A-Z0-9_]+_[a-f0-9]{8}\.mp4$/);
    expect(safeCode('Ahmad bin Ali')).toBe('AHMAD_BIN_ALI'); // codes only — names are never passed in
  });
  it('is unique per media UUID across devices', () => {
    const a = mediaFilename({ ...base, mediaId: uuid(), mime: 'video/mp4' });
    const b = mediaFilename({ ...base, mediaId: uuid(), mime: 'video/mp4' });
    expect(a).not.toBe(b);
  });
  it('builds the OPFS folder layout', () => {
    expect(sessionFolder('P000125', 'S01', '2026-11-25')).toBe('Follisync_Media/P000125/S01_2026-11-25');
    expect(mediaFolder('P000125', 'S01', '2026-11-25', '06_FUE_Harvesting', 'Continuous_punching')).toBe('Follisync_Media/P000125/S01_2026-11-25/06_FUE_Harvesting/Continuous_punching');
    expect(sidecarName('HT-x_001_ab.mp4')).toBe('HT-x_001_ab.json');
  });
});

describe('codes', () => {
  it('generates sequential patient, session and batch codes', () => {
    expect(nextPatientCode([])).toBe('P000001');
    expect(nextPatientCode(['P000009', 'P000124'])).toBe('P000125');
    expect(nextPatientCode(['P000124'], 'a7')).toBe('P000125A7');
    expect(nextSessionCode(['S01', 'S02'])).toBe('S03');
    expect(nextBatchCode(['GB-001'])).toBe('GB-002');
  });
  it('derives deterministic instance ids', async () => {
    const a = await deterministicUuid('s:S06:'), b = await deterministicUuid('s:S06:'), c = await deterministicUuid('s:S08:');
    expect(a).toBe(b); expect(a).not.toBe(c); expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('computes days since surgery', () => { expect(daysBetween('2026-11-01', '2026-11-08')).toBe(7); });
});

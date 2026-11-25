import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';

beforeAll(() => { (globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }; (globalThis as any).navigator ??= { onLine: true, userAgent: 'test' }; });

describe('local-first clinical workflow', async () => {
  const { setActor, save, list } = await import('@/lib/repo');
  const { createPatient, createSession, ensureInstance, saveParamVersion, currentParams, completion } = await import('@/lib/clinical');
  const { getDB } = await import('@/lib/db');
  const { STAGES } = await import('@/lib/catalog');
  setActor('11111111-1111-4111-8111-111111111111', 'org');

  it('creates a patient with only a name, no fabricated values', async () => {
    const p = await createPatient({ full_name: 'Test Only', online: true });
    expect(p.patient_code).toMatch(/^P\d{6}$/);
    expect(p.mrn).toBeNull(); expect(p.branch_id).toBeNull();
    const ops = await (await getDB()).getAll('outbox');
    expect(ops.some((o: any) => o.table === 'patients' && o.data.id === p.id && o.base_version === null)).toBe(true);
  });

  it('allows jumping straight to FUE harvesting with no parameters', async () => {
    const p = await createPatient({ mrn: 'MRN-9', online: false });
    expect(p.patient_code).toMatch(/^P\d{6}[A-Z0-9]{2}$/); // offline codes carry device suffix
    const s = await createSession(p.id);
    const inst = await ensureInstance(s.id, 'S06');
    expect(inst.status).toBe('not_started');
    const again = await ensureInstance(s.id, 'S06');
    expect(again.id).toBe(inst.id);
    expect((await currentParams(inst)).values).toEqual({});
  });

  it('versions parameters immutably and keeps blanks out', async () => {
    const p = await createPatient({ full_name: 'V', online: true });
    const s = await createSession(p.id);
    const inst = await ensureInstance(s.id, 'S06');
    const v1 = await saveParamVersion(inst, { punch_diameter: { v: 0.85, unit: 'mm', src: 'instrument' }, rpm: { v: null } });
    expect(v1.values).toEqual({ punch_diameter: { v: 0.85, unit: 'mm', src: 'instrument' } });
    const inst2 = (await list<any>('procedure_instances', (i) => i.id === inst.id))[0];
    const v2 = await saveParamVersion(inst2, { punch_diameter: { v: 0.9 } });
    expect(v2.version_no).toBe(2);
    const versions = await list<any>('procedure_parameter_versions', (x) => x.instance_id === inst.id);
    expect(versions.find((x) => x.version_no === 1).values.punch_diameter.v).toBe(0.85); // historical context untouched
    expect(completion(v2.values, STAGES.find((x) => x.code === 'S06')!.params)).toBeGreaterThan(0);
  });

  it('compacts queued edits for the same row', async () => {
    const p = await createPatient({ full_name: 'C', online: true });
    await save('patients', { ...p, notes: 'a' });
    await save('patients', { ...p, notes: 'b' });
    const ops = (await (await getDB()).getAll('outbox')).filter((o: any) => o.table === 'patients' && o.data.id === p.id);
    expect(ops.length).toBe(1);
    expect(ops[0].data.notes).toBe('b');
  });
});

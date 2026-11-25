/** Demonstration mode: synthetic patients in a SEPARATE on-device database that never syncs to Supabase. */
import { getDB } from './db';
import { save } from './repo';
import { uuid, isoDate } from './naming';
import { STAGES } from './catalog';

export function setDemo(on: boolean) {
  try { on ? localStorage.setItem('fs_demo', '1') : localStorage.removeItem('fs_demo'); } catch {}
}

export async function seedDemo() {
  const db = await getDB(true);
  if ((await db.count('patients')) > 0) return;
  const people = [
    { name: 'DEMO Ahmad Synthetic', code: 'P900001' },
    { name: 'DEMO Lim Testcase', code: 'P900002' },
    { name: 'DEMO Raj Placeholder', code: 'P900003' },
  ];
  for (const [i, p] of people.entries()) {
    const id = uuid();
    await save('patients', { id, patient_code: p.code, full_name: p.name, mrn: `DEMO-${i + 1}`, registration_date: isoDate(new Date()), is_demo: true, version: 1 });
    await save('patient_demographics', { patient_id: id, age_years: 30 + i * 7, sex: 'Male', ethnicity: 'Not recorded' });
    for (const t of ['photography', 'video', 'audio']) {
      await save('patient_consents', { id: uuid(), patient_id: id, consent_type: t, status: 'granted', consent_date: isoDate(new Date()), consent_version: 'DEMO' });
    }
    await save('patient_consents', { id: uuid(), patient_id: id, consent_type: 'research_ai', status: 'not_asked' });
    if (i < 2) {
      await save('surgical_sessions', {
        id: uuid(), patient_id: id, session_code: 'S01', surgery_date: isoDate(new Date()), status: i === 0 ? 'in_progress' : 'completed',
        technique: 'FUE', planned_graft_count: 2500 + i * 500, donor_regions: ['Central occipital'], recipient_regions: ['Frontal hairline'], data: {},
      });
    }
  }
  void STAGES;
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Modal, Select, toast, cx } from './ui';
import { useApp } from './AppProvider';
import { createPatient, createSession, setConsent } from '@/lib/clinical';
import { sb } from '@/lib/supabase';
import { isoDate } from '@/lib/naming';
import { can } from '@/lib/auth';

export const CONSENT_TYPES = [
  { key: 'photography', label: 'Clinical photography' },
  { key: 'video', label: 'Clinical video recording' },
  { key: 'audio', label: 'Audio recording' },
  { key: 'research_ai', label: 'Future research & AI development' },
];

/** Minimal case creation: a name OR clinic identifier is enough. Everything else can be completed later. */
export function NewPatientModal({ open, onClose, startSession = true }: { open: boolean; onClose: () => void; startSession?: boolean }) {
  const { branches, staff, profile, online, settings } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [mrn, setMrn] = useState('');
  const [branch, setBranch] = useState('');
  const [doctor, setDoctor] = useState('');
  const [consents, setConsents] = useState<Record<string, string>>({ photography: '', video: '', audio: '', research_ai: '' });
  const [docRef, setDocRef] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = can.createPatient(profile);

  async function submit() {
    if (!name.trim() && !mrn.trim()) { toast.err('Enter a patient name or clinic identifier'); return; }
    setBusy(true);
    try {
      let serverCodes: string[] = [];
      if (online) {
        const { data } = await sb().from('patients').select('patient_code').order('patient_code', { ascending: false }).limit(5);
        serverCodes = (data ?? []).map((d: any) => d.patient_code);
      }
      const p = await createPatient({ full_name: name, mrn, branch_id: branch || null, assigned_doctor_id: doctor || null, online, serverCodes });
      for (const c of CONSENT_TYPES) {
        const st = consents[c.key];
        if (st) await setConsent(p.id, c.key, { status: st, consent_date: st === 'granted' || st === 'declined' ? isoDate(new Date()) : null,
          document_ref: docRef || null, consent_version: settings.consent_version, confirmed_by: profile?.id });
      }
      toast.ok(`Patient ${p.patient_code} created`);
      onClose();
      if (startSession) {
        const s = await createSession(p.id, { branch_id: branch || null, lead_surgeon_id: doctor || (profile?.role === 'doctor' ? profile.id : null) });
        router.push(`/session/?id=${s.id}`);
      } else router.push(`/patient/?id=${p.id}`);
    } catch (e: any) { toast.err(e.message); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={startSession ? 'Start new procedure — new patient' : 'New patient'}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || !allowed} onClick={submit}>{busy ? 'Creating…' : startSession ? 'Create & open session' : 'Create patient'}</Button></>}>
      {!allowed ? <p className="text-sm text-red-600">Your account is not permitted to create patient cases.</p> : (
        <div className="space-y-4">
          <p className="text-sm text-navy-500">Only a name <b>or</b> clinic identifier is required. Internal IDs and the patient code are generated automatically; everything else can be completed later.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Patient full name"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
            <Field label="Clinic medical record number"><Input value={mrn} onChange={(e) => setMrn(e.target.value)} /></Field>
            <Field label="Clinic branch"><Select options={branches.map((b) => ({ v: b.id, l: b.name }))} value={branch} onChange={setBranch} placeholder="Not set" /></Field>
            <Field label="Assigned doctor"><Select options={staff.filter((s) => s.role === 'doctor' && s.active).map((s) => ({ v: s.id, l: s.full_name }))} value={doctor} onChange={setDoctor} placeholder="Not set" /></Field>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-navy-800">Recording consent</h4>
            <p className="mb-3 text-xs text-navy-500">Each consent is recorded separately. Recording consent does not imply research, AI, publication or commercial use. Recording of a media type requires its consent to be marked <b>granted</b>.</p>
            <div className="space-y-2">
              {CONSENT_TYPES.map((c) => (
                <div key={c.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-100 px-3 py-2">
                  <span className="text-sm text-navy-800">{c.label}</span>
                  <div className="flex gap-1">
                    {[['granted', 'Granted'], ['declined', 'Declined'], ['not_asked', 'Not asked']].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setConsents({ ...consents, [c.key]: consents[c.key] === v ? '' : v })}
                        className={cx('rounded-lg px-3 py-1.5 text-sm', consents[c.key] === v ? (v === 'granted' ? 'bg-teal-600 text-white' : v === 'declined' ? 'bg-red-600 text-white' : 'bg-navy-700 text-white') : 'bg-navy-50 text-navy-600')}>{l}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Field label="Consent document reference" className="mt-3"><Input value={docRef} onChange={(e) => setDocRef(e.target.value)} placeholder="e.g. signed form no." /></Field>
          </div>
        </div>
      )}
    </Modal>
  );
}

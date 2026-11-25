'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Field, Input, Modal, Select, toast, cx } from './ui';
import { Check } from 'lucide-react';
import { useApp } from './AppProvider';
import { createPatient, createSession, setConsent, grantRecordingConsent } from '@/lib/clinical';
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
  const [recConsent, setRecConsent] = useState(false);
  const [aiConsent, setAiConsent] = useState(false);
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
      if (recConsent) await grantRecordingConsent(p.id, profile?.id ?? null, settings.consent_version);
      if (aiConsent) await setConsent(p.id, 'research_ai', { status: 'granted', consent_date: isoDate(new Date()), consent_version: settings.consent_version, confirmed_by: profile?.id });
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
          <div className="space-y-2">
            <Tick on={recConsent} onClick={() => setRecConsent(!recConsent)} label="Patient agreed to photos, videos and audio recording" />
            <Tick on={aiConsent} onClick={() => setAiConsent(!aiConsent)} label="Patient also agreed to research / AI use (optional)" small />
          </div>
        </div>
      )}
    </Modal>
  );
}

export function Tick({ on, onClick, label, small }: { on: boolean; onClick: () => void; label: string; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-2xl border-2 text-left transition active:scale-[.99]', small ? 'p-3' : 'p-4',
      on ? 'border-teal-500 bg-teal-50' : 'border-navy-200 bg-white')}>
      <span className={cx('flex shrink-0 items-center justify-center rounded-lg border-2', small ? 'h-7 w-7' : 'h-9 w-9', on ? 'border-teal-600 bg-teal-600' : 'border-navy-300 bg-white')}>
        {on && <Check className={cx('text-white', small ? 'h-5 w-5' : 'h-6 w-6')} />}
      </span>
      <span className={cx('font-medium text-navy-900', small ? 'text-[15px]' : 'text-[17px]')}>{label}</span>
    </button>
  );
}

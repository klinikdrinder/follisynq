'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Field, Input, Select, Tabs, Badge, Empty, PageHeader, Modal, Textarea, toast } from '@/components/ui';
import { ParamForm, filledCount } from '@/components/ParamForm';
import { MediaGrid } from '@/components/MediaGallery';
import { CONSENT_TYPES } from '@/components/NewPatient';
import { useQuery } from '@/lib/useQuery';
import { one, list, save } from '@/lib/repo';
import { createSession, setConsent, Values } from '@/lib/clinical';
import { CLASSIFICATIONS, ETHNICITY_OPTIONS } from '@/lib/catalog';
import { isoDate, uuid, daysBetween } from '@/lib/naming';
import { ArrowLeft, Plus, Save, Film, CalendarClock } from 'lucide-react';

type Tab = 'overview' | 'clinical_history' | 'hair' | 'scalp' | 'consents' | 'timeline' | 'media';

export default function PatientPage() {
  const q = useQuery();
  const id = q?.get('id') ?? '';
  const router = useRouter();
  const { catalog, branches, staff, profile, settings } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const data = useData(async () => {
    if (!id) return null;
    const [p, demo, hist, hair, scalp, consents, sessions, encounters, media] = await Promise.all([
      one<any>('patients', id), one<any>('patient_demographics', id), one<any>('patient_clinical_history', id), one<any>('patient_hair_characteristics', id),
      one<any>('patient_scalp_characteristics', id), list<any>('patient_consents', (c) => c.patient_id === id),
      list<any>('surgical_sessions', (s) => s.patient_id === id && !s.deleted_at), list<any>('clinical_encounters', (e) => e.patient_id === id && !e.deleted_at),
      list<any>('media_assets', (m) => m.patient_id === id && !m.deleted_at),
    ]);
    return { p, demo, hist, hair, scalp, consents, sessions: sessions.sort((a, b) => a.session_code.localeCompare(b.session_code)), encounters, media };
  }, [id]);

  if (!data?.p) return <Shell><Empty title={q ? 'Patient not found on this iPad' : 'Loading…'} /></Shell>;
  const p = data.p;

  return (
    <Shell>
      <PageHeader
        back={<Link href="/patients/" className="mb-1 inline-flex items-center gap-1 text-sm text-navy-500"><ArrowLeft className="h-4 w-4" />Patients</Link>}
        title={<span className="flex items-center gap-3">{p.full_name || '(name not recorded)'}<Badge tone="navy">{p.patient_code}</Badge></span>}
        sub={`${p.mrn ? `MRN ${p.mrn} · ` : ''}Registered ${p.registration_date}${p.branch_id ? ` · ${branches.find((b) => b.id === p.branch_id)?.name ?? ''}` : ''}`}
        actions={<Button variant="teal" onClick={async () => { const s = await createSession(p.id, { branch_id: p.branch_id, lead_surgeon_id: profile?.role === 'doctor' ? profile.id : p.assigned_doctor_id }); router.push(`/session/?id=${s.id}`); }}><Plus className="h-5 w-5" />New surgical session</Button>}
      />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[
        { v: 'overview', l: 'Overview' }, { v: 'clinical_history', l: 'Clinical history' }, { v: 'hair', l: 'Hair' }, { v: 'scalp', l: 'Scalp' },
        { v: 'consents', l: 'Consents' }, { v: 'timeline', l: `Sessions (${data.sessions.length})` }, { v: 'media', l: `Media (${data.media.length})` },
      ]} /></div>

      {tab === 'overview' && <Overview p={p} demo={data.demo} branches={branches} staff={staff} />}
      {(tab === 'clinical_history' || tab === 'hair' || tab === 'scalp') && catalog && (
        <ProfileSection key={tab} patientId={p.id} section={tab} row={tab === 'clinical_history' ? data.hist : tab === 'hair' ? data.hair : data.scalp}
          defs={catalog.patient.find((s) => s.key === tab)!.params} />
      )}
      {tab === 'consents' && <Consents patientId={p.id} rows={data.consents} version={settings.consent_version} />}
      {tab === 'timeline' && (
        <div className="space-y-3">
          {data.sessions.map((s) => {
            const enc = data.encounters.filter((e) => e.session_id === s.id);
            const sm = data.media.filter((m) => m.session_id === s.id);
            return (
              <Card key={s.id} className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-lg font-semibold text-navy-900">{s.session_code} · {s.surgery_date ?? 'No date'}</div>
                    <div className="text-sm text-navy-500">{[s.procedure_type, s.technique, s.implantation_technique].filter(Boolean).join(' · ') || 'Procedure details not recorded'} · {sm.length} media</div></div>
                  <div className="flex items-center gap-2"><Badge tone={s.status === 'completed' ? 'green' : 'teal'}>{s.status.replace('_', ' ')}</Badge><Link href={`/session/?id=${s.id}`}><Button size="sm">Open</Button></Link></div>
                </div>
                {enc.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {enc.sort((a, b) => (a.encounter_date ?? '').localeCompare(b.encounter_date ?? '')).map((e) => (
                      <Link key={e.id} href={`/stage/?s=${s.id}&st=S12&e=${e.id}`}><Badge tone="blue"><CalendarClock className="h-3 w-3" />{e.interval_label ?? 'Follow-up'} · {e.encounter_date ?? '—'}{s.surgery_date && e.encounter_date ? ` (day ${daysBetween(s.surgery_date, e.encounter_date)})` : ''}</Badge></Link>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
          {!data.sessions.length && <Card><Empty title="No surgical sessions yet" /></Card>}
        </div>
      )}
      {tab === 'media' && <MediaGrid media={data.media.sort((a, b) => (b.recorded_at ?? '').localeCompare(a.recorded_at ?? ''))} empty={<Card><Empty icon={<Film className="h-10 w-10" />} title="No media yet" /></Card>} />}
    </Shell>
  );
}

function Overview({ p, demo, branches, staff }: { p: any; demo: any; branches: any[]; staff: any[] }) {
  const [d, setD] = useState<any>({});
  const [g, setG] = useState<any>({});
  useEffect(() => { setD({ full_name: p.full_name, mrn: p.mrn, branch_id: p.branch_id, assigned_doctor_id: p.assigned_doctor_id, registration_date: p.registration_date, notes: p.notes }); }, [p]);
  useEffect(() => { setG({ date_of_birth: demo?.date_of_birth ?? '', age_years: demo?.age_years ?? '', sex: demo?.sex ?? '', ethnicity: demo?.ethnicity ?? '', ethnicity_self_described: demo?.ethnicity_self_described ?? '', nationality: demo?.nationality ?? '' }); }, [demo]);
  const age = g.date_of_birth ? Math.floor(daysBetween(g.date_of_birth, new Date()) / 365.25) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-navy-900">Identification</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name"><Input value={d.full_name ?? ''} onChange={(e) => setD({ ...d, full_name: e.target.value })} /></Field>
          <Field label="Clinic MRN"><Input value={d.mrn ?? ''} onChange={(e) => setD({ ...d, mrn: e.target.value })} /></Field>
          <Field label="Patient code" hint="Auto-generated, used in filenames (no PII)"><Input value={p.patient_code} disabled /></Field>
          <Field label="Registration date"><Input type="date" value={d.registration_date ?? ''} onChange={(e) => setD({ ...d, registration_date: e.target.value })} /></Field>
          <Field label="Clinic branch"><Select options={branches.map((b) => ({ v: b.id, l: b.name }))} value={d.branch_id} onChange={(v) => setD({ ...d, branch_id: v || null })} placeholder="Not set" /></Field>
          <Field label="Assigned doctor"><Select options={staff.filter((s) => s.role === 'doctor').map((s) => ({ v: s.id, l: s.full_name }))} value={d.assigned_doctor_id} onChange={(v) => setD({ ...d, assigned_doctor_id: v || null })} placeholder="Not set" /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={d.notes ?? ''} onChange={(e) => setD({ ...d, notes: e.target.value })} /></Field>
        </div>
        <p className="mt-3 text-[11px] text-navy-400">Internal UUID: {p.id}</p>
        <Button className="mt-3" onClick={async () => {
          if (!d.full_name?.trim() && !d.mrn?.trim()) return toast.err('Keep at least a name or clinic identifier');
          await save('patients', { ...p, ...d, full_name: d.full_name?.trim() || null, mrn: d.mrn?.trim() || null }); toast.ok('Saved');
        }}><Save className="h-4 w-4" />Save</Button>
      </Card>
      <Card className="p-5">
        <h3 className="mb-1 font-semibold text-navy-900">Demographics</h3>
        <p className="mb-4 text-xs text-navy-400">Ethnicity is self-reported only — never inferred from appearance, name or nationality.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date of birth"><Input type="date" value={g.date_of_birth} onChange={(e) => setG({ ...g, date_of_birth: e.target.value })} /></Field>
          <Field label="Age" hint={age != null ? `Calculated from DOB: ${age}` : undefined}><Input type="number" inputMode="numeric" value={g.age_years} onChange={(e) => setG({ ...g, age_years: e.target.value })} placeholder="Not recorded" /></Field>
          <Field label="Sex"><Select options={['Male', 'Female', 'Intersex', 'Prefer not to say']} value={g.sex} onChange={(v) => setG({ ...g, sex: v })} placeholder="Not recorded" /></Field>
          <Field label="Nationality"><Input value={g.nationality} onChange={(e) => setG({ ...g, nationality: e.target.value })} /></Field>
          <Field label="Self-reported ethnicity"><Select options={ETHNICITY_OPTIONS} value={g.ethnicity} onChange={(v) => setG({ ...g, ethnicity: v })} placeholder="Not recorded" /></Field>
          {g.ethnicity === 'Other or self-described' && <Field label="Self-described"><Input value={g.ethnicity_self_described} onChange={(e) => setG({ ...g, ethnicity_self_described: e.target.value })} /></Field>}
        </div>
        <Button className="mt-4" onClick={async () => {
          await save('patient_demographics', { ...(demo ?? { version: 1 }), patient_id: p.id, date_of_birth: g.date_of_birth || null,
            age_years: g.age_years === '' ? (age ?? null) : Number(g.age_years), sex: g.sex || null, ethnicity: g.ethnicity || null,
            ethnicity_self_described: g.ethnicity_self_described || null, nationality: g.nationality || null });
          toast.ok('Saved');
        }}><Save className="h-4 w-4" />Save</Button>
      </Card>
    </div>
  );
}

function ProfileSection({ patientId, section, row, defs }: { patientId: string; section: 'clinical_history' | 'hair' | 'scalp'; row: any; defs: any[] }) {
  const [values, setValues] = useState<Values>(row?.data ?? {});
  const [cls, setCls] = useState({ system: row?.classification_system ?? '', grade: row?.classification_grade ?? '' });
  const [dirty, setDirty] = useState(false);
  const table = section === 'clinical_history' ? 'patient_clinical_history' : section === 'hair' ? 'patient_hair_characteristics' : 'patient_scalp_characteristics';
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-navy-500">{filledCount(values, defs)} of {defs.length} fields recorded · all optional</span>
        <Button disabled={!dirty} onClick={async () => {
          const extra: any = section === 'clinical_history' ? { classification_system: cls.system || null, classification_grade: cls.grade || null }
            : section === 'hair' ? { hair_texture: values.texture?.v ?? null, hair_caliber: values.caliber?.v ?? null } : {};
          await save(table, { ...(row ?? { version: 1 }), patient_id: patientId, data: values, ...extra }); setDirty(false); toast.ok('Saved');
        }}><Save className="h-4 w-4" />Save</Button>
      </div>
      {section === 'clinical_history' && (
        <div className="mb-6 grid gap-4 rounded-xl bg-navy-50/60 p-4 sm:grid-cols-2">
          <Field label="Hair loss classification"><Select options={Object.keys(CLASSIFICATIONS)} value={cls.system} onChange={(v) => { setCls({ system: v, grade: '' }); setDirty(true); }} placeholder="Unclassified / not recorded" /></Field>
          <Field label="Grade">{CLASSIFICATIONS[cls.system]?.length ? <Select options={CLASSIFICATIONS[cls.system]} value={cls.grade} onChange={(v) => { setCls({ ...cls, grade: v }); setDirty(true); }} placeholder="Not recorded" />
            : <Input value={cls.grade} onChange={(e) => { setCls({ ...cls, grade: e.target.value }); setDirty(true); }} placeholder={cls.system ? 'Describe grade' : 'Select classification first'} />}</Field>
        </div>
      )}
      <ParamForm defs={defs} values={values} onChange={(v) => { setValues(v); setDirty(true); }} />
    </Card>
  );
}

function Consents({ patientId, rows, version }: { patientId: string; rows: any[]; version: string }) {
  const { profile, staff } = useApp();
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {CONSENT_TYPES.map((c) => {
        const r = rows.find((x) => x.consent_type === c.key);
        return (
          <Card key={c.key} className="p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">{c.label}</h3>
              <Badge tone={r?.status === 'granted' ? 'green' : r?.status === 'declined' || r?.status === 'withdrawn' ? 'red' : 'neutral'}>{r?.status?.replace('_', ' ') ?? 'not recorded'}</Badge>
            </div>
            <div className="mt-2 space-y-0.5 text-sm text-navy-500">
              <div>Date: {r?.consent_date ?? '—'} · Version: {r?.consent_version ?? '—'}</div>
              <div>Document: {r?.document_ref ?? '—'}</div>
              <div>Confirmed by: {staff.find((s) => s.id === r?.confirmed_by)?.full_name ?? '—'}</div>
              {r?.withdrawn_at && <div className="text-red-600">Withdrawn {new Date(r.withdrawn_at).toLocaleDateString()}{r.withdrawal_reason ? ` — ${r.withdrawal_reason}` : ''}</div>}
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setEdit({ type: c.key, label: c.label, status: r?.status ?? '', consent_date: r?.consent_date ?? isoDate(new Date()), document_ref: r?.document_ref ?? '', consent_version: r?.consent_version ?? version, withdrawal_reason: r?.withdrawal_reason ?? '' })}>Update</Button>
          </Card>
        );
      })}
      <p className="text-xs text-navy-500 md:col-span-2">Clinical recording consent does not imply permission for AI research, publication or commercial use. Withdrawal blocks new recordings of that media type; existing media are retained pending the clinic&apos;s authorised deletion workflow.</p>
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={edit.label}
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => {
            await setConsent(patientId, edit.type, { status: edit.status || 'not_asked', consent_date: edit.consent_date || null, document_ref: edit.document_ref || null,
              consent_version: edit.consent_version || null, confirmed_by: profile?.id, withdrawn_at: edit.status === 'withdrawn' ? new Date().toISOString() : null,
              withdrawal_reason: edit.status === 'withdrawn' ? edit.withdrawal_reason || null : null });
            setEdit(null); toast.ok('Consent updated');
          }}>Save</Button></>}>
          <div className="space-y-4">
            <Field label="Status"><Select options={[{ v: 'granted', l: 'Granted' }, { v: 'declined', l: 'Declined' }, { v: 'withdrawn', l: 'Withdrawn' }, { v: 'not_asked', l: 'Not asked' }]} value={edit.status} onChange={(v) => setEdit({ ...edit, status: v })} /></Field>
            <Field label="Consent date"><Input type="date" value={edit.consent_date} onChange={(e) => setEdit({ ...edit, consent_date: e.target.value })} /></Field>
            <Field label="Consent document reference"><Input value={edit.document_ref} onChange={(e) => setEdit({ ...edit, document_ref: e.target.value })} /></Field>
            <Field label="Consent version"><Input value={edit.consent_version} onChange={(e) => setEdit({ ...edit, consent_version: e.target.value })} /></Field>
            {edit.status === 'withdrawn' && <Field label="Withdrawal reason"><Input value={edit.withdrawal_reason} onChange={(e) => setEdit({ ...edit, withdrawal_reason: e.target.value })} /></Field>}
          </div>
        </Modal>
      )}
    </div>
  );
}
void uuid;

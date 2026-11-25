'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Input, Select, Badge, Empty, PageHeader } from '@/components/ui';
import { NewPatientModal } from '@/components/NewPatient';
import { list } from '@/lib/repo';
import { CLASSIFICATIONS } from '@/lib/catalog';
import { UserPlus, Search, Users, ChevronRight, Trash2 } from 'lucide-react';

export default function Patients() {
  const { branches, staff } = useApp();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [bin, setBin] = useState(false);
  const data = useData(async () => {
    const [patients, hist, hair, consents, sessions, media] = await Promise.all([
      list<any>('patients'), list<any>('patient_clinical_history'), list<any>('patient_hair_characteristics'),
      list<any>('patient_consents'), list<any>('surgical_sessions', (s) => !s.deleted_at), list<any>('media_assets', (m) => !m.deleted_at),
    ]);
    return { patients, hist, hair, consents, sessions, media };
  });
  const rows = useMemo(() => {
    if (!data) return [];
    return data.patients.map((p) => {
      const h = data.hist.find((x) => x.patient_id === p.id);
      const hc = data.hair.find((x) => x.patient_id === p.id);
      const c = data.consents.filter((x) => x.patient_id === p.id);
      const ss = data.sessions.filter((s) => s.patient_id === p.id);
      return { p, h, hc, c, ss, mediaCount: data.media.filter((m) => m.patient_id === p.id).length, lastDate: ss.map((s) => s.surgery_date).filter(Boolean).sort().pop() };
    }).filter(({ p, h, hc, c, ss, lastDate }) => {
      if (!!p.deleted_at !== bin) return false;
      if (q && ![p.full_name, p.mrn, p.patient_code].some((x) => x?.toLowerCase().includes(q.toLowerCase()))) return false;
      if (f.branch && p.branch_id !== f.branch) return false;
      if (f.doctor && p.assigned_doctor_id !== f.doctor && !ss.some((s) => s.lead_surgeon_id === f.doctor)) return false;
      if (f.classification && h?.classification_system !== f.classification) return false;
      if (f.grade && h?.classification_grade !== f.grade) return false;
      if (f.texture && hc?.hair_texture !== f.texture) return false;
      if (f.caliber && hc?.hair_caliber !== f.caliber) return false;
      if (f.consent === 'video' && !c.some((x) => x.consent_type === 'video' && x.status === 'granted')) return false;
      if (f.consent === 'research' && !c.some((x) => x.consent_type === 'research_ai' && x.status === 'granted')) return false;
      if (f.consent === 'withdrawn' && !c.some((x) => x.status === 'withdrawn')) return false;
      if (f.from && (!lastDate || lastDate < f.from)) return false;
      if (f.to && (!lastDate || lastDate > f.to)) return false;
      return true;
    }).sort((a, b) => (b.p.created_at ?? '').localeCompare(a.p.created_at ?? ''));
  }, [data, q, f, bin]);
  const set = (k: string) => (v: string) => setF({ ...f, [k]: v });

  return (
    <Shell>
      <PageHeader title={bin ? 'Recently deleted patients' : 'Patient library'} sub={bin ? 'Open a patient to restore them' : `${rows.length} patient${rows.length === 1 ? '' : 's'}`}
        actions={<>
          <Button variant={bin ? 'primary' : 'secondary'} onClick={() => setBin(!bin)}><Trash2 className="h-4 w-4" />{bin ? 'Back to patients' : `Recently deleted (${data?.patients.filter((p) => p.deleted_at).length ?? 0})`}</Button>
          {!bin && <Button onClick={() => setOpen(true)}><UserPlus className="h-5 w-5" />New patient</Button>}
        </>} />
      <Card className="mb-4 p-4">
        <div className="relative mb-3"><Search className="absolute left-3 top-3 h-5 w-5 text-navy-300" /><Input className="pl-10" placeholder="Search name, patient code or MRN" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Select placeholder="Any branch" options={branches.map((b) => ({ v: b.id, l: b.name }))} value={f.branch} onChange={set('branch')} />
          <Select placeholder="Any doctor" options={staff.filter((s) => s.role === 'doctor').map((s) => ({ v: s.id, l: s.full_name }))} value={f.doctor} onChange={set('doctor')} />
          <Select placeholder="Any classification" options={Object.keys(CLASSIFICATIONS)} value={f.classification} onChange={(v) => setF({ ...f, classification: v, grade: '' })} />
          <Select placeholder="Any grade" options={CLASSIFICATIONS[f.classification ?? '']?.length ? CLASSIFICATIONS[f.classification] : Array.from(new Set(Object.values(CLASSIFICATIONS).flat()))} value={f.grade} onChange={set('grade')} />
          <Select placeholder="Any texture" options={['Straight', 'Wavy', 'Curly', 'Coily']} value={f.texture} onChange={set('texture')} />
          <Select placeholder="Any caliber" options={['Fine', 'Medium', 'Coarse']} value={f.caliber} onChange={set('caliber')} />
          <Select placeholder="Any consent" options={[{ v: 'video', l: 'Video consent granted' }, { v: 'research', l: 'Research/AI consent granted' }, { v: 'withdrawn', l: 'Has withdrawal' }]} value={f.consent} onChange={set('consent')} />
          <div className="flex gap-1"><Input type="date" value={f.from ?? ''} onChange={(e) => set('from')(e.target.value)} title="Surgery from" /><Input type="date" value={f.to ?? ''} onChange={(e) => set('to')(e.target.value)} title="Surgery to" /></div>
        </div>
      </Card>
      <Card>
        {rows.length ? rows.map(({ p, h, ss, c, mediaCount, lastDate }) => (
          <Link key={p.id} href={`/patient/?id=${p.id}`} className="flex items-center justify-between gap-3 border-b border-navy-50 px-5 py-4 last:border-0 hover:bg-navy-50/60">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="truncate font-medium text-navy-900">{p.full_name || '(name not recorded)'}</span>{p.is_demo && <Badge tone="amber">Demo</Badge>}</div>
              <div className="text-xs text-navy-400">{p.patient_code}{p.mrn ? ` · MRN ${p.mrn}` : ''} · {ss.length} session{ss.length === 1 ? '' : 's'} · {mediaCount} media{lastDate ? ` · last surgery ${lastDate}` : ''}</div>
            </div>
            <div className="flex items-center gap-2">
              {h?.classification_grade && <Badge>{h.classification_system?.split('–')[0]} {h.classification_grade}</Badge>}
              {c.some((x: any) => x.status === 'withdrawn') && <Badge tone="red">Consent withdrawn</Badge>}
              <ChevronRight className="h-5 w-5 text-navy-300" />
            </div>
          </Link>
        )) : <Empty icon={<Users className="h-10 w-10" />} title="No patients match">Create a patient with just a name or clinic ID.</Empty>}
      </Card>
      <NewPatientModal open={open} onClose={() => setOpen(false)} startSession={false} />
    </Shell>
  );
}

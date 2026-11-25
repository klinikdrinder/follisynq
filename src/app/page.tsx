'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Stat, Badge, Empty, Modal, Input } from '@/components/ui';
import { NewPatientModal } from '@/components/NewPatient';
import { list } from '@/lib/repo';
import { formatBytes, isoDate } from '@/lib/naming';
import { getDeviceId } from '@/lib/auth';
import { storageEstimate } from '@/lib/storage/opfs';
import { createSession } from '@/lib/clinical';
import { useRouter } from 'next/navigation';
import { Plus, UserPlus, CalendarDays, PlayCircle, Users, Film, CheckCircle2, CalendarClock, HardDrive, Settings, Image as ImageIcon, Video, RefreshCw, Smartphone, Search } from 'lucide-react';

export default function Dashboard() {
  const { profile, sync, online } = useApp();
  const router = useRouter();
  const [newPt, setNewPt] = useState<false | 'session' | 'patient'>(false);
  const [pick, setPick] = useState(false);
  const data = useData(async () => {
    const [patients, sessions, media, encounters, est] = await Promise.all([
      list<any>('patients', (p) => !p.deleted_at), list<any>('surgical_sessions', (s) => !s.deleted_at), list<any>('media_assets', (m) => !m.deleted_at),
      list<any>('clinical_encounters', (e) => !e.deleted_at), storageEstimate(),
    ]);
    const deviceId = getDeviceId();
    const today = isoDate(new Date());
    const local = media.filter((m) => m.device_id === deviceId);
    return {
      patients, sessions, media, encounters, est,
      today: sessions.filter((s) => s.surgery_date === today),
      ongoing: sessions.filter((s) => s.status === 'in_progress'),
      completed: sessions.filter((s) => s.status === 'completed'),
      videos: media.filter((m) => m.media_type === 'video').length, photos: media.filter((m) => m.media_type === 'photo').length,
      localBytes: local.reduce((a, m) => a + (m.size_bytes ?? 0), 0), localCount: local.length,
      followUps: encounters.filter((e) => e.encounter_date && e.encounter_date >= today).sort((a, b) => a.encounter_date.localeCompare(b.encounter_date)),
    };
  });
  const pname = (id: string) => data?.patients.find((p) => p.id === id);

  const SessionRow = ({ s }: { s: any }) => {
    const p = pname(s.patient_id);
    return (
      <Link href={`/session/?id=${s.id}`} className="flex items-center justify-between gap-3 rounded-xl px-3 py-3 hover:bg-navy-50">
        <div className="min-w-0">
          <div className="truncate font-medium text-navy-900">{p?.full_name || p?.mrn || p?.patient_code}</div>
          <div className="text-xs text-navy-400">{p?.patient_code} · {s.session_code} · {s.surgery_date ?? 'No date'}{s.technique ? ` · ${s.technique}` : ''}</div>
        </div>
        <Badge tone={s.status === 'completed' ? 'green' : 'teal'}>{s.status === 'completed' ? 'Completed' : 'In progress'}</Badge>
      </Link>
    );
  };

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-navy-400">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="text-3xl font-semibold tracking-tight text-navy-900">Welcome, {profile?.full_name?.split(' ')[0]}</h1>
        </div>
        <Button size="xl" variant="teal" onClick={() => setPick(true)} className="px-8"><PlayCircle className="h-7 w-7" />Start New Procedure</Button>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { l: 'New Patient', i: UserPlus, on: () => setNewPt('patient') },
          { l: 'New Surgical Session', i: Plus, on: () => setPick(true) },
          { l: 'Patient Library', i: Users, href: '/patients/' },
          { l: 'Media Library', i: Film, href: '/media/' },
          { l: 'Device Storage', i: HardDrive, href: '/storage/' },
        ].map((a) => {
          const inner = (<><a.i className="h-6 w-6 text-teal-600" /><span className="font-medium text-navy-800">{a.l}</span></>);
          return a.href ? <Link key={a.l} href={a.href} className="flex h-24 flex-col items-start justify-between rounded-2xl border border-navy-100 bg-white p-4 shadow-card hover:border-teal-300">{inner}</Link>
            : <button key={a.l} onClick={a.on} className="flex h-24 flex-col items-start justify-between rounded-2xl border border-navy-100 bg-white p-4 text-left shadow-card hover:border-teal-300">{inner}</button>;
        })}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Total patients" value={data?.patients.length ?? '—'} icon={<Users className="h-4 w-4" />} />
        <Stat label="Today's surgical cases" value={data?.today.length ?? '—'} icon={<CalendarDays className="h-4 w-4" />} />
        <Stat label="Ongoing procedures" value={data?.ongoing.length ?? '—'} icon={<PlayCircle className="h-4 w-4" />} />
        <Stat label="Completed procedures" value={data?.completed.length ?? '—'} icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Videos recorded" value={data?.videos ?? '—'} icon={<Video className="h-4 w-4" />} />
        <Stat label="Photographs recorded" value={data?.photos ?? '—'} icon={<ImageIcon className="h-4 w-4" />} />
        <Stat label="Local media size" value={formatBytes(data?.localBytes ?? 0)} sub={data?.est.quota ? `of ~${formatBytes(data.est.quota)} quota (est.)` : 'Quota unavailable'} icon={<HardDrive className="h-4 w-4" />} />
        <Stat label="Media on this iPad" value={data?.localCount ?? '—'} icon={<Smartphone className="h-4 w-4" />} />
        <Stat label="Pending metadata sync" value={sync.pending} sub={online ? (sync.lastSync ? `Last sync ${new Date(sync.lastSync).toLocaleTimeString()}` : 'Not yet synced') : 'Offline — queued safely'} icon={<RefreshCw className="h-4 w-4" />} />
        <Link href="/settings/"><Stat label="Settings" value={<Settings className="h-7 w-7 text-navy-300" />} sub="Staff, catalogues, devices" /></Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 px-3 font-semibold text-navy-900"><CalendarDays className="h-5 w-5 text-teal-600" />Today&apos;s procedures</h2>
          {data?.today.length ? data.today.map((s) => <SessionRow key={s.id} s={s} />) : <Empty title="No procedures dated today" />}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 px-3 font-semibold text-navy-900"><PlayCircle className="h-5 w-5 text-teal-600" />Continue existing procedure</h2>
          {data?.ongoing.length ? data.ongoing.slice(0, 8).map((s) => <SessionRow key={s.id} s={s} />) : <Empty title="No procedures in progress" />}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 px-3 font-semibold text-navy-900"><CheckCircle2 className="h-5 w-5 text-teal-600" />Completed procedures</h2>
          {data?.completed.length ? data.completed.slice(-8).reverse().map((s) => <SessionRow key={s.id} s={s} />) : <Empty title="None yet" />}
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 flex items-center gap-2 px-3 font-semibold text-navy-900"><CalendarClock className="h-5 w-5 text-teal-600" />Follow-up cases</h2>
          {data?.followUps.length ? data.followUps.slice(0, 8).map((e) => {
            const p = pname(e.patient_id);
            return (
              <Link key={e.id} href={e.session_id ? `/stage/?s=${e.session_id}&st=S12&e=${e.id}` : `/patient/?id=${e.patient_id}`} className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-navy-50">
                <div><div className="font-medium text-navy-900">{p?.full_name || p?.patient_code}</div><div className="text-xs text-navy-400">{p?.patient_code} · {e.interval_label ?? 'Follow-up'}</div></div>
                <Badge tone="blue">{e.encounter_date}</Badge>
              </Link>
            );
          }) : <Empty title="No upcoming follow-up encounters" />}
        </Card>
      </div>

      <NewPatientModal open={!!newPt} onClose={() => setNewPt(false)} startSession={newPt === 'session'} />
      <PickPatient open={pick} onClose={() => setPick(false)} patients={data?.patients ?? []}
        onNew={() => { setPick(false); setNewPt('session'); }}
        onPick={async (p) => { setPick(false); const s = await createSession(p.id, { branch_id: p.branch_id, lead_surgeon_id: profile?.role === 'doctor' ? profile.id : p.assigned_doctor_id }); router.push(`/session/?id=${s.id}`); }} />
    </Shell>
  );
}

function PickPatient({ open, onClose, patients, onPick, onNew }: { open: boolean; onClose: () => void; patients: any[]; onPick: (p: any) => void; onNew: () => void }) {
  const [q, setQ] = useState('');
  const f = patients.filter((p) => !q || [p.full_name, p.mrn, p.patient_code].some((x) => x?.toLowerCase().includes(q.toLowerCase()))).slice(0, 30);
  return (
    <Modal open={open} onClose={onClose} title="Start new procedure">
      <Button size="lg" variant="teal" className="mb-4 w-full" onClick={onNew}><UserPlus className="h-5 w-5" />New patient</Button>
      <div className="relative mb-3"><Search className="absolute left-3 top-3 h-5 w-5 text-navy-300" /><Input className="pl-10" placeholder="Search existing patient by name, MRN or code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="max-h-[50vh] overflow-y-auto">
        {f.map((p) => (
          <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-navy-50">
            <span><span className="font-medium text-navy-900">{p.full_name || p.mrn || p.patient_code}</span><span className="block text-xs text-navy-400">{p.patient_code}{p.mrn ? ` · MRN ${p.mrn}` : ''}</span></span>
            <Plus className="h-5 w-5 text-teal-600" />
          </button>
        ))}
        {!f.length && <Empty title="No matching patients" />}
      </div>
    </Modal>
  );
}

'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Field, Input, Select, Badge, Empty, PageHeader, Modal, Textarea, Section, cx, toast } from '@/components/ui';
import { useQuery } from '@/lib/useQuery';
import { one, list, save } from '@/lib/repo';
import { currentParams, completion, instanceId } from '@/lib/clinical';
import { formatBytes, formatDuration, uuid, isoDate, daysBetween } from '@/lib/naming';
import { getDeviceId } from '@/lib/auth';
import { getDB } from '@/lib/db';
import { FOLLOW_UP_INTERVALS } from '@/lib/catalog';
import { ArrowLeft, CheckCircle2, RotateCcw, Video, Image as ImageIcon, Mic, Download, Plus, CalendarClock, AlertTriangle, ChevronRight } from 'lucide-react';

const STATUS: Record<string, { l: string; tone: any }> = {
  not_started: { l: 'Not started', tone: 'neutral' }, media_recorded: { l: 'Media recorded', tone: 'blue' }, in_progress: { l: 'In progress', tone: 'teal' },
  completed: { l: 'Completed', tone: 'green' }, skipped: { l: 'Skipped', tone: 'amber' }, not_applicable: { l: 'Not applicable', tone: 'neutral' },
};

export default function SessionPage() {
  const q = useQuery();
  const id = q?.get('id') ?? '';
  const { catalog, staff, branches } = useApp();
  const [details, setDetails] = useState(false);
  const [fu, setFu] = useState(false);
  const data = useData(async () => {
    if (!id || !catalog) return null;
    const s = await one<any>('surgical_sessions', id);
    if (!s) return { s: null } as any;
    const p = await one<any>('patients', s.patient_id);
    const media = await list<any>('media_assets', (m) => m.session_id === id && !m.deleted_at);
    const locs = await list<any>('media_storage_locations', (l) => media.some((m) => m.id === l.media_id));
    const encounters = await list<any>('clinical_encounters', (e) => e.session_id === id && !e.deleted_at);
    const outbox = (await (await getDB()).getAll('outbox')) as any[];
    const pendingIds = new Set(outbox.map((o) => o.data.id ?? o.data.patient_id));
    const deviceId = getDeviceId();
    const stages = await Promise.all(catalog.stages.map(async (st) => {
      const inst = await one<any>('procedure_instances', await instanceId(id, st.code, null));
      const { values } = await currentParams(inst);
      const sm = media.filter((m) => m.stage_code === st.code);
      return {
        st, inst, status: inst?.status ?? (sm.length ? 'media_recorded' : 'not_started'), pct: completion(values, st.params),
        videos: sm.filter((m) => m.media_type === 'video').length, photos: sm.filter((m) => m.media_type === 'photo').length, audio: sm.filter((m) => m.media_type === 'audio').length,
        duration: sm.reduce((a, m) => a + (m.duration_ms ?? 0), 0), bytes: sm.filter((m) => m.device_id === deviceId).reduce((a, m) => a + (m.size_bytes ?? 0), 0),
        pending: sm.filter((m) => pendingIds.has(m.id)).length,
      };
    }));
    const localMedia = media.filter((m) => m.device_id === deviceId);
    const backup = { verified: locs.filter((l) => l.backup_status === 'verified').length, exported: locs.filter((l) => l.backup_status === 'exported').length };
    const unavailable = locs.filter((l) => l.availability !== 'available').length;
    return { s, p, media, encounters, stages, localMedia, backup, unavailable, pendingSession: pendingIds.has(id) };
  }, [id, catalog]);

  if (!data?.s) return <Shell><Empty title={q ? 'Session not found on this iPad' : 'Loading…'} /></Shell>;
  const { s, p } = data;
  const lead = staff.find((x) => x.id === s.lead_surgeon_id);

  return (
    <Shell>
      <PageHeader
        back={<Link href={`/patient/?id=${p?.id}`} className="mb-1 inline-flex items-center gap-1 text-sm text-navy-500"><ArrowLeft className="h-4 w-4" />{p?.full_name || p?.patient_code}</Link>}
        title={<span className="flex items-center gap-3">{p?.patient_code} · {s.session_code}<Badge tone={s.status === 'completed' ? 'green' : 'teal'}>{s.status === 'completed' ? 'Completed' : 'In progress'}</Badge></span>}
        sub={`${s.surgery_date ?? 'No date'}${lead ? ` · ${lead.full_name}` : ''}${s.branch_id ? ` · ${branches.find((b) => b.id === s.branch_id)?.name ?? ''}` : ''}${s.technique ? ` · ${s.technique}` : ''}`}
        actions={<>
          <Button variant="secondary" onClick={() => setDetails(true)}>Session details</Button>
          <Link href={`/storage/?export=${s.id}`}><Button variant="secondary"><Download className="h-4 w-4" />Export case</Button></Link>
          {s.status === 'completed'
            ? <Button variant="secondary" onClick={async () => { await save('surgical_sessions', { ...s, status: 'in_progress', reopened_at: new Date().toISOString() }); toast.ok('Session reopened for further documentation'); }}><RotateCcw className="h-4 w-4" />Reopen</Button>
            : <Button variant="teal" onClick={async () => { await save('surgical_sessions', { ...s, status: 'completed', completed_at: new Date().toISOString() }); toast.ok('Session completed — it can be reopened at any time'); }}><CheckCircle2 className="h-4 w-4" />Complete session</Button>}
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[
          ['Videos', data.media.filter((m) => m.media_type === 'video').length], ['Photographs', data.media.filter((m) => m.media_type === 'photo').length],
          ['Audio', data.media.filter((m) => m.media_type === 'audio').length], ['Recording time', formatDuration(data.media.reduce((a, m) => a + (m.duration_ms ?? 0), 0))],
          ['Local media size', formatBytes(data.localMedia.reduce((a, m) => a + (m.size_bytes ?? 0), 0))],
          ['Backup', `${data.backup.verified} verified · ${data.backup.exported} exported`],
        ].map(([l, v]) => <Card key={String(l)} className="p-4"><div className="text-xs text-navy-400">{l}</div><div className="mt-1 text-lg font-semibold text-navy-900">{v}</div></Card>)}
      </div>
      {data.unavailable > 0 && <p className="mb-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-4 w-4" />{data.unavailable} media item(s) marked unavailable. Check Device Storage.</p>}

      <h2 className="mb-3 font-semibold text-navy-900">Procedural stages <span className="text-sm font-normal text-navy-400">— recommended order, open any stage at any time. Status is informational only.</span></h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.stages.map(({ st, status, pct, videos, photos, audio, duration, bytes, pending }) => (
          <Link key={st.code} href={`/stage/?s=${s.id}&st=${st.code}`}
            className={cx('group rounded-2xl border bg-white p-4 shadow-card transition hover:border-teal-400', status === 'not_started' ? 'border-navy-100' : status === 'completed' ? 'border-emerald-200' : 'border-teal-200')}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className={cx('flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold', status === 'not_started' ? 'bg-navy-50 text-navy-400' : status === 'completed' ? 'bg-emerald-600 text-white' : 'bg-teal-600 text-white')}>{String(st.number).padStart(2, '0')}</span>
                <div><div className="font-semibold leading-tight text-navy-900">{st.title}</div>{st.priority === 'highest' && <span className="text-[11px] font-medium uppercase tracking-wide text-teal-700">High priority</span>}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-navy-200 group-hover:text-teal-500" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-navy-500">
              <Badge tone={STATUS[status]?.tone}>{STATUS[status]?.l ?? status}</Badge>
              <span className="flex items-center gap-1"><Video className="h-3.5 w-3.5" />{videos}</span>
              <span className="flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" />{photos}</span>
              <span className="flex items-center gap-1"><Mic className="h-3.5 w-3.5" />{audio}</span>
              {duration > 0 && <span>{formatDuration(duration)}</span>}
              {bytes > 0 && <span>{formatBytes(bytes)}</span>}
              {pending > 0 && <Badge tone="amber">{pending} sync pending</Badge>}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-navy-50"><div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} /></div>
            <div className="mt-1 text-[11px] text-navy-400">Clinical metadata {pct}% recorded</div>
          </Link>
        ))}
      </div>

      <div className="mt-6">
        <Section title="Follow-up encounters" count={<Badge>{data.encounters.length}</Badge>} right={<span onClick={(e) => { e.stopPropagation(); setFu(true); }} className="inline-flex items-center gap-1 rounded-lg bg-navy-800 px-3 py-1.5 text-sm text-white"><Plus className="h-4 w-4" />Add</span>}>
          {data.encounters.length ? data.encounters.sort((a, b) => (a.encounter_date ?? '').localeCompare(b.encounter_date ?? '')).map((e) => (
            <Link key={e.id} href={`/stage/?s=${s.id}&st=S12&e=${e.id}`} className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-navy-50">
              <span className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-teal-600" /><b className="text-navy-800">{e.interval_label ?? 'Follow-up'}</b><span className="text-sm text-navy-500">{e.encounter_date ?? 'No date'}{s.surgery_date && e.encounter_date ? ` · day ${daysBetween(s.surgery_date, e.encounter_date)} after surgery` : ''}</span></span>
              <ChevronRight className="h-5 w-5 text-navy-300" />
            </Link>
          )) : <p className="text-sm text-navy-500">No follow-up encounters. Suggested intervals are never enforced.</p>}
        </Section>
      </div>

      {details && <SessionDetails s={s} onClose={() => setDetails(false)} />}
      {fu && <FollowUpModal s={s} onClose={() => setFu(false)} />}
    </Shell>
  );
}

function SessionDetails({ s, onClose }: { s: any; onClose: () => void }) {
  const { staff, branches, catalog } = useApp();
  const [d, setD] = useState<any>({});
  useEffect(() => { setD({ ...s, data: { ...(s.data ?? {}) } }); }, [s]);
  const setData = (k: string, v: any) => setD({ ...d, data: { ...d.data, [k]: v === '' ? null : v } });
  const clinicians = staff.filter((x) => x.active);
  const multi = (k: string, list: string[], fromData = false) => {
    const arr: string[] = (fromData ? d.data?.[k] : d[k]) ?? [];
    return (
      <div className="flex flex-wrap gap-2">{list.map((o) => {
        const on = arr.includes(o);
        return <button key={o} type="button" onClick={() => { const n = on ? arr.filter((x) => x !== o) : [...arr, o]; fromData ? setData(k, n) : setD({ ...d, [k]: n }); }}
          className={cx('rounded-full border px-3 py-1.5 text-sm', on ? 'border-teal-500 bg-teal-50 text-teal-800' : 'border-navy-200 text-navy-600')}>{o}</button>;
      })}</div>
    );
  };
  const est = d.data?.start && d.data?.end ? Math.round((new Date(d.data.end).getTime() - new Date(d.data.start).getTime()) / 60000) : null;
  return (
    <Modal open onClose={onClose} wide title={`Session ${s.session_code} details`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      await save('surgical_sessions', { ...d, planned_graft_count: d.planned_graft_count === '' || d.planned_graft_count == null ? null : Number(d.planned_graft_count),
        planned_recipient_density: d.planned_recipient_density === '' || d.planned_recipient_density == null ? null : Number(d.planned_recipient_density),
        data: { ...d.data, actual_duration_min: est ?? d.data?.actual_duration_min ?? null } });
      toast.ok('Session details saved'); onClose();
    }}>Save</Button></>}>
      <p className="mb-4 text-sm text-navy-500">All fields are optional and can be completed later.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Case ID"><Input value={s.session_code} disabled /></Field>
        <Field label="Surgery date"><Input type="date" value={d.surgery_date ?? ''} onChange={(e) => setD({ ...d, surgery_date: e.target.value || null })} /></Field>
        <Field label="Clinic branch"><Select options={branches.map((b) => ({ v: b.id, l: b.name }))} value={d.branch_id} onChange={(v) => setD({ ...d, branch_id: v || null })} /></Field>
        <Field label="Lead surgeon"><Select options={clinicians.filter((x) => x.role !== 'nurse').map((x) => ({ v: x.id, l: x.full_name }))} value={d.lead_surgeon_id} onChange={(v) => setD({ ...d, lead_surgeon_id: v || null })} /></Field>
        <Field label="Procedure type"><Select options={['Primary hair transplant', 'Repair / revision', 'Eyebrow transplant', 'Beard transplant', 'Scar camouflage', 'Body hair transplant', 'Other']} value={d.procedure_type} onChange={(v) => setD({ ...d, procedure_type: v || null })} /></Field>
        <Field label="Transplantation technique"><Select options={['FUE', 'FUT', 'Combined FUE + FUT']} value={d.technique} onChange={(v) => setD({ ...d, technique: v || null })} /></Field>
        <Field label="Implantation technique"><Select options={['Forceps (stick-and-place)', 'Forceps (pre-made sites)', 'Implanter (DHI/Choi)', 'Implanter (pre-made sites)', 'Mixed']} value={d.implantation_technique} onChange={(v) => setD({ ...d, implantation_technique: v || null })} /></Field>
        <Field label="Shaving"><Select options={['Shaven', 'Partially shaven', 'Unshaven']} value={d.shave_type} onChange={(v) => setD({ ...d, shave_type: v || null })} /></Field>
        <Field label="Patient positioning"><Select options={['Supine', 'Prone', 'Semi-recumbent', 'Sitting', 'Lateral', 'Changed during procedure']} value={d.data?.positioning ?? ''} onChange={(v) => setData('positioning', v)} /></Field>
        <Field label="Planned graft count"><Input type="number" inputMode="numeric" value={d.planned_graft_count ?? ''} onChange={(e) => setD({ ...d, planned_graft_count: e.target.value })} placeholder="Not recorded" /></Field>
        <Field label="Planned recipient density (grafts/cm²)"><Input type="number" inputMode="decimal" value={d.planned_recipient_density ?? ''} onChange={(e) => setD({ ...d, planned_recipient_density: e.target.value })} placeholder="Not recorded" /></Field>
        <Field label="Estimated duration (min)"><Input type="number" value={d.data?.estimated_duration_min ?? ''} onChange={(e) => setData('estimated_duration_min', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <Field label="Surgery start time"><Input type="datetime-local" value={d.data?.start ?? ''} onChange={(e) => setData('start', e.target.value)} /></Field>
        <Field label="Surgery end time"><Input type="datetime-local" value={d.data?.end ?? ''} onChange={(e) => setData('end', e.target.value)} /></Field>
        <Field label="Actual duration" hint="Calculated from start/end"><Input value={est != null ? `${est} min` : ''} disabled placeholder="—" /></Field>
      </div>
      <div className="mt-4 space-y-4">
        <Field label="Assisting doctors">{multi('assisting_doctors', clinicians.filter((x) => x.role === 'doctor').map((x) => x.full_name), true)}</Field>
        <Field label="Nurses and technicians">{multi('nurses', clinicians.filter((x) => x.role === 'nurse').map((x) => x.full_name), true)}</Field>
        <Field label="Additional team members (free text)"><Input value={d.data?.other_team ?? ''} onChange={(e) => setData('other_team', e.target.value)} /></Field>
        <Field label="Donor regions">{multi('donor_regions', catalog?.donorRegions ?? [])}</Field>
        <Field label="Recipient regions">{multi('recipient_regions', catalog?.recipientRegions ?? [])}</Field>
        <Field label="Surgical notes"><Textarea value={d.data?.notes ?? ''} onChange={(e) => setData('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function FollowUpModal({ s, onClose }: { s: any; onClose: () => void }) {
  const [interval, setInterval] = useState('');
  const [date, setDate] = useState(isoDate(new Date()));
  const suggest = (iv: string) => {
    if (!s.surgery_date || iv === 'Custom') return;
    const d = new Date(s.surgery_date + 'T00:00:00');
    const m = /^(Day|Month) (\d+)/.exec(iv);
    if (!m) return;
    m[1] === 'Day' ? d.setDate(d.getDate() + Number(m[2])) : d.setMonth(d.getMonth() + Number(m[2]));
    setDate(isoDate(d));
  };
  return (
    <Modal open onClose={onClose} title="New follow-up encounter" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      await save('clinical_encounters', { id: uuid(), patient_id: s.patient_id, session_id: s.id, encounter_type: 'follow_up', interval_label: interval || 'Custom', encounter_date: date || null, version: 1 });
      toast.ok('Follow-up encounter created'); onClose();
    }}>Create</Button></>}>
      <div className="space-y-4">
        <Field label="Interval (suggested, not enforced)"><Select options={FOLLOW_UP_INTERVALS} value={interval} onChange={(v) => { setInterval(v); suggest(v); }} placeholder="Custom" /></Field>
        <Field label="Encounter date" hint={s.surgery_date && date ? `${daysBetween(s.surgery_date, date)} days since surgery` : undefined}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

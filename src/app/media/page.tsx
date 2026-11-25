'use client';
import { useMemo, useState } from 'react';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Card, Input, Select, Empty, PageHeader, Button } from '@/components/ui';
import { MediaGrid } from '@/components/MediaGallery';
import { list } from '@/lib/repo';
import { getDB } from '@/lib/db';
import { getDeviceId } from '@/lib/auth';
import { Film, Search, SlidersHorizontal, Trash2 } from 'lucide-react';

const PARAM_FILTERS = [
  { k: 'punch_diameter', l: 'Punch diameter (mm)', st: 'S06' }, { k: 'punch_type', l: 'Punch type', st: 'S06' },
  { k: 'motor_model', l: 'Machine model', st: 'S06' }, { k: 'rpm', l: 'RPM', st: 'S06' },
  { k: 'instrument_type', l: 'Slit instrument', st: 'S08' }, { k: 'blade_width', l: 'Blade width (mm)', st: 'S08' },
  { k: 'technique', l: 'Implantation technique', st: 'S09' }, { k: 'graft_type', l: 'Graft type', st: 'S09' },
];

export default function MediaLibrary() {
  const { catalog, staff, branches } = useApp();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Record<string, string>>({});
  const [more, setMore] = useState(false);
  const [bin, setBin] = useState(false);
  const data = useData(async () => {
    const [media, patients, sessions, snaps, hist, hair, consents, devices, locs, outbox] = await Promise.all([
      list<any>('media_assets'), list<any>('patients'), list<any>('surgical_sessions'), list<any>('media_metadata_snapshots'),
      list<any>('patient_clinical_history'), list<any>('patient_hair_characteristics'), list<any>('patient_consents'), list<any>('registered_devices'),
      list<any>('media_storage_locations'), getDB().then((d) => d.getAll('outbox')),
    ]);
    return { media, patients, sessions, snaps: new Map(snaps.map((s) => [s.media_id, s.snapshot])), hist, hair, consents, devices, locs,
      pending: new Set((outbox as any[]).filter((o) => o.table === 'media_assets').map((o) => o.data.id)) };
  });
  const stage = catalog?.stages.find((s) => s.code === f.stage);
  const deviceId = typeof window !== 'undefined' ? getDeviceId() : '';

  const rows = useMemo(() => {
    if (!data) return [];
    return data.media.filter((m) => {
      if (!!m.deleted_at !== bin) return false;
      const p = data.patients.find((x) => x.id === m.patient_id);
      const s = data.sessions.find((x) => x.id === m.session_id);
      if (q && ![p?.full_name, p?.patient_code, s?.session_code, m.filename].some((x) => x?.toLowerCase().includes(q.toLowerCase()))) return false;
      if (f.stage && m.stage_code !== f.stage) return false;
      if (f.sub && m.subcategory_code !== f.sub) return false;
      if (f.region && m.region !== f.region) return false;
      if (f.type && m.media_type !== f.type) return false;
      if (f.doctor && s?.lead_surgeon_id !== f.doctor && m.recorded_by !== f.doctor) return false;
      if (f.branch && s?.branch_id !== f.branch) return false;
      if (f.from && (m.recorded_at ?? '').slice(0, 10) < f.from) return false;
      if (f.to && (m.recorded_at ?? '').slice(0, 10) > f.to) return false;
      if (f.surgery && s?.surgery_date !== f.surgery) return false;
      if (f.minDur && (m.duration_ms ?? 0) < Number(f.minDur) * 1000) return false;
      if (f.device && m.device_id !== f.device) return false;
      if (f.avail === 'here' && m.device_id !== deviceId && !data.locs.some((l) => l.media_id === m.id && l.device_id === deviceId)) return false;
      if (f.avail === 'other' && (m.device_id === deviceId || data.locs.some((l) => l.media_id === m.id && l.device_id === deviceId))) return false;
      if (f.sync === 'pending' && !data.pending.has(m.id)) return false;
      if (f.sync === 'synced' && data.pending.has(m.id)) return false;
      if (f.classification || f.grade) { const h = data.hist.find((x) => x.patient_id === m.patient_id); if (f.classification && h?.classification_system !== f.classification) return false; if (f.grade && h?.classification_grade !== f.grade) return false; }
      if (f.texture || f.caliber) { const h = data.hair.find((x) => x.patient_id === m.patient_id); if (f.texture && h?.hair_texture !== f.texture) return false; if (f.caliber && h?.hair_caliber !== f.caliber) return false; }
      if (f.consent === 'research' && !data.consents.some((c) => c.patient_id === m.patient_id && c.consent_type === 'research_ai' && c.status === 'granted')) return false;
      if (f.consent === 'withdrawn' && !data.consents.some((c) => c.patient_id === m.patient_id && c.status === 'withdrawn')) return false;
      for (const pf of PARAM_FILTERS) {
        if (!f[pf.k]) continue;
        const v = data.snaps.get(m.id)?.clinical_context?.parameters?.[pf.k]?.v;
        if (v == null || String(v).toLowerCase() !== f[pf.k].toLowerCase()) return false;
      }
      return true;
    }).sort((a, b) => (b.recorded_at ?? '').localeCompare(a.recorded_at ?? ''));
  }, [data, q, f, deviceId, bin]);

  const set = (k: string) => (v: string) => setF({ ...f, [k]: v });
  const distinct = (k: string) => Array.from(new Set((data ? Array.from(data.snaps.values()) : []).map((s: any) => s?.clinical_context?.parameters?.[k]?.v).filter((x) => x != null).map(String))).sort();

  return (
    <Shell>
      <PageHeader title={bin ? 'Recently deleted' : 'Media library'} sub={bin ? 'Tap an item to restore it' : `${rows.length} item${rows.length === 1 ? '' : 's'} · playback available only for media stored on this iPad`}
        actions={<Button variant={bin ? 'primary' : 'secondary'} onClick={() => setBin(!bin)}><Trash2 className="h-4 w-4" />{bin ? 'Back to media' : `Recently deleted (${data?.media.filter((m) => m.deleted_at).length ?? 0})`}</Button>} />
      <Card className="mb-4 p-4">
        <div className="mb-3 flex gap-2">
          <div className="relative flex-1"><Search className="absolute left-3 top-3 h-5 w-5 text-navy-300" /><Input className="pl-10" placeholder="Search patient, code, session or filename" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button variant="secondary" onClick={() => setMore(!more)}><SlidersHorizontal className="h-4 w-4" />Filters</Button>
          {Object.values(f).some(Boolean) && <Button variant="ghost" onClick={() => setF({})}>Clear</Button>}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Select placeholder="Any stage" options={(catalog?.stages ?? []).map((s) => ({ v: s.code, l: `${s.code} ${s.title}` }))} value={f.stage} onChange={(v) => setF({ ...f, stage: v, sub: '' })} />
          <Select placeholder="Any subcategory" options={(stage?.subcategories ?? []).map((s) => ({ v: s.code, l: s.label }))} value={f.sub} onChange={set('sub')} />
          <Select placeholder="Any media type" options={[{ v: 'video', l: 'Video' }, { v: 'photo', l: 'Photograph' }, { v: 'audio', l: 'Audio' }]} value={f.type} onChange={set('type')} />
          <Select placeholder="Any storage" options={[{ v: 'here', l: 'Available on this iPad' }, { v: 'other', l: 'Stored on another iPad' }]} value={f.avail} onChange={set('avail')} />
          <Select placeholder="Any sync status" options={[{ v: 'pending', l: 'Sync pending' }, { v: 'synced', l: 'Synced' }]} value={f.sync} onChange={set('sync')} />
          <Select placeholder="Any region" options={[...(catalog?.donorRegions ?? []), ...(catalog?.recipientRegions ?? [])]} value={f.region} onChange={set('region')} />
        </div>
        {more && (
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
            <Select placeholder="Any doctor" options={staff.map((s) => ({ v: s.id, l: s.full_name }))} value={f.doctor} onChange={set('doctor')} />
            <Select placeholder="Any branch" options={branches.map((b) => ({ v: b.id, l: b.name }))} value={f.branch} onChange={set('branch')} />
            <Select placeholder="Any device" options={(data?.devices ?? []).map((d) => ({ v: d.id, l: d.label || `${d.model ?? 'Device'} ${d.id.slice(0, 4)}` }))} value={f.device} onChange={set('device')} />
            <Input type="date" title="Surgery date" value={f.surgery ?? ''} onChange={(e) => set('surgery')(e.target.value)} />
            <Input type="date" title="Recorded from" value={f.from ?? ''} onChange={(e) => set('from')(e.target.value)} />
            <Input type="date" title="Recorded to" value={f.to ?? ''} onChange={(e) => set('to')(e.target.value)} />
            <Input type="number" placeholder="Min duration (s)" value={f.minDur ?? ''} onChange={(e) => set('minDur')(e.target.value)} />
            <Select placeholder="Any classification" options={['Hamilton–Norwood', 'Ludwig', 'Sinclair', 'Other']} value={f.classification} onChange={set('classification')} />
            <Input placeholder="Grade" value={f.grade ?? ''} onChange={(e) => set('grade')(e.target.value)} />
            <Select placeholder="Any texture" options={['Straight', 'Wavy', 'Curly', 'Coily']} value={f.texture} onChange={set('texture')} />
            <Select placeholder="Any caliber" options={['Fine', 'Medium', 'Coarse']} value={f.caliber} onChange={set('caliber')} />
            <Select placeholder="Any consent" options={[{ v: 'research', l: 'Research/AI consent granted' }, { v: 'withdrawn', l: 'Consent withdrawn' }]} value={f.consent} onChange={set('consent')} />
            {PARAM_FILTERS.map((pf) => <Select key={pf.k} placeholder={pf.l} options={distinct(pf.k)} value={f[pf.k]} onChange={set(pf.k)} />)}
          </div>
        )}
      </Card>
      <MediaGrid media={rows} empty={<Card><Empty icon={<Film className="h-10 w-10" />} title={bin ? 'Nothing in Recently deleted' : 'No media match these filters'} /></Card>} />
    </Shell>
  );
}

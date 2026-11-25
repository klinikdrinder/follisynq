'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Field, Input, Select, Badge, Empty, Modal, Textarea, Section, cx, toast } from '@/components/ui';
import { ParamForm, filledCount } from '@/components/ParamForm';
import { MediaGrid } from '@/components/MediaGallery';
import { CameraModal } from '@/components/Camera';
import { useQuery } from '@/lib/useQuery';
import { one, list, save } from '@/lib/repo';
import { ensureInstance, currentParams, saveParamVersion, consentsFor, consentAllows, createBatch, Values, instanceId } from '@/lib/clinical';
import { CaptureContext, MediaType, importExternal, checkStorage } from '@/lib/media';
import { uuid, isoDate, daysBetween, formatBytes } from '@/lib/naming';
import { ArrowLeft, ChevronLeft, ChevronRight, Video, Camera, Mic, Upload, Save, Layers, Info, ShieldAlert, Plus, CalendarClock, History } from 'lucide-react';

const STATUSES = [
  { v: 'not_started', l: 'Not started' }, { v: 'media_recorded', l: 'Media recorded' }, { v: 'in_progress', l: 'In progress' },
  { v: 'completed', l: 'Completed' }, { v: 'skipped', l: 'Skipped' }, { v: 'not_applicable', l: 'Not applicable' },
];

export default function StagePage() {
  const q = useQuery();
  const router = useRouter();
  const sessionId = q?.get('s') ?? '';
  const stageCode = q?.get('st') ?? 'S01';
  const encounterId = q?.get('e') || null;
  const { catalog, profile, settings, staff } = useApp();
  const stage = catalog?.stages.find((s) => s.code === stageCode);
  const idx = catalog?.stages.findIndex((s) => s.code === stageCode) ?? 0;

  const [sub, setSub] = useState<string>('');
  const [region, setRegion] = useState<string>('');
  const [batchId, setBatchId] = useState<string>('');
  const [values, setValues] = useState<Values>({});
  const [dirty, setDirty] = useState(false);
  const [notes, setNotes] = useState('');
  const [recCtx, setRecCtx] = useState<Values>({});
  const [camera, setCamera] = useState<MediaType | null>(null);
  const [subFilter, setSubFilter] = useState<'all' | 'selected'>('all');
  const [history, setHistory] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const loadedKey = useRef('');
  const ctxCache = useRef<CaptureContext | null>(null);

  const data = useData(async () => {
    if (!sessionId || !stage) return null;
    const session = await one<any>('surgical_sessions', sessionId);
    if (!session) return { session: null } as any;
    const patient = await one<any>('patients', session.patient_id);
    const instId = await instanceId(sessionId, stageCode, encounterId);
    const inst = await one<any>('procedure_instances', instId);
    const cur = await currentParams(inst);
    const versions = inst ? (await list<any>('procedure_parameter_versions', (v) => v.instance_id === inst.id)).sort((a, b) => b.version_no - a.version_no) : [];
    const media = await list<any>('media_assets', (m) => m.session_id === sessionId && m.stage_code === stageCode && !m.deleted_at && (stageCode !== 'S12' || (m.encounter_id ?? null) === encounterId));
    const consents = await consentsFor(session.patient_id);
    const batches = await list<any>('graft_batches', (b) => b.session_id === sessionId && !b.deleted_at);
    const encounters = await list<any>('clinical_encounters', (e) => e.session_id === sessionId && !e.deleted_at);
    const donorAssess = await list<any>('donor_assessments', (d) => d.session_id === sessionId && !d.deleted_at);
    const presets = await list<any>('instrument_presets', (p) => p.active && (!p.stage_code || p.stage_code === stageCode));
    const [hist, hair, scalp, demo] = await Promise.all([one<any>('patient_clinical_history', session.patient_id), one<any>('patient_hair_characteristics', session.patient_id), one<any>('patient_scalp_characteristics', session.patient_id), one<any>('patient_demographics', session.patient_id)]);
    return { session, patient, inst, cur, versions, media, consents, batches, encounters, donorAssess, presets, hist, hair, scalp, demo };
  }, [sessionId, stageCode, encounterId, stage?.code]);

  // load persisted values when instance/version changes, without clobbering unsaved edits
  useEffect(() => {
    if (!data?.session) return;
    const key = `${sessionId}:${stageCode}:${encounterId}:${data.cur?.version?.id ?? 'none'}`;
    if (loadedKey.current === key) return;
    if (dirty && loadedKey.current.startsWith(`${sessionId}:${stageCode}:${encounterId}:`)) return;
    loadedKey.current = key;
    setValues(data.cur?.values ?? {});
    setNotes(data.inst?.notes ?? '');
    setDirty(false);
  }, [data, sessionId, stageCode, encounterId, dirty]);

  useEffect(() => { setSub(''); setRegion(''); setBatchId(''); setDirty(false); loadedKey.current = ''; }, [stageCode, encounterId]);

  const subcat = stage?.subcategories.find((x) => x.code === sub) ?? null;
  const regionOptions = useMemo(() => {
    const d = catalog?.donorRegions ?? [], r = catalog?.recipientRegions ?? [];
    if (['S02', 'S06', 'S07'].includes(stageCode)) return d;
    if (['S03', 'S08', 'S09'].includes(stageCode)) return r;
    return [...d.map((x) => `Donor · ${x}`), ...r.map((x) => `Recipient · ${x}`)];
  }, [catalog, stageCode]);

  if (!stage || !catalog) return <Shell><Empty title="Loading…" /></Shell>;
  if (!data?.session) return <Shell><Empty title={q ? 'Session not found on this iPad' : 'Loading…'} /></Shell>;
  const { session, patient, consents } = data;
  const prev = catalog.stages[idx - 1], next = catalog.stages[idx + 1];
  const link = (code: string) => `/stage/?s=${sessionId}&st=${code}${code === 'S12' && encounterId ? `&e=${encounterId}` : ''}`;
  const encounter = data.encounters.find((e) => e.id === encounterId);

  async function persistParams(reason?: string, presetId?: string | null) {
    const inst = await ensureInstance(sessionId, stageCode, encounterId);
    const ver = await saveParamVersion(inst, values, reason, presetId);
    setDirty(false);
    loadedKey.current = `${sessionId}:${stageCode}:${encounterId}:${ver.id}`;
    return { inst, ver };
  }
  async function saveNotesStatus(patch: Record<string, any>) {
    const inst = await ensureInstance(sessionId, stageCode, encounterId);
    await save('procedure_instances', { ...inst, ...patch });
  }

  async function buildCtx(): Promise<CaptureContext> {
    let paramVersion = data!.cur?.version ?? null;
    let vals = data!.cur?.values ?? {};
    if (dirty) { const r = await persistParams('Auto-saved before recording'); paramVersion = r.ver; vals = r.ver.values; }
    const rc: Record<string, any> = {};
    for (const [k, v] of Object.entries(recCtx)) if (v?.v != null && v.v !== '') rc[k] = v.v;
    return {
      patient, session, stage: { code: stage!.code, folder: stage!.folder, title: stage!.title }, subcategory: subcat,
      region: region || null, graftBatchId: batchId || null, encounterId, paramVersion, values: vals, recordingContext: rc, notes: null,
      operator: profile ? { id: profile.id, name: profile.full_name, role: profile.role } : undefined,
      patientSummary: {
        age_years: data!.demo?.age_years ?? null, sex: data!.demo?.sex ?? null,
        hair_loss_classification: data!.hist?.classification_system ?? null, hair_loss_grade: data!.hist?.classification_grade ?? null,
        hair: data!.hair?.data ?? {}, scalp: data!.scalp?.data ?? {},
      },
    };
  }

  async function openCamera(mode: MediaType) {
    if (!consentAllows(consents, mode)) { toast.err(`${mode === 'photo' ? 'Photography' : mode === 'video' ? 'Video' : 'Audio'} consent has not been granted for this patient.`); return; }
    const st = await checkStorage({ warn: settings.storage_warn_pct, critical: settings.storage_critical_pct });
    if (!st.ok) { toast.err(st.message!); return; }
    if (st.level === 'low') toast.info(st.message!);
    ctxCache.current = await buildCtx();
    setCamera(mode);
  }
  async function onImport(files: File[]) {
    const ctx = await buildCtx();
    for (const f of files) {
      const type: MediaType = f.type.startsWith('image/') ? 'photo' : f.type.startsWith('audio/') ? 'audio' : 'video';
      if (!consentAllows(consents, type)) { toast.err(`${f.name}: ${type} consent not granted — skipped`); continue; }
      try { const m = await importExternal(ctx, f); toast.ok(`Imported & verified · ${m.filename} · ${formatBytes(m.size_bytes)}`); }
      catch (e: any) { toast.err(`${f.name}: NOT imported — ${e.message}`); }
    }
  }

  const status = data.inst?.status ?? (data.media.length ? 'media_recorded' : 'not_started');
  const filled = filledCount(values, stage.params);
  const shownMedia = data.media.filter((m) => subFilter === 'all' || !sub || m.subcategory_code === sub).sort((a, b) => (b.recorded_at ?? '').localeCompare(a.recorded_at ?? ''));
  const consentMissing = (['video', 'photo', 'audio'] as MediaType[]).filter((t) => !consentAllows(consents, t));

  return (
    <Shell>
      {/* header */}
      <div className="mb-4">
        <Link href={`/session/?id=${sessionId}`} className="mb-2 inline-flex items-center gap-1 text-sm text-navy-500"><ArrowLeft className="h-4 w-4" />{patient?.patient_code} · {session.session_code} summary</Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider text-teal-700">Stage {String(stage.number).padStart(2, '0')}{stage.priority === 'highest' ? ' · high priority' : ''}</div>
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">{stage.title}</h1>
            <p className="mt-1 max-w-3xl text-sm text-navy-500">{stage.description}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={!prev} onClick={() => prev && router.push(link(prev.code))}><ChevronLeft className="h-5 w-5" />Previous</Button>
            <Button variant="secondary" disabled={!next} onClick={() => next && router.push(link(next.code))}>Next<ChevronRight className="h-5 w-5" /></Button>
          </div>
        </div>
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {catalog.stages.map((s) => (
            <Link key={s.code} href={link(s.code)} className={cx('whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium', s.code === stageCode ? 'bg-navy-800 text-white' : 'bg-white text-navy-600 border border-navy-100')}>
              {String(s.number).padStart(2, '0')} {s.title.split(/[ /,]/)[0]}
            </Link>
          ))}
        </div>
      </div>

      {consentMissing.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          <span className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" />Consent not granted for: {consentMissing.join(', ')}. Those recording types are disabled.</span>
          <Link href={`/patient/?id=${patient.id}`}><Button size="sm" variant="secondary">Record consent</Button></Link>
        </div>
      )}

      {stageCode === 'S12' && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-2 text-sm font-medium text-navy-700"><CalendarClock className="mr-1 inline h-4 w-4" />Encounter:</span>
            <Link href={`/stage/?s=${sessionId}&st=S12`} className={cx('rounded-full px-3 py-1.5 text-sm', !encounterId ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-600')}>Session-level</Link>
            {data.encounters.sort((a, b) => (a.encounter_date ?? '').localeCompare(b.encounter_date ?? '')).map((e) => (
              <Link key={e.id} href={`/stage/?s=${sessionId}&st=S12&e=${e.id}`} className={cx('rounded-full px-3 py-1.5 text-sm', encounterId === e.id ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-600')}>
                {e.interval_label ?? 'Follow-up'} · {e.encounter_date ?? '—'}
              </Link>
            ))}
            <Button size="sm" variant="ghost" onClick={async () => {
              const e = await save('clinical_encounters', { id: uuid(), patient_id: session.patient_id, session_id: sessionId, encounter_type: 'follow_up', interval_label: 'Custom', encounter_date: isoDate(new Date()), version: 1 });
              router.push(`/stage/?s=${sessionId}&st=S12&e=${e.id}`);
            }}><Plus className="h-4 w-4" />Today</Button>
          </div>
          {encounter && session.surgery_date && encounter.encounter_date && <p className="mt-2 text-sm text-navy-500">Days since surgery (auto): <b>{daysBetween(session.surgery_date, encounter.encounter_date)}</b>. Use the same standardized views as baseline.</p>}
        </Card>
      )}

      {/* capture controls */}
      <Card className="mb-4 p-4">
        <div className="mb-3">
          <div className="mb-2 text-sm font-medium text-navy-700">Media subcategory <span className="font-normal text-navy-400">(optional — tap to select)</span></div>
          <div className="flex flex-wrap gap-2">
            {stage.subcategories.map((s) => (
              <button key={s.code} onClick={() => setSub(sub === s.code ? '' : s.code)}
                className={cx('rounded-xl border px-3 py-2 text-sm font-medium transition', sub === s.code ? 'border-teal-600 bg-teal-600 text-white' : 'border-navy-200 bg-white text-navy-700 hover:border-teal-400')}>
                {s.label} <span className="ml-1 opacity-60">{data.media.filter((m) => m.subcategory_code === s.code).length || ''}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Anatomical region (optional)"><Select options={regionOptions} value={region} onChange={setRegion} placeholder="Not specified" /></Field>
          {['S07', 'S09'].includes(stageCode) && (
            <Field label="Graft batch (optional)"><Select options={data.batches.map((b) => ({ v: b.id, l: `${b.batch_code}${b.donor_region ? ` · ${b.donor_region}` : ''}` }))} value={batchId} onChange={setBatchId} placeholder="No batch" /></Field>
          )}
          {stage.views && <Field label="Standard view (optional)"><Select options={stage.views} value={(recCtx.standard_view?.v as string) ?? ''} onChange={(v) => setRecCtx({ ...recCtx, standard_view: { v: v || null } })} placeholder="Not specified" /></Field>}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Button size="xl" variant="record" disabled={!consentAllows(consents, 'video')} onClick={() => openCamera('video')}><Video className="h-7 w-7" />Record Video</Button>
          <Button size="xl" variant="primary" disabled={!consentAllows(consents, 'photo')} onClick={() => openCamera('photo')}><Camera className="h-7 w-7" />Take Photograph</Button>
          <Button size="xl" variant="secondary" disabled={!consentAllows(consents, 'audio')} onClick={() => openCamera('audio')}><Mic className="h-7 w-7" />Record Audio</Button>
          <Button size="xl" variant="secondary" onClick={() => importRef.current?.click()}><Upload className="h-7 w-7" />Import Media</Button>
          <input ref={importRef} type="file" hidden multiple accept="image/*,video/*,audio/*" onChange={(e) => { onImport(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-navy-400"><Info className="h-3.5 w-3.5" />Recording never requires clinical fields. Each recording keeps an immutable snapshot of the parameters active when it was captured.</p>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section title="Clinical parameters" count={<Badge tone={filled ? 'teal' : 'neutral'}>{filled}/{stage.params.length} recorded</Badge>} defaultOpen={stage.priority !== 'standard' || filled > 0}
            right={data.cur?.version ? <span className="text-xs text-navy-400">v{data.cur.version.version_no}</span> : null}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                {data.presets.length > 0 && (
                  <Select className="w-64" options={data.presets.map((p) => ({ v: p.id, l: `Preset: ${p.name}` }))} value="" placeholder="Apply instrument preset…" onChange={(id) => {
                    const p = data.presets.find((x) => x.id === id);
                    if (!p) return;
                    const n = { ...values };
                    for (const [k, v] of Object.entries(p.values ?? {})) n[k] = { v, src: 'instrument', by: profile?.id ?? null, at: new Date().toISOString() };
                    setValues(n); setDirty(true); toast.info(`Preset “${p.name}” applied — adjust any field, then save`);
                  }} />
                )}
                <Button size="sm" variant="ghost" onClick={() => setHistory(true)} disabled={!data.versions.length}><History className="h-4 w-4" />Versions ({data.versions.length})</Button>
              </div>
              <Button disabled={!dirty} onClick={async () => { await persistParams(); toast.ok('Parameters saved as a new version — later recordings inherit them'); }}><Save className="h-4 w-4" />Save parameters</Button>
            </div>
            {dirty && <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">Unsaved changes. They will be saved automatically when you start the next recording.</p>}
            <ParamForm defs={stage.params} values={values} onChange={(v) => { setValues(v); setDirty(true); }} />
            {filled < stage.params.length && <p className="mt-4 text-xs text-navy-400">{stage.params.length - filled} fields not recorded — informational only. Missing values are stored as “not recorded”, never as zero.</p>}
          </Section>

          {stageCode === 'S02' && <DonorAssessments sessionId={sessionId} rows={data.donorAssess} defs={stage.params} />}
          {stageCode === 'S07' && <GraftBatches sessionId={sessionId} rows={data.batches} defs={stage.params} />}

          <Section title="Recording context (optional)" defaultOpen={false}>
            <p className="mb-3 text-xs text-navy-500">Applies to the next recordings from this screen.</p>
            <ParamForm defs={catalog.recording} values={recCtx} onChange={setRecCtx} />
          </Section>

          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-navy-900">Recorded media <span className="text-sm font-normal text-navy-400">({data.media.length})</span></h3>
              {sub && <div className="flex gap-1 text-sm">
                <button onClick={() => setSubFilter('all')} className={cx('rounded-lg px-2 py-1', subFilter === 'all' ? 'bg-navy-800 text-white' : 'text-navy-500')}>All</button>
                <button onClick={() => setSubFilter('selected')} className={cx('rounded-lg px-2 py-1', subFilter === 'selected' ? 'bg-navy-800 text-white' : 'text-navy-500')}>{subcat?.label}</button>
              </div>}
            </div>
            <MediaGrid media={shownMedia} empty={<Empty icon={<Layers className="h-10 w-10" />} title="No media recorded for this stage yet" />} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <Field label="Stage status (informational)">
              <Select options={STATUSES} value={status} onChange={(v) => saveNotesStatus({ status: v || 'not_started' })} />
            </Field>
            <Field label="Clinical notes" className="mt-4">
              <Textarea rows={6} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if ((data.inst?.notes ?? '') !== notes) saveNotesStatus({ notes: notes || null }).then(() => toast.ok('Notes saved')); }} />
            </Field>
          </Card>
          <Card className="p-4 text-sm text-navy-600">
            <div className="font-medium text-navy-800">{patient?.patient_code} · {session.session_code}</div>
            <div className="text-navy-500">{patient?.full_name}</div>
            <div className="mt-2 text-xs">Lead: {staff.find((x) => x.id === session.lead_surgeon_id)?.full_name ?? '—'}</div>
          </Card>
        </div>
      </div>

      {camera && ctxCache.current && (
        <CameraModal mode={camera} ctx={ctxCache.current} thresholds={{ warn: settings.storage_warn_pct, critical: settings.storage_critical_pct }} onClose={() => setCamera(null)}
          header={<>
            <div className="font-semibold">{patient.patient_code} · {session.session_code} · {stage.code} {stage.title}</div>
            <div className="text-white/70">{subcat?.label ?? 'No subcategory'}{region ? ` · ${region}` : ''}{batchId ? ` · ${data.batches.find((b) => b.id === batchId)?.batch_code}` : ''}{ctxCache.current.paramVersion ? ` · params v${ctxCache.current.paramVersion.version_no}` : ''}</div>
          </>} />
      )}

      {history && (
        <Modal open onClose={() => setHistory(false)} wide title="Parameter versions">
          <p className="mb-3 text-sm text-navy-500">Versions are immutable. Recordings reference the version active when they were captured.</p>
          {data.versions.map((v) => (
            <div key={v.id} className="mb-3 rounded-xl border border-navy-100 p-3">
              <div className="mb-1 flex items-center justify-between text-sm"><b>Version {v.version_no}</b><span className="text-navy-400">{new Date(v.created_at).toLocaleString()} · {staff.find((s) => s.id === v.created_by)?.full_name ?? ''}</span></div>
              {v.reason && <div className="mb-1 text-xs text-navy-500">{v.reason}</div>}
              <div className="flex flex-wrap gap-1">{Object.entries(v.values ?? {}).map(([k, val]: any) => {
                const d = stage.params.find((p) => p.key === k);
                return <Badge key={k}>{d?.label ?? k}: {Array.isArray(val?.v) ? val.v.join(', ') : String(val?.v ?? '—')}{d?.unit && d.unit !== 'count' ? ` ${d.unit}` : ''}{val?.src ? ` (${val.src})` : ''}</Badge>;
              })}</div>
            </div>
          ))}
        </Modal>
      )}
    </Shell>
  );
}

function DonorAssessments({ sessionId, rows, defs }: { sessionId: string; rows: any[]; defs: any[] }) {
  const { catalog } = useApp();
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <Section title="Per-region donor assessments" count={<Badge>{rows.length}</Badge>} defaultOpen={rows.length > 0}>
      <div className="mb-3 flex flex-wrap gap-2">
        {rows.map((r) => <Button key={r.id} size="sm" variant="secondary" onClick={() => setEdit({ ...r })}>{r.region}</Button>)}
        <Select className="w-64" options={(catalog?.donorRegions ?? []).filter((x) => !rows.some((r) => r.region === x))} value="" placeholder="+ Add region assessment" onChange={(v) => v && setEdit({ id: uuid(), session_id: sessionId, region: v, data: {}, version: 1 })} />
      </div>
      {edit && (
        <Modal open wide onClose={() => setEdit(null)} title={`Donor assessment · ${edit.region}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => { await save('donor_assessments', edit); setEdit(null); toast.ok('Region assessment saved'); }}>Save</Button></>}>
          <ParamForm defs={defs.filter((d) => d.key !== 'donor_region')} values={edit.data ?? {}} onChange={(v) => setEdit({ ...edit, data: v })} />
        </Modal>
      )}
    </Section>
  );
}

function GraftBatches({ sessionId, rows, defs }: { sessionId: string; rows: any[]; defs: any[] }) {
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <Section title="Graft batches" count={<Badge>{rows.length}</Badge>} defaultOpen>
      <div className="flex flex-wrap gap-2">
        {rows.sort((a, b) => a.batch_code.localeCompare(b.batch_code)).map((b) => <Button key={b.id} size="sm" variant="secondary" onClick={() => setEdit({ ...b })}>{b.batch_code}{b.data?.total_grafts?.v != null ? ` · ${b.data.total_grafts.v} grafts` : ''}</Button>)}
        <Button size="sm" onClick={async () => { const b = await createBatch(sessionId, { extracted_at: new Date().toISOString() }); toast.ok(`Batch ${b.batch_code} created`); setEdit(b); }}><Plus className="h-4 w-4" />New batch</Button>
      </div>
      {edit && (
        <Modal open wide onClose={() => setEdit(null)} title={`Graft batch ${edit.batch_code}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => {
          await save('graft_batches', { ...edit, donor_region: edit.data?.donor_region?.v ?? edit.donor_region ?? null }); setEdit(null); toast.ok('Batch saved');
        }}>Save</Button></>}>
          <ParamForm defs={defs} values={edit.data ?? {}} onChange={(v) => setEdit({ ...edit, data: v })} />
        </Modal>
      )}
    </Section>
  );
}

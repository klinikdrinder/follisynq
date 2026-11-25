'use client';
import { useEffect, useState } from 'react';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Field, Input, Select, Tabs, Badge, PageHeader, Modal, Textarea, Empty, toast, cx } from '@/components/ui';
import { ParamForm } from '@/components/ParamForm';
import { prefs, setPrefs } from '@/components/Camera';
import { list, save } from '@/lib/repo';
import { getDB } from '@/lib/db';
import { sb, APP_VERSION, SUPABASE_URL } from '@/lib/supabase';
import { syncNow, fetchAdmin, resolveConflict, resetCursors } from '@/lib/sync';
import { installDefaultCatalog } from '@/lib/catalogStore';
import { setDemo } from '@/lib/demo';
import { getDeviceId, grantInfo } from '@/lib/auth';
import { formatBytes, uuid } from '@/lib/naming';
import { Plus, RefreshCw, ShieldAlert } from 'lucide-react';

type T = 'general' | 'presets' | 'staff' | 'branches' | 'devices' | 'catalogue' | 'org' | 'audit';

export default function Settings() {
  const { profile } = useApp();
  const admin = profile?.role === 'admin';
  const [tab, setTab] = useState<T>('general');
  const tabs: { v: T; l: string }[] = [{ v: 'general', l: 'General' }, { v: 'presets', l: 'Instrument presets' },
    ...(admin ? [{ v: 'staff' as T, l: 'Staff' }, { v: 'branches' as T, l: 'Branches' }, { v: 'devices' as T, l: 'Devices' }, { v: 'catalogue' as T, l: 'Clinical catalogue' }, { v: 'org' as T, l: 'Policies' }, { v: 'audit' as T, l: 'Audit log' }] : [])];
  return (
    <Shell>
      <PageHeader title="Settings" />
      <div className="mb-4"><Tabs tabs={tabs} value={tab} onChange={setTab} /></div>
      {tab === 'general' && <General />}
      {tab === 'presets' && <Presets />}
      {tab === 'staff' && admin && <Staff />}
      {tab === 'branches' && admin && <Branches />}
      {tab === 'devices' && admin && <Devices />}
      {tab === 'catalogue' && admin && <Catalogue />}
      {tab === 'org' && admin && <OrgPolicies />}
      {tab === 'audit' && admin && <Audit />}
    </Shell>
  );
}

function OnlineOnly({ children }: { children: React.ReactNode }) {
  const { online } = useApp();
  return online ? <>{children}</> : <Card className="p-5 text-sm text-amber-800">Administrative changes require an internet connection.</Card>;
}

function General() {
  const { sync, profile, demo, settings, profile: me } = useApp();
  const [p, setP] = useState<any>({});
  const [operator, setOperator] = useState<any>({});
  const [grant, setGrant] = useState<any>(null);
  useEffect(() => { setP(prefs()); grantInfo().then(setGrant); setOperator(me?.operator_profile ?? {}); }, [me]);
  const conflicts = useData(async () => (await getDB()).getAll('conflicts'));
  const outbox = useData(async () => (await getDB()).getAll('outbox'));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-navy-900">Recording preferences (this iPad)</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default camera"><Select options={[{ v: 'environment', l: 'Rear camera' }, { v: 'user', l: 'Front camera' }]} value={p.facing ?? 'environment'} onChange={(v) => { setPrefs({ facing: v }); setP({ ...p, facing: v }); }} /></Field>
          <Field label="Microphone default"><Select options={[{ v: 'on', l: 'On' }, { v: 'off', l: 'Off' }]} value={p.mic === false ? 'off' : 'on'} onChange={(v) => { setPrefs({ mic: v !== 'off' }); setP({ ...p, mic: v !== 'off' }); }} /></Field>
          <Field label="Recording quality" hint="Actual resolution depends on the iPad and Safari; it is displayed live, never assumed."><Select options={[{ v: 'max', l: 'Highest supported' }, { v: '2160', l: 'Request 2160p' }, { v: '1080', l: '1080p' }, { v: '720', l: '720p' }]} value={p.quality ?? 'max'} onChange={(v) => { setPrefs({ quality: v }); setP({ ...p, quality: v }); }} /></Field>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="mb-2 font-semibold text-navy-900">Synchronisation</h3>
        <p className="text-sm text-navy-500">{sync.pending} change(s) queued · last sync {sync.lastSync ? new Date(sync.lastSync).toLocaleString() : 'never'}{sync.lastError ? ` · last error: ${sync.lastError}` : ''}</p>
        <p className="mt-1 text-sm text-navy-500">Only metadata is synchronised. Videos, photographs and audio always stay on the iPad that recorded them.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => syncNow()}><RefreshCw className="h-4 w-4" />Sync now</Button>
          <Button size="sm" variant="secondary" onClick={async () => { await resetCursors(); await syncNow(); toast.ok('Full re-download of metadata complete'); }}>Full re-sync</Button>
        </div>
        {(outbox ?? []).filter((o: any) => o.last_error).slice(0, 5).map((o: any) => <p key={o.op_id} className="mt-2 text-xs text-red-600">{o.table}: {o.last_error} (attempt {o.attempts})</p>)}
        {(conflicts ?? []).length > 0 && (
          <div className="mt-4">
            <h4 className="flex items-center gap-1 text-sm font-semibold text-red-700"><ShieldAlert className="h-4 w-4" />Conflicting clinical edits</h4>
            {(conflicts as any[]).map((c) => (
              <div key={c.op_id} className="mt-2 rounded-xl border border-red-100 p-3 text-xs">
                <div className="mb-1 font-medium">{c.table} · edited on another device at {new Date(c.server.updated_at).toLocaleString()}</div>
                <div className="grid grid-cols-2 gap-2"><pre className="overflow-x-auto rounded bg-navy-50 p-2">This iPad: {JSON.stringify(diff(c.local, c.server), null, 1)}</pre><pre className="overflow-x-auto rounded bg-navy-50 p-2">Server: {JSON.stringify(diff(c.server, c.local), null, 1)}</pre></div>
                <div className="mt-2 flex gap-2"><Button size="sm" onClick={() => resolveConflict(c.op_id, 'mine')}>Keep this iPad&apos;s version</Button><Button size="sm" variant="secondary" onClick={() => resolveConflict(c.op_id, 'server')}>Use server version</Button></div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="p-5">
        <h3 className="mb-4 font-semibold text-navy-900">My operator profile (optional)</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Clinical experience"><Input value={operator.experience ?? ''} onChange={(e) => setOperator({ ...operator, experience: e.target.value })} /></Field>
          <Field label="Years of hair transplantation experience"><Input type="number" value={operator.ht_years ?? ''} onChange={(e) => setOperator({ ...operator, ht_years: e.target.value === '' ? null : Number(e.target.value) })} /></Field>
          <Field label="Dominant hand"><Select options={['Right', 'Left', 'Ambidextrous']} value={operator.dominant_hand ?? ''} onChange={(v) => setOperator({ ...operator, dominant_hand: v || null })} /></Field>
          <Field label="Preferred instruments"><Input value={operator.preferred_instruments ?? ''} onChange={(e) => setOperator({ ...operator, preferred_instruments: e.target.value })} /></Field>
        </div>
        <Button className="mt-4" size="sm" onClick={async () => {
          const { error } = await sb().from('staff_profiles').update({ operator_profile: operator }).eq('id', profile!.id);
          error ? toast.err(error.message) : (toast.ok('Saved'), syncNow());
        }}>Save profile</Button>
      </Card>
      <Card className="p-5">
        <h3 className="mb-2 font-semibold text-navy-900">Demonstration mode</h3>
        <p className="text-sm text-navy-500">Uses a separate on-device database with synthetic patients only. Demo data is never synchronised to Supabase and never mixed with production records.</p>
        <Button className="mt-3" size="sm" variant={demo ? 'danger' : 'secondary'} onClick={() => { setDemo(!demo); location.href = '/'; }}>{demo ? 'Exit demo mode' : 'Enter demo mode'}</Button>
      </Card>
      <Card className="p-5 lg:col-span-2">
        <h3 className="mb-2 font-semibold text-navy-900">Application information</h3>
        <div className="grid gap-1 text-sm text-navy-600 sm:grid-cols-2">
          <div>Version: {APP_VERSION}</div><div>Device UUID: <code className="text-xs">{getDeviceId()}</code></div>
          <div>Database: {SUPABASE_URL.replace('https://', '')}</div><div>Offline authorisation valid until: {grant ? new Date(grant.expires_at).toLocaleString() : '—'}</div>
          <div>Inactivity lock: {settings.inactivity_lock_minutes} min</div><div>Signed in as {profile?.full_name} ({profile?.role})</div>
        </div>
        <p className="mt-3 text-xs text-navy-400">Follisync is a clinical media collection tool. It performs no AI analysis, prediction or dose calculation. Implemented technical safeguards support, but do not by themselves constitute, compliance with Malaysia&apos;s PDPA 2010 or healthcare confidentiality requirements.</p>
      </Card>
    </div>
  );
}

function diff(a: any, b: any) {
  const o: any = {};
  for (const k of Object.keys(a ?? {})) if (!['updated_at', 'version', 'created_at', '_server_version'].includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b?.[k])) o[k] = a[k];
  return o;
}

function Presets() {
  const { catalog, profile } = useApp();
  const rows = useData(async () => list<any>('instrument_presets', (p) => p.active), []);
  const [edit, setEdit] = useState<any | null>(null);
  const stage = catalog?.stages.find((s) => s.code === edit?.stage_code);
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-navy-500">Presets pre-fill instrument parameters in a stage. Any value can be modified after applying.</p>
        <Button size="sm" onClick={() => setEdit({ id: uuid(), name: '', stage_code: 'S06', values: {}, shared: true, active: true, owner_id: profile?.id, version: 1 })}><Plus className="h-4 w-4" />New preset</Button>
      </div>
      {(rows ?? []).length ? (rows as any[]).map((p) => (
        <div key={p.id} className="flex items-center justify-between border-b border-navy-50 py-3 last:border-0">
          <div><div className="font-medium text-navy-900">{p.name}</div><div className="text-xs text-navy-400">{p.stage_code ?? 'Any stage'} · {Object.keys(p.values ?? {}).length} values · {p.shared ? 'Shared' : 'Private'}</div></div>
          <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit({ ...p })}>Edit</Button><Button size="sm" variant="ghost" onClick={() => save('instrument_presets', { ...p, active: false })}>Archive</Button></div>
        </div>
      )) : <Empty title="No presets yet" />}
      {edit && (
        <Modal open wide onClose={() => setEdit(null)} title="Instrument preset" footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit.name.trim()} onClick={async () => { await save('instrument_presets', edit); setEdit(null); toast.ok('Preset saved'); }}>Save</Button></>}>
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. Hybrid 0.85 mm, 3,000 RPM" /></Field>
            <Field label="Stage"><Select options={(catalog?.stages ?? []).map((s) => ({ v: s.code, l: `${s.code} ${s.title}` }))} value={edit.stage_code} onChange={(v) => setEdit({ ...edit, stage_code: v || null, values: {} })} /></Field>
            <Field label="Visibility"><Select options={[{ v: 'shared', l: 'Shared with clinic' }, { v: 'private', l: 'Only me' }]} value={edit.shared ? 'shared' : 'private'} onChange={(v) => setEdit({ ...edit, shared: v !== 'private' })} /></Field>
          </div>
          {stage && <ParamForm defs={stage.params.filter((p) => !['number'].includes(p.type) || !p.unit || p.unit !== 'count').filter((p) => p.group !== 'Performance')}
            values={Object.fromEntries(Object.entries(edit.values ?? {}).map(([k, v]) => [k, { v }]))}
            onChange={(vals) => setEdit({ ...edit, values: Object.fromEntries(Object.entries(vals).filter(([, x]) => x?.v != null && x.v !== '').map(([k, x]) => [k, x.v])) })} />}
        </Modal>
      )}
    </Card>
  );
}

function Staff() {
  const { staff, branches, refresh } = useApp();
  const [create, setCreate] = useState<any | null>(null);
  const [edit, setEdit] = useState<any | null>(null);
  const [reset, setReset] = useState<any | null>(null);
  async function callFn(body: any) {
    const { data, error } = await sb().functions.invoke('admin-staff', { body });
    if (error) { let msg = error.message; try { msg = (await (error as any).context?.json())?.error ?? msg; } catch {} throw new Error(msg); }
    return data;
  }
  return (
    <OnlineOnly>
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between"><p className="text-sm text-navy-500">No public registration. Staff accounts are created here by administrators.</p>
          <Button size="sm" onClick={() => setCreate({ role: 'doctor', full_name: '', email: '', password: '', can_create_patients: true, all_branches: true, branch_ids: [] })}><Plus className="h-4 w-4" />Add staff</Button></div>
        {staff.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-50 py-3 last:border-0">
            <div><div className="font-medium text-navy-900">{s.full_name} {!s.active && <Badge tone="red">Inactive</Badge>}</div><div className="text-xs text-navy-400">{s.email} · {s.role}{s.all_branches ? ' · all branches' : ` · ${s.branch_ids.length} branch(es)`}</div></div>
            <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEdit({ ...s })}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setReset({ id: s.id, name: s.full_name, password: '' })}>Reset password</Button></div>
          </div>
        ))}
      </Card>
      {create && (
        <Modal open onClose={() => setCreate(null)} title="Add staff member" footer={<><Button variant="ghost" onClick={() => setCreate(null)}>Cancel</Button><Button onClick={async () => {
          try { await callFn({ action: 'create', ...create }); toast.ok('Staff account created'); setCreate(null); await syncNow(); refresh(); } catch (e: any) { toast.err(e.message); }
        }}>Create account</Button></>}>
          <StaffForm v={create} set={setCreate} branches={branches} isNew />
        </Modal>
      )}
      {edit && (
        <Modal open onClose={() => setEdit(null)} title={`Edit ${edit.full_name}`} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={async () => {
          const { error } = await sb().from('staff_profiles').update({ full_name: edit.full_name, role: edit.role, active: edit.active, staff_code: edit.staff_code || null, professional_role: edit.professional_role || null, can_create_patients: edit.can_create_patients, all_branches: edit.all_branches, branch_ids: edit.branch_ids }).eq('id', edit.id);
          if (error) return toast.err(error.message);
          toast.ok('Saved'); setEdit(null); await syncNow(); refresh();
        }}>Save</Button></>}>
          <StaffForm v={edit} set={setEdit} branches={branches} />
        </Modal>
      )}
      {reset && (
        <Modal open onClose={() => setReset(null)} title={`Reset password — ${reset.name}`} footer={<><Button variant="ghost" onClick={() => setReset(null)}>Cancel</Button><Button disabled={reset.password.length < 10} onClick={async () => {
          try { await callFn({ action: 'reset_password', id: reset.id, password: reset.password }); toast.ok('Password reset'); setReset(null); } catch (e: any) { toast.err(e.message); }
        }}>Reset</Button></>}>
          <Field label="New temporary password (min 10 characters)"><Input type="password" autoComplete="new-password" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} /></Field>
        </Modal>
      )}
    </OnlineOnly>
  );
}

function StaffForm({ v, set, branches, isNew }: { v: any; set: (x: any) => void; branches: any[]; isNew?: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name"><Input value={v.full_name} onChange={(e) => set({ ...v, full_name: e.target.value })} /></Field>
      <Field label="Role"><Select options={[{ v: 'doctor', l: 'Doctor' }, { v: 'nurse', l: 'Clinical assistant / nurse' }, { v: 'admin', l: 'Administrator' }]} value={v.role} onChange={(r) => set({ ...v, role: r || 'doctor' })} /></Field>
      {isNew && <Field label="Email (login)"><Input type="email" value={v.email} onChange={(e) => set({ ...v, email: e.target.value })} /></Field>}
      {isNew && <Field label="Temporary password (min 10)"><Input type="password" autoComplete="new-password" value={v.password} onChange={(e) => set({ ...v, password: e.target.value })} /></Field>}
      <Field label="Staff identifier"><Input value={v.staff_code ?? ''} onChange={(e) => set({ ...v, staff_code: e.target.value })} /></Field>
      <Field label="Professional role"><Input value={v.professional_role ?? ''} onChange={(e) => set({ ...v, professional_role: e.target.value })} placeholder="e.g. Hair transplant surgeon" /></Field>
      {v.role === 'nurse' && <Field label="May create patient cases"><Select options={[{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }]} value={v.can_create_patients ? 'yes' : 'no'} onChange={(x) => set({ ...v, can_create_patients: x !== 'no' })} /></Field>}
      <Field label="Branch access"><Select options={[{ v: 'all', l: 'All branches' }, { v: 'some', l: 'Selected branches' }]} value={v.all_branches ? 'all' : 'some'} onChange={(x) => set({ ...v, all_branches: x !== 'some' })} /></Field>
      {!v.all_branches && <div className="sm:col-span-2 flex flex-wrap gap-2">{branches.map((b) => { const on = v.branch_ids.includes(b.id); return <button key={b.id} type="button" onClick={() => set({ ...v, branch_ids: on ? v.branch_ids.filter((x: string) => x !== b.id) : [...v.branch_ids, b.id] })} className={cx('rounded-full border px-3 py-1.5 text-sm', on ? 'border-teal-500 bg-teal-50' : 'border-navy-200')}>{b.name}</button>; })}</div>}
      {!isNew && <Field label="Account status"><Select options={[{ v: 'active', l: 'Active' }, { v: 'inactive', l: 'Inactive (access revoked)' }]} value={v.active ? 'active' : 'inactive'} onChange={(x) => set({ ...v, active: x !== 'inactive' })} /></Field>}
    </div>
  );
}

function Branches() {
  const rows = useData(async () => list<any>('clinic_branches'), []);
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <OnlineOnly>
      <Card className="p-5">
        <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setEdit({ code: '', name: '', active: true })}><Plus className="h-4 w-4" />Add branch</Button></div>
        {(rows ?? []).map((b: any) => (
          <div key={b.id} className="flex items-center justify-between border-b border-navy-50 py-3 last:border-0">
            <span><b>{b.name}</b> <span className="text-sm text-navy-400">{b.code}</span> {!b.active && <Badge tone="red">Inactive</Badge>}</span>
            <Button size="sm" variant="secondary" onClick={() => setEdit({ ...b })}>Edit</Button>
          </div>
        ))}
      </Card>
      {edit && <Modal open onClose={() => setEdit(null)} title="Branch" footer={<Button onClick={async () => {
        const payload = { code: edit.code.toUpperCase(), name: edit.name, active: edit.active, org_id: (await list<any>('organizations'))[0]?.id };
        const r = edit.id ? await sb().from('clinic_branches').update(payload).eq('id', edit.id) : await sb().from('clinic_branches').insert(payload);
        if (r.error) return toast.err(r.error.message);
        setEdit(null); await syncNow(); toast.ok('Saved');
      }}>Save</Button>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Code"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
          <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Status"><Select options={[{ v: 'a', l: 'Active' }, { v: 'i', l: 'Inactive' }]} value={edit.active ? 'a' : 'i'} onChange={(v) => setEdit({ ...edit, active: v !== 'i' })} /></Field>
        </div>
      </Modal>}
    </OnlineOnly>
  );
}

function Devices() {
  const rows = useData(async () => { const [d, m] = await Promise.all([list<any>('registered_devices'), list<any>('media_assets')]); return d.map((x) => ({ ...x, media: m.filter((y) => y.device_id === x.id) })); }, []);
  const [label, setLabel] = useState<Record<string, string>>({});
  return (
    <Card className="p-5">
      <p className="mb-3 text-sm text-navy-500">Each iPad registers its own device UUID. Storage figures are reported by each device when it is online.</p>
      {(rows ?? []).map((d: any) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-50 py-3 last:border-0">
          <div>
            <div className="font-medium text-navy-900">{d.label || d.model || 'Device'} {d.id === getDeviceId() && <Badge tone="teal">This iPad</Badge>}</div>
            <div className="text-xs text-navy-400"><code>{d.id}</code> · last seen {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}</div>
            <div className="text-xs text-navy-500">{d.media.length} recordings · {formatBytes(d.media.reduce((a: number, m: any) => a + (m.size_bytes ?? 0), 0))} · storage {formatBytes(d.storage_summary?.usage)} / {formatBytes(d.storage_summary?.quota)} (est.)</div>
          </div>
          <div className="flex gap-2">
            <Input className="w-48" placeholder="Label e.g. OT-1 iPad" value={label[d.id] ?? d.label ?? ''} onChange={(e) => setLabel({ ...label, [d.id]: e.target.value })} />
            <Button size="sm" variant="secondary" onClick={async () => { await save('registered_devices', { ...d, media: undefined, label: label[d.id] ?? d.label }); toast.ok('Saved'); }}>Save</Button>
          </div>
        </div>
      ))}
    </Card>
  );
}

function Catalogue() {
  const { catalog, profile, refresh } = useApp();
  const raw = useData(async () => { const [st, sub, par, reg] = await Promise.all([list<any>('procedure_stages'), list<any>('procedure_subcategories'), list<any>('parameter_definitions'), list<any>('anatomical_regions')]); return { st, sub, par, reg }; }, []);
  const [step, setStep] = useState('');
  const [stage, setStage] = useState('S06');
  const [add, setAdd] = useState<any | null>(null);
  const st = raw?.st.find((s: any) => s.code === stage);
  async function ins(table: string, payload: any) { const { error } = await sb().from(table).insert({ ...payload, org_id: profile!.org_id }); if (error) throw new Error(error.message); }
  async function upd(table: string, id: string, payload: any) { const { error } = await sb().from(table).update(payload).eq('id', id); if (error) throw new Error(error.message); }
  return (
    <OnlineOnly>
      <Card className="mb-4 p-5">
        <h3 className="font-semibold text-navy-900">Organisation catalogue</h3>
        <p className="mt-1 text-sm text-navy-500">Source in use: <b>{catalog?.source === 'organisation' ? 'organisation definitions (Supabase)' : 'bundled defaults'}</b>. Install the default Follisync catalogue (12 stages, subcategories, parameters, regions) into Supabase so administrators can extend it. Existing entries are kept. Deactivating never deletes: historical records stay readable.</p>
        <Button className="mt-3" size="sm" onClick={async () => { try { await installDefaultCatalog(profile!.org_id, setStep); setStep(''); await syncNow(); refresh(); toast.ok('Catalogue installed'); } catch (e: any) { toast.err(e.message); setStep(''); } }}>Install / update default catalogue</Button>
        {step && <p className="mt-2 text-sm text-teal-700">{step}</p>}
      </Card>
      {raw && raw.st.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2"><Select className="flex-1" options={raw.st.sort((a: any, b: any) => a.sort_order - b.sort_order).map((s: any) => ({ v: s.code, l: `${s.code} ${s.title}${s.active ? '' : ' (inactive)'}` }))} value={stage} onChange={(v) => setStage(v || 'S01')} />
              <Button size="sm" variant="secondary" onClick={() => setAdd({ kind: 'stage', code: `S${String(raw.st.length + 1).padStart(2, '0')}`, title: '', folder_name: '', description: '' })}><Plus className="h-4 w-4" />Stage</Button></div>
            {st && <div className="mb-3 flex items-center justify-between rounded-xl bg-navy-50 p-3 text-sm"><span>{st.title}</span><Button size="sm" variant="ghost" onClick={async () => { await upd('procedure_stages', st.id, { active: !st.active }); await syncNow(); }}>{st.active ? 'Deactivate' : 'Activate'}</Button></div>}
            <h4 className="mb-2 text-sm font-semibold text-navy-800">Subcategories</h4>
            {raw.sub.filter((x: any) => x.stage_id === st?.id).sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => (
              <div key={x.id} className="flex items-center justify-between py-1.5 text-sm"><span className={x.active ? '' : 'text-navy-300 line-through'}>{x.label} <code className="text-xs text-navy-400">{x.code}</code></span>
                <button className="text-xs text-navy-500 underline" onClick={async () => { await upd('procedure_subcategories', x.id, { active: !x.active }); await syncNow(); }}>{x.active ? 'Deactivate' : 'Activate'}</button></div>
            ))}
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => setAdd({ kind: 'sub', label: '', code: '' })}><Plus className="h-4 w-4" />Subcategory</Button>
          </Card>
          <Card className="p-5">
            <h4 className="mb-2 text-sm font-semibold text-navy-800">Clinical parameters for {stage}</h4>
            <div className="max-h-96 overflow-y-auto">
              {raw.par.filter((x: any) => x.stage_id === st?.id).sort((a: any, b: any) => a.sort_order - b.sort_order).map((x: any) => (
                <div key={x.id} className="flex items-center justify-between py-1.5 text-sm"><span className={x.active ? '' : 'text-navy-300 line-through'}>{x.label} <span className="text-xs text-navy-400">{x.data_type}{x.unit ? ` · ${x.unit}` : ''}</span></span>
                  <button className="text-xs text-navy-500 underline" onClick={async () => { await upd('parameter_definitions', x.id, { active: !x.active }); await syncNow(); }}>{x.active ? 'Deactivate' : 'Activate'}</button></div>
              ))}
            </div>
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => setAdd({ kind: 'param', label: '', key: '', data_type: 'text', unit: '', options: '', group_name: '', provenance: false, searchable: false })}><Plus className="h-4 w-4" />Parameter</Button>
          </Card>
          <Card className="p-5 lg:col-span-2">
            <h4 className="mb-2 text-sm font-semibold text-navy-800">Anatomical regions</h4>
            <div className="flex flex-wrap gap-2">{raw.reg.sort((a: any, b: any) => a.kind.localeCompare(b.kind) || a.sort_order - b.sort_order).map((r: any) => (
              <button key={r.id} onClick={async () => { await upd('anatomical_regions', r.id, { active: !r.active }); await syncNow(); }} className={cx('rounded-full border px-3 py-1 text-xs', r.active ? 'border-navy-200' : 'border-navy-100 text-navy-300 line-through')}>{r.kind === 'donor' ? 'D' : 'R'} · {r.label}</button>
            ))}</div>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => setAdd({ kind: 'region', label: '', regionKind: 'donor' })}><Plus className="h-4 w-4" />Region</Button>
          </Card>
        </div>
      )}
      {add && (
        <Modal open onClose={() => setAdd(null)} title="Add to catalogue" footer={<Button onClick={async () => {
          try {
            const code = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24);
            if (add.kind === 'stage') await ins('procedure_stages', { code: add.code, number: raw!.st.length + 1, slug: code(add.title).toLowerCase(), title: add.title, description: add.description, folder_name: `${String(raw!.st.length + 1).padStart(2, '0')}_${add.folder_name || code(add.title)}`, sort_order: raw!.st.length + 1 });
            if (add.kind === 'sub') await ins('procedure_subcategories', { stage_id: st.id, code: add.code ? code(add.code) : code(add.label), label: add.label, folder_name: add.label.replace(/[^A-Za-z0-9]+/g, '_'), sort_order: 999 });
            if (add.kind === 'param') await ins('parameter_definitions', { scope: 'stage', stage_id: st.id, key: add.key || code(add.label).toLowerCase(), label: add.label, data_type: add.data_type, unit: add.unit || null, group_name: add.group_name || null, options: add.options ? add.options.split(',').map((s: string) => s.trim()).filter(Boolean) : null, provenance: add.provenance, searchable: add.searchable, sort_order: 999 });
            if (add.kind === 'region') await ins('anatomical_regions', { kind: add.regionKind, code: code(add.label), label: add.label, sort_order: 999 });
            setAdd(null); await syncNow(); refresh(); toast.ok('Added');
          } catch (e: any) { toast.err(e.message); }
        }}>Add</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            {add.kind === 'stage' && <><Field label="Code"><Input value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} /></Field><Field label="Title"><Input value={add.title} onChange={(e) => setAdd({ ...add, title: e.target.value })} /></Field><Field label="Folder name"><Input value={add.folder_name} onChange={(e) => setAdd({ ...add, folder_name: e.target.value })} /></Field><Field label="Description" className="sm:col-span-2"><Textarea value={add.description} onChange={(e) => setAdd({ ...add, description: e.target.value })} /></Field></>}
            {(add.kind === 'sub' || add.kind === 'region' || add.kind === 'param') && <Field label="Label"><Input value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} /></Field>}
            {add.kind === 'sub' && <Field label="Filename code (optional)"><Input value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} placeholder="e.g. PUNCHING" /></Field>}
            {add.kind === 'region' && <Field label="Type"><Select options={[{ v: 'donor', l: 'Donor' }, { v: 'recipient', l: 'Recipient' }]} value={add.regionKind} onChange={(v) => setAdd({ ...add, regionKind: v || 'donor' })} /></Field>}
            {add.kind === 'param' && <>
              <Field label="Key (optional)"><Input value={add.key} onChange={(e) => setAdd({ ...add, key: e.target.value })} /></Field>
              <Field label="Type"><Select options={['text', 'textarea', 'number', 'select', 'multiselect', 'datetime', 'date', 'boolean', 'donor_region', 'recipient_region']} value={add.data_type} onChange={(v) => setAdd({ ...add, data_type: v || 'text' })} /></Field>
              <Field label="Unit"><Input value={add.unit} onChange={(e) => setAdd({ ...add, unit: e.target.value })} /></Field>
              <Field label="Group"><Input value={add.group_name} onChange={(e) => setAdd({ ...add, group_name: e.target.value })} /></Field>
              <Field label="Options (comma-separated)"><Input value={add.options} onChange={(e) => setAdd({ ...add, options: e.target.value })} /></Field>
              <Field label="Measurement source selector"><Select options={[{ v: 'y', l: 'Yes' }, { v: 'n', l: 'No' }]} value={add.provenance ? 'y' : 'n'} onChange={(v) => setAdd({ ...add, provenance: v === 'y' })} /></Field>
              <Field label="Searchable in libraries"><Select options={[{ v: 'y', l: 'Yes' }, { v: 'n', l: 'No' }]} value={add.searchable ? 'y' : 'n'} onChange={(v) => setAdd({ ...add, searchable: v === 'y' })} /></Field>
            </>}
          </div>
        </Modal>
      )}
    </OnlineOnly>
  );
}

function OrgPolicies() {
  const { settings, refresh } = useApp();
  const [s, setS] = useState<any>(settings);
  return (
    <OnlineOnly>
      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Inactivity lock (minutes, 0 = off)"><Input type="number" value={s.inactivity_lock_minutes} onChange={(e) => setS({ ...s, inactivity_lock_minutes: Number(e.target.value) })} /></Field>
          <Field label="Offline authorisation validity (hours)"><Input type="number" value={s.offline_auth_hours} onChange={(e) => setS({ ...s, offline_auth_hours: Number(e.target.value) })} /></Field>
          <Field label="Low-storage warning (% used)"><Input type="number" value={s.storage_warn_pct} onChange={(e) => setS({ ...s, storage_warn_pct: Number(e.target.value) })} /></Field>
          <Field label="Critical storage — block recording (% used)"><Input type="number" value={s.storage_critical_pct} onChange={(e) => setS({ ...s, storage_critical_pct: Number(e.target.value) })} /></Field>
          <Field label="Backup reminder interval (hours)"><Input type="number" value={s.backup_reminder_hours} onChange={(e) => setS({ ...s, backup_reminder_hours: Number(e.target.value) })} /></Field>
          <Field label="Current consent form version"><Input value={s.consent_version} onChange={(e) => setS({ ...s, consent_version: e.target.value })} /></Field>
          <Field label="Data retention (years)" hint="Recorded policy; no automatic deletion is performed."><Input type="number" value={s.retention_years ?? ''} onChange={(e) => setS({ ...s, retention_years: Number(e.target.value) })} /></Field>
        </div>
        <Button className="mt-4" onClick={async () => {
          const org = (await list<any>('organizations'))[0];
          const { error } = await sb().from('organizations').update({ settings: s }).eq('id', org.id);
          if (error) return toast.err(error.message);
          await syncNow(); refresh(); toast.ok('Policies saved');
        }}>Save policies</Button>
      </Card>
    </OnlineOnly>
  );
}

function Audit() {
  const { staff } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { fetchAdmin('audit_logs', 300).then(setRows).catch((e) => toast.err(e.message)); }, []);
  return (
    <OnlineOnly>
      <Card className="p-5">
        <p className="mb-3 text-sm text-navy-500">The audit log records who changed which fields and when. Field values are not logged, so patient information does not appear in logs.</p>
        <div className="max-h-[65vh] overflow-y-auto text-sm">
          {rows === null ? <p>Loading…</p> : rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[160px_140px_1fr] gap-2 border-b border-navy-50 py-1.5">
              <span className="text-navy-400">{new Date(r.created_at).toLocaleString()}</span>
              <span>{staff.find((s) => s.id === r.actor_id)?.full_name ?? (r.actor_id ? r.actor_id.slice(0, 8) : 'system')}</span>
              <span><b>{r.action}</b> {r.table_name} <code className="text-xs text-navy-400">{String(r.record_id ?? '').slice(0, 8)}</code>{r.changed_fields?.length ? ` · ${r.changed_fields.join(', ')}` : ''}</span>
            </div>
          ))}
        </div>
      </Card>
    </OnlineOnly>
  );
}

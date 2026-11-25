'use client';
import { useEffect, useRef, useState } from 'react';
import { Shell } from '@/components/Shell';
import { useApp, useData } from '@/components/AppProvider';
import { Button, Card, Field, Input, Select, Badge, PageHeader, Modal, Stat, toast } from '@/components/ui';
import { useQuery } from '@/lib/useQuery';
import { list, save } from '@/lib/repo';
import { storageEstimate, requestPersistence, opfs } from '@/lib/storage/opfs';
import { planExport, buildBatch, deliverFile, recordExport, cleanupTemp, restoreBackup, ExportPlan } from '@/lib/export';
import { formatBytes } from '@/lib/naming';
import { getDeviceId } from '@/lib/auth';
import { kvGet, kvSet } from '@/lib/db';
import { HardDrive, ShieldCheck, AlertTriangle, Download, Upload, Lock, SearchCheck, Database, Trash2 } from 'lucide-react';

export default function StoragePage() {
  const { settings, profile } = useApp();
  const q = useQuery();
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: number; missing: string[]; bad: string[] } | null>(null);
  const [exportOpen, setExportOpen] = useState<string[] | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [purge, setPurge] = useState(false);
  const data = useData(async () => {
    const deviceId = getDeviceId();
    const [est, media, locs, sessions, patients, lastBackup] = await Promise.all([
      storageEstimate(), list<any>('media_assets', (m) => !m.deleted_at), list<any>('media_storage_locations', (l) => l.device_id === deviceId && l.provider === 'local_opfs'),
      list<any>('surgical_sessions', (s) => !s.deleted_at), list<any>('patients'), kvGet<string>('last_backup'),
    ]);
    const local = locs.filter((l) => l.availability === 'available');
    return {
      est, media, locs, sessions, patients, lastBackup,
      localBytes: local.reduce((a, l) => a + (l.size_bytes ?? 0), 0), count: local.length,
      none: local.filter((l) => l.backup_status === 'none'), exported: local.filter((l) => l.backup_status === 'exported'), verified: local.filter((l) => l.backup_status === 'verified'),
      pendingMigration: local.filter((l) => l.migration_status === 'pending').reduce((a, l) => a + (l.size_bytes ?? 0), 0),
    };
  });
  useEffect(() => { const e = q?.get('export'); if (e) setExportOpen([e]); }, [q]);
  const pct = data?.est.quota && data.est.usage != null ? (data.est.usage / data.est.quota) * 100 : null;
  const level = pct == null ? 'unknown' : pct >= settings.storage_critical_pct ? 'critical' : pct >= settings.storage_warn_pct ? 'low' : 'ok';
  const backupDue = !data?.lastBackup || Date.now() - new Date(data.lastBackup).getTime() > settings.backup_reminder_hours * 3600_000;

  async function integrityCheck() {
    if (!data) return;
    setChecking(true);
    const res = { ok: 0, missing: [] as string[], bad: [] as string[] };
    for (const l of data.locs) {
      const m = data.media.find((x) => x.id === l.media_id);
      const v = await opfs.verify(l.relative_path, { size: l.size_bytes, sha256: l.checksum_sha256 });
      if (v.ok) { res.ok++; if (l.availability !== 'available' || l.integrity_status !== 'verified') await save('media_storage_locations', { ...l, availability: 'available', integrity_status: 'verified', verified_at: new Date().toISOString() }); }
      else if (v.reason === 'File missing') { res.missing.push(m?.filename ?? l.relative_path); if (l.availability !== 'missing') await save('media_storage_locations', { ...l, availability: 'missing' }); }
      else { res.bad.push(`${m?.filename ?? l.relative_path}: ${v.reason}`); await save('media_storage_locations', { ...l, integrity_status: 'failed' }); }
    }
    setCheck(res); setChecking(false);
    res.missing.length || res.bad.length ? toast.err(`Integrity issues found: ${res.missing.length} missing, ${res.bad.length} failed`) : toast.ok(`All ${res.ok} local files verified`);
  }

  return (
    <Shell>
      <PageHeader title="Device storage" sub="This iPad's local clinical media (Origin Private File System)"
        actions={<>
          <Button variant="secondary" onClick={() => setRestoreOpen(true)}><Upload className="h-4 w-4" />Verify / restore backup</Button>
          <Button onClick={() => setExportOpen(data?.sessions.map((s) => s.id) ?? [])}><Download className="h-4 w-4" />Bulk export</Button>
        </>} />

      <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <b className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Browser-local storage is not permanent clinical archival storage.</b>
        <p className="mt-1">Media lives in Safari&apos;s private storage for this app. It is not visible in the Files app, can be lost if website data is cleared or the app is removed, and persistence is not guaranteed. Export and verify backups daily. Begin real patient recording only after these iPads pass recording, storage and backup-recovery tests.</p>
      </div>
      {backupDue && (data?.none.length ?? 0) > 0 && <div className="mb-4 flex items-center justify-between rounded-2xl bg-red-50 p-4 text-sm text-red-800"><span><b>Backup reminder:</b> {data?.none.length} recording(s) on this iPad have never been exported.</span><Button size="sm" variant="danger" onClick={() => setExportOpen(data?.sessions.map((s) => s.id) ?? [])}>Back up now</Button></div>}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Estimated quota" value={formatBytes(data?.est.quota)} icon={<HardDrive className="h-4 w-4" />} sub="Browser estimate" />
        <Stat label="Estimated usage" value={formatBytes(data?.est.usage)} sub={pct != null ? `${pct.toFixed(1)}% used` : 'Unavailable'} />
        <Stat label="Available (est.)" value={data?.est.quota != null && data.est.usage != null ? formatBytes(data.est.quota - data.est.usage) : '—'} sub={<Badge tone={level === 'critical' ? 'red' : level === 'low' ? 'amber' : 'green'}>{level === 'critical' ? 'Critical' : level === 'low' ? 'Low' : level === 'ok' ? 'OK' : 'Unknown'}</Badge>} />
        <Stat label="Local media" value={formatBytes(data?.localBytes)} sub={`${data?.count ?? 0} recordings`} />
        <Stat label="Backup status" value={`${data?.verified.length ?? 0} verified`} sub={`${data?.exported.length ?? 0} exported · ${data?.none.length ?? 0} not backed up`} icon={<ShieldCheck className="h-4 w-4" />} />
        <Stat label="Pending migration" value={formatBytes(data?.pendingMigration)} sub="Reserved for Google Drive" icon={<Database className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-2 font-semibold text-navy-900">Persistence & integrity</h3>
          <p className="text-sm text-navy-500">Persistent storage: <b>{data?.est.persisted == null ? 'unknown' : data.est.persisted ? 'granted' : 'not granted'}</b>. Installing Follisync to the Home Screen improves persistence on iPadOS, but it is never guaranteed.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={async () => { const r = await requestPersistence(); toast.info(r ? 'Persistent storage granted' : 'Browser did not grant persistent storage'); }}>Request persistent storage</Button>
            <Button variant="secondary" size="sm" disabled={checking} onClick={integrityCheck}><SearchCheck className="h-4 w-4" />{checking ? 'Checking checksums…' : 'Run integrity check'}</Button>
          </div>
          {check && (
            <div className="mt-3 text-sm">
              <p className="text-emerald-700">{check.ok} files verified (size + SHA-256).</p>
              {check.missing.map((x) => <p key={x} className="text-red-600">Missing: {x}</p>)}
              {check.bad.map((x) => <p key={x} className="text-red-600">{x}</p>)}
            </div>
          )}
        </Card>
        <Card className="p-5">
          <h3 className="mb-2 font-semibold text-navy-900">Sessions on this iPad</h3>
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {data?.sessions.map((s) => {
              const p = data.patients.find((x) => x.id === s.patient_id);
              const ls = data.locs.filter((l) => data.media.some((m) => m.id === l.media_id && m.session_id === s.id));
              if (!ls.length) return null;
              return (
                <div key={s.id} className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-navy-50">
                  <span className="text-sm"><b>{p?.patient_code} · {s.session_code}</b> <span className="text-navy-400">{ls.length} files · {formatBytes(ls.reduce((a, l) => a + (l.size_bytes ?? 0), 0))}</span></span>
                  <span className="flex items-center gap-2">
                    {ls.every((l) => l.backup_status === 'verified') ? <Badge tone="green">Verified</Badge> : ls.some((l) => l.backup_status === 'none') ? <Badge tone="red">Not backed up</Badge> : <Badge>Exported</Badge>}
                    <Button size="sm" variant="ghost" onClick={() => setExportOpen([s.id])}>Export</Button>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
        {profile?.role === 'admin' && (
          <Card className="p-5 lg:col-span-2">
            <h3 className="mb-1 font-semibold text-navy-900">Free space (administrator)</h3>
            <p className="text-sm text-navy-500">Originals are never deleted automatically. An administrator may remove local copies only for recordings whose backup has been <b>verified</b> by restoring/checking the exported archive. Metadata is retained and storage records are marked accordingly.</p>
            <Button className="mt-3" variant="secondary" size="sm" disabled={!data?.verified.length} onClick={() => setPurge(true)}><Trash2 className="h-4 w-4" />Remove verified-backup originals ({data?.verified.length ?? 0})</Button>
          </Card>
        )}
      </div>

      {exportOpen && <ExportModal sessionIds={exportOpen} onClose={() => { setExportOpen(null); history.replaceState(null, '', '/storage/'); }} />}
      {restoreOpen && <RestoreModal onClose={() => setRestoreOpen(false)} />}
      {purge && data && <PurgeModal locs={data.verified} onClose={() => setPurge(false)} />}
    </Shell>
  );
}

function ExportModal({ sessionIds, onClose }: { sessionIds: string[]; onClose: () => void }) {
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [encrypt, setEncrypt] = useState(true);
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [limit, setLimit] = useState('1024');
  const [step, setStep] = useState('');
  const [done, setDone] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { planExport(sessionIds, Number(limit) * 1024 * 1024).then(setPlan).catch((e) => toast.err(e.message)); }, [sessionIds, limit]);
  const pwOk = !encrypt || (pw.length >= 10 && pw === pw2);
  async function run(i: number) {
    if (!plan) return;
    setBusy(true);
    try {
      const file = await buildBatch(plan.batches[i], i, plan.batches.length, encrypt ? pw : null, setStep);
      setStep('Ready — choose where to save (e.g. Files › clinic-approved location)');
      await deliverFile(file);
      const ids = plan.batches[i].files.map((f) => f.mediaId).filter(Boolean) as string[];
      await recordExport(ids, plan.batches[i].bytes, encrypt, { sessions: sessionIds, batch: i + 1, of: plan.batches.length });
      await kvSet('last_backup', new Date().toISOString());
      setDone((d) => [...d, i]);
      setStep(`Batch ${i + 1} exported. Verify it via “Verify / restore backup” to mark it verified.`);
    } catch (e: any) { toast.err(e.message); setStep(''); } finally { setBusy(false); await cleanupTemp(); }
  }
  return (
    <Modal open onClose={onClose} title="Secure export" wide>
      {!plan ? <p className="text-navy-500">Preparing manifest…</p> : !plan.batches.length ? <p className="text-navy-500">No local media for this selection on this iPad.</p> : (
        <div className="space-y-4">
          <p className="text-sm text-navy-600">{plan.mediaIds.length} recordings · {formatBytes(plan.totalBytes)} including JSON sidecars and manifests. Exported in {plan.batches.length} batch{plan.batches.length > 1 ? 'es' : ''}; each file is checksum-verified while packaging. Original files are not modified or deleted.</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Batch size"><Select options={[{ v: '512', l: '512 MB' }, { v: '1024', l: '1 GB' }, { v: '2048', l: '2 GB' }, { v: '3500', l: '3.5 GB (max)' }]} value={limit} onChange={(v) => setLimit(v || '1024')} /></Field>
            <Field label="Encryption"><Select options={[{ v: 'yes', l: 'AES-256-GCM encrypted (.fsenc)' }, { v: 'no', l: 'Unencrypted ZIP' }]} value={encrypt ? 'yes' : 'no'} onChange={(v) => setEncrypt(v !== 'no')} /></Field>
          </div>
          {encrypt ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Backup password (min 10 chars)"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
              <Field label="Confirm password"><Input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></Field>
              <p className="text-xs text-navy-500 sm:col-span-2"><Lock className="mr-1 inline h-3 w-3" />Store this password in the clinic&apos;s password manager. Without it the backup cannot be recovered.</p>
            </div>
          ) : <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Unencrypted exports contain clinical information. Only save to an approved, encrypted, access-controlled destination.</p>}
          <div className="space-y-2">
            {plan.batches.map((b, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl border border-navy-100 px-3 py-2">
                <span className="text-sm">Batch {i + 1} · {b.files.length} files · {formatBytes(b.bytes)}</span>
                {done.includes(i) ? <Badge tone="green">Exported</Badge> : <Button size="sm" disabled={busy || !pwOk} onClick={() => run(i)}><Download className="h-4 w-4" />Export</Button>}
              </div>
            ))}
          </div>
          {step && <p className="text-sm text-teal-700">{step}</p>}
        </div>
      )}
    </Modal>
  );
}

function RestoreModal({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'verify' | 'restore'>('verify');
  const [step, setStep] = useState('');
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Verify or restore a backup" footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button disabled={!file || busy} onClick={async () => {
      setBusy(true); setRes(null);
      try { const r = await restoreBackup(file!, pw || null, mode, setStep); setRes(r); r.failed.length ? toast.err(`${r.failed.length} file(s) failed verification`) : toast.ok(`${r.ok} files verified${mode === 'restore' ? `, ${r.restored} restored` : ''}`); }
      catch (e: any) { toast.err(e.message); } finally { setBusy(false); setStep(''); }
    }}>{busy ? 'Working…' : mode === 'verify' ? 'Verify backup' : 'Restore'}</Button></>}>
      <div className="space-y-4">
        <p className="text-sm text-navy-500">Select a Follisync export (.zip or .fsenc). Verification checks every file&apos;s size and SHA-256 against the backup manifest and marks matching recordings as <b>backup verified</b>. Restore also copies missing files back onto this iPad.</p>
        <Button variant="secondary" onClick={() => ref.current?.click()}><Upload className="h-4 w-4" />{file ? file.name : 'Choose backup file'}</Button>
        <input ref={ref} type="file" hidden accept=".zip,.fsenc,application/zip,application/octet-stream" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        {file?.name.endsWith('.fsenc') && <Field label="Backup password"><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>}
        <Field label="Action"><Select options={[{ v: 'verify', l: 'Verify integrity only' }, { v: 'restore', l: 'Verify and restore missing files to this iPad' }]} value={mode} onChange={(v) => setMode((v as any) || 'verify')} /></Field>
        {step && <p className="text-sm text-teal-700">{step}</p>}
        {res && <div className="text-sm"><p className="text-emerald-700">{res.ok} files verified{mode === 'restore' ? ` · ${res.restored} restored` : ''}.</p>{res.failed.map((f: string) => <p key={f} className="text-red-600">{f}</p>)}</div>}
      </div>
    </Modal>
  );
}

function PurgeModal({ locs, onClose }: { locs: any[]; onClose: () => void }) {
  const { profile } = useApp();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Remove local originals with verified backups" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="danger" disabled={confirm !== 'DELETE' || busy} onClick={async () => {
      setBusy(true);
      let n = 0;
      for (const l of locs) {
        try { await opfs.delete(l.relative_path, { approvedBy: profile!.id, verifiedArchive: l.backup_status === 'verified' }); await save('media_storage_locations', { ...l, availability: 'deleted_after_archive' }); n++; } catch (e: any) { toast.err(e.message); }
      }
      toast.ok(`${n} local originals removed; metadata retained.`); setBusy(false); onClose();
    }}>Remove {locs.length} files</Button></>}>
      <p className="text-sm text-navy-600">This removes {locs.length} original file(s) from this iPad. Each has a verified backup. This is logged. Type <b>DELETE</b> to confirm.</p>
      <Input className="mt-3" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
    </Modal>
  );
}

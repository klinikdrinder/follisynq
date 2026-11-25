'use client';
import React, { useEffect, useState } from 'react';
import { Trash2, RotateCcw, Film, Image as ImageIcon, Mic, Smartphone, CloudOff, AlertTriangle, CheckCircle2, Clock, ShieldCheck } from 'lucide-react';
import { availabilityOf, thumbUrl, amendMedia, Availability } from '@/lib/media';
import { opfs } from '@/lib/storage/opfs';
import { formatBytes, formatDuration } from '@/lib/naming';
import { list } from '@/lib/repo';
import { getDB } from '@/lib/db';
import { deleteMedia, restoreMedia, purgeMediaFiles } from '@/lib/trash';
import { Badge, Button, Modal, Field, Select, Textarea, Input, cx, toast } from './ui';
import { useApp } from './AppProvider';

const TypeIcon = ({ t, className }: { t: string; className?: string }) => t === 'video' ? <Film className={className} /> : t === 'photo' ? <ImageIcon className={className} /> : <Mic className={className} />;

export function AvailabilityBadge({ status }: { status: Availability | 'loading' }) {
  if (status === 'local') return <Badge tone="green"><Smartphone className="h-3 w-3" />On this iPad</Badge>;
  if (status === 'other_device') return <Badge tone="blue"><CloudOff className="h-3 w-3" />On another iPad</Badge>;
  if (status === 'missing') return <Badge tone="red"><AlertTriangle className="h-3 w-3" />Original unavailable</Badge>;
  if (status === 'loading') return <Badge>…</Badge>;
  return <Badge tone="amber">Unknown location</Badge>;
}

export function useSyncedIds() {
  const { tick } = useApp();
  const [pending, setPending] = useState<Set<string>>(new Set());
  useEffect(() => {
    getDB().then((db) => db.getAll('outbox')).then((ops: any[]) => setPending(new Set(ops.filter((o) => o.table === 'media_assets').map((o) => o.data.id))));
  }, [tick]);
  return pending;
}

export function MediaTile({ m, onOpen, pendingSync, backup }: { m: any; onOpen: () => void; pendingSync: boolean; backup?: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | 'loading'>('loading');
  useEffect(() => {
    let url: string | null = null;
    availabilityOf(m).then((a) => {
      setAvail(a.status);
      if (a.status === 'local') {
        const load = (retry: boolean) => thumbUrl(m.id).then((u) => { if (u) { url = u; setThumb(u); } else if (retry) setTimeout(() => load(false), 2000); });
        load(true);
      }
    });
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [m.id, m.device_id]);
  return (
    <button onClick={onOpen} className="group overflow-hidden rounded-2xl border border-navy-100 bg-white text-left shadow-card transition hover:border-teal-300">
      <div className="relative aspect-video bg-navy-50">
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> :
          <div className="flex h-full items-center justify-center text-navy-200"><TypeIcon t={m.media_type} className="h-10 w-10" /></div>}
        <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">{m.stage_code} · #{String(m.sequence_no ?? '').padStart(3, '0')}</span>
        {m.duration_ms != null && <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white tabular-nums">{formatDuration(m.duration_ms)}</span>}
        {m.deleted_at && <span className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-navy-600">{m.notes?.includes('Superseded') ? 'Superseded' : 'Deleted'}</span>}
      </div>
      <div className="space-y-1.5 p-3">
        <div className="truncate text-[13px] font-medium text-navy-800">{m.subcategory_code ?? 'General'}{m.region ? ` · ${m.region}` : ''}</div>
        <div className="flex flex-wrap gap-1">
          <AvailabilityBadge status={avail} />
          {pendingSync ? <Badge tone="amber"><Clock className="h-3 w-3" />Sync pending</Badge> : <Badge tone="teal"><CheckCircle2 className="h-3 w-3" />Metadata synced</Badge>}
          {backup === 'verified' && <Badge tone="green"><ShieldCheck className="h-3 w-3" />Backup verified</Badge>}
          {backup === 'exported' && <Badge tone="neutral">Exported</Badge>}
          {m.integrity_status === 'partial_recovered' && <Badge tone="red">Partial</Badge>}
        </div>
      </div>
    </button>
  );
}

export function MediaGrid({ media, empty }: { media: any[]; empty?: React.ReactNode }) {
  const pending = useSyncedIds();
  const [open, setOpen] = useState<any | null>(null);
  const [locs, setLocs] = useState<Record<string, string>>({});
  const { tick } = useApp();
  useEffect(() => {
    list<any>('media_storage_locations').then((ls) => { const o: Record<string, string> = {}; ls.forEach((l) => { o[l.media_id] = l.backup_status; }); setLocs(o); });
  }, [tick]);
  if (!media.length) return <>{empty}</>;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {media.map((m) => <MediaTile key={m.id} m={m} onOpen={() => setOpen(m)} pendingSync={pending.has(m.id)} backup={locs[m.id]} />)}
      </div>
      {open && <MediaViewer media={open} onClose={() => setOpen(null)} />}
    </>
  );
}

export function MediaViewer({ media, onClose }: { media: any; onClose: () => void }) {
  const { catalog, staff, profile } = useApp();
  const [confirm, setConfirm] = useState<null | 'delete' | 'purge'>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [avail, setAvail] = useState<Availability | 'loading'>('loading');
  const [verify, setVerify] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState<any>({});
  const [reason, setReason] = useState('');
  const [amendments, setAmendments] = useState<any[]>([]);
  useEffect(() => {
    let u: string | null = null;
    availabilityOf(media).then(async (a) => {
      setAvail(a.status);
      if (a.status === 'local' && a.path) { const f = await opfs.retrieve(a.path); if (f) { u = URL.createObjectURL(f); setUrl(u); } }
    });
    list<any>('media_metadata_amendments', (x) => x.media_id === media.id).then((x) => setAmendments(x.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))));
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [media]);
  const stage = catalog?.stages.find((s) => s.code === (draft.stage_code ?? media.stage_code));
  const recorder = staff.find((s) => s.id === media.recorded_by);

  async function runVerify() {
    const a = await availabilityOf(media);
    if (!a.path) return setVerify('No local file on this iPad');
    const r = await opfs.verify(a.path, { size: media.size_bytes, sha256: media.checksum_sha256 });
    setVerify(r.ok ? `Integrity verified · SHA-256 matches · ${formatBytes(r.size)}` : `Integrity FAILED: ${r.reason}`);
  }

  return (
    <Modal open onClose={onClose} wide title={<span className="flex items-center gap-2"><TypeIcon t={media.media_type} className="h-5 w-5" />{media.filename}</span>}>
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="overflow-hidden rounded-2xl bg-black">
            {avail === 'local' && url ? (
              media.media_type === 'video' ? <video src={url} controls playsInline className="max-h-[60vh] w-full" /> :
              media.media_type === 'photo' ? <img src={url} alt="" className="max-h-[60vh] w-full object-contain" /> :
              <div className="p-8"><audio src={url} controls className="w-full" /></div>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 p-6 text-center text-white/80">
                <AvailabilityBadge status={avail} />
                <p className="text-sm">{avail === 'other_device' ? 'This recording is stored on another registered iPad. Playback becomes available after cloud migration or restoring a backup here.' :
                  avail === 'missing' ? 'The original file could not be found on this iPad. Restore it from a verified backup.' : 'Checking local storage…'}</p>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {avail === 'local' && <Button variant="secondary" size="sm" onClick={runVerify}>Verify integrity</Button>}
            <Button variant="secondary" size="sm" onClick={() => { setDraft({ stage_code: media.stage_code, subcategory_code: media.subcategory_code, region: media.region, notes: media.notes, recording_context: media.recording_context ?? {} }); setEdit(true); }}>Edit / reclassify</Button>
            {!media.deleted_at ? (
              <Button variant="secondary" size="sm" className="!border-red-200 !text-red-600" onClick={() => setConfirm('delete')}><Trash2 className="h-4 w-4" />Delete</Button>
            ) : (
              <>
                <Button variant="teal" size="sm" onClick={async () => { await restoreMedia(media); toast.ok('Restored'); onClose(); }}><RotateCcw className="h-4 w-4" />Restore</Button>
                {profile?.role === 'admin' && avail === 'local' && <Button variant="danger" size="sm" onClick={() => setConfirm('purge')}><Trash2 className="h-4 w-4" />Delete permanently</Button>}
              </>
            )}
          </div>
          {media.deleted_at && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This item is in Recently deleted. It is hidden everywhere else and can be restored.</p>}
          {verify && <p className={cx('mt-2 text-sm', verify.includes('FAILED') ? 'text-red-600' : 'text-emerald-700')}>{verify}</p>}
        </div>
        <div className="space-y-2 text-sm">
          {[
            ['Media UUID', <code key="u" className="text-[11px] break-all">{media.id}</code>],
            ['Stage', `${media.stage_code} · ${catalog?.stages.find((s) => s.code === media.stage_code)?.title ?? ''}`],
            ['Subcategory', media.subcategory_code ?? '—'], ['Region', media.region ?? '—'],
            ['Recorded', media.recorded_at ? new Date(media.recorded_at).toLocaleString() : '—'], ['By', recorder?.full_name ?? '—'],
            ['Duration', formatDuration(media.duration_ms)], ['Resolution', media.width ? `${media.width}×${media.height}${media.frame_rate ? ` @ ${Math.round(media.frame_rate)}fps` : ''}` : '—'],
            ['Format', `${media.mime_type ?? '—'}`], ['Size', formatBytes(media.size_bytes)],
            ['SHA-256', <code key="h" className="text-[11px] break-all">{media.checksum_sha256 ?? '—'}</code>],
            ['Source', media.recording_source], ['Device', media.device_model ?? '—'], ['Integrity', media.integrity_status],
            ['Notes', media.notes ?? '—'],
          ].map(([k, v]) => (
            <div key={String(k)} className="grid grid-cols-[110px_1fr] gap-2 border-b border-navy-50 pb-1.5"><span className="text-navy-400">{k}</span><span className="text-navy-800">{v}</span></div>
          ))}
          {amendments.length > 0 && (
            <div className="pt-2">
              <h4 className="mb-1 font-semibold text-navy-800">Amendment history</h4>
              {amendments.map((a) => (
                <div key={a.id} className="text-xs text-navy-500">{new Date(a.created_at).toLocaleString()} · <b>{a.field}</b>: {JSON.stringify(a.old_value)} → {JSON.stringify(a.new_value)}{a.reason ? ` (${a.reason})` : ''}</div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm === 'purge' ? 'Delete permanently?' : `Delete this ${media.media_type === 'photo' ? 'photo' : media.media_type}?`}
        footer={<><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" size="lg" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            if (confirm === 'purge') { await purgeMediaFiles(media, profile!.id); toast.ok('Original file erased from this iPad'); }
            else { await deleteMedia(media); toast.ok('Moved to Recently deleted'); }
            setConfirm(null); onClose();
          } catch (e: any) { toast.err(e.message); } finally { setBusy(false); }
        }}><Trash2 className="h-5 w-5" />{confirm === 'purge' ? 'Erase file' : 'Delete'}</Button></>}>
        <p className="text-[15px] text-navy-700">{confirm === 'purge'
          ? 'The original file will be erased from this iPad and cannot be recovered unless you have a backup. The record stays in the audit trail.'
          : 'It moves to Recently deleted in the Media library. You can restore it any time.'}</p>
      </Modal>
      <Modal open={edit} onClose={() => setEdit(false)} title="Amend media metadata"
        footer={<><Button variant="ghost" onClick={() => setEdit(false)}>Cancel</Button><Button disabled={!reason.trim()} onClick={async () => {
          await amendMedia(media, draft, reason.trim()); toast.ok('Amendment recorded (original identifiers unchanged)'); setEdit(false); onClose();
        }}>Save amendment</Button></>}>
        <div className="space-y-4">
          <p className="text-sm text-navy-500">Permanent media UUID, checksum and original recording snapshot are never changed. Each change is recorded as an auditable amendment.</p>
          <Field label="Stage"><Select options={(catalog?.stages ?? []).map((s) => ({ v: s.code, l: `${s.code} · ${s.title}` }))} value={draft.stage_code} onChange={(v) => setDraft({ ...draft, stage_code: v || null, subcategory_code: null })} /></Field>
          <Field label="Subcategory"><Select options={(stage?.subcategories ?? []).map((s) => ({ v: s.code, l: s.label }))} value={draft.subcategory_code} onChange={(v) => setDraft({ ...draft, subcategory_code: v || null })} /></Field>
          <Field label="Anatomical region"><Select options={[...(catalog?.donorRegions ?? []).map((r) => ({ v: r, l: `Donor · ${r}` })), ...(catalog?.recipientRegions ?? []).map((r) => ({ v: r, l: `Recipient · ${r}` }))]} value={draft.region} onChange={(v) => setDraft({ ...draft, region: v || null })} /></Field>
          <Field label="Notes"><Textarea value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} /></Field>
          <Field label="Reason for amendment (required)"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. recorded under wrong subcategory" /></Field>
        </div>
      </Modal>
    </Modal>
  );
}

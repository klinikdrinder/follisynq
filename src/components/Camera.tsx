'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, SwitchCamera, Mic, MicOff, Circle, Square, Camera as CamIcon, ZoomIn, HardDrive, RotateCcw, Upload, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button, cx, toast } from './ui';
import { opfs } from '@/lib/storage/opfs';
import { prepareMedia, registerMedia, CaptureContext, MediaType, checkStorage, journalStart, journalEnd, StorageCheck, PreparedMedia, importExternal } from '@/lib/media';
import { formatBytes, formatDuration } from '@/lib/naming';
import { save } from '@/lib/repo';

type Quality = 'max' | '2160' | '1080' | '720';
const QUALITY_DIMS: Record<Exclude<Quality, 'max'>, [number, number]> = { '2160': [3840, 2160], '1080': [1920, 1080], '720': [1280, 720] };

export function prefs() {
  try { return JSON.parse(localStorage.getItem('fs_rec_prefs') || '{}'); } catch { return {}; }
}
export function setPrefs(p: Record<string, any>) {
  try { localStorage.setItem('fs_rec_prefs', JSON.stringify({ ...prefs(), ...p })); } catch {}
}

function pickMime(type: MediaType): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const cands = type === 'audio'
    ? ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    : ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const c of cands) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch {} }
  return '';
}

export function CameraModal({ mode: initialMode, ctx, header, onClose, thresholds }: {
  mode: MediaType; ctx: CaptureContext; header: React.ReactNode; onClose: () => void; thresholds: { warn: number; critical: number };
}) {
  const [mode, setMode] = useState<MediaType>(initialMode);
  const p = prefs();
  const [facing, setFacing] = useState<'environment' | 'user'>(p.facing ?? 'environment');
  const [mic, setMic] = useState<boolean>(p.mic ?? true);
  const [quality, setQuality] = useState<Quality>(p.quality ?? 'max');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [saving, setSaving] = useState(false);
  const [storage, setStorage] = useState<StorageCheck | null>(null);
  const [zoom, setZoom] = useState<{ min: number; max: number; step: number; value: number } | null>(null);
  const [actual, setActual] = useState<{ w?: number; h?: number; fps?: number } | null>(null);
  const [maxW, setMaxW] = useState<number | null>(null);
  const [last, setLast] = useState<{ media: any; url: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const prepRef = useRef<PreparedMedia | null>(null);
  const chainRef = useRef<Promise<any>>(Promise.resolve());
  const startRef = useRef<number>(0);
  const writeErr = useRef<string | null>(null);
  const nativeRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const recorderSupported = typeof MediaRecorder !== 'undefined';

  const stopStream = useCallback((s: MediaStream | null) => { s?.getTracks().forEach((t) => t.stop()); }, []);

  const startStream = useCallback(async () => {
    setError(null);
    if (!supported) { setError('In-app camera is not available in this browser. Use native capture below.'); return; }
    try {
      const dims = quality !== 'max' ? QUALITY_DIMS[quality] : [4096, 2160];
      const constraints: MediaStreamConstraints = mode === 'audio'
        ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }, video: false }
        : { video: { facingMode: { ideal: facing }, width: { ideal: dims[0] }, height: { ideal: dims[1] }, frameRate: { ideal: 30 } }, audio: mode === 'video' && mic };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      setStream((old) => { stopStream(old); return s; });
      const vt = s.getVideoTracks()[0];
      if (vt) {
        const st = vt.getSettings();
        setActual({ w: st.width, h: st.height, fps: st.frameRate });
        const caps: any = vt.getCapabilities?.() ?? {};
        setMaxW(caps.width?.max ?? null);
        if (caps.zoom) setZoom({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: (st as any).zoom ?? caps.zoom.min });
        else setZoom(null);
      } else setActual(null);
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') setError('Camera/microphone permission was denied. Allow access in Settings › Safari › Camera & Microphone, or use native capture.');
      else if (e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError') setError('Requested camera is not available on this device.');
      else setError(e?.message || 'Could not start camera');
    }
  }, [facing, mic, mode, quality, supported, stopStream]);

  useEffect(() => { checkStorage(thresholds).then(setStorage); }, [thresholds]);
  useEffect(() => { if (!recording) startStream(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [facing, mode, quality, mic]);
  useEffect(() => () => { setStream((s) => { stopStream(s); return null; }); }, [stopStream]);
  useEffect(() => { if (videoRef.current && stream) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}); } }, [stream]);
  useEffect(() => {
    if (!recording) return;
    document.body.dataset.recording = '1';
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 250);
    const s = setInterval(async () => {
      const c = await checkStorage(thresholds);
      setStorage(c);
      if (!c.ok) { toast.err('Storage critically low — recording stopped and saved.'); stopRecording(); }
    }, 10_000);
    const vis = () => { if (document.visibilityState === 'hidden') stopRecording(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); clearInterval(s); document.removeEventListener('visibilitychange', vis); delete document.body.dataset.recording; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const snapshotCtx = () => ({
    patientId: ctx.patient.id, sessionId: ctx.session.id,
    capture: { stage: ctx.stage, subcategory: ctx.subcategory, region: ctx.region, graftBatchId: ctx.graftBatchId, encounterId: ctx.encounterId,
      paramVersion: ctx.paramVersion, values: ctx.values, recordingContext: ctx.recordingContext, patientSummary: ctx.patientSummary, operator: ctx.operator },
  });

  async function startRecording() {
    if (!stream) return;
    const st = await checkStorage(thresholds);
    setStorage(st);
    if (!st.ok) { toast.err(st.message!); return; }
    const mime = pickMime(mode);
    if (mime === null) { setError('Recording is not supported in this browser — use native capture.'); return; }
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: mode === 'video' ? 16_000_000 : undefined } : undefined); }
    catch { rec = new MediaRecorder(stream); }
    const actualMime = rec.mimeType || mime || (mode === 'audio' ? 'audio/mp4' : 'video/mp4');
    const prep = await prepareMedia(ctx, actualMime);
    try { await opfs.beginWrite(prep.path); } catch (e: any) { toast.err('Cannot write to local storage: ' + e.message); return; }
    prepRef.current = prep;
    writeErr.current = null;
    chainRef.current = Promise.resolve();
    let n = 0;
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      const blob = e.data;
      chainRef.current = chainRef.current.then(async () => {
        if (writeErr.current) return;
        try { const size = await opfs.appendChunk(prep.path, await blob.arrayBuffer(), ++n % 5 === 0); setBytes(size); }
        catch (err: any) { writeErr.current = err.message; toast.err('Local write failed: ' + err.message); try { rec.stop(); } catch {} }
      });
    };
    rec.onerror = (e: any) => { writeErr.current = e?.error?.message || 'Recorder error'; };
    const vt = stream.getVideoTracks()[0]?.getSettings();
    await journalStart({ media_id: prep.id, path: prep.path, type: mode, ctx: snapshotCtx(), prep,
      tech: { width: vt?.width ?? null, height: vt?.height ?? null, frameRate: vt?.frameRate ?? null, hasAudio: stream.getAudioTracks().length > 0, facing: mode === 'audio' ? null : facing } });
    recRef.current = rec;
    startRef.current = Date.now();
    setElapsed(0); setBytes(0);
    rec.start(1000); // 1-second chunks written incrementally to disk
    setRecording(true);
  }

  async function stopRecording() {
    const rec = recRef.current;
    const prep = prepRef.current;
    if (!rec || !prep) return;
    recRef.current = null;
    setRecording(false);
    setSaving(true);
    const stopped = new Promise<void>((res) => { rec.onstop = () => res(); });
    try { if (rec.state !== 'inactive') rec.stop(); } catch {}
    await Promise.race([stopped, new Promise((r) => setTimeout(r, 4000))]);
    await chainRef.current;
    const endedAt = new Date().toISOString();
    try {
      const fin = await opfs.finishWrite(prep.path);
      if (writeErr.current && !fin.size) throw new Error(writeErr.current);
      const vt = stream?.getVideoTracks()[0]?.getSettings();
      const media = await registerMedia(ctx, prep, mode, { size: fin.size, sha256: fin.sha256 }, {
        width: vt?.width ?? null, height: vt?.height ?? null, frameRate: vt?.frameRate ?? null, durationMs: Date.now() - startRef.current,
        hasAudio: (stream?.getAudioTracks().length ?? 0) > 0 && mic, facing: mode === 'audio' ? null : facing, orientation: orientation(),
        source: 'in_app', endedAt,
      });
      if (writeErr.current) await save('media_assets', { ...media, integrity_status: 'partial_recovered', notes: `Recording interrupted: ${writeErr.current}` });
      await journalEnd(prep.id);
      const f = await opfs.retrieve(prep.path);
      setLast((old) => { if (old) URL.revokeObjectURL(old.url); return { media, url: f ? URL.createObjectURL(f) : '' }; });
      toast.ok(`Saved & verified on this iPad · ${formatBytes(fin.size)}`);
    } catch (e: any) {
      toast.err(`Recording NOT saved: ${e.message}`);
    } finally {
      setSaving(false);
      prepRef.current = null;
    }
  }

  async function takePhoto() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const st = await checkStorage(thresholds);
    if (!st.ok) { toast.err(st.message!); return; }
    setSaving(true);
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d')!.drawImage(v, 0, 0);
      const blob: Blob | null = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
      if (!blob) throw new Error('Could not capture frame');
      const prep = await prepareMedia(ctx, 'image/jpeg');
      const w = await opfs.save(prep.path, blob);
      const media = await registerMedia(ctx, prep, 'photo', w, { width: c.width, height: c.height, hasAudio: false, facing, orientation: orientation(), source: 'in_app' });
      setLast((old) => { if (old) URL.revokeObjectURL(old.url); return { media, url: URL.createObjectURL(blob) }; });
      toast.ok(`Photo saved & verified · ${c.width}×${c.height}`);
    } catch (e: any) { toast.err('Photo NOT saved: ' + e.message); }
    finally { setSaving(false); }
  }

  async function saveExternalFile(file: File, source: 'native_capture' | 'import') {
    const type: MediaType = file.type.startsWith('image/') ? 'photo' : file.type.startsWith('audio/') ? 'audio' : 'video';
    const st = await checkStorage(thresholds);
    if (!st.ok) { toast.err(st.message!); return; }
    setSaving(true);
    try {
      void type;
      const media = await importExternal(ctx, file, source);
      setLast((old) => { if (old) URL.revokeObjectURL(old.url); return { media, url: URL.createObjectURL(file) }; });
      toast.ok(`${source === 'import' ? 'Imported' : 'Saved'} & verified · ${formatBytes(media.size_bytes)}`);
    } catch (e: any) { toast.err('File NOT saved: ' + e.message); }
    finally { setSaving(false); }
  }

  async function retake() {
    if (!last) return;
    // never deletes the original — marks it superseded (kept on device and in metadata)
    await save('media_assets', { ...last.media, deleted_at: new Date().toISOString(), notes: [last.media.notes, 'Superseded by retake'].filter(Boolean).join(' · ') });
    URL.revokeObjectURL(last.url);
    setLast(null);
    toast.info('Previous capture marked as superseded (original file kept). Ready to retake.');
    if (mode === 'photo') takePhoto(); else startRecording();
  }

  function applyZoom(z: number) {
    const vt = stream?.getVideoTracks()[0];
    if (!vt || !zoom) return;
    vt.applyConstraints({ advanced: [{ zoom: z } as any] }).then(() => setZoom({ ...zoom, value: z })).catch(() => {});
  }

  const close = async () => { if (recording) await stopRecording(); onClose(); };
  const qualityOptions: Quality[] = ['max', ...(maxW == null || maxW >= 3840 ? ['2160' as Quality] : []), '1080', '720'];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* top bar */}
      <div className="flex items-start justify-between gap-3 bg-black/70 px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <div className="min-w-0 text-sm leading-tight">{header}</div>
        <button onClick={close} className="rounded-full bg-white/10 p-3" aria-label="Close camera"><X className="h-6 w-6" /></button>
      </div>
      {/* preview */}
      <div className="relative flex-1 overflow-hidden">
        {mode !== 'audio' ? (
          <video ref={videoRef} playsInline muted autoPlay className={cx('h-full w-full object-contain', facing === 'user' && '-scale-x-100')} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className={cx('flex h-40 w-40 items-center justify-center rounded-full border-4', recording ? 'border-red-500' : 'border-white/30')}>
              <Mic className="h-16 w-16" />
            </div>
            <p className="text-white/70">{recording ? 'Recording audio…' : 'Audio recording'}</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-4 rounded-2xl bg-red-600/90 p-4 text-sm"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>
        )}
        {recording && (
          <div className="absolute left-1/2 top-4 -translate-x-1/2 flex items-center gap-2 rounded-full bg-red-600 px-4 py-2 font-semibold tabular-nums shadow-lg">
            <span className="rec-dot h-3 w-3 rounded-full bg-white" /> REC {formatDuration(elapsed)} · {bytes ? `${formatBytes(bytes)} on disk` : 'writing…'}
          </div>
        )}
        {saving && <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-medium">Saving and verifying…</div>}
        <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 text-xs">
          {actual?.w && <span className="rounded-full bg-black/60 px-3 py-1">{actual.w}×{actual.h}{actual.fps ? ` @ ${Math.round(actual.fps)}fps` : ''} (actual)</span>}
          <span className={cx('rounded-full px-3 py-1', mic && mode !== 'photo' ? 'bg-black/60' : 'bg-amber-500/80 text-black')}>{mode === 'photo' ? 'Photo' : mic ? 'Mic on' : 'Mic off'}</span>
          {storage && <span className={cx('flex items-center gap-1 rounded-full px-3 py-1', storage.level === 'critical' ? 'bg-red-600' : storage.level === 'low' ? 'bg-amber-500 text-black' : 'bg-black/60')}>
            <HardDrive className="h-3 w-3" />{storage.available != null ? `${formatBytes(storage.available)} free (est.)` : 'Storage unknown'}</span>}
        </div>
        {zoom && !recording && mode !== 'audio' && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2 rounded-full bg-black/50 px-2 py-4">
            <ZoomIn className="h-4 w-4" />
            <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onChange={(e) => applyZoom(Number(e.target.value))}
              className="h-40 [writing-mode:vertical-lr] [direction:rtl]" aria-label="Zoom" />
            <span className="text-xs">{zoom.value.toFixed(1)}×</span>
          </div>
        )}
      </div>
      {/* controls */}
      <div className="bg-black/80 px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
        <div className="mb-3 flex items-center justify-center gap-2">
          {(['video', 'photo', 'audio'] as MediaType[]).map((m) => (
            <button key={m} disabled={recording} onClick={() => setMode(m)}
              className={cx('rounded-full px-4 py-1.5 text-sm font-medium capitalize', mode === m ? 'bg-white text-black' : 'text-white/70')}>{m}</button>
          ))}
        </div>
        <div className="grid grid-cols-3 items-center">
          <div className="flex items-center gap-2">
            {last && !recording && (
              <div className="flex items-center gap-2">
                {last.media.media_type === 'photo' ? <img src={last.url} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  : last.media.media_type === 'video' ? <video src={last.url} className="h-14 w-14 rounded-lg object-cover" muted playsInline />
                  : <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/10"><Mic className="h-6 w-6" /></div>}
                <div className="text-xs"><CheckCircle2 className="mb-0.5 inline h-4 w-4 text-emerald-400" /> Saved<br />
                  <button onClick={retake} className="mt-1 inline-flex items-center gap-1 text-white/80 underline"><RotateCcw className="h-3 w-3" />Retake</button></div>
              </div>
            )}
          </div>
          <div className="flex justify-center">
            {mode === 'photo' ? (
              <button onClick={takePhoto} disabled={!stream || saving} aria-label="Take photograph" className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-white/20 active:scale-95 disabled:opacity-40">
                <CamIcon className="h-8 w-8" />
              </button>
            ) : recording ? (
              <button onClick={stopRecording} aria-label="Stop recording" className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-red-600 active:scale-95">
                <Square className="h-8 w-8 fill-white" />
              </button>
            ) : (
              <button onClick={startRecording} disabled={!stream || saving || !recorderSupported} aria-label="Start recording" className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white active:scale-95 disabled:opacity-40">
                <Circle className="h-14 w-14 fill-red-600 text-red-600" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-end gap-2">
            {mode !== 'photo' && (
              <button disabled={recording} onClick={() => { setMic(!mic); setPrefs({ mic: !mic }); }} className="rounded-full bg-white/10 p-3 disabled:opacity-40" aria-label="Toggle microphone">
                {mic ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
              </button>
            )}
            {mode !== 'audio' && (
              <button disabled={recording} onClick={() => { const f = facing === 'environment' ? 'user' : 'environment'; setFacing(f); setPrefs({ facing: f }); }} className="rounded-full bg-white/10 p-3 disabled:opacity-40" aria-label="Switch camera">
                <SwitchCamera className="h-6 w-6" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-white/70">
          {mode !== 'audio' && (
            <select disabled={recording} value={quality} onChange={(e) => { setQuality(e.target.value as Quality); setPrefs({ quality: e.target.value }); }}
              className="rounded-full bg-white/10 px-3 py-1.5 text-white">
              {qualityOptions.map((q) => <option key={q} value={q} className="text-black">{q === 'max' ? 'Highest supported' : q === '2160' ? 'Request 2160p (if supported)' : `${q}p`}</option>)}
            </select>
          )}
          <button disabled={recording} onClick={() => nativeRef.current?.click()} className="rounded-full bg-white/10 px-3 py-1.5">Native camera</button>
          <button disabled={recording} onClick={() => importRef.current?.click()} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5"><Upload className="h-3 w-3" />Import</button>
        </div>
        <input ref={nativeRef} type="file" hidden accept={mode === 'photo' ? 'image/*' : mode === 'audio' ? 'audio/*' : 'video/*'} capture="environment"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) saveExternalFile(f, 'native_capture'); e.target.value = ''; }} />
        <input ref={importRef} type="file" hidden multiple accept="image/*,video/*,audio/*"
          onChange={async (e) => { const fs = Array.from(e.target.files ?? []); for (const f of fs) await saveExternalFile(f, 'import'); e.target.value = ''; }} />
      </div>
    </div>
  );
}

function orientation() {
  try { return (screen.orientation?.type ?? (innerWidth > innerHeight ? 'landscape' : 'portrait')).replace('-primary', '').replace('-secondary', ''); } catch { return null; }
}

export function ImportButton({ onFiles, children }: { onFiles: (f: File[]) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLInputElement>(null);
  return (<><Button variant="secondary" size="lg" onClick={() => ref.current?.click()}>{children}</Button>
    <input ref={ref} type="file" hidden multiple accept="image/*,video/*,audio/*" onChange={(e) => { onFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} /></>);
}

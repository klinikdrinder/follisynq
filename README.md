# Follisync

Follisync is a clinical media collection app for hair transplantation at **Klinik Dr Inder**. It is for internal use by doctors, nurses and authorised clinical staff, on iPads during procedures.

> Capture first, document when you can. Every recording is saved to the iPad and verified there, together with an immutable snapshot of its clinical context.

This MVP does **not** include AI analysis, annotation, cloud media storage or Google Drive. The architecture is ready for each of these to be added later.

---

## 1. Architecture

| Layer | Responsibility |
|---|---|
| **Vercel** | Hosts the static PWA only (Next.js static export). Clinical media and patient data never pass through Vercel servers. |
| **Supabase Postgres + Auth + RLS** | Staff accounts, patients, sessions, versioned parameters, media identifiers and metadata, device records, audit log and sync log. No media binaries. |
| **Supabase Edge Function `admin-staff`** | Lets administrators create staff and reset passwords. The service-role key lives only here. |
| **IndexedDB** | Offline metadata cache plus an idempotent sync outbox. |
| **OPFS (Origin Private File System)** | The original videos, photos and audio, with JSON sidecars, `media_manifest.json` and `case_metadata.json`. |
| **Storage-provider interface** | `src/lib/storage/provider.ts`. `local_opfs` is implemented; `google_drive` and `s3` are reserved. |

### Key engineering decisions
- **Static export plus a service worker.** All routes use query parameters (`/stage/?s=…&st=S06`), so the whole app shell can be precached and works fully offline.
- **Local-first writes.** Every change lands in IndexedDB first and is queued. `fs_sync_push(ops)` is a security-invoker RPC, so RLS applies. Each operation carries an `op_id`, which makes retries idempotent, and a `base_version` for optimistic concurrency. A stale edit becomes a *conflict* that a clinician resolves. Nothing is overwritten silently.
- **Incremental, verified recording.** MediaRecorder emits 1-second chunks. A worker appends them to OPFS with `createSyncAccessHandle()` and updates a streaming SHA-256 as it goes. On Stop the file is closed and re-hashed from disk, and size and checksum are compared. Only then are the sidecar and metadata written and *"Saved & verified on this iPad"* shown.
- **Interrupted recordings** are written to a journal in IndexedDB. On the next launch, the partial file is registered as `partial_recovered`, or a clear failure is reported. It is never presented as complete.
- **Immutable context.** Each parameter change creates a new `procedure_parameter_versions` row; database triggers block updates and deletes on it. Every recording stores `parameter_version_id` and a full `media_metadata_snapshots` row, which is also insert-only. Corrections go into `media_metadata_amendments`, one auditable row per field.
- **Deterministic stage-instance IDs**, a hash of session, stage and encounter. Two iPads working offline converge on the same record.
- **Offline patient codes** get a two-character device suffix (e.g. `P000126A7`) to avoid collisions across iPads. Codes created online are plain `P000126`.
- **No fabricated values.** Blank means `null`. Numeric fields have an optional measurement source: measured / instrument-reported / estimated / observed / not measured / not recorded / not applicable.
- **Identity separation.** Filenames, sidecars, manifests and media snapshots contain the patient *code*, never the name, DOB or ethnicity.
- **Audit log** records the actor, table, record and *changed field names*, never the values, so PHI never appears in logs.

## 2. Repository layout
```
src/app/            pages: dashboard, patients, patient, session, stage, media, storage, settings
src/components/     UI kit, Camera, ParamForm, MediaGallery, AppProvider (auth/lock/sync), Shell
src/lib/catalog.ts  12 stages, subcategories, all clinical parameters (single source of truth)
src/lib/            naming, db (IndexedDB), repo (local-first), sync, auth (offline grant),
                    clinical, media (save pipeline), export (zip/encrypt/restore), demo
src/lib/storage/    provider interface, OPFS provider, OPFS worker
supabase/migrations 0001 schema · 0002 RLS, audit, immutability, sync RPC · 0003 seed
supabase/functions  admin-staff edge function
scripts/            gen-seed.ts (catalog → SQL), gen-sw.mjs (service worker), icons.cjs
tests/unit          vitest: naming, ZIP round-trip, local-first clinical workflow
tests/e2e           Playwright: full recording workflow with a fake camera
```

## 3. Supabase setup (already done for project `follisync`, ref `wyxclgtiwrqyecfwgobf`, Singapore)
1. Apply `supabase/migrations/0001…`, `0002…` and `0003…` in order. On a fresh project, regenerate 0003 first with `npm run gen:seed`.
   *Live project note:* the organisation, branches and roles were seeded by migration. The clinical catalogue (stages, subcategories, parameters, regions) installs itself automatically on the administrator's first sign-in. It can be re-run from **Settings › Clinical catalogue**, and existing entries are kept.
2. Deploy the edge function: `supabase functions deploy admin-staff` (JWT verification on).
3. **Dashboard steps the owner must do:**
   - Authentication › Sign In / Providers › Email: **turn OFF "Allow new users to sign up"**. Without a staff profile, RLS already denies all data access, but public sign-up should still be off.
   - Authentication › Passwords: enable **leaked password protection** and set a minimum length of 10 or more.
   - Change the bootstrap administrator's password after the first login (see §6).

## 4. Environment variables
Copy `.env.example` to `.env.local`.
```
NEXT_PUBLIC_SUPABASE_URL=https://wyxclgtiwrqyecfwgobf.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```
Only the publishable key goes into the frontend; RLS protects every table. **Never** put the service-role key in Vercel or in this app.

## 5. Vercel deployment
- Framework: Next.js. Build: `npm run build`. Output: `out`. These settings are in `vercel.json`.
- Set the two `NEXT_PUBLIC_*` variables for Production and Preview. The code also falls back to the public project values.
- `vercel.json` sets the security headers: HSTS, CSP (Supabase only), `X-Frame-Options: DENY`, and a camera/microphone permissions policy.
- There are no analytics, session replay or error-reporting SDKs, so no patient data can leak through them.

## 6. Administrator onboarding
1. Sign in with the bootstrap admin account (handed over privately). **Change its password**: Settings › Staff › Reset password, or the Supabase dashboard.
2. Settings › Staff › **Add staff**: name, role (Doctor / Clinical assistant-nurse / Administrator), login email, temporary password, branch access, and whether a nurse may create patients.
3. Settings › Branches: PJ and Subang are pre-configured.
4. Settings › Policies: inactivity lock, offline authorisation hours, storage thresholds, backup reminder, consent version, retention.
5. Settings › Clinical catalogue: add stages, subcategories, parameters or regions with no code change. Deactivating never deletes, so history stays readable.
6. Settings › Instrument presets: create shared punch, motor, blade and implanter presets.
7. Settings › Devices: label each iPad (e.g. "OT-1 iPad").

## 7. iPad installation
1. Open the Vercel URL in **Safari** on a clinic-managed, passcode-protected iPad.
2. Share › **Add to Home Screen** › open Follisync from the Home Screen icon.
3. Sign in once while online. This registers the device and downloads metadata and the catalogue.
4. Allow camera and microphone when asked. If access was denied: Settings › Safari › Camera / Microphone › Allow.
5. Device Storage › **Request persistent storage**.
6. Run the acceptance tests below on **each** iPad before recording real patients.

## 8. Daily operation and backup
- Recording works offline. Metadata syncs automatically when the iPad is back online (every 30 s, and immediately on reconnect).
- **Back up every day**: Device Storage › Bulk export. This produces encrypted `.fsenc` files (AES-256-GCM, PBKDF2-SHA-256 with 310k iterations), in batches of up to 3.5 GB. Save them to the clinic's approved storage via the Files app, then use **Verify / restore backup** on them so each recording is marked *backup verified*.
- Originals are never deleted automatically. Only an administrator can remove local originals, and only those with a *verified* backup.

## 9. Testing
```
npm test                 # unit tests (naming, ZIP, local-first versioning/queue)
npm run build && node tests/e2e/flow.cjs   # end-to-end: login → minimal patient + consent →
                                           # FUE → record → stop → verified save → 2nd recording →
                                           # photo → jump to implantation → back to consultation →
                                           # add data later → complete → reopen → idempotent sync
```
These were checked against the live database with impersonated roles: idempotent duplicate ops, conflict detection on stale edits, version increments, rejection of non-syncable tables, field-name-only audit entries, and anonymous users seeing zero patients.

### Real-iPad acceptance checklist (required before clinical use)
- [ ] Rear and front camera; mic on and off; photo; short (≤1 min) and long (≥30 min) video; 5 consecutive recordings
- [ ] Note the actual codec and extension Safari produces (expected `video/mp4` → `.mp4`) and confirm playback after an app restart
- [ ] Permission denial handled; native-capture fallback; import of existing media
- [ ] Kill the app mid-recording and confirm the recovery message on relaunch
- [ ] Fill storage to the critical threshold and confirm recording is blocked or auto-stopped and saved
- [ ] Flight mode: create a patient, record, enter metadata; reconnect and confirm sync with no duplicates
- [ ] Offline authorisation expiry (set to 1 h in Policies, wait) blocks access
- [ ] Two iPads edit the same stage and confirm the conflict appears and resolves
- [ ] Encrypted export → save to Files → verify → restore onto a second iPad and confirm playback
- [ ] Nurse without branch access cannot see that branch's patients; nurse without create permission cannot create cases

## 10. Known limitations and production-readiness
- **OPFS is not an archive.** Safari may evict data if website data is cleared, the PWA is deleted, or under storage pressure. Persistence is requested but not guaranteed. Daily verified backups are mandatory until Google Drive migration exists.
- OPFS files are **not visible in the Files app**. Use Export.
- Media recorded on one iPad cannot play on another until migration, or until a backup is restored there. The UI shows *"On another iPad"* instead of broken playback controls.
- Safari's MediaRecorder decides the codec and bitrate; 4K is only offered when the camera reports it. Zoom controls appear only where Safari exposes `zoom` capabilities. Device model is reported only as "iPad" because Safari hides exact models.
- Frame rate is the camera track's *reported* setting, not a measured file property.
- Thumbnails are local only and generated on a best-effort basis.
- Local OPFS data is protected by iPadOS device encryption and the passcode, not by app-level encryption. **Evaluate app-level encryption and key management before production.**
- The bootstrap admin email `admin@follisync.app` is a login identifier only. Replace it with a real clinic address.
- Technical controls support **PDPA 2010 compliance preparation**. They do not by themselves make the system compliant; the clinic needs a DPIA, consent forms, a retention policy and a data-processing agreement covering Supabase (Singapore region) and Vercel.

## 11. Google Drive migration (planned, ~10 days)
Implement `MigrationTarget` (`src/lib/storage/provider.ts`) for Google Drive. Then, for each `media_storage_locations` row with `migration_status='pending'`:
1. Upload by media UUID into the same folder path, using a resumable upload.
2. Verify size and SHA-256.
3. Insert a new `media_storage_locations` row (`provider='google_drive'`, `cloud_file_id`, `cloud_path`).
4. Mark the local row `migrated`.
5. Allow administrator-approved local deletion.

`migration_jobs` tracks progress per device. No clinical tables change.

# Follisync database schema (Supabase Postgres)

All primary keys are UUIDs. Clinical rows are created on the iPad, which makes offline creation safe. Every table has `org_id` and RLS enabled. There are no DELETE policies: removal is a soft delete through `deleted_at`. Media binaries are never stored in the database.

| Group | Tables |
|---|---|
| Organisation | `organizations` (settings JSON: lock, offline hours, thresholds, consent version), `clinic_branches`, `staff_roles`, `staff_profiles` (role, branch scope, operator profile) |
| Catalogue (admin-extensible) | `procedure_stages`, `procedure_subcategories`, `parameter_definitions` (scope: stage / patient_* / recording_context; `searchable`, `provenance`), `anatomical_regions`, `instrument_catalog`, `instrument_presets` |
| Patient (identity separated) | `patients` (code, MRN, name, branch), `patient_demographics` (self-reported ethnicity), `patient_clinical_history` (typed classification + JSONB), `patient_hair_characteristics` (typed texture/caliber + JSONB), `patient_scalp_characteristics`, `patient_consents` (one row per consent type, withdrawal fields) |
| Procedure | `surgical_sessions`, `clinical_encounters` (follow-ups), `procedure_instances` (session × stage × encounter, informational status), `procedure_parameter_versions` (**insert-only**), `parameter_values` (typed projection of searchable values, filled by trigger), `donor_assessments` (per region), `graft_batches`, `graft_batch_assessments`, `clinical_events`, `follow_up_assessments` |
| Media | `media_assets` (identity fields guarded by trigger), `media_metadata_snapshots` (**insert-only**), `media_storage_locations` (provider-agnostic: local_opfs / google_drive / s3), `media_metadata_amendments` (**insert-only**) |
| Operations | `registered_devices`, `audit_logs` (trigger-written; field names only), `export_records`, `migration_jobs`, `sync_ops` (idempotency log) |

Parameter values are stored as `{ key: { v, unit, src, method, by, at } }`. Here `src` is one of measured · instrument · estimated · observed · not_measured · not_recorded · na.

Key functions:
- `private.current_org_id()`, `private.is_admin()`, `private.can_access_branch()`, `private.can_access_patient()`: security-definer helpers used by RLS.
- `public.fs_sync_push(ops jsonb, p_device_id uuid)`: idempotent batched upsert with optimistic concurrency. It runs as the caller, so RLS applies.

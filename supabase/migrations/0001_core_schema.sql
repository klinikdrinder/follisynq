-- Follisync core schema
-- Clinical media binaries are NEVER stored in Postgres or Supabase Storage.
-- Only identifiers, metadata and storage-location records live here.

create extension if not exists pgcrypto;
create schema if not exists private;

-- ───────────────────────── organisation & staff ─────────────────────────
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_code text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinic_branches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  code text not null,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create table public.staff_roles (
  code text primary key,           -- admin | doctor | nurse
  label text not null,
  description text
);

create table public.staff_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_id uuid not null references public.organizations(id),
  role text not null references public.staff_roles(code),
  full_name text not null,
  staff_code text,
  professional_role text,
  email text,
  active boolean not null default true,
  can_create_patients boolean not null default true,
  all_branches boolean not null default true,
  branch_ids uuid[] not null default '{}',
  -- optional operator profile (all optional)
  operator_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── helper functions ─────────────────────────
create or replace function private.current_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select org_id from public.staff_profiles where id = auth.uid() and active
$$;

create or replace function private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select role from public.staff_profiles where id = auth.uid() and active
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'admin' from public.staff_profiles where id = auth.uid() and active), false)
$$;

create or replace function private.is_clinical() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('admin','doctor','nurse') from public.staff_profiles where id = auth.uid() and active), false)
$$;

create or replace function private.can_access_branch(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select sp.role = 'admin' or sp.all_branches or b is null or b = any(sp.branch_ids)
    from public.staff_profiles sp where sp.id = auth.uid() and sp.active
  ), false)
$$;

-- generic updated_at + optimistic version trigger
create or replace function private.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    begin
      new.version := coalesce(old.version, 0) + 1;
    exception when undefined_column then null;
    end;
  end if;
  return new;
end $$;

-- ───────────────────────── reference / classification ─────────────────────────
create table public.procedure_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  code text not null,          -- S01..S12 (admins may add more)
  number int not null,
  slug text not null,
  title text not null,
  description text,
  folder_name text not null,
  priority text not null default 'standard',
  standard_views text[] not null default '{}',
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);

create table public.procedure_subcategories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  stage_id uuid not null references public.procedure_stages(id),
  code text not null,
  label text not null,
  folder_name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id, code)
);

create table public.anatomical_regions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  kind text not null check (kind in ('donor','recipient')),
  code text not null,
  label text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, kind, code)
);

create table public.parameter_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  scope text not null default 'stage',      -- stage | patient_clinical_history | patient_hair | patient_scalp | recording_context
  stage_id uuid references public.procedure_stages(id),
  key text not null,
  label text not null,
  data_type text not null,
  group_name text,
  unit text,
  options jsonb,
  provenance boolean not null default false,
  searchable boolean not null default false,
  help text,
  sort_order int not null default 0,
  definition_version int not null default 1,
  active boolean not null default true,      -- deactivate, never delete: history stays readable
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index parameter_definitions_uniq on public.parameter_definitions (org_id, scope, coalesce(stage_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table public.instrument_catalog (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  category text not null,     -- punch | motor | blade | needle | implanter | forceps | loupe | other
  manufacturer text,
  model text,
  specs jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.instrument_presets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  owner_id uuid references public.staff_profiles(id),
  stage_code text,              -- e.g. S06; null = any
  name text not null,
  values jsonb not null default '{}'::jsonb,   -- parameter key -> value
  shared boolean not null default true,
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── patients (identity separated) ─────────────────────────
create table public.patients (
  id uuid primary key,                      -- generated on device (offline-safe)
  org_id uuid not null references public.organizations(id),
  patient_code text not null,               -- human-readable, e.g. P000125 (no PII)
  mrn text,
  full_name text,
  branch_id uuid references public.clinic_branches(id),
  assigned_doctor_id uuid references public.staff_profiles(id),
  registration_date date not null default current_date,
  is_demo boolean not null default false,
  notes text,
  created_by uuid references public.staff_profiles(id),
  updated_by uuid references public.staff_profiles(id),
  version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, patient_code),
  check (full_name is not null or mrn is not null or patient_code is not null)
);

create table public.patient_demographics (
  patient_id uuid primary key references public.patients(id),
  org_id uuid not null references public.organizations(id),
  date_of_birth date,
  age_years int,
  sex text,
  ethnicity text,                 -- self-reported only; never inferred
  ethnicity_self_described text,
  nationality text,
  version int not null default 1,
  updated_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_clinical_history (
  patient_id uuid primary key references public.patients(id),
  org_id uuid not null references public.organizations(id),
  classification_system text,
  classification_grade text,
  data jsonb not null default '{}'::jsonb,   -- {key: {v, src, unit, method, by, at}}
  schema_version int not null default 1,
  version int not null default 1,
  updated_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_hair_characteristics (
  patient_id uuid primary key references public.patients(id),
  org_id uuid not null references public.organizations(id),
  hair_texture text,
  hair_caliber text,
  data jsonb not null default '{}'::jsonb,
  schema_version int not null default 1,
  version int not null default 1,
  updated_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_scalp_characteristics (
  patient_id uuid primary key references public.patients(id),
  org_id uuid not null references public.organizations(id),
  data jsonb not null default '{}'::jsonb,
  schema_version int not null default 1,
  version int not null default 1,
  updated_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_consents (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  patient_id uuid not null references public.patients(id),
  consent_type text not null check (consent_type in ('photography','video','audio','research_ai')),
  status text not null check (status in ('granted','declined','withdrawn','not_asked')),
  consent_date date,
  document_ref text,
  consent_version text,
  confirmed_by uuid references public.staff_profiles(id),
  withdrawn_at timestamptz,
  withdrawal_reason text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, consent_type)
);

-- ───────────────────────── sessions & encounters ─────────────────────────
create table public.surgical_sessions (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  patient_id uuid not null references public.patients(id),
  session_code text not null,              -- S01, S02 … per patient
  surgery_date date,
  branch_id uuid references public.clinic_branches(id),
  lead_surgeon_id uuid references public.staff_profiles(id),
  status text not null default 'in_progress' check (status in ('planned','in_progress','completed')),
  procedure_type text,
  technique text,                          -- FUE | FUT | Combined
  implantation_technique text,
  shave_type text,
  planned_graft_count int,
  planned_recipient_density numeric,
  donor_regions text[] not null default '{}',
  recipient_regions text[] not null default '{}',
  data jsonb not null default '{}'::jsonb, -- assisting doctors, nurses, positioning, times, notes …
  completed_at timestamptz,
  reopened_at timestamptz,
  created_by uuid references public.staff_profiles(id),
  updated_by uuid references public.staff_profiles(id),
  version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, session_code)
);

create table public.clinical_encounters (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  patient_id uuid not null references public.patients(id),
  session_id uuid references public.surgical_sessions(id),
  encounter_type text not null default 'follow_up',
  interval_label text,
  encounter_date date,
  notes text,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.procedure_instances (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  session_id uuid not null references public.surgical_sessions(id),
  encounter_id uuid references public.clinical_encounters(id),
  stage_code text not null,
  status text not null default 'not_started'
    check (status in ('not_started','media_recorded','in_progress','completed','skipped','not_applicable')),
  notes text,
  current_parameter_version_id uuid,
  updated_by uuid references public.staff_profiles(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index procedure_instances_uniq on public.procedure_instances
  (session_id, stage_code, coalesce(encounter_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- immutable parameter versions: insert-only
create table public.procedure_parameter_versions (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  instance_id uuid not null references public.procedure_instances(id),
  version_no int not null,
  values jsonb not null default '{}'::jsonb,
  preset_id uuid references public.instrument_presets(id),
  reason text,
  created_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  unique (instance_id, version_no)
);
alter table public.procedure_instances
  add constraint procedure_instances_param_fk foreign key (current_parameter_version_id)
  references public.procedure_parameter_versions(id) deferrable initially deferred;

-- typed projection of searchable values (populated by trigger)
create table public.parameter_values (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id),
  parameter_version_id uuid not null references public.procedure_parameter_versions(id) on delete cascade,
  stage_code text not null,
  key text not null,
  num_value numeric,
  text_value text,
  unit text,
  provenance text,
  created_at timestamptz not null default now()
);

create table public.donor_assessments (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  session_id uuid not null references public.surgical_sessions(id),
  region text not null,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.graft_batches (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  session_id uuid not null references public.surgical_sessions(id),
  batch_code text not null,                -- auto, e.g. GB-001
  donor_region text,
  extracted_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, batch_code)
);

create table public.graft_batch_assessments (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  batch_id uuid not null references public.graft_batches(id),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.clinical_events (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  session_id uuid not null references public.surgical_sessions(id),
  stage_code text,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.follow_up_assessments (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  encounter_id uuid not null references public.clinical_encounters(id),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── devices ─────────────────────────
create table public.registered_devices (
  id uuid primary key,                      -- device UUID generated on the iPad
  org_id uuid not null references public.organizations(id),
  label text,
  model text,
  user_agent text,
  registered_by uuid references public.staff_profiles(id),
  last_seen_at timestamptz,
  storage_summary jsonb not null default '{}'::jsonb,  -- quota/usage/media counts reported by device
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────────────────────── media (metadata only) ─────────────────────────
create table public.media_assets (
  id uuid primary key,                      -- permanent media UUID generated on device
  org_id uuid not null references public.organizations(id),
  patient_id uuid not null references public.patients(id),
  session_id uuid references public.surgical_sessions(id),
  encounter_id uuid references public.clinical_encounters(id),
  stage_code text,
  subcategory_code text,
  region text,
  graft_batch_id uuid references public.graft_batches(id),
  sequence_no int,
  media_type text not null check (media_type in ('video','photo','audio')),
  filename text not null,                    -- no PII in filenames
  mime_type text,
  container text,
  video_codec text,
  has_audio boolean,
  duration_ms bigint,
  width int,
  height int,
  frame_rate numeric,
  size_bytes bigint,
  checksum_sha256 text,
  device_id uuid references public.registered_devices(id),
  device_model text,
  camera_facing text,
  orientation text,
  recording_source text,                    -- in_app | native_capture | import | recovered
  recorded_by uuid references public.staff_profiles(id),
  recorded_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  parameter_version_id uuid references public.procedure_parameter_versions(id),
  recording_context jsonb not null default '{}'::jsonb,
  notes text,
  app_version text,
  metadata_schema_version int not null default 1,
  integrity_status text not null default 'verified',  -- verified | partial_recovered | failed | unknown
  version int not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- immutable context snapshot at time of recording: insert-only
create table public.media_metadata_snapshots (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  media_id uuid not null references public.media_assets(id),
  snapshot jsonb not null,
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  unique (media_id)
);

create table public.media_storage_locations (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  media_id uuid not null references public.media_assets(id),
  provider text not null default 'local_opfs',   -- local_opfs | google_drive | s3 | export
  device_id uuid references public.registered_devices(id),
  relative_path text,
  cloud_file_id text,
  cloud_path text,
  availability text not null default 'available',  -- available | missing | deleted_after_archive
  backup_status text not null default 'none',       -- none | exported | verified
  migration_status text not null default 'pending', -- pending | in_progress | migrated | failed | not_required
  integrity_status text not null default 'verified',
  checksum_sha256 text,
  size_bytes bigint,
  verified_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auditable amendments to media metadata: insert-only
create table public.media_metadata_amendments (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  media_id uuid not null references public.media_assets(id),
  field text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  amended_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now()
);

-- ───────────────────────── audit, export, migration ─────────────────────────
create table public.audit_logs (
  id bigint generated always as identity primary key,
  org_id uuid,
  actor_id uuid,
  table_name text not null,
  record_id text,
  action text not null,
  changed_fields text[],
  device_id uuid,
  created_at timestamptz not null default now()
);

create table public.export_records (
  id uuid primary key,
  org_id uuid not null references public.organizations(id),
  device_id uuid references public.registered_devices(id),
  exported_by uuid references public.staff_profiles(id),
  scope jsonb not null default '{}'::jsonb,
  encrypted boolean not null default false,
  media_count int,
  total_bytes bigint,
  manifest_checksum text,
  status text not null default 'completed',
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.migration_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  device_id uuid references public.registered_devices(id),
  target_provider text not null,
  status text not null default 'planned',   -- planned | running | paused | completed | failed
  total_items int, completed_items int not null default 0, failed_items int not null default 0,
  total_bytes bigint, transferred_bytes bigint not null default 0,
  created_by uuid references public.staff_profiles(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- idempotent sync log
create table public.sync_ops (
  op_id uuid primary key,
  org_id uuid,
  actor_id uuid,
  device_id uuid,
  table_name text not null,
  record_id uuid,
  result text not null,
  created_at timestamptz not null default now()
);

-- ───────────────────────── indexes ─────────────────────────
create index on public.clinic_branches(org_id);
create index on public.staff_profiles(org_id);
create index on public.procedure_stages(org_id);
create index on public.procedure_subcategories(org_id);
create index on public.procedure_subcategories(stage_id);
create index on public.anatomical_regions(org_id);
create index on public.parameter_definitions(stage_id);
create index on public.instrument_catalog(org_id);
create index on public.instrument_presets(org_id);
create index on public.instrument_presets(owner_id);
create index on public.patients(org_id, updated_at);
create index on public.patients(branch_id);
create index on public.patients(assigned_doctor_id);
create index on public.patients(created_by);
create index on public.patients(updated_by);
create index on public.patient_demographics(org_id, updated_at);
create index on public.patient_demographics(updated_by);
create index on public.patient_clinical_history(org_id, updated_at);
create index on public.patient_clinical_history(updated_by);
create index on public.patient_clinical_history(classification_system, classification_grade);
create index on public.patient_hair_characteristics(org_id, updated_at);
create index on public.patient_hair_characteristics(updated_by);
create index on public.patient_scalp_characteristics(org_id, updated_at);
create index on public.patient_scalp_characteristics(updated_by);
create index on public.patient_consents(org_id, updated_at);
create index on public.patient_consents(confirmed_by);
create index on public.surgical_sessions(org_id, updated_at);
create index on public.surgical_sessions(patient_id);
create index on public.surgical_sessions(surgery_date);
create index on public.surgical_sessions(branch_id);
create index on public.surgical_sessions(lead_surgeon_id);
create index on public.surgical_sessions(created_by);
create index on public.surgical_sessions(updated_by);
create index on public.clinical_encounters(org_id, updated_at);
create index on public.clinical_encounters(patient_id);
create index on public.clinical_encounters(session_id);
create index on public.clinical_encounters(created_by);
create index on public.procedure_instances(org_id, updated_at);
create index on public.procedure_instances(encounter_id);
create index on public.procedure_instances(current_parameter_version_id);
create index on public.procedure_instances(updated_by);
create index on public.procedure_parameter_versions(org_id, created_at);
create index on public.procedure_parameter_versions(preset_id);
create index on public.procedure_parameter_versions(created_by);
create index on public.parameter_values(org_id);
create index on public.parameter_values(parameter_version_id);
create index on public.parameter_values(stage_code, key, num_value);
create index on public.parameter_values(stage_code, key, text_value);
create index on public.donor_assessments(org_id, updated_at);
create index on public.donor_assessments(session_id);
create index on public.donor_assessments(created_by);
create index on public.graft_batches(org_id, updated_at);
create index on public.graft_batches(created_by);
create index on public.graft_batch_assessments(org_id);
create index on public.graft_batch_assessments(batch_id);
create index on public.graft_batch_assessments(created_by);
create index on public.clinical_events(org_id, updated_at);
create index on public.clinical_events(session_id);
create index on public.clinical_events(created_by);
create index on public.follow_up_assessments(org_id);
create index on public.follow_up_assessments(encounter_id);
create index on public.follow_up_assessments(created_by);
create index on public.registered_devices(org_id);
create index on public.registered_devices(registered_by);
create index on public.media_assets(org_id, updated_at);
create index on public.media_assets(patient_id);
create index on public.media_assets(session_id, stage_code);
create index on public.media_assets(encounter_id);
create index on public.media_assets(graft_batch_id);
create index on public.media_assets(device_id);
create index on public.media_assets(recorded_by);
create index on public.media_assets(parameter_version_id);
create index on public.media_assets(media_type, recorded_at);
create index on public.media_metadata_snapshots(org_id);
create index on public.media_storage_locations(org_id, updated_at);
create index on public.media_storage_locations(media_id);
create index on public.media_storage_locations(device_id);
create index on public.media_metadata_amendments(org_id);
create index on public.media_metadata_amendments(media_id);
create index on public.media_metadata_amendments(amended_by);
create index on public.audit_logs(org_id, created_at desc);
create index on public.export_records(org_id);
create index on public.export_records(device_id);
create index on public.export_records(exported_by);
create index on public.migration_jobs(org_id);
create index on public.migration_jobs(device_id);
create index on public.migration_jobs(created_by);
create index on public.sync_ops(org_id);

-- ───────────────────────── triggers: updated_at / version ─────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','clinic_branches','staff_profiles','procedure_stages','procedure_subcategories','anatomical_regions',
    'parameter_definitions','instrument_catalog','instrument_presets','patients','patient_demographics',
    'patient_clinical_history','patient_hair_characteristics','patient_scalp_characteristics','patient_consents',
    'surgical_sessions','clinical_encounters','procedure_instances','donor_assessments','graft_batches',
    'graft_batch_assessments','clinical_events','follow_up_assessments','registered_devices','media_assets',
    'media_storage_locations','export_records','migration_jobs']
  loop
    execute format('create trigger touch_%1$s before insert or update on public.%1$I for each row execute function private.touch()', t);
  end loop;
end $$;

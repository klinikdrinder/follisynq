-- Follisync: Row Level Security, audit trail, immutability and idempotent sync

-- ───────────────────────── patient access helper ─────────────────────────
create or replace function private.can_access_patient(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.patients pt
    join public.staff_profiles sp on sp.id = auth.uid() and sp.active and sp.org_id = pt.org_id
    where pt.id = p
      and (sp.role = 'admin' or sp.all_branches or pt.branch_id is null or pt.branch_id = any(sp.branch_ids))
  )
$$;

create or replace function private.can_access_session(s uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.surgical_sessions ss where ss.id = s and private.can_access_patient(ss.patient_id))
$$;

-- ───────────────────────── enable RLS everywhere ─────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- staff_roles: readable by any signed-in staff
create policy staff_roles_read on public.staff_roles for select to authenticated using (private.is_clinical());

-- organizations
create policy org_read on public.organizations for select to authenticated using (id = private.current_org_id());
create policy org_admin_update on public.organizations for update to authenticated
  using (id = private.current_org_id() and private.is_admin()) with check (id = private.current_org_id());

-- staff_profiles: staff see colleagues in their org; only admins modify (creation via edge function)
create policy staff_read on public.staff_profiles for select to authenticated
  using (org_id = private.current_org_id() or id = auth.uid());
create policy staff_admin_update on public.staff_profiles for update to authenticated
  using (org_id = private.current_org_id() and private.is_admin())
  with check (org_id = private.current_org_id());
create policy staff_self_update on public.staff_profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()) and role = private.current_role() and active and org_id = private.current_org_id());

-- configuration tables: read by staff, write by admins
do $$
declare t text;
begin
  foreach t in array array['clinic_branches','procedure_stages','procedure_subcategories','anatomical_regions',
                           'parameter_definitions','instrument_catalog','migration_jobs']
  loop
    execute format($f$create policy %1$s_read on public.%1$I for select to authenticated using (org_id = private.current_org_id())$f$, t);
    execute format($f$create policy %1$s_admin_ins on public.%1$I for insert to authenticated with check (org_id = private.current_org_id() and private.is_admin())$f$, t);
    execute format($f$create policy %1$s_admin_upd on public.%1$I for update to authenticated using (org_id = private.current_org_id() and private.is_admin()) with check (org_id = private.current_org_id())$f$, t);
  end loop;
end $$;

-- instrument presets: any clinical staff may create; owner or admin may edit
create policy presets_read on public.instrument_presets for select to authenticated
  using (org_id = private.current_org_id() and (shared or owner_id = (select auth.uid()) or private.is_admin()));
create policy presets_ins on public.instrument_presets for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical());
create policy presets_upd on public.instrument_presets for update to authenticated
  using (org_id = private.current_org_id() and (owner_id = (select auth.uid()) or private.is_admin()))
  with check (org_id = private.current_org_id());

-- patients
create policy patients_read on public.patients for select to authenticated
  using (org_id = private.current_org_id() and private.can_access_branch(branch_id));
create policy patients_ins on public.patients for insert to authenticated
  with check (
    org_id = private.current_org_id() and private.can_access_branch(branch_id)
    and (private.current_role() in ('admin','doctor')
         or (private.current_role() = 'nurse' and coalesce((select can_create_patients from public.staff_profiles where id = (select auth.uid())), false)))
  );
create policy patients_upd on public.patients for update to authenticated
  using (org_id = private.current_org_id() and private.can_access_branch(branch_id) and private.is_clinical())
  with check (org_id = private.current_org_id() and private.can_access_branch(branch_id));

-- patient child tables keyed by patient_id
do $$
declare t text;
begin
  foreach t in array array['patient_demographics','patient_clinical_history','patient_hair_characteristics',
                           'patient_scalp_characteristics','patient_consents','surgical_sessions','clinical_encounters','media_assets']
  loop
    execute format($f$create policy %1$s_read on public.%1$I for select to authenticated using (org_id = private.current_org_id() and private.can_access_patient(patient_id))$f$, t);
    execute format($f$create policy %1$s_ins on public.%1$I for insert to authenticated with check (org_id = private.current_org_id() and private.is_clinical() and private.can_access_patient(patient_id))$f$, t);
    execute format($f$create policy %1$s_upd on public.%1$I for update to authenticated using (org_id = private.current_org_id() and private.is_clinical() and private.can_access_patient(patient_id)) with check (org_id = private.current_org_id() and private.can_access_patient(patient_id))$f$, t);
  end loop;
end $$;

-- session child tables keyed by session_id
do $$
declare t text;
begin
  foreach t in array array['procedure_instances','donor_assessments','graft_batches','clinical_events']
  loop
    execute format($f$create policy %1$s_read on public.%1$I for select to authenticated using (org_id = private.current_org_id() and private.can_access_session(session_id))$f$, t);
    execute format($f$create policy %1$s_ins on public.%1$I for insert to authenticated with check (org_id = private.current_org_id() and private.is_clinical() and private.can_access_session(session_id))$f$, t);
    execute format($f$create policy %1$s_upd on public.%1$I for update to authenticated using (org_id = private.current_org_id() and private.is_clinical() and private.can_access_session(session_id)) with check (org_id = private.current_org_id())$f$, t);
  end loop;
end $$;

-- parameter versions (insert-only) via instance → session
create policy ppv_read on public.procedure_parameter_versions for select to authenticated
  using (org_id = private.current_org_id() and exists (select 1 from public.procedure_instances pi where pi.id = instance_id and private.can_access_session(pi.session_id)));
create policy ppv_ins on public.procedure_parameter_versions for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical()
              and exists (select 1 from public.procedure_instances pi where pi.id = instance_id and private.can_access_session(pi.session_id)));

create policy pv_read on public.parameter_values for select to authenticated using (org_id = private.current_org_id());

create policy gba_read on public.graft_batch_assessments for select to authenticated
  using (org_id = private.current_org_id() and exists (select 1 from public.graft_batches gb where gb.id = batch_id and private.can_access_session(gb.session_id)));
create policy gba_ins on public.graft_batch_assessments for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical());
create policy gba_upd on public.graft_batch_assessments for update to authenticated
  using (org_id = private.current_org_id() and private.is_clinical()) with check (org_id = private.current_org_id());

create policy fua_read on public.follow_up_assessments for select to authenticated
  using (org_id = private.current_org_id() and exists (select 1 from public.clinical_encounters ce where ce.id = encounter_id and private.can_access_patient(ce.patient_id)));
create policy fua_ins on public.follow_up_assessments for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical());
create policy fua_upd on public.follow_up_assessments for update to authenticated
  using (org_id = private.current_org_id() and private.is_clinical()) with check (org_id = private.current_org_id());

-- media snapshots (insert-only), storage locations, amendments (insert-only)
create policy mms_read on public.media_metadata_snapshots for select to authenticated
  using (org_id = private.current_org_id() and exists (select 1 from public.media_assets m where m.id = media_id and private.can_access_patient(m.patient_id)));
create policy mms_ins on public.media_metadata_snapshots for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical());

create policy msl_read on public.media_storage_locations for select to authenticated
  using (org_id = private.current_org_id() and exists (select 1 from public.media_assets m where m.id = media_id and private.can_access_patient(m.patient_id)));
create policy msl_ins on public.media_storage_locations for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical());
create policy msl_upd on public.media_storage_locations for update to authenticated
  using (org_id = private.current_org_id() and private.is_clinical()) with check (org_id = private.current_org_id());

create policy mma_read on public.media_metadata_amendments for select to authenticated
  using (org_id = private.current_org_id() and exists (select 1 from public.media_assets m where m.id = media_id and private.can_access_patient(m.patient_id)));
create policy mma_ins on public.media_metadata_amendments for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical() and amended_by = (select auth.uid()));

-- devices: staff register/update devices of their org
create policy dev_read on public.registered_devices for select to authenticated using (org_id = private.current_org_id());
create policy dev_ins on public.registered_devices for insert to authenticated with check (org_id = private.current_org_id() and private.is_clinical());
create policy dev_upd on public.registered_devices for update to authenticated
  using (org_id = private.current_org_id() and private.is_clinical()) with check (org_id = private.current_org_id());

-- exports
create policy exp_read on public.export_records for select to authenticated
  using (org_id = private.current_org_id() and (private.is_admin() or exported_by = (select auth.uid())));
create policy exp_ins on public.export_records for insert to authenticated
  with check (org_id = private.current_org_id() and private.is_clinical() and exported_by = (select auth.uid()));

-- audit logs: admins read; nobody writes directly (trigger only)
create policy audit_admin_read on public.audit_logs for select to authenticated
  using (org_id = private.current_org_id() and private.is_admin());

-- sync_ops: no direct access (RPC only, security definer insert)
-- No DELETE policies anywhere: hard deletes are blocked for authenticated users. Soft delete via deleted_at.

-- ───────────────────────── immutability guards ─────────────────────────
create or replace function private.block_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Table % is append-only; create a new version or amendment instead', tg_table_name;
end $$;

create trigger ppv_immutable before update or delete on public.procedure_parameter_versions
  for each row execute function private.block_mutation();
create trigger mms_immutable before update or delete on public.media_metadata_snapshots
  for each row execute function private.block_mutation();
create trigger mma_immutable before update or delete on public.media_metadata_amendments
  for each row execute function private.block_mutation();

-- media_assets: identity fields of a recording can never change
create or replace function private.guard_media_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id <> old.id or new.patient_id <> old.patient_id or new.media_type <> old.media_type
     or coalesce(new.checksum_sha256,'') <> coalesce(old.checksum_sha256, new.checksum_sha256, '')
     or new.started_at is distinct from coalesce(old.started_at, new.started_at)
     or new.device_id is distinct from coalesce(old.device_id, new.device_id) then
    raise exception 'Permanent recording identity fields cannot be modified';
  end if;
  return new;
end $$;
create trigger media_identity_guard before update on public.media_assets
  for each row execute function private.guard_media_identity();

-- ───────────────────────── parameter value projection ─────────────────────────
create or replace function private.project_parameter_values() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  st text; k text; v jsonb; raw jsonb;
begin
  select pi.stage_code into st from public.procedure_instances pi where pi.id = new.instance_id;
  for k, v in select key, value from jsonb_each(new.values) loop
    if exists (select 1 from public.parameter_definitions d join public.procedure_stages s on s.id = d.stage_id
               where s.code = st and d.key = k and d.searchable and d.org_id = new.org_id) then
      raw := case when jsonb_typeof(v) = 'object' then v->'v' else v end;
      if raw is null or raw = 'null'::jsonb then continue; end if;
      insert into public.parameter_values (org_id, parameter_version_id, stage_code, key, num_value, text_value, unit, provenance)
      values (new.org_id, new.id, st, k,
              case when jsonb_typeof(raw) = 'number' then (raw#>>'{}')::numeric end,
              case when jsonb_typeof(raw) = 'array' then (select string_agg(x, ', ') from jsonb_array_elements_text(raw) x) else raw#>>'{}' end,
              case when jsonb_typeof(v) = 'object' then v->>'unit' end,
              case when jsonb_typeof(v) = 'object' then v->>'src' end);
    end if;
  end loop;
  return new;
end $$;
create trigger ppv_project after insert on public.procedure_parameter_versions
  for each row execute function private.project_parameter_values();

-- ───────────────────────── audit trail ─────────────────────────
-- Records who changed which fields — not the values — so PII never lands in logs.
create or replace function private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  changed text[];
  rec jsonb;
  oldrec jsonb;
begin
  rec := to_jsonb(coalesce(new, old));
  if tg_op = 'UPDATE' then
    oldrec := to_jsonb(old);
    select array_agg(key) into changed from jsonb_each(rec) n
      where n.key not in ('updated_at','version') and n.value is distinct from oldrec->n.key;
    if changed is null then return new; end if;
  end if;
  insert into public.audit_logs (org_id, actor_id, table_name, record_id, action, changed_fields)
  values ((rec->>'org_id')::uuid, auth.uid(), tg_table_name,
          coalesce(rec->>'id', rec->>'patient_id'), lower(tg_op), changed);
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'clinic_branches','staff_profiles','procedure_stages','procedure_subcategories','anatomical_regions','parameter_definitions',
    'instrument_presets','patients','patient_demographics','patient_clinical_history','patient_hair_characteristics',
    'patient_scalp_characteristics','patient_consents','surgical_sessions','clinical_encounters','procedure_instances',
    'procedure_parameter_versions','donor_assessments','graft_batches','media_assets','media_metadata_amendments',
    'media_storage_locations','registered_devices','export_records','migration_jobs']
  loop
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I for each row execute function private.audit()', t);
  end loop;
end $$;

-- ───────────────────────── idempotent batch sync RPC ─────────────────────────
-- ops: [{op_id, table, data, base_version}]  — runs as the caller so RLS applies.
-- Returns per-op result: applied | duplicate | conflict | error.
create or replace function public.fs_sync_push(ops jsonb, p_device_id uuid default null)
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  op jsonb;
  tbl text;
  rid uuid;
  data jsonb;
  base int;
  cur_version int;
  cols text;
  upd text;
  pk text;
  results jsonb := '[]'::jsonb;
  server_row jsonb;
  insert_only constant text[] := array['procedure_parameter_versions','media_metadata_snapshots','media_metadata_amendments','export_records'];
  allowed constant text[] := array['patients','patient_demographics','patient_clinical_history','patient_hair_characteristics',
    'patient_scalp_characteristics','patient_consents','surgical_sessions','clinical_encounters','procedure_instances',
    'procedure_parameter_versions','donor_assessments','graft_batches','graft_batch_assessments','clinical_events',
    'follow_up_assessments','registered_devices','media_assets','media_metadata_snapshots','media_storage_locations',
    'media_metadata_amendments','export_records','instrument_presets'];
  org uuid := private.current_org_id();
begin
  if org is null then
    raise exception 'Not an active staff member';
  end if;

  for op in select * from jsonb_array_elements(ops) loop
    begin
      tbl := op->>'table';
      data := op->'data';
      base := nullif(op->>'base_version','')::int;
      if not (tbl = any(allowed)) then
        raise exception 'table % not syncable', tbl;
      end if;

      -- idempotency: op already processed?
      if exists (select 1 from public.sync_ops where op_id = (op->>'op_id')::uuid) then
        results := results || jsonb_build_object('op_id', op->>'op_id', 'result', 'duplicate');
        continue;
      end if;

      pk := case when tbl in ('patient_demographics','patient_clinical_history','patient_hair_characteristics','patient_scalp_characteristics')
                 then 'patient_id' else 'id' end;
      rid := (data->>pk)::uuid;
      data := data || jsonb_build_object('org_id', org);

      -- strip server-managed columns
      data := data - 'created_at' - 'updated_at';

      select string_agg(quote_ident(c.column_name), ',') into cols
      from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = tbl and data ? c.column_name
        and c.is_generated = 'NEVER' and c.identity_generation is null;

      if tbl = any(insert_only) then
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict do nothing',
                       tbl, cols, cols, tbl) using data;
      else
        execute format('select version from public.%I where %I = $1', tbl, pk) into cur_version using rid;
        if cur_version is not null and base is not null and cur_version <> base then
          execute format('select to_jsonb(t) from public.%I t where %I = $1', tbl, pk) into server_row using rid;
          results := results || jsonb_build_object('op_id', op->>'op_id', 'result', 'conflict', 'server', server_row);
          continue;
        end if;
        select string_agg(format('%1$I = excluded.%1$I', c.column_name), ',') into upd
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = tbl and data ? c.column_name
          and c.column_name not in ('id','org_id','created_by','version') and c.is_generated = 'NEVER' and c.identity_generation is null;
        data := data - 'version';
        select string_agg(quote_ident(c.column_name), ',') into cols
        from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = tbl and data ? c.column_name
          and c.is_generated = 'NEVER' and c.identity_generation is null;
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) on conflict (%I) do update set %s',
                       tbl, cols, cols, tbl, pk, coalesce(upd, format('%1$I = excluded.%1$I', pk))) using data;
      end if;

      execute format('select to_jsonb(t) from public.%I t where %I = $1', tbl, pk) into server_row using rid;
      insert into public.sync_ops (op_id, org_id, actor_id, device_id, table_name, record_id, result)
      values ((op->>'op_id')::uuid, org, auth.uid(), p_device_id, tbl, rid, 'applied');
      results := results || jsonb_build_object('op_id', op->>'op_id', 'result', 'applied',
                                               'version', server_row->'version', 'updated_at', server_row->'updated_at');
    exception when others then
      results := results || jsonb_build_object('op_id', op->>'op_id', 'result', 'error', 'message', sqlerrm, 'code', sqlstate);
    end;
  end loop;
  return results;
end $$;

-- sync_ops insert needs privileges beyond RLS: allow inserts for the caller's own ops
create policy sync_ops_ins on public.sync_ops for insert to authenticated
  with check (org_id = private.current_org_id() and actor_id = (select auth.uid()));
create policy sync_ops_read on public.sync_ops for select to authenticated
  using (org_id = private.current_org_id() and actor_id = (select auth.uid()));

revoke execute on function public.fs_sync_push(jsonb, uuid) from anon, public;
grant execute on function public.fs_sync_push(jsonb, uuid) to authenticated;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

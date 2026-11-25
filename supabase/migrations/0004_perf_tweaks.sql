-- Advisor fixes: evaluate auth.uid() once per query; index FK on staff_profiles.role
drop policy staff_read on public.staff_profiles;
create policy staff_read on public.staff_profiles for select to authenticated
  using (org_id = private.current_org_id() or id = (select auth.uid()));
create index if not exists staff_profiles_role_idx on public.staff_profiles(role);

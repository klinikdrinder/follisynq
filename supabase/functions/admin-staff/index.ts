// Follisync admin-staff: administrator-managed staff onboarding.
// The service-role key stays server-side (Supabase Edge runtime) and never reaches the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: 'Not authenticated' }, 401);

  const { data: caller } = await admin.from('staff_profiles').select('org_id, role, active').eq('id', userData.user.id).single();
  if (!caller || !caller.active || caller.role !== 'admin') return json({ error: 'Administrator role required' }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const action = body.action as string;

  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const role = String(body.role ?? '');
    const full_name = String(body.full_name ?? '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Valid email required' }, 400);
    if (password.length < 10) return json({ error: 'Password must be at least 10 characters' }, 400);
    if (!['admin', 'doctor', 'nurse'].includes(role)) return json({ error: 'Invalid role' }, 400);
    if (!full_name) return json({ error: 'Full name required' }, 400);

    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name },
    });
    if (error || !created.user) return json({ error: error?.message ?? 'Could not create user' }, 400);

    const { error: pErr } = await admin.from('staff_profiles').insert({
      id: created.user.id, org_id: caller.org_id, role, full_name, email,
      staff_code: body.staff_code ?? null, professional_role: body.professional_role ?? null,
      can_create_patients: body.can_create_patients ?? true,
      all_branches: body.all_branches ?? true,
      branch_ids: Array.isArray(body.branch_ids) ? body.branch_ids : [],
    });
    if (pErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: pErr.message }, 400);
    }
    await admin.from('audit_logs').insert({
      org_id: caller.org_id, actor_id: userData.user.id, table_name: 'auth.users', record_id: created.user.id, action: 'staff_created',
    });
    return json({ id: created.user.id });
  }

  if (action === 'reset_password') {
    const id = String(body.id ?? '');
    const password = String(body.password ?? '');
    if (password.length < 10) return json({ error: 'Password must be at least 10 characters' }, 400);
    const { data: target } = await admin.from('staff_profiles').select('org_id').eq('id', id).single();
    if (!target || target.org_id !== caller.org_id) return json({ error: 'Staff member not found' }, 404);
    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: error.message }, 400);
    await admin.from('audit_logs').insert({
      org_id: caller.org_id, actor_id: userData.user.id, table_name: 'auth.users', record_id: id, action: 'password_reset',
    });
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});

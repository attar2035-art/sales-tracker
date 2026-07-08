import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const findUserByEmail = async (admin: ReturnType<typeof createClient>, email: string) => {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find(user => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Function is missing Supabase admin environment variables' }, 500);
  }

  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing authorization token' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: requesterData, error: requesterError } = await admin.auth.getUser(jwt);
  if (requesterError || !requesterData.user) return json({ error: 'Unauthorized' }, 401);

  const { data: role, error: roleError } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', requesterData.user.id)
    .single();

  if (roleError || role?.role !== 'admin') {
    return json({ error: 'Only admin users can create representative accounts' }, 403);
  }

  const { email, password, repId } = await req.json().catch(() => ({}));
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) return json({ error: 'Invalid email' }, 400);
  if (!password || String(password).length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);
  if (!repId) return json({ error: 'Missing representative id' }, 400);

  const { data: rep, error: repError } = await admin
    .from('representatives')
    .select('id,name')
    .eq('id', repId)
    .single();

  if (repError || !rep) return json({ error: 'Representative not found' }, 404);

  let authUser = await findUserByEmail(admin, normalizedEmail);
  let createdNewUser = false;

  if (authUser) {
    const { data: updated, error: updateUserError } = await admin.auth.admin.updateUserById(authUser.id, {
      password,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        role: 'rep',
        rep_id: repId,
        must_change_password: true,
      },
    });
    if (updateUserError) return json({ error: updateUserError.message }, 400);
    authUser = updated.user;
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'rep',
        rep_id: repId,
        must_change_password: true,
      },
    });

    if (createError) return json({ error: createError.message }, 400);
    authUser = created.user;
    createdNewUser = true;
  }

  const userId = authUser?.id;
  if (!userId) return json({ error: 'Supabase did not return a user id' }, 500);

  const { data: existingRole } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const rolePayload = {
    user_id: userId,
    role: 'rep',
    rep_id: repId,
    supervisor_id: null,
  };

  const roleResult = existingRole
    ? await admin.from('user_roles').update(rolePayload).eq('user_id', userId)
    : await admin.from('user_roles').insert(rolePayload);

  if (roleResult.error) {
    if (createdNewUser) await admin.auth.admin.deleteUser(userId);
    return json({ error: roleResult.error.message }, 400);
  }

  return json({
    userId,
    email: normalizedEmail,
    repId,
    repName: rep.name,
    mode: createdNewUser ? 'created' : 'linked_existing',
  });
});

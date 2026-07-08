const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REP_ID = process.env.REP_ID;
const REP_NAME = (process.env.REP_NAME || '').trim();
const REP_EMAIL = (process.env.REP_EMAIL || '').trim().toLowerCase();
const REP_PASSWORD = process.env.REP_PASSWORD;

if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
if (!REP_ID && !REP_NAME) throw new Error('Missing REP_ID or REP_NAME');
if (!REP_EMAIL || !REP_EMAIL.includes('@')) throw new Error('Missing or invalid REP_EMAIL');
if (!REP_PASSWORD || REP_PASSWORD.length < 6) throw new Error('REP_PASSWORD must be at least 6 characters');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(email) {
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find(user => user.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function main() {
  let repQuery = supabase.from('representatives').select('id,name');
  repQuery = REP_ID ? repQuery.eq('id', REP_ID) : repQuery.ilike('name', REP_NAME);
  const { data: repMatches, error: repError } = await repQuery.limit(10);

  if (repError) throw repError;
  if (!repMatches || repMatches.length === 0) throw new Error(`Representative not found: ${REP_ID || REP_NAME}`);
  if (repMatches.length > 1) {
    throw new Error(`More than one representative matched "${REP_NAME}". Use REP_ID instead.`);
  }
  const rep = repMatches[0];

  let authUser = await findUserByEmail(REP_EMAIL);
  let mode = 'created';

  if (authUser) {
    const { data: updated, error: updateUserError } = await supabase.auth.admin.updateUserById(authUser.id, {
      password: REP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        ...(authUser.user_metadata || {}),
        role: 'rep',
        rep_id: rep.id,
        must_change_password: true,
      },
    });
    if (updateUserError) throw updateUserError;
    authUser = updated.user;
    mode = 'linked existing';
  } else {
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: REP_EMAIL,
      password: REP_PASSWORD,
      email_confirm: true,
      user_metadata: {
        role: 'rep',
        rep_id: rep.id,
        must_change_password: true,
      },
    });

    if (createError) throw createError;
    authUser = created.user;
  }

  const userId = authUser?.id;
  if (!userId) throw new Error('Supabase did not return a user id');

  const { data: existingRole } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const rolePayload = {
    user_id: userId,
    role: 'rep',
    rep_id: rep.id,
    supervisor_id: null,
  };

  const roleResult = existingRole
    ? await supabase.from('user_roles').update(rolePayload).eq('user_id', userId)
    : await supabase.from('user_roles').insert(rolePayload);

  if (roleResult.error) {
    if (mode === 'created') await supabase.auth.admin.deleteUser(userId);
    throw roleResult.error;
  }

  console.log(`Representative account ready (${mode}). rep=${rep.name} email=${REP_EMAIL}`);
}

main().catch((error) => {
  console.error(`::error title=Create rep account failed::${(error.message || String(error)).replace(/\r?\n/g, ' ')}`);
  console.error(error);
  process.exit(1);
});

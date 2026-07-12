const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const readDotEnvValue = (key) => {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs.readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find(row => row.trim().startsWith(`${key}=`));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL || readDotEnvValue('REACT_APP_SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_KEY || readDotEnvValue('REACT_APP_SUPABASE_KEY');
const CHECK_YEAR = Number(process.env.HEALTH_CHECK_YEAR || 2026);
const CHECK_MONTH = Number(process.env.HEALTH_CHECK_MONTH || 7);
const MIN_DAILY_ROWS = Number(process.env.HEALTH_CHECK_MIN_DAILY_ROWS || 1);
const MIN_TARGET_ROWS = Number(process.env.HEALTH_CHECK_MIN_TARGET_ROWS || 1);

if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
if (!SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_ANON_KEY or REACT_APP_SUPABASE_KEY');

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const failOnError = (label, error) => {
  if (error) throw new Error(`${label}: ${error.message || String(error)}`);
};

async function createTemporaryAdmin() {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `healthcheck+${nonce}@hawafel.com`;
  const password = `Hwf-${nonce}-2026`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      role: 'admin',
      health_check: true,
      must_change_password: false,
    },
  });
  failOnError('create temporary admin user', createError);

  const userId = created.user?.id;
  if (!userId) throw new Error('Supabase did not return temporary user id');

  const { error: roleError } = await admin.from('user_roles').insert({
    user_id: userId,
    role: 'admin',
    supervisor_id: null,
    rep_id: null,
  });
  if (roleError) {
    await admin.auth.admin.deleteUser(userId);
    throw new Error(`create temporary admin role: ${roleError.message}`);
  }

  return { userId, email, password };
}

async function deleteTemporaryAdmin(userId) {
  if (!userId) return;
  await admin.from('user_roles').delete().eq('user_id', userId);
  await admin.auth.admin.deleteUser(userId);
}

async function assertClientRead(client, label, queryBuilder) {
  const { data, count, error } = await queryBuilder(client);
  failOnError(label, error);
  return { data: data || [], count };
}

async function main() {
  let temporaryUser = null;
  try {
    temporaryUser = await createTemporaryAdmin();
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
      email: temporaryUser.email,
      password: temporaryUser.password,
    });
    failOnError('sign in as temporary admin', signInError);
    if (!signInData.user?.id) throw new Error('Temporary admin sign-in did not return user id');

    const roleResult = await assertClientRead(client, 'read own/admin user_roles without RLS recursion', c =>
      c.from('user_roles').select('role,user_id', { count: 'exact' }).eq('user_id', temporaryUser.userId)
    );
    if (!roleResult.data.some(row => row.role === 'admin')) {
      throw new Error('Temporary admin role was not visible to client');
    }

    const repsResult = await assertClientRead(client, 'read representatives as admin', c =>
      c.from('representatives').select('id,name', { count: 'exact' }).limit(5)
    );
    if ((repsResult.count || 0) < 1) throw new Error('No representatives visible to admin client');

    const targetsResult = await assertClientRead(client, `read monthly_targets ${CHECK_YEAR}-${CHECK_MONTH}`, c =>
      c.from('monthly_targets').select('target_sales,target_collection', { count: 'exact' })
        .eq('year', CHECK_YEAR)
        .eq('month', CHECK_MONTH)
        .limit(10000)
    );
    if ((targetsResult.count || 0) < MIN_TARGET_ROWS) {
      throw new Error(`Expected at least ${MIN_TARGET_ROWS} monthly target rows for ${CHECK_YEAR}-${CHECK_MONTH}, got ${targetsResult.count || 0}`);
    }

    const entriesResult = await assertClientRead(client, `read daily_entries ${CHECK_YEAR}-${CHECK_MONTH}`, c =>
      c.from('daily_entries').select('daily_sales,daily_collection,total_visits', { count: 'exact' })
        .eq('year', CHECK_YEAR)
        .eq('month', CHECK_MONTH)
        .limit(10000)
    );
    if ((entriesResult.count || 0) < MIN_DAILY_ROWS) {
      throw new Error(`Expected at least ${MIN_DAILY_ROWS} daily entry rows for ${CHECK_YEAR}-${CHECK_MONTH}, got ${entriesResult.count || 0}`);
    }

    const totals = entriesResult.data.reduce((acc, row) => {
      acc.sales += Number(row.daily_sales) || 0;
      acc.collection += Number(row.daily_collection) || 0;
      acc.visits += Number(row.total_visits) || 0;
      return acc;
    }, { sales: 0, collection: 0, visits: 0 });

    if (totals.sales <= 0 && totals.collection <= 0 && totals.visits <= 0) {
      throw new Error(`Daily entries for ${CHECK_YEAR}-${CHECK_MONTH} are visible but totals are all zero`);
    }

    console.log(JSON.stringify({
      ok: true,
      checkedPeriod: `${CHECK_YEAR}-${String(CHECK_MONTH).padStart(2, '0')}`,
      representativesVisible: repsResult.count,
      targetRows: targetsResult.count,
      dailyRows: entriesResult.count,
      totals,
    }, null, 2));
  } finally {
    await deleteTemporaryAdmin(temporaryUser?.userId);
  }
}

main().catch((error) => {
  console.error(`::error title=Production health check failed::${(error.message || String(error)).replace(/\r?\n/g, ' ')}`);
  console.error(error);
  process.exit(1);
});

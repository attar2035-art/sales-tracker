import { supabase } from './supabase';

export const signIn = async (email, password) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { data, error };
};

export const signOut = async () => {
  await supabase.auth.signOut();
};

export const getCurrentUser = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: role } = await supabase.from('user_roles')
    .select('role, supervisor_id, rep_id, supervisors(name,id)')
    .eq('user_id', user.id).single();
  return {
    ...user,
    role: role?.role || null,
    supervisor: role?.supervisors || null,
    supervisor_id: role?.supervisor_id || null,
    rep_id: role?.rep_id || null,
    must_change_password: user.user_metadata?.must_change_password === true,
  };
};

export const updatePassword = async (newPassword) => {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
    data: { must_change_password: false },
  });
  return { error };
};

// Self-service password recovery: emails the user a reset link that returns to
// this app (whatever host it is served from). Clicking it opens the app with a
// recovery session, which App.js detects to show the "set new password" screen.
export const sendPasswordReset = async (email) => {
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabase.auth.resetPasswordForEmail(
    (email || '').trim().toLowerCase(),
    { redirectTo },
  );
  return { error };
};

const getRepAccountErrorMessage = (error) => {
  const message = (error?.message || '').toLowerCase();
  if (
    message.includes('function not found')
    || message.includes('failed to fetch')
    || message.includes('networkerror')
    || message.includes('load failed')
    || message.includes('404')
  ) {
    return 'مسار إنشاء الحساب الآمن غير منشور بعد في Supabase Edge Functions. استخدم تشغيل GitHub اليدوي مؤقتًا أو انشر وظيفة create-rep-account.';
  }
  if (message.includes('user already registered') || message.includes('already registered')) {
    return 'هذا الإيميل مسجل بالفعل. استخدم إيميل آخر أو اربط الحساب الموجود بالمندوب من Supabase.';
  }
  return error?.message || 'تعذر إنشاء الحساب.';
};

export const createRepLoginAccount = async ({ email, password, repId }) => {
  const normalizedEmail = email.trim().toLowerCase();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    return { data: null, error: { message: 'يجب تسجيل الدخول كمدير قبل إنشاء حساب مندوب.' } };
  }

  const supabaseUrl = process.env.REACT_APP_SUPABASE_URL;
  if (!supabaseUrl) {
    return { data: null, error: { message: 'رابط Supabase غير مضبوط في إعدادات التشغيل.' } };
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/create-rep-account`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: normalizedEmail, password, repId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        data: null,
        error: { message: getRepAccountErrorMessage({ message: payload.error || response.statusText || String(response.status) }) },
      };
    }
    return { data: payload, error: null };
  } catch (error) {
    return { data: null, error: { message: getRepAccountErrorMessage(error) } };
  }
};

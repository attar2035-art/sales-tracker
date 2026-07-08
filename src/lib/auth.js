import { createDetachedSupabaseClient, supabase } from './supabase';

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

const getRepAccountErrorMessage = (error) => {
  const message = (error?.message || '').toLowerCase();
  if (message.includes('email rate limit')) {
    return 'تم الوصول لحد إرسال إيميلات Supabase مؤقتًا. انتظر قليلًا أو أوقف تأكيد الإيميل من إعدادات Supabase، أو استخدم إنشاء الحسابات من API آمن بدون إرسال رسالة تأكيد.';
  }
  if (message.includes('user already registered') || message.includes('already registered')) {
    return 'هذا الإيميل مسجل بالفعل. استخدم إيميل آخر أو اربط الحساب الموجود بالمندوب من Supabase.';
  }
  return error?.message || 'تعذر إنشاء الحساب.';
};

export const createRepLoginAccount = async ({ email, password, repId }) => {
  const authClient = createDetachedSupabaseClient();
  const normalizedEmail = email.trim().toLowerCase();

  const { data, error } = await authClient.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
      data: {
        role: 'rep',
        rep_id: repId,
        must_change_password: true,
      },
    },
  });

  if (error) return { data: null, error: { ...error, message: getRepAccountErrorMessage(error) } };

  const userId = data?.user?.id;
  const identities = data?.user?.identities || [];
  if (!userId || identities.length === 0) {
    return {
      data: null,
      error: { message: 'هذا الإيميل مسجل بالفعل أو لم يرجع رقم مستخدم صالح من Supabase.' },
    };
  }

  const { error: roleError } = await supabase.from('user_roles').insert({
    user_id: userId,
    role: 'rep',
    rep_id: repId,
  });

  await authClient.auth.signOut();

  if (roleError) return { data: null, error: roleError };
  return { data: { userId, email: normalizedEmail }, error: null };
};

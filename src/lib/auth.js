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
  const { data: role } = await supabase.from('user_roles').select('*, supervisors(name,id)').eq('user_id', user.id).single();
  return { ...user, role: role?.role || null, supervisor: role?.supervisors || null, supervisor_id: role?.supervisor_id || null };
};

export const updatePassword = async (newPassword) => {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error };
};

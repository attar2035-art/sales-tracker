import { supabase } from './supabase';

export const AUDIT_EVENT_LABELS = {
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  page_view: 'فتح صفحة',
  create: 'إضافة',
  update: 'تعديل',
  delete: 'حذف',
  status_change: 'تغيير حالة',
  handover: 'تسليم مندوب',
  account_create: 'إنشاء حساب دخول',
};

export const PAGE_LABELS = {
  dashboard: 'لوحة المتابعة',
  daily: 'الإدخال اليومي',
  targets: 'الأهداف الشهرية',
  repdetails: 'تفاصيل المندوب',
  repdashboard: 'تقريري',
  customers: 'العملاء',
  analytics: 'تحليل العملاء',
  segmentation: 'تقسيم العملاء',
  setup: 'الإعدادات',
  audit: 'سجل النشاط',
  password: 'تغيير كلمة السر',
};

const getCurrentActor = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return null;

  const { data: role } = await supabase
    .from('user_roles')
    .select('role, supervisor_id, rep_id')
    .eq('user_id', user.id)
    .maybeSingle();

  return {
    userId: user.id,
    email: user.email || '',
    role: role?.role || null,
    supervisorId: role?.supervisor_id || null,
    repId: role?.rep_id || null,
  };
};

export const logAuditEvent = async ({
  eventType,
  pageKey = null,
  entityType = null,
  entityId = null,
  details = {},
} = {}) => {
  if (!eventType) return;

  try {
    const actor = await getCurrentActor();
    if (!actor) return;

    await supabase.from('audit_logs').insert({
      user_id: actor.userId,
      user_email: actor.email,
      user_role: actor.role,
      supervisor_id: actor.supervisorId,
      rep_id: actor.repId,
      event_type: eventType,
      page_key: pageKey,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      details,
      user_agent: window.navigator.userAgent,
    });
  } catch (error) {
    console.warn('Audit log skipped:', error?.message || error);
  }
};

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

// Throttle duplicate page_view events (e.g. rapid re-navigation) so the audit
// table isn't flooded with near-identical rows.
const PAGE_VIEW_THROTTLE_MS = 3000;
let lastPageViewKey = null;
let lastPageViewAt = 0;

export const logAuditEvent = async ({
  eventType,
  pageKey = null,
  entityType = null,
  entityId = null,
  details = {},
} = {}) => {
  if (!eventType) return;

  if (eventType === 'page_view') {
    const now = Date.now();
    if (lastPageViewKey === pageKey && now - lastPageViewAt < PAGE_VIEW_THROTTLE_MS) return;
    lastPageViewKey = pageKey;
    lastPageViewAt = now;
  }

  try {
    const actor = await getCurrentActor();
    if (!actor) return;

    // Capture the error explicitly (insert alone won't throw on RLS/constraint
    // failure) so audit gaps are at least visible in the console.
    const { error } = await supabase.from('audit_logs').insert({
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
    if (error) console.warn('Audit log failed:', error.message);
  } catch (error) {
    console.warn('Audit log skipped:', error?.message || error);
  }
};

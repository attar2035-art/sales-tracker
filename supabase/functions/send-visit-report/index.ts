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

const esc = (s: unknown) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtTime = (t: string | null) => {
  if (!t) return '—';
  try {
    return new Date(t).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
};

const STATUS_AR: Record<string, string> = {
  planned: 'مخططة', completed: 'مكتملة', cancelled: 'ملغاة',
};

// deno-lint-ignore no-explicit-any
const shell = (title: string, inner: string) => `<!doctype html>
<html dir="rtl" lang="ar"><body style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:0 auto;padding:20px">
  <div style="background:#0f172a;color:#fff;border-radius:12px 12px 0 0;padding:18px 20px;font-size:18px;font-weight:bold">🏭 نظام متابعة المبيعات — ${esc(title)}</div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:20px">${inner}</div>
  <div style="text-align:center;color:#94a3b8;font-size:12px;padding:14px">رسالة تلقائية من نظام متابعة المبيعات</div>
</div></body></html>`;

async function sendEmail(resendKey: string, from: string, to: string[], subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.message || `Resend error ${res.status}`);
  return payload;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const fromEmail = Deno.env.get('REPORTS_FROM_EMAIL') || 'may@hawafel.com';
  const fromName = Deno.env.get('REPORTS_FROM_NAME') || 'نظام متابعة المبيعات';
  const appUrl = Deno.env.get('APP_URL') || 'https://sales-tracker-ijyb.onrender.com';
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Missing Supabase admin env' }, 500);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'Missing authorization token' }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resend key: prefer the platform secret, but fall back to the locked-down
  // app_secrets table (readable only by the service role) so the key never has
  // to live in the public repository.
  let resendKey = Deno.env.get('RESEND_API_KEY') || null;
  if (!resendKey) {
    const { data: secret } = await admin.from('app_secrets')
      .select('value').eq('key', 'resend_api_key').maybeSingle();
    resendKey = secret?.value || null;
  }
  if (!resendKey) return json({ error: 'RESEND_API_KEY is not configured' }, 500);

  const { data: requester, error: reqErr } = await admin.auth.getUser(jwt);
  if (reqErr || !requester.user) return json({ error: 'Unauthorized' }, 401);
  const { data: roleRow } = await admin.from('user_roles')
    .select('role, supervisor_id').eq('user_id', requester.user.id).single();
  const role = roleRow?.role;
  if (role !== 'supervisor' && role !== 'admin') return json({ error: 'Forbidden' }, 403);

  const from = `${fromName} <${fromEmail}>`;
  const body = await req.json().catch(() => ({}));
  const type = body?.type;

  // Signed URL (7 days) for a stored photo/file so recipients can open it.
  const signUrl = async (path: string | null | undefined) => {
    if (!path) return null;
    const { data } = await admin.storage.from('visit-photos').createSignedUrl(path, 60 * 60 * 24 * 7);
    return data?.signedUrl || null;
  };
  // Build the shared "customer + address + rep" detail rows from a visit row,
  // preferring the free-form fields the supervisor typed in.
  const detailRows = (v: Record<string, unknown>, fallbackName?: string) => {
    const row = (label: string, val: unknown) => val
      ? `<tr><td style="padding:6px 8px;color:#64748b">${label}</td><td style="padding:6px 8px">${esc(val)}</td></tr>` : '';
    return row('العميل/المحل', v.customer_name || fallbackName || 'عميل')
      + row('المسؤول', v.contact_person)
      + row('المدينة', v.city)
      + row('الحي', v.neighborhood)
      + row('الشارع', v.street)
      + row('المندوب', v.rep_name);
  };

  // Resolve active recipients and pick the ones relevant to the involved regions.
  const pickRecipients = async (regionIds: (string | null)[]) => {
    const regionSet = new Set(regionIds.filter(Boolean) as string[]);
    // Region-scoped extra recipients from the Permissions Center...
    const { data: recs } = await admin.from('report_recipients')
      .select('email, region_id, is_active').eq('is_active', true);
    const fromCenter = (recs || [])
      .filter(r => !r.region_id || regionSet.has(r.region_id))
      .map(r => String(r.email).toLowerCase());
    // ...plus every active manager (managers are company-wide recipients).
    const { data: mgrs } = await admin.from('managers')
      .select('email').eq('is_active', true);
    const fromManagers = (mgrs || []).map(m => String(m.email).toLowerCase());
    return [...new Set([...fromCenter, ...fromManagers])];
  };

  const ownsRoute = (routeSupervisorId: string) =>
    role === 'admin' || roleRow?.supervisor_id === routeSupervisorId;

  try {
    if (type === 'single') {
      const visitId = body?.visitId;
      if (!visitId) return json({ error: 'Missing visitId' }, 400);
      const { data: visit } = await admin.from('supervisor_visits')
        .select('*').eq('id', visitId).single();
      if (!visit) return json({ error: 'Visit not found' }, 404);
      const { data: route } = await admin.from('supervisor_routes')
        .select('id, supervisor_id, route_date').eq('id', visit.route_id).single();
      if (!route || !ownsRoute(route.supervisor_id)) return json({ error: 'Forbidden' }, 403);

      const { data: cust } = visit.customer_id
        ? await admin.from('customers').select('customer_name, region_id').eq('id', visit.customer_id).maybeSingle()
        : { data: null };
      const { data: sup } = await admin.from('supervisors')
        .select('name').eq('id', route.supervisor_id).maybeSingle();

      const recipients = await pickRecipients([cust?.region_id || null]);
      if (recipients.length === 0) return json({ sent: 0, reason: 'no recipients' });

      const gps = visit.gps_lat && visit.gps_lng
        ? `<a href="https://www.google.com/maps?q=${visit.gps_lat},${visit.gps_lng}">📍 الموقع على الخريطة</a>` : '—';
      const photoPaths = Array.isArray(visit.photos) ? visit.photos : [];
      const photoUrls = (await Promise.all(photoPaths.map((p: string) => signUrl(p)))).filter(Boolean) as string[];
      const photosCell = photoUrls.length
        ? photoUrls.map((u, i) => `<a href="${u}">📷 صورة ${i + 1}</a>`).join(' &nbsp; ')
        : `${photoPaths.length} صورة`;
      const attachUrl = await signUrl(visit.attachment_path as string);
      const custName = visit.customer_name || cust?.customer_name || 'عميل';
      const inner = `
        <p style="font-size:15px">سجّل المشرف <b>${esc(sup?.name || '')}</b> زيارة جديدة:</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          ${detailRows(visit, cust?.customer_name)}
          <tr><td style="padding:6px 8px;color:#64748b">التاريخ</td><td style="padding:6px 8px">${esc(route.route_date)}</td></tr>
          <tr><td style="padding:6px 8px;color:#64748b">وقت الزيارة</td><td style="padding:6px 8px">${fmtTime(visit.check_in_time)}</td></tr>
          <tr><td style="padding:6px 8px;color:#64748b">الموقع</td><td style="padding:6px 8px">${gps}</td></tr>
          ${visit.visit_notes ? `<tr><td style="padding:6px 8px;color:#64748b">ملاحظات</td><td style="padding:6px 8px">${esc(visit.visit_notes)}</td></tr>` : ''}
          ${attachUrl ? `<tr><td style="padding:6px 8px;color:#64748b">ملف مرفق</td><td style="padding:6px 8px"><a href="${attachUrl}">📎 فتح الملف</a></td></tr>` : ''}
          <tr><td style="padding:6px 8px;color:#64748b">الصور</td><td style="padding:6px 8px">${photosCell}</td></tr>
        </table>`;
      await sendEmail(resendKey, from, recipients,
        `زيارة جديدة — ${sup?.name || 'مشرف'} — ${custName}`,
        shell('إشعار زيارة', inner));
      return json({ sent: recipients.length });
    }

    if (type === 'daily') {
      const routeId = body?.routeId;
      if (!routeId) return json({ error: 'Missing routeId' }, 400);
      const { data: route } = await admin.from('supervisor_routes')
        .select('id, supervisor_id, route_date').eq('id', routeId).single();
      if (!route || !ownsRoute(route.supervisor_id)) return json({ error: 'Forbidden' }, 403);

      const { data: visits } = await admin.from('supervisor_visits')
        .select('*').eq('route_id', routeId).order('created_at', { ascending: true });
      const list = visits || [];
      const custIds = [...new Set(list.map(v => v.customer_id).filter(Boolean))];
      const { data: custs } = custIds.length
        ? await admin.from('customers').select('id, customer_name, region_id').in('id', custIds)
        : { data: [] };
      // deno-lint-ignore no-explicit-any
      const custById = new Map((custs || []).map((c: any) => [c.id, c]));
      const { data: sup } = await admin.from('supervisors')
        .select('name').eq('id', route.supervisor_id).maybeSingle();

      // supervisor's own login email (from their user_roles link)
      const { data: supRole } = await admin.from('user_roles')
        .select('user_id').eq('supervisor_id', route.supervisor_id).eq('role', 'supervisor').maybeSingle();
      let supEmail: string | null = null;
      if (supRole?.user_id) {
        const { data: supUser } = await admin.auth.admin.getUserById(supRole.user_id);
        supEmail = supUser?.user?.email || null;
      }

      const regionIds = list.map(v => custById.get(v.customer_id)?.region_id || null);
      const managerEmails = await pickRecipients(regionIds);
      const recipients = [...new Set([...managerEmails, ...(supEmail ? [supEmail.toLowerCase()] : [])])];
      if (recipients.length === 0) return json({ sent: 0, reason: 'no recipients' });

      const completed = list.filter(v => v.visit_status === 'completed').length;
      const rows = list.map(v => {
        const c = custById.get(v.customer_id);
        const name = v.customer_name || c?.customer_name || '—';
        const sub = [v.city, v.neighborhood].filter(Boolean).join(' — ');
        const rep = v.rep_name ? `<div style="font-size:11px;color:#94a3b8">مندوب: ${esc(v.rep_name)}</div>` : '';
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eef2f7"><b>${esc(name)}</b>${sub ? `<div style="font-size:11px;color:#94a3b8">${esc(sub)}</div>` : ''}${rep}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${fmtTime(v.check_in_time)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${esc(STATUS_AR[v.visit_status] || v.visit_status)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${Array.isArray(v.photos) ? v.photos.length : 0}</td>
        </tr>`;
      }).join('');
      const inner = `
        <p style="font-size:15px">تقرير زيارات المشرف <b>${esc(sup?.name || '')}</b> — ${esc(route.route_date)}</p>
        <div style="display:flex;gap:10px;margin:12px 0">
          <div style="flex:1;background:#eff6ff;border-radius:8px;padding:10px;text-align:center"><div style="color:#64748b;font-size:12px">إجمالي الزيارات</div><div style="font-size:20px;font-weight:bold">${list.length}</div></div>
          <div style="flex:1;background:#ecfdf5;border-radius:8px;padding:10px;text-align:center"><div style="color:#64748b;font-size:12px">مكتملة</div><div style="font-size:20px;font-weight:bold">${completed}</div></div>
        </div>
        ${list.length ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="background:#f8fafc;text-align:right">
            <th style="padding:8px">العميل</th><th style="padding:8px">الوقت</th><th style="padding:8px">الحالة</th><th style="padding:8px">صور</th>
          </tr></thead><tbody>${rows}</tbody></table>`
          : '<p style="color:#64748b">لا توجد زيارات مسجّلة اليوم.</p>'}
        <p style="margin-top:16px"><a href="${esc(appUrl)}" style="color:#3b82f6">فتح النظام</a></p>`;
      await sendEmail(resendKey, from, recipients,
        `تقرير زيارات اليوم — ${sup?.name || 'مشرف'} — ${route.route_date}`,
        shell('تقرير اليوم', inner));
      return json({ sent: recipients.length });
    }

    return json({ error: 'Invalid type (expected single|daily)' }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

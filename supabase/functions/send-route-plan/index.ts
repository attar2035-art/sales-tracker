import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

// Emails a rep's daily route plan to their region supervisor + the managers,
// triggered by the rep (or a supervisor/admin for a rep on their team) from the
// "إرسال الخطة للمدير" button on the Route Plan page. One email per request,
// carrying the full day's planned customers — never one per customer.

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

const shell = (title: string, inner: string) => `<!doctype html>
<html dir="rtl" lang="ar"><body style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif;color:#0f172a">
<div style="max-width:640px;margin:0 auto;padding:20px">
  <div style="background:#0f172a;color:#fff;border-radius:12px 12px 0 0;padding:18px 20px;font-size:18px;font-weight:bold">🏭 نظام متابعة المبيعات — ${esc(title)}</div>
  <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;padding:20px">${inner}</div>
  <div style="text-align:center;color:#94a3b8;font-size:12px;padding:14px">رسالة تلقائية من نظام متابعة المبيعات</div>
</div></body></html>`;

async function sendEmail(resendKey: string, from: string, to: string[], subject: string, html: string, replyTo?: string | null) {
  const body: Record<string, unknown> = { from, to, subject, html };
  if (replyTo) body.reply_to = replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

  // Resend key: platform secret first, then the locked-down app_secrets table.
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
    .select('role, rep_id, supervisor_id').eq('user_id', requester.user.id).single();
  const role = roleRow?.role;
  if (role !== 'rep' && role !== 'supervisor' && role !== 'admin') {
    return json({ error: 'Forbidden' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const planDate = body?.planDate;
  if (!planDate) return json({ error: 'Missing planDate' }, 400);

  // Which rep's plan: a rep may only send their own; a supervisor/admin may send
  // for a named rep (repId).
  let repId: string | null = null;
  if (role === 'rep') repId = roleRow?.rep_id || null;
  else repId = body?.repId || null;
  if (!repId) return json({ error: 'Missing repId' }, 400);

  const { data: rep } = await admin.from('representatives')
    .select('id, name, region_id, supervisor_id').eq('id', repId).maybeSingle();
  if (!rep) return json({ error: 'Rep not found' }, 404);

  // A supervisor may only send for reps on their own team.
  if (role === 'supervisor' && rep.supervisor_id !== roleRow?.supervisor_id) {
    return json({ error: 'Forbidden' }, 403);
  }

  // The day's planned customers (the rep's own uploaded plan, not off-plan rows).
  const { data: planRows } = await admin.from('daily_route_plan')
    .select('customer_name, region_id, city, neighborhood, phone, contact_person, customer_rating, address, location_url, sort_order, created_at')
    .eq('rep_id', repId).eq('plan_date', planDate).eq('off_plan', false)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: true });
  const rows = planRows || [];
  if (rows.length === 0) return json({ sent: 0, reason: 'no plan' });

  // Recipients: the rep's region supervisor if there is one; otherwise the
  // fixed company managers. A region supervisor is either the rep's own
  // supervisor (representatives.supervisor_id) OR a region-scoped recipient
  // who is NOT one of the company managers (this is how وليد supervises
  // خميس/جيزان). A manager scoped to a region (e.g. أحمد عطار on جدة) is a
  // manager, not the supervisor, so it is excluded from supervisor detection.
  const FIXED_MANAGERS = [
    'salm77437@gmail.com', 'ahmedattar88@gmail.com', 'attar4334@gmail.com',
    'sayedattar300@gmail.com', 'ceo@hawafel.com',
  ];

  const { data: allRecs } = await admin.from('report_recipients')
    .select('email, region_id, is_active').eq('is_active', true);
  const { data: mgrs } = await admin.from('managers')
    .select('email').eq('is_active', true);
  // The company-manager set: used to tell a region supervisor apart from a
  // region-scoped manager.
  const managerSet = new Set<string>([
    ...FIXED_MANAGERS.map((e) => e.toLowerCase()),
    ...(mgrs || []).map((m) => String(m.email).toLowerCase()),
    ...(allRecs || []).filter((r) => !r.region_id).map((r) => String(r.email).toLowerCase()),
  ]);

  // (1) the rep's own supervisor (رامي / يحي)
  let supEmail: string | null = null;
  if (rep.supervisor_id) {
    const { data: supRole } = await admin.from('user_roles')
      .select('user_id').eq('supervisor_id', rep.supervisor_id).eq('role', 'supervisor').maybeSingle();
    if (supRole?.user_id) {
      const { data: supUser } = await admin.auth.admin.getUserById(supRole.user_id);
      supEmail = supUser?.user?.email ? supUser.user.email.toLowerCase() : null;
    }
  }
  // (2) a region-scoped recipient who is not a company manager = the supervisor (وليد)
  const regionSups = (allRecs || [])
    .filter((r) => r.region_id === rep.region_id)
    .map((r) => String(r.email).toLowerCase())
    .filter((e) => !managerSet.has(e));

  const supervisors = [...new Set([...(supEmail ? [supEmail] : []), ...regionSups])];
  // Supervisor if any; otherwise fall back to the fixed company managers.
  const recipients = supervisors.length > 0
    ? supervisors
    : [...new Set(FIXED_MANAGERS.map((e) => e.toLowerCase()))];
  if (recipients.length === 0) return json({ sent: 0, reason: 'no recipients' });

  // Region names for the table.
  const regionIds = [...new Set(rows.map((r) => r.region_id).filter(Boolean))] as string[];
  const { data: regs } = regionIds.length
    ? await admin.from('regions').select('id, name').in('id', regionIds)
    : { data: [] };
  const regionName = new Map((regs || []).map((r: Record<string, unknown>) => [r.id, r.name]));

  const trs = rows.map((it, i) => {
    const sub = [it.city, it.neighborhood].filter(Boolean).join(' — ');
    const loc = it.location_url
      ? `<a href="${esc(it.location_url)}">📍 الموقع</a>`
      : esc(it.address || '—');
    return `<tr>
      <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${i + 1}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eef2f7"><b>${esc(it.customer_name)}</b>${sub ? `<div style="font-size:11px;color:#94a3b8">${esc(sub)}</div>` : ''}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${esc(regionName.get(it.region_id) || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${esc(it.phone || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${esc(it.contact_person || '—')}</td>
      <td style="padding:6px 8px;border-bottom:1px solid #eef2f7">${loc}</td>
    </tr>`;
  }).join('');

  const inner = `
    <p style="font-size:15px">رفع المندوب <b>${esc(rep.name)}</b> خطة خط السير ليوم <b>${esc(planDate)}</b>:</p>
    <div style="background:#eff6ff;border-radius:8px;padding:10px;text-align:center;margin:12px 0">
      <div style="color:#64748b;font-size:12px">عدد العملاء في الخطة</div>
      <div style="font-size:22px;font-weight:bold">${rows.length}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead><tr style="background:#f8fafc;text-align:right">
        <th style="padding:8px">#</th><th style="padding:8px">العميل</th><th style="padding:8px">المنطقة</th><th style="padding:8px">التليفون</th><th style="padding:8px">المسؤول</th><th style="padding:8px">الموقع</th>
      </tr></thead><tbody>${trs}</tbody>
    </table>
    <p style="margin-top:16px"><a href="${esc(appUrl)}" style="color:#3b82f6">فتح النظام</a></p>`;

  const from = `${fromName} <${fromEmail}>`;
  try {
    await sendEmail(resendKey, from, recipients,
      `خطة خط السير — ${rep.name} — ${planDate}`,
      shell('خطة خط السير', inner),
      requester.user.email || null);
    return json({ sent: recipients.length });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

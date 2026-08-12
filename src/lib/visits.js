import { supabase } from './supabase';

const todayDateStr = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// One route per supervisor per day. Fetch it if it already exists, otherwise
// create it — avoids asking the supervisor to explicitly "start a route".
export const getOrCreateTodayRoute = async (supervisorId) => {
  const routeDate = todayDateStr();
  const { data: existing, error: fetchError } = await supabase
    .from('supervisor_routes')
    .select('id, route_date, status')
    .eq('supervisor_id', supervisorId)
    .eq('route_date', routeDate)
    .maybeSingle();
  if (fetchError) return { data: null, error: fetchError };
  if (existing) return { data: existing, error: null };

  const { data: created, error: insertError } = await supabase
    .from('supervisor_routes')
    .insert({ supervisor_id: supervisorId, route_date: routeDate })
    .select('id, route_date, status')
    .single();
  return { data: created, error: insertError };
};

// Customer names are joined client-side (rather than a PostgREST embedded
// `customers(...)` select) to keep this query independent of the embed-through
// relationship — the FK on supervisor_visits.customer_id exists, but a plain
// lookup keeps the shape identical to listVisitsInRange below.
export const listRouteVisits = async (routeId) => {
  const { data, error } = await supabase
    .from('supervisor_visits')
    .select('*')
    .eq('route_id', routeId)
    .order('created_at', { ascending: true });
  if (error || !data) return { data, error };
  return { data: await attachCustomerNames(data), error: null };
};

export const attachCustomerNames = async (visits) => {
  const ids = [...new Set(visits.map(v => v.customer_id).filter(Boolean))];
  if (ids.length === 0) return visits;
  const { data: customers } = await supabase.from('customers').select('id, customer_name, customer_code').in('id', ids);
  const byId = new Map((customers || []).map(c => [c.id, c]));
  // Prefer the free-form name the supervisor typed; fall back to the linked
  // customer record for legacy visits that still reference customer_id.
  return visits.map(v => ({
    ...v,
    customer_name: v.customer_name || byId.get(v.customer_id)?.customer_name,
    customer_code: byId.get(v.customer_id)?.customer_code,
  }));
};

// Reps that belong to a supervisor's team — used to fill the "المندوب" picker
// in the visit form.
export const listRepsForSupervisor = async (supervisorId) => {
  if (!supervisorId) return { data: [], error: null };
  return supabase
    .from('representatives')
    .select('id, name')
    .eq('supervisor_id', supervisorId)
    .order('name');
};

// region-scoped customer search for the visit picker, matching the same
// fail-closed role scoping used on the Customers page.
export const searchCustomersForVisit = async (user, term) => {
  let regionIds = null;
  if (user?.role === 'admin') {
    regionIds = null;
  } else if (user?.role === 'supervisor' && user?.supervisor_id) {
    const { data: reps } = await supabase
      .from('representatives')
      .select('region_id')
      .eq('supervisor_id', user.supervisor_id);
    regionIds = [...new Set((reps || []).map(r => r.region_id))];
  } else {
    regionIds = [];
  }

  let query = supabase
    .from('customers')
    .select('id, customer_code, customer_name, region_id, regions(name)')
    .limit(20);
  if (term) query = query.ilike('customer_name', `%${term}%`);
  if (regionIds) query = query.in('region_id', regionIds.length ? regionIds : ['__none__']);
  return query;
};

export const getCurrentPosition = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) { reject(new Error('الموقع الجغرافي غير مدعوم في هذا المتصفح')); return; }
  navigator.geolocation.getCurrentPosition(
    pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
    err => reject(err),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// A visit is now free-form: the supervisor types the customer/shop name and
// address details by hand instead of picking an existing customer record.
export const startVisit = async ({
  routeId, customerName, contactPerson, city, neighborhood, street, repName, gps, notes,
}) => {
  return supabase
    .from('supervisor_visits')
    .insert({
      route_id: routeId,
      customer_id: null,
      customer_name: customerName || null,
      contact_person: contactPerson || null,
      city: city || null,
      neighborhood: neighborhood || null,
      street: street || null,
      rep_name: repName || null,
      visit_status: 'completed',
      check_in_time: new Date().toISOString(),
      gps_lat: gps?.lat ?? null,
      gps_lng: gps?.lng ?? null,
      visit_notes: notes || null,
    })
    .select('*')
    .single();
};

export const uploadVisitPhoto = async (userId, file) => {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from('visit-photos').upload(path, file);
  if (error) return { path: null, error };
  return { path, error: null };
};

export const attachPhotosToVisit = async (visitId, photoPaths) => {
  return supabase.from('supervisor_visits').update({ photos: photoPaths }).eq('id', visitId);
};

// A single free-form attachment (any file type) uploaded with the visit.
export const attachFileToVisit = async (visitId, path) => {
  return supabase.from('supervisor_visits').update({ attachment_path: path }).eq('id', visitId);
};

// Weekdays used by the weekly route plan (Saturday-first, as in the region).
export const WEEKDAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

// The regions a user can pick a route for: admins see all, a supervisor sees
// only the regions covered by their own reps.
export const listRegionsForSupervisor = async (user) => {
  if (user?.role === 'admin') {
    return supabase.from('regions').select('id, name').order('name');
  }
  if (user?.role === 'supervisor' && user?.supervisor_id) {
    const { data: reps } = await supabase
      .from('representatives').select('region_id').eq('supervisor_id', user.supervisor_id);
    const ids = [...new Set((reps || []).map(r => r.region_id).filter(Boolean))];
    if (!ids.length) return { data: [], error: null };
    return supabase.from('regions').select('id, name').in('id', ids).order('name');
  }
  return { data: [], error: null };
};

// Customers planned on a region's route for a given weekday.
export const listRoutePlanCustomers = async (regionId, dayOfWeek) => {
  if (!regionId || !dayOfWeek) return { data: [], error: null };
  return supabase
    .from('route_plan_customers')
    .select('id, customer_name, neighborhood, city, sort_order')
    .eq('region_id', regionId)
    .eq('day_of_week', dayOfWeek)
    .order('sort_order', { ascending: true })
    .order('customer_name', { ascending: true });
};

// Admin bulk import of route-plan rows. Rows must already carry a resolved
// region_id. Existing rows for every (region_id, day) pair in the batch are
// replaced so re-uploading a sheet refreshes that day cleanly.
export const importRoutePlan = async (rows) => {
  if (!rows || !rows.length) return { error: null, inserted: 0 };
  const pairs = [...new Set(rows.map(r => `${r.region_id}|${r.day_of_week}`))];
  for (const pair of pairs) {
    const [regionId, day] = pair.split('|');
    const { error: delErr } = await supabase
      .from('route_plan_customers').delete().eq('region_id', regionId).eq('day_of_week', day);
    if (delErr) return { error: delErr, inserted: 0 };
  }
  const batchSize = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase.from('route_plan_customers').insert(batch);
    if (error) return { error, inserted };
    inserted += batch.length;
  }
  return { error: null, inserted };
};

// Report titles/types the supervisor can pick when filing a free-form report.
export const REPORT_TYPES = [
  'زيارة ميدانية',
  'جرد شهري',
  'تقرير كفاءة',
  'تقرير أسبوعي',
  'تقرير شهري',
  'تقرير يومي',
];

// Create a free-form supervisor report (separate from route visits).
export const createReport = async ({ supervisorId, reportType, content }) => {
  return supabase
    .from('supervisor_reports')
    .insert({
      supervisor_id: supervisorId,
      report_type: reportType,
      content: content || null,
    })
    .select('*')
    .single();
};

// Attach uploaded photo/file storage paths to a report after it is created.
export const attachReportMedia = async (reportId, { photos, files }) => {
  return supabase
    .from('supervisor_reports')
    .update({ photos: photos || [], files: files || [] })
    .eq('id', reportId);
};

// Email a visit report to the managers in the Permissions Center (and, for the
// end-of-day report, the supervisor too). Runs server-side in the
// send-visit-report edge function (Resend); the user's JWT is attached
// automatically by supabase.functions.invoke.
//   payload: { type: 'single', visitId }  |  { type: 'daily', routeId }
export const sendVisitReport = async (payload) => {
  return supabase.functions.invoke('send-visit-report', { body: payload });
};

// Mark today's route as completed (used by the end-of-day "send report" action).
export const completeRoute = async (routeId) => {
  return supabase.from('supervisor_routes').update({ status: 'completed' }).eq('id', routeId);
};

// Knowledge Center: all visits in a date range, scoped by role like every
// other report in the app (admin sees everyone, supervisor sees only their
// own routes). Supervisor and customer names are resolved with plain client-
// side lookups to keep the result shape consistent across the two readers.
export const listVisitsInRange = async (user, fromDate, toDate) => {
  let routesQuery = supabase
    .from('supervisor_routes')
    .select('id, supervisor_id, route_date, status')
    .gte('route_date', fromDate)
    .lte('route_date', toDate);
  if (user?.role === 'supervisor') {
    if (!user.supervisor_id) return { data: [], error: null };
    routesQuery = routesQuery.eq('supervisor_id', user.supervisor_id);
  }
  const { data: routes, error: routesError } = await routesQuery;
  if (routesError) return { data: null, error: routesError };
  if (!routes || routes.length === 0) return { data: [], error: null };

  const routeIds = routes.map(r => r.id);
  const { data: visits, error: visitsError } = await supabase
    .from('supervisor_visits')
    .select('*')
    .in('route_id', routeIds)
    .order('created_at', { ascending: false });
  if (visitsError) return { data: null, error: visitsError };

  const routeById = new Map(routes.map(r => [r.id, r]));
  const { data: supervisors } = await supabase.from('supervisors').select('id, name');
  const supervisorById = new Map((supervisors || []).map(s => [s.id, s.name]));

  const enriched = await attachCustomerNames(visits || []);
  return {
    data: enriched.map(v => ({
      ...v,
      route_date: routeById.get(v.route_id)?.route_date,
      supervisor_name: supervisorById.get(routeById.get(v.route_id)?.supervisor_id) || '—',
    })),
    error: null,
  };
};

// All supervisors, for the manager's follow-up picker.
export const listSupervisors = async () =>
  supabase.from('supervisors').select('id, name').order('name');

// A single supervisor's visits within a date range (manager follow-up view).
export const listVisitsForSupervisor = async (supervisorId, fromDate, toDate) => {
  if (!supervisorId) return { data: [], error: null };
  const { data: routes, error: rErr } = await supabase
    .from('supervisor_routes')
    .select('id, route_date, status')
    .eq('supervisor_id', supervisorId)
    .gte('route_date', fromDate)
    .lte('route_date', toDate);
  if (rErr) return { data: null, error: rErr };
  if (!routes || !routes.length) return { data: [], error: null };
  const routeById = new Map(routes.map(r => [r.id, r]));
  const { data: visits, error: vErr } = await supabase
    .from('supervisor_visits')
    .select('*')
    .in('route_id', routes.map(r => r.id))
    .order('created_at', { ascending: false });
  if (vErr) return { data: null, error: vErr };
  const enriched = await attachCustomerNames(visits || []);
  return {
    data: enriched.map(v => ({ ...v, route_date: routeById.get(v.route_id)?.route_date })),
    error: null,
  };
};

// A single supervisor's free-form reports within a date range.
export const listReportsForSupervisor = async (supervisorId, fromDate, toDate) => {
  if (!supervisorId) return { data: [], error: null };
  let q = supabase
    .from('supervisor_reports')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .order('created_at', { ascending: false });
  if (fromDate) q = q.gte('created_at', fromDate);
  if (toDate) q = q.lte('created_at', `${toDate}T23:59:59`);
  return q;
};

// KPI summary for a set of routes (Knowledge Center). `routes` is the raw
// rows from supervisor_routes; `visits` from supervisor_visits.
export const summarizeVisits = (visits) => {
  const total = visits.length;
  const completed = visits.filter(v => v.visit_status === 'completed').length;
  const cancelled = visits.filter(v => v.visit_status === 'cancelled').length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, cancelled, successRate };
};

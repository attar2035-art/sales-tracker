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
  return visits.map(v => ({ ...v, customer_name: byId.get(v.customer_id)?.customer_name, customer_code: byId.get(v.customer_id)?.customer_code }));
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

export const startVisit = async ({ routeId, customerId, gps, notes }) => {
  return supabase
    .from('supervisor_visits')
    .insert({
      route_id: routeId,
      customer_id: customerId,
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

// KPI summary for a set of routes (Knowledge Center). `routes` is the raw
// rows from supervisor_routes; `visits` from supervisor_visits.
export const summarizeVisits = (visits) => {
  const total = visits.length;
  const completed = visits.filter(v => v.visit_status === 'completed').length;
  const cancelled = visits.filter(v => v.visit_status === 'cancelled').length;
  const successRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { total, completed, cancelled, successRate };
};

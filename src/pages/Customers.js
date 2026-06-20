import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import CustomerDetails from './CustomerDetails';

export default function Customers({ user }) {
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [allowedRegionIds, setAllowedRegionIds] = useState(null); // null = no restriction (admin)
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [sortBy, setSortBy] = useState('amount_desc');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const loadData = async () => {
    setLoading(true);

    // 1. تحديد المناطق المسموح بها حسب الدور
    let regionIds = null; // null = admin, يشوف الكل

    if (user?.role === 'supervisor' && user?.supervisor_id) {
      const { data: reps } = await supabase
        .from('representatives')
        .select('region_id')
        .eq('supervisor_id', user.supervisor_id);
      regionIds = [...new Set((reps || []).map(r => r.region_id))];
    } else if (user?.role === 'rep' && user?.rep_id) {
      const { data: rep } = await supabase
        .from('representatives')
        .select('region_id')
        .eq('id', user.rep_id)
        .single();
      regionIds = rep ? [rep.region_id] : [];
    }
    setAllowedRegionIds(regionIds);

    // 2. تحميل المناطق (للفلتر) — فقط المسموح بها
    let regionsQuery = supabase.from('regions').select('id, name').order('name');
    if (regionIds) regionsQuery = regionsQuery.in('id', regionIds.length ? regionIds : ['__none__']);
    const { data: regionsData } = await regionsQuery;
    setRegions(regionsData || []);

    // 3. تحميل العملاء (فقط المناطق المسموح بها)
    let customersQuery = supabase
      .from('customers')
      .select('id, customer_code, customer_name, region_id, regions(name)');
    if (regionIds) {
      customersQuery = customersQuery.in('region_id', regionIds.length ? regionIds : ['__none__']);
    }
    const { data: customersData, error } = await customersQuery;

    if (error) {
      console.error(error);
      setCustomers([]);
      setLoading(false);
      return;
    }

    const customerIdsSet = new Set((customersData || []).map(c => c.id));

    // 4. تحميل كل سجلات المبيعات عبر صفحات (بدون فلتر .in() لأن عدد العملاء قد يكون كبير جداً لرابط الطلب)
    const salesTotals = {}; // customer_id -> { amount, quantity, products }
    const pageSize = 1000;
    let from = 0;
    let keepGoing = true;

    while (keepGoing) {
      const { data: salesPage, error: salesError } = await supabase
        .from('customer_product_sales')
        .select('customer_id, amount, quantity, product_id')
        .range(from, from + pageSize - 1);

      if (salesError) {
        console.error(salesError);
        break;
      }

      (salesPage || []).forEach(row => {
        if (!customerIdsSet.has(row.customer_id)) return; // فقط العملاء المسموح بهم
        if (!salesTotals[row.customer_id]) {
          salesTotals[row.customer_id] = { amount: 0, quantity: 0, products: new Set() };
        }
        salesTotals[row.customer_id].amount += Number(row.amount) || 0;
        salesTotals[row.customer_id].quantity += Number(row.quantity) || 0;
        salesTotals[row.customer_id].products.add(row.product_id);
      });

      keepGoing = (salesPage || []).length === pageSize;
      from += pageSize;
    }

    const merged = (customersData || []).map(c => {
      const totals = salesTotals[c.id] || { amount: 0, quantity: 0, products: new Set() };
      return {
        ...c,
        total_amount: totals.amount,
        total_quantity: totals.quantity,
        sku_count: totals.products.size,
      };
    });

    setCustomers(merged);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = customers;

    if (regionFilter !== 'all') {
      result = result.filter(c => c.region_id === regionFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(c =>
        (c.customer_name || '').toLowerCase().includes(q) ||
        (c.customer_code || '').toLowerCase().includes(q)
      );
    }

    const sorted = [...result];
    switch (sortBy) {
      case 'amount_desc': sorted.sort((a, b) => b.total_amount - a.total_amount); break;
      case 'amount_asc': sorted.sort((a, b) => a.total_amount - b.total_amount); break;
      case 'name': sorted.sort((a, b) => (a.customer_name || '').localeCompare(b.customer_name || '', 'ar')); break;
      case 'sku_desc': sorted.sort((a, b) => b.sku_count - a.sku_count); break;
      default: break;
    }
    return sorted;
  }, [customers, search, regionFilter, sortBy]);

  const totals = useMemo(() => {
    return filtered.reduce((acc, c) => {
      acc.amount += c.total_amount;
      acc.quantity += c.total_quantity;
      return acc;
    }, { amount: 0, quantity: 0 });
  }, [filtered]);

  if (selectedCustomerId) {
    return (
      <CustomerDetails
        customerId={selectedCustomerId}
        onBack={() => setSelectedCustomerId(null)}
      />
    );
  }

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        جاري تحميل العملاء...
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '1.25rem' }}>
        👥 العملاء
      </h1>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">عدد العملاء</div>
          <div className="stat-value">{formatNumber(filtered.length)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">إجمالي المبيعات (يناير - مايو 2026)</div>
          <div className="stat-value">{formatCurrency(totals.amount)} ر.س</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">إجمالي الكمية المباعة</div>
          <div className="stat-value">{formatNumber(totals.quantity)}</div>
        </div>
      </div>

      <div className="card">
        <div className="form-grid" style={{ marginBottom: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">بحث بالاسم أو الكود</label>
            <input
              className="form-input"
              type="text"
              placeholder="اكتب اسم العميل أو الكود..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {!user || user.role === 'admin' || user.role === 'supervisor' ? (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">المنطقة</label>
              <select
                className="form-select"
                value={regionFilter}
                onChange={e => setRegionFilter(e.target.value)}
              >
                <option value="all">كل المناطق المتاحة</option>
                {regions.map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">الترتيب</label>
            <select
              className="form-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="amount_desc">الأعلى مبيعاً</option>
              <option value="amount_asc">الأقل مبيعاً</option>
              <option value="sku_desc">الأكثر تنوع أصناف</option>
              <option value="name">الاسم (أبجدي)</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>الكود</th>
                <th>اسم العميل</th>
                <th>المنطقة</th>
                <th>عدد الأصناف</th>
                <th>الكمية</th>
                <th>إجمالي المبيعات</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    لا يوجد عملاء مطابقين
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <tr
                    key={c.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedCustomerId(c.id)}
                  >
                    <td>{c.customer_code}</td>
                    <td>{c.customer_name}</td>
                    <td>{c.regions?.name || '-'}</td>
                    <td>{formatNumber(c.sku_count)}</td>
                    <td>{formatNumber(c.total_quantity)}</td>
                    <td>{formatCurrency(c.total_amount)} ر.س</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import CustomerDetails from './CustomerDetails';

export default function Customers({ user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [customers, setCustomers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [sortBy, setSortBy] = useState('amount_desc');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    setPage(1);
  }, [customers, search, regionFilter, sortBy]);

  const loadData = async () => {
    setLoading(true);
    setError('');

    // 1. تحديد المناطق المسموح بها حسب الدور (fail closed: أي دور غير admin بدون
    //    معرّف صحيح يرى لا شيء بدل رؤية كل العملاء).
    let regionIds = null; // null = admin/manager يشوفون الكل
    if (user?.role === 'admin' || user?.role === 'manager') {
      regionIds = null;
    } else if (user?.role === 'supervisor') {
      if (user?.supervisor_id) {
        const { data: reps } = await supabase
          .from('representatives')
          .select('region_id')
          .eq('supervisor_id', user.supervisor_id);
        regionIds = [...new Set((reps || []).map(r => r.region_id))];
      } else {
        regionIds = [];
      }
    } else if (user?.role === 'rep') {
      if (user?.rep_id) {
        const { data: rep } = await supabase
          .from('representatives')
          .select('region_id')
          .eq('id', user.rep_id)
          .maybeSingle();
        regionIds = rep ? [rep.region_id] : [];
      } else {
        regionIds = [];
      }
    } else {
      regionIds = []; // unknown role: see nothing
    }

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
      setError('تعذّر تحميل بيانات العملاء. حاول مرة أخرى.');
      setCustomers([]);
      setLoading(false);
      return;
    }

    const customerIds = (customersData || []).map(c => c.id);

    // 4. حساب إجماليات المبيعات لكل عميل.
    //    الأفضل: دالة تجميع على السيرفر (RPC) — تُرجع الإجماليات مباشرة بدل جلب
    //    كل صفوف المبيعات للمتصفح. مع تراجع آمن للحساب على العميل إن لم تكن الدالة
    //    منشورة بعد (BUG-020).
    let totalsById = null;

    const rpc = await supabase.rpc('customer_sales_totals', {
      p_region_ids: regionIds ? regionIds.map(String) : null,
    });
    if (!rpc.error && Array.isArray(rpc.data)) {
      totalsById = {};
      rpc.data.forEach(row => {
        totalsById[String(row.customer_id)] = {
          amount: Number(row.total_amount) || 0,
          quantity: Number(row.total_quantity) || 0,
          skuCount: Number(row.sku_count) || 0,
        };
      });
    } else {
      // Fallback: batched client-side aggregation (previous behavior).
      const salesTotals = {};
      const batchSize = 200;
      const batches = [];
      for (let i = 0; i < customerIds.length; i += batchSize) {
        batches.push(customerIds.slice(i, i + batchSize));
      }
      await Promise.all(batches.map(async (batch) => {
        let from = 0;
        const pageSize = 1000;
        let keepGoing = true;
        while (keepGoing) {
          const { data: salesPage, error: salesError } = await supabase
            .from('customer_product_sales')
            .select('customer_id, amount, quantity, product_id')
            .in('customer_id', batch)
            .range(from, from + pageSize - 1);

          if (salesError) { console.error(salesError); break; }

          (salesPage || []).forEach(row => {
            const key = String(row.customer_id);
            if (!salesTotals[key]) salesTotals[key] = { amount: 0, quantity: 0, products: new Set() };
            salesTotals[key].amount += Number(row.amount) || 0;
            salesTotals[key].quantity += Number(row.quantity) || 0;
            salesTotals[key].products.add(row.product_id);
          });

          keepGoing = (salesPage || []).length === pageSize;
          from += pageSize;
        }
      }));
      totalsById = {};
      Object.entries(salesTotals).forEach(([key, t]) => {
        totalsById[key] = { amount: t.amount, quantity: t.quantity, skuCount: t.products.size };
      });
    }

    const merged = (customersData || []).map(c => {
      const totals = totalsById[String(c.id)] || { amount: 0, quantity: 0, skuCount: 0 };
      return {
        ...c,
        total_amount: totals.amount,
        total_quantity: totals.quantity,
        sku_count: totals.skuCount,
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

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginatedCustomers = filtered.slice((page - 1) * pageSize, page * pageSize);

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

  if (error) {
    return <div className="alert alert-error" style={{ margin: '1rem 0' }}>{error}</div>;
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
          <div className="stat-label">إجمالي المبيعات (كل الفترات)</div>
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
          <table className="responsive-cards">
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
                  <td className="no-label" colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    لا يوجد عملاء مطابقين
                  </td>
                </tr>
              ) : (
                paginatedCustomers.map(c => (
                  <tr
                    key={c.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedCustomerId(c.id)}
                  >
                    <td data-label="الكود">{c.customer_code}</td>
                    <td data-label="اسم العميل">{c.customer_name}</td>
                    <td data-label="المنطقة">{c.regions?.name || '-'}</td>
                    <td data-label="عدد الأصناف">{formatNumber(c.sku_count)}</td>
                    <td data-label="الكمية">{formatNumber(c.total_quantity)}</td>
                    <td data-label="إجمالي المبيعات">{formatCurrency(c.total_amount)} ر.س</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>السابق</button>
            <span style={{ color: 'var(--text-secondary)' }}>صفحة {page} من {totalPages} — ({filtered.length} عميل)</span>
            <button className="btn btn-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>التالي</button>
          </div>
        )}
      </div>
    </div>
  );
}

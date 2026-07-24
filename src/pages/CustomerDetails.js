import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';

export default function CustomerDetails({ customerId, onBack }) {
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('amount_desc');

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const loadData = async () => {
    setLoading(true);

    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id, customer_code, customer_name, region_id, regions(name)')
      .eq('id', customerId)
      .maybeSingle();
    if (customerError) console.error(customerError);
    setCustomer(customerData || null);

    const { data: salesData, error } = await supabase
      .from('customer_product_sales')
      .select('product_id, quantity, amount, products(product_code, product_name, unit)')
      .eq('customer_id', customerId);

    if (error) {
      console.error(error);
      setProducts([]);
      setLoading(false);
      return;
    }

    // تجميع البيانات حسب الصنف (في حالة وجود أكثر من سطر لنفس الصنف)
    const grouped = {};
    (salesData || []).forEach(row => {
      const pid = row.product_id;
      if (!grouped[pid]) {
        grouped[pid] = {
          product_id: pid,
          product_code: row.products?.product_code || '-',
          product_name: row.products?.product_name || 'صنف غير معروف',
          unit: row.products?.unit || '',
          quantity: 0,
          amount: 0,
        };
      }
      grouped[pid].quantity += Number(row.quantity) || 0;
      grouped[pid].amount += Number(row.amount) || 0;
    });

    setProducts(Object.values(grouped));
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let result = products;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(p =>
        (p.product_name || '').toLowerCase().includes(q) ||
        (p.product_code || '').toLowerCase().includes(q)
      );
    }

    const sorted = [...result];
    switch (sortBy) {
      case 'amount_desc': sorted.sort((a, b) => b.amount - a.amount); break;
      case 'amount_asc': sorted.sort((a, b) => a.amount - b.amount); break;
      case 'quantity_desc': sorted.sort((a, b) => b.quantity - a.quantity); break;
      case 'name': sorted.sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '', 'ar')); break;
      default: break;
    }
    return sorted;
  }, [products, search, sortBy]);

  const totals = useMemo(() => {
    return filtered.reduce((acc, p) => {
      acc.amount += p.amount;
      acc.quantity += p.quantity;
      return acc;
    }, { amount: 0, quantity: 0 });
  }, [filtered]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        جاري تحميل تفاصيل العميل...
      </div>
    );
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: '1rem' }} onClick={onBack}>
        ← رجوع إلى قائمة العملاء
      </button>

      <div className="card">
        <div className="card-title">🏪 {customer?.customer_name || 'عميل'}</div>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          <div>الكود: <strong style={{ color: 'var(--text-primary)' }}>{customer?.customer_code}</strong></div>
          <div>المنطقة: <strong style={{ color: 'var(--text-primary)' }}>{customer?.regions?.name || '-'}</strong></div>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">عدد الأصناف المباعة</div>
          <div className="stat-value">{formatNumber(filtered.length)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">إجمالي الكمية</div>
          <div className="stat-value">{formatNumber(totals.quantity)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">إجمالي المبيعات (كل الفترات)</div>
          <div className="stat-value">{formatCurrency(totals.amount)} ر.س</div>
        </div>
      </div>

      <div className="card">
        <div className="form-grid" style={{ marginBottom: '1rem' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">بحث بالصنف أو الكود</label>
            <input
              className="form-input"
              type="text"
              placeholder="اكتب اسم الصنف أو الكود..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">الترتيب</label>
            <select
              className="form-select"
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
            >
              <option value="amount_desc">الأعلى قيمة</option>
              <option value="amount_asc">الأقل قيمة</option>
              <option value="quantity_desc">الأعلى كمية</option>
              <option value="name">الاسم (أبجدي)</option>
            </select>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="responsive-cards">
            <thead>
              <tr>
                <th>كود الصنف</th>
                <th>اسم الصنف</th>
                <th>الوحدة</th>
                <th>الكمية</th>
                <th>القيمة الإجمالية</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td className="no-label" colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    لا توجد أصناف مطابقة
                  </td>
                </tr>
              ) : (
                filtered.map(p => (
                  <tr key={p.product_id}>
                    <td data-label="كود الصنف">{p.product_code}</td>
                    <td data-label="اسم الصنف">{p.product_name}</td>
                    <td data-label="الوحدة">{p.unit}</td>
                    <td data-label="الكمية">{formatNumber(p.quantity)}</td>
                    <td data-label="القيمة الإجمالية">{formatCurrency(p.amount)} ر.س</td>
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

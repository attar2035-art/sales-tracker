import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/helpers';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';

export default function CustomerLoyaltyAnalysis({ baseYear = 2022, comparisonYear = 2023 }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data2022, setData2022] = useState([]);
  const [data2023, setData2023] = useState([]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseYear, comparisonYear]);

  const loadData = async () => {
    setLoading(true);
    setError('');

    const [baseRes, compRes] = await Promise.all([
      supabase.from('customer_yearly_sales')
        .select('id, customer_code, customer_name, net_sales, year').eq('year', baseYear),
      supabase.from('customer_yearly_sales')
        .select('id, customer_code, customer_name, net_sales, year').eq('year', comparisonYear),
    ]);

    if (baseRes.error || compRes.error) {
      console.error(baseRes.error || compRes.error);
      setError('تعذّر تحميل بيانات المقارنة. حاول مرة أخرى.');
      setData2022([]);
      setData2023([]);
      setLoading(false);
      return;
    }

    setData2022((baseRes.data || []).map(c => ({ ...c, yearly_sales: Number(c.net_sales) || 0 })));
    setData2023((compRes.data || []).map(c => ({ ...c, yearly_sales: Number(c.net_sales) || 0 })));
    setLoading(false);
  };

  const analysis = useMemo(() => {
    if (data2022.length === 0 || data2023.length === 0) return null;

    // إنشاء map للمقارنة
    const map2022 = {};
    data2022.forEach(c => {
      map2022[c.customer_code] = c;
    });

    const map2023 = {};
    data2023.forEach(c => {
      map2023[c.customer_code] = c;
    });

    // تحليل الولاء
    const loyal = []; // موجود في 2022 و 2023
    const lost = []; // موجود في 2022 لكن ليس في 2023
    const new_customers = []; // جديد في 2023
    let growth_data = [];

    // العملاء الموالون والنمو
    Object.keys(map2022).forEach(code => {
      if (map2023[code]) {
        const change = map2023[code].yearly_sales - map2022[code].yearly_sales;
        const changePercent = map2022[code].yearly_sales > 0
          ? ((change / map2022[code].yearly_sales) * 100)
          : 0;
        loyal.push({
          code,
          name: map2022[code].customer_name,
          sales_2022: map2022[code].yearly_sales,
          sales_2023: map2023[code].yearly_sales,
          change,
          changePercent,
          status: change > 0 ? 'نمو' : change < 0 ? 'انخفاض' : 'ثابت'
        });
      } else {
        lost.push({
          code,
          name: map2022[code].customer_name,
          sales_2022: map2022[code].yearly_sales,
          sales_2023: 0
        });
      }
    });

    // العملاء الجدد
    Object.keys(map2023).forEach(code => {
      if (!map2022[code]) {
        new_customers.push({
          code,
          name: map2023[code].customer_name,
          sales_2023: map2023[code].yearly_sales
        });
      }
    });

    // حساب الإحصائيات
    const loyalSales2022 = loyal.reduce((sum, c) => sum + c.sales_2022, 0);
    const loyalSales2023 = loyal.reduce((sum, c) => sum + c.sales_2023, 0);
    const lostSales = lost.reduce((sum, c) => sum + c.sales_2022, 0);
    const newSales = new_customers.reduce((sum, c) => sum + c.sales_2023, 0);

    const growingCount = loyal.filter(c => c.change > 0).length;
    const decliningCount = loyal.filter(c => c.change < 0).length;
    const stableCount = loyal.filter(c => c.change === 0).length;

    // بيانات الرسم البياني — مفاتيح ديناميكية حسب السنوات المختارة
    growth_data = [
      {
        category: 'عملاء موالون',
        [`سنة ${baseYear}`]: Math.round(loyalSales2022),
        [`سنة ${comparisonYear}`]: Math.round(loyalSales2023)
      }
    ];

    return {
      loyal: loyal.sort((a, b) => b.change - a.change),
      lost,
      new: new_customers,
      stats: {
        loyalCount: loyal.length,
        loyalPercentage: ((loyal.length / data2022.length) * 100).toFixed(1),
        growingCount,
        decliningCount,
        stableCount,
        lostCount: lost.length,
        lostPercentage: ((lost.length / data2022.length) * 100).toFixed(1),
        lostSales,
        newCount: new_customers.length,
        newSales,
        loyalSales2022,
        loyalSales2023,
        loyalGrowth: loyalSales2022 > 0
          ? ((loyalSales2023 - loyalSales2022) / loyalSales2022 * 100).toFixed(1)
          : '0.0'
      },
      growth_data
    };
  }, [data2022, data2023, baseYear, comparisonYear]);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        جاري تحميل البيانات...
      </div>
    );
  }

  if (error) {
    return <div className="alert alert-error" style={{ margin: '1rem 0' }}>{error}</div>;
  }

  if (!analysis) {
    return <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
      لا توجد بيانات مقارنة بين {baseYear} و {comparisonYear}
    </div>;
  }

  const { loyal, lost, new: newCustomers, stats, growth_data } = analysis;

  return (
    <div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        💫 تحليل ولاء العملاء ({baseYear} → {comparisonYear})
      </h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">العملاء الموالون</div>
          <div className="stat-value">{stats.loyalCount} عميل</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {stats.loyalPercentage}% من العملاء الأساسيين
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">العملاء المفقودون</div>
          <div className="stat-value">{stats.lostCount} عميل</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {stats.lostPercentage}% من العملاء | {formatCurrency(stats.lostSales)} ر.س
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">العملاء الجدد</div>
          <div className="stat-value">{stats.newCount} عميل</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {formatCurrency(stats.newSales)} ر.س
          </div>
        </div>
      </div>

      {/* رسم بياني النمو */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>مقارنة المبيعات - العملاء الموالون</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={growth_data} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="category" />
            <YAxis />
            <Tooltip formatter={(value) => formatCurrency(value)} />
            <Legend />
            <Bar dataKey={`سنة ${baseYear}`} fill="#3b82f6" />
            <Bar dataKey={`سنة ${comparisonYear}`} fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ملخص الولاء */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
        <div className="card" style={{ backgroundColor: '#dcfce7', borderRight: '4px solid #10b981' }}>
          <div style={{ fontWeight: 600, color: '#166534', fontSize: '0.9rem' }}>📈 نمو إيجابي</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#15803d', marginTop: '0.5rem' }}>
            {stats.growingCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#047857', marginTop: '0.25rem' }}>
            عميل في نمو مستمر
          </div>
        </div>

        <div className="card" style={{ backgroundColor: '#fef3c7', borderRight: '4px solid #f59e0b' }}>
          <div style={{ fontWeight: 600, color: '#78350f', fontSize: '0.9rem' }}>📉 انخفاض</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b45309', marginTop: '0.5rem' }}>
            {stats.decliningCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#92400e', marginTop: '0.25rem' }}>
            عميل شهد انخفاضاً
          </div>
        </div>

        <div className="card" style={{ backgroundColor: '#f3f4f6', borderRight: '4px solid #6b7280' }}>
          <div style={{ fontWeight: 600, color: '#374151', fontSize: '0.9rem' }}>➡️ ثابت</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#4b5563', marginTop: '0.5rem' }}>
            {stats.stableCount}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '0.25rem' }}>
            عميل ثابت المبيعات
          </div>
        </div>
      </div>

      {/* الجداول */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* العملاء الموالون */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>العملاء الموالون ({loyal.length})</h3>
          <div className="table-wrapper" style={{ maxHeight: '400px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>الكود</th>
                  <th>اسم العميل</th>
                  <th>مبيعات {baseYear}</th>
                  <th>مبيعات {comparisonYear}</th>
                  <th>التغير</th>
                  <th>النسبة %</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {loyal.slice(0, 20).map((c, idx) => (
                  <tr key={idx}>
                    <td>{c.code}</td>
                    <td>{c.name}</td>
                    <td>{formatCurrency(c.sales_2022)} ر.س</td>
                    <td>{formatCurrency(c.sales_2023)} ر.س</td>
                    <td style={{ color: c.change > 0 ? '#10b981' : c.change < 0 ? '#ef4444' : '#6b7280' }}>
                      {c.change > 0 ? '+' : ''}{formatCurrency(c.change)} ر.س
                    </td>
                    <td style={{ color: c.changePercent > 0 ? '#10b981' : c.changePercent < 0 ? '#ef4444' : '#6b7280' }}>
                      {c.changePercent > 0 ? '+' : ''}{c.changePercent.toFixed(1)}%
                    </td>
                    <td>
                      <span style={{
                        padding: '0.25rem 0.5rem',
                        borderRadius: '0.25rem',
                        backgroundColor: c.status === 'نمو' ? '#dcfce7' : c.status === 'انخفاض' ? '#fee2e2' : '#f3f4f6',
                        color: c.status === 'نمو' ? '#166534' : c.status === 'انخفاض' ? '#7f1d1d' : '#374151',
                        fontSize: '0.8rem',
                        fontWeight: 600
                      }}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {loyal.length > 20 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              عرض 20 من {loyal.length} عميل
            </div>
          )}
        </div>

        {/* العملاء المفقودون */}
        {lost.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>⚠️ العملاء المفقودون ({lost.length})</h3>
            <div className="table-wrapper" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>الكود</th>
                    <th>اسم العميل</th>
                    <th>آخر مبيعات ({baseYear})</th>
                  </tr>
                </thead>
                <tbody>
                  {lost.slice(0, 15).map((c, idx) => (
                    <tr key={idx} style={{ opacity: 0.7 }}>
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{formatCurrency(c.sales_2022)} ر.س</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* العملاء الجدد */}
        {newCustomers.length > 0 && (
          <div className="card">
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>✨ العملاء الجدد ({newCustomers.length})</h3>
            <div className="table-wrapper" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>الكود</th>
                    <th>اسم العميل</th>
                    <th>مبيعات {comparisonYear}</th>
                  </tr>
                </thead>
                <tbody>
                  {newCustomers.slice(0, 15).map((c, idx) => (
                    <tr key={idx} style={{ backgroundColor: '#f0fdf4' }}>
                      <td>{c.code}</td>
                      <td>{c.name}</td>
                      <td>{formatCurrency(c.sales_2023)} ر.س</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

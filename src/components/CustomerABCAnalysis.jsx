import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import { classifyByCumulativeSales, ABC_BOUNDARIES } from '../lib/analytics';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

export default function CustomerABCAnalysis({ year = 2022 }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState([]);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const loadData = async () => {
    setLoading(true);
    setError('');
    const { data: customersData, error: loadError } = await supabase
      .from('customer_yearly_sales')
      .select('customer_code, customer_name, net_sales, year')
      .eq('year', year)
      .order('net_sales', { ascending: false });

    if (loadError) {
      console.error(loadError);
      setError('تعذّر تحميل البيانات. حاول مرة أخرى.');
      setData([]); // clear stale data so a failed fetch doesn't show the previous year
      setLoading(false);
      return;
    }

    setData((customersData || []).map(c => ({
      ...c,
      yearly_sales: Number(c.net_sales) || 0,
    })));
    setLoading(false);
  };

  const analysis = useMemo(() => {
    if (data.length === 0) return null;

    const totalSales = data.reduce((sum, c) => sum + (Number(c.yearly_sales) || 0), 0);
    if (totalSales <= 0) return null;

    // Canonical cumulative-sales ABC (shared with the segmentation grading — BUG-022).
    const classified = classifyByCumulativeSales(data, { valueKey: 'yearly_sales', boundaries: ABC_BOUNDARIES })
      .map(c => ({ ...c, category: c.grade, percentage: c.cumulativePercent }));

    // حساب الإحصائيات
    const categories = { A: [], B: [], C: [] };
    classified.forEach(c => {
      categories[c.category].push(c);
    });

    return {
      total: totalSales,
      customers: classified,
      categories,
      summary: {
        A: {
          count: categories.A.length,
          sales: categories.A.reduce((sum, c) => sum + c.yearly_sales, 0),
          percentage: ((categories.A.reduce((sum, c) => sum + c.yearly_sales, 0) / totalSales) * 100).toFixed(1),
        },
        B: {
          count: categories.B.length,
          sales: categories.B.reduce((sum, c) => sum + c.yearly_sales, 0),
          percentage: ((categories.B.reduce((sum, c) => sum + c.yearly_sales, 0) / totalSales) * 100).toFixed(1),
        },
        C: {
          count: categories.C.length,
          sales: categories.C.reduce((sum, c) => sum + c.yearly_sales, 0),
          percentage: ((categories.C.reduce((sum, c) => sum + c.yearly_sales, 0) / totalSales) * 100).toFixed(1),
        },
      }
    };
  }, [data]);

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
    return <div>لا توجد بيانات</div>;
  }

  const chartData = [
    { name: 'فئة A (أساسيون)', value: analysis.summary.A.count, sales: analysis.summary.A.sales },
    { name: 'فئة B (مهمون)', value: analysis.summary.B.count, sales: analysis.summary.B.sales },
    { name: 'فئة C (هامشيون)', value: analysis.summary.C.count, sales: analysis.summary.C.sales },
  ];

  const COLORS = ['#10b981', '#f59e0b', '#ef4444'];

  return (
    <div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        📊 تحليل ABC - تصنيف العملاء (سنة {year})
      </h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">إجمالي المبيعات</div>
          <div className="stat-value">{formatCurrency(analysis.total)} ر.س</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">إجمالي العملاء</div>
          <div className="stat-value">{formatNumber(data.length)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">متوسط المبيعات</div>
          <div className="stat-value">{formatCurrency(analysis.total / data.length)} ر.س</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: '1.5rem', marginTop: '1.5rem' }}>
        {/* الرسم البياني */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>توزيع العملاء</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, value }) => `${name}: ${value}`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value} عميل`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* الملخص */}
        <div className="card">
          <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>ملخص التصنيفات</h3>
          
          <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#ecfdf5', borderRight: '4px solid #10b981' }}>
            <div style={{ fontWeight: 600, color: '#065f46' }}>فئة A (العملاء الأساسيون)</div>
            <div style={{ fontSize: '0.9rem', color: '#047857', marginTop: '0.25rem' }}>
              {analysis.summary.A.count} عميل | {formatCurrency(analysis.summary.A.sales)} ر.س | {analysis.summary.A.percentage}%
            </div>
          </div>

          <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: '#fffbeb', borderRight: '4px solid #f59e0b' }}>
            <div style={{ fontWeight: 600, color: '#78350f' }}>فئة B (العملاء المهمون)</div>
            <div style={{ fontSize: '0.9rem', color: '#b45309', marginTop: '0.25rem' }}>
              {analysis.summary.B.count} عميل | {formatCurrency(analysis.summary.B.sales)} ر.س | {analysis.summary.B.percentage}%
            </div>
          </div>

          <div style={{ padding: '0.75rem', backgroundColor: '#fef2f2', borderRight: '4px solid #ef4444' }}>
            <div style={{ fontWeight: 600, color: '#7f1d1d' }}>فئة C (العملاء الهامشيون)</div>
            <div style={{ fontSize: '0.9rem', color: '#dc2626', marginTop: '0.25rem' }}>
              {analysis.summary.C.count} عميل | {formatCurrency(analysis.summary.C.sales)} ر.س | {analysis.summary.C.percentage}%
            </div>
          </div>
        </div>
      </div>

      {/* جدول التفاصيل */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>تفاصيل العملاء</h3>
        <div className="table-wrapper" style={{ maxHeight: '500px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>الفئة</th>
                <th>الكود</th>
                <th>اسم العميل</th>
                <th>المبيعات</th>
                <th>النسبة المئوية المجمعة</th>
              </tr>
            </thead>
            <tbody>
              {analysis.customers.slice(0, 200).map((c, idx) => (
                <tr key={idx}>
                  <td>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '0.25rem',
                      backgroundColor: c.category === 'A' ? '#dcfce7' : c.category === 'B' ? '#fef3c7' : '#fee2e2',
                      color: c.category === 'A' ? '#166534' : c.category === 'B' ? '#92400e' : '#991b1b',
                      fontWeight: 600,
                      fontSize: '0.85rem'
                    }}>
                      فئة {c.category}
                    </span>
                  </td>
                  <td>{c.customer_code}</td>
                  <td>{c.customer_name}</td>
                  <td>{formatCurrency(c.yearly_sales)} ر.س</td>
                  <td>{c.percentage.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {analysis.customers.length > 200 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              عرض أول 200 من {formatNumber(analysis.customers.length)} عميل
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

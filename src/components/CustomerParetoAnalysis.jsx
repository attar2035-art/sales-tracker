import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/helpers';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Bar, Line } from 'recharts';

export default function CustomerParetoAnalysis({ year = 2022 }) {
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
      setData([]); // clear stale data so we don't show the previous year's numbers
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

    const sorted = [...data].sort((a, b) => b.yearly_sales - a.yearly_sales);
    const totalSales = sorted.reduce((sum, c) => sum + c.yearly_sales, 0);
    if (totalSales <= 0) return null;

    let cumulative = 0;
    let count80 = 0;
    let customersFor80 = [];
    let chartData = [];

    for (let i = 0; i < sorted.length; i++) {
      cumulative += sorted[i].yearly_sales;
      const percentage = (cumulative / totalSales) * 100;
      
      if (percentage <= 80) {
        customersFor80.push(sorted[i]);
      }
      
      if (percentage <= 100) {
        chartData.push({
          index: i + 1,
          name: (sorted[i].customer_name || '—').substring(0, 15),
          sales: sorted[i].yearly_sales,
          cumulative: percentage
        });
      }
    }

    count80 = customersFor80.length;
    const percentage80 = ((count80 / sorted.length) * 100).toFixed(1);
    const sales80 = customersFor80.reduce((sum, c) => sum + c.yearly_sales, 0);

    return {
      total: totalSales,
      customers: sorted,
      count80,
      percentage80,
      sales80,
      customersFor80,
      chartData: chartData.slice(0, 50) // أول 50 عميل للرسم
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

  return (
    <div>
      <h2 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '1.5rem' }}>
        📈 قاعدة باريتو - 80/20 (سنة {year})
      </h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">العملاء المسؤولون عن 80% من المبيعات</div>
          <div className="stat-value">{analysis.count80} عميل</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {analysis.percentage80}% من إجمالي العملاء
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">قيمة المبيعات من هؤلاء العملاء</div>
          <div className="stat-value">{formatCurrency(analysis.sales80)} ر.س</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            80% من الإجمالي ({formatCurrency(analysis.total)} ر.س)
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">العملاء المتبقيون</div>
          <div className="stat-value">{analysis.customers.length - analysis.count80} عميل</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
            {((analysis.customers.length - analysis.count80) / analysis.customers.length * 100).toFixed(1)}% من العملاء
          </div>
        </div>
      </div>

      {/* رسم بياني المراكمة */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>منحنى باريتو (أول 50 عميل)</h3>
        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart data={analysis.chartData} margin={{ top: 20, right: 30, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis 
              dataKey="index" 
              angle={-45}
              textAnchor="end"
              height={100}
              tick={{ fontSize: 12 }}
            />
            <YAxis yAxisId="left" label={{ value: 'المبيعات (ر.س)', angle: -90, position: 'insideLeft' }} />
            <YAxis yAxisId="right" orientation="right" label={{ value: 'النسبة المراكمة (%)', angle: 90, position: 'insideRight' }} />
            <Tooltip 
              contentStyle={{ backgroundColor: 'rgba(0,0,0,0.8)', color: '#fff', borderRadius: '0.5rem' }}
              formatter={(value, name) => name === 'sales' ? [formatCurrency(value), 'المبيعات'] : [value.toFixed(1) + '%', 'النسبة المراكمة']}
            />
            <Bar yAxisId="left" dataKey="sales" fill="#3b82f6" name="المبيعات" />
            <Line 
              yAxisId="right" 
              type="monotone" 
              dataKey="cumulative" 
              stroke="#ef4444" 
              name="النسبة المراكمة"
              isAnimationActive={false}
            />
            <Legend />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* الجدول */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>العملاء الـ 80 في المائة</h3>
        <div className="table-wrapper" style={{ maxHeight: '400px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>الكود</th>
                <th>اسم العميل</th>
                <th>المبيعات</th>
                <th>النسبة من الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {analysis.customersFor80.slice(0, 200).map((c, idx) => (
                <tr key={idx}>
                  <td>{idx + 1}</td>
                  <td>{c.customer_code}</td>
                  <td>{c.customer_name}</td>
                  <td>{formatCurrency(c.yearly_sales)} ر.س</td>
                  <td>{((c.yearly_sales / analysis.total) * 100).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {analysis.customersFor80.length > 200 && (
            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              عرض أول 200 من {analysis.customersFor80.length} عميل
            </div>
          )}
        </div>
      </div>

      {/* التوصيات */}
      <div className="card" style={{ marginTop: '1.5rem', backgroundColor: '#f0fdf4', borderRight: '4px solid #10b981' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600, color: '#166534' }}>💡 التوصيات</h3>
        <ul style={{ margin: 0, paddingRight: '1.5rem', color: '#15803d' }}>
          <li>ركز على الـ {analysis.count80} عميل الأساسيين (يمثلون 80% من المبيعات)</li>
          <li>وسّع من العملاء المتبقيين لتقليل الاعتماد على عدد محدود من العملاء</li>
          <li>استثمر في تطوير علاقات أقوى مع عملاء فئة A</li>
          <li>ركز على جودة الخدمة والحفاظ على هؤلاء العملاء</li>
        </ul>
      </div>
    </div>
  );
}

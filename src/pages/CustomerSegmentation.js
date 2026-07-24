import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency, formatNumber } from '../lib/helpers';
import * as XLSX from 'xlsx';

const YEARS = [2022, 2023, 2024, 2025, 2026];

function classifyABCD(customers) {
  if (!customers.length) return [];
  const sorted = [...customers].sort((a, b) => b.net_sales - a.net_sales);
  const total = sorted.length;
  return sorted.map((c, i) => {
    const pct = (i + 1) / total;
    let grade;
    if (pct <= 0.2) grade = 'A';
    else if (pct <= 0.5) grade = 'B';
    else if (pct <= 0.8) grade = 'C';
    else grade = 'D';
    return { ...c, grade };
  });
}

const GRADE_COLORS = { A: '#10b981', B: '#3b82f6', C: '#f59e0b', D: '#ef4444' };
const GRADE_LABELS = { A: 'عملاء ممتازون', B: 'عملاء جيدون', C: 'عملاء متوسطون', D: 'عملاء ضعفاء' };

export default function CustomerSegmentation() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importYear, setImportYear] = useState(2022);
  const [importPreview, setImportPreview] = useState(null);
  const [importMsg, setImportMsg] = useState('');
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedRegion, setSelectedRegion] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');
  const [tableError, setTableError] = useState(false);
  const [importProgress, setImportProgress] = useState('');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    const { data: rows, error } = await supabase
      .from('customer_yearly_sales')
      .select('*')
      .limit(50000);
    if (error) {
      console.error(error);
      setTableError(true);
      setData([]);
      setLoading(false);
      return;
    }
    setData(rows || []);
    setTableError(false);
    setLoading(false);
  };

  const runImport = async () => {
    // Non-destructive & idempotent: upsert on (customer_code, year, region_name).
    // Existing rows are updated in place; nothing is deleted. Re-running is safe.
    const confirmed = window.confirm(
      'سيتم تحديث/إضافة بيانات العملاء المحضرة (بدون حذف أي بيانات موجودة). '
      + 'السجلات المطابقة (نفس رقم العميل/السنة/المنطقة) سيتم تحديثها. هل تريد المتابعة؟'
    );
    if (!confirmed) return;

    setImporting(true);
    setImportProgress('جاري تحميل البيانات...');
    try {
      const mod = await import('../data/customers_import.json');
      const jsonData = mod.default || mod;

      // Upsert in batches — no delete step, so a mid-run failure never loses data.
      setImportProgress('جاري تحديث/إدخال ' + jsonData.length + ' سجل...');
      const batch = 200;
      let imported = 0;
      let errors = 0;
      let lastError = '';
      for (let i = 0; i < jsonData.length; i += batch) {
        const chunk = jsonData.slice(i, i + batch);
        const { error } = await supabase
          .from('customer_yearly_sales')
          .upsert(chunk, { onConflict: 'customer_code,year,region_name' });
        if (error) {
          console.error('Batch error:', error);
          errors++;
          lastError = error.message;
        } else {
          imported += chunk.length;
        }
        setImportProgress('تم تحديث/إدخال ' + imported + ' من ' + jsonData.length + (errors > 0 ? ' (' + errors + ' أخطاء: ' + lastError + ')' : ''));
      }
      if (errors > 0 && imported === 0) {
        setImportProgress('خطأ في الاستيراد: ' + lastError);
      } else {
        setImportProgress('اكتمل! تم تحديث/استيراد ' + imported + ' سجل' + (errors > 0 ? ' (مع ' + errors + ' دفعات بها أخطاء: ' + lastError + ')' : ''));
      }
      await fetchData();
    } catch (e) {
      setImportProgress('خطأ: ' + e.message);
    }
    setImporting(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportMsg('');
    const reader = new FileReader();
    reader.onload = (evt) => {
      const wb = XLSX.read(evt.target.result, { type: 'array' });
      const allRows = [];
      wb.SheetNames.forEach(sheetName => {
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws);
        rows.forEach(row => {
          const code = String(row['رقم العميل'] || '').trim();
          if (!code) return;
          allRows.push({
            customer_code: code,
            customer_name: String(row['اسم العميل'] || '').trim(),
            region_name: sheetName.trim(),
            year: importYear,
            net_sales: parseFloat(row['صافي المبيعات']) || 0,
            collected: parseFloat(row['المبلغ المحصل']) || 0,
            aging_0_30: parseFloat(row['0 - 30'] || row['0-30']) || 0,
            aging_31_60: parseFloat(row['31 - 60'] || row['31-60']) || 0,
            aging_61_90: parseFloat(row['61 - 90'] || row['61-90']) || 0,
            aging_91_120: parseFloat(row['91 - 120'] || row['91-120']) || 0,
            aging_120_plus: parseFloat(row['> 120'] || row['>120']) || 0,
            debt_age: String(row['عمر الدين'] || row['عمر الدين '] || '').trim(),
            monthly_avg_collection: parseFloat(row['المتوسط الشهري للتحصيل'] || row['المتوسط الشهري للتحصيل ']) || 0,
          });
        });
      });
      setImportPreview({ sheets: wb.SheetNames.length, total: allRows.length, rows: allRows });
    };
    reader.readAsArrayBuffer(file);
  };

  const doImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    setImportMsg('');
    const batch = 500;
    let imported = 0;
    for (let i = 0; i < importPreview.rows.length; i += batch) {
      const chunk = importPreview.rows.slice(i, i + batch);
      const { error } = await supabase.from('customer_yearly_sales')
        .upsert(chunk, { onConflict: 'customer_code,year,region_name' });
      if (error) {
        setImportMsg('خطأ: ' + error.message);
        setImporting(false);
        return;
      }
      imported += chunk.length;
    }
    setImportMsg(`تم استيراد ${imported} عميل لسنة ${importYear} بنجاح`);
    setImportPreview(null);
    setImporting(false);
    fetchData();
  };

  const regions = useMemo(() => {
    return [...new Set(data.map(d => d.region_name))].sort();
  }, [data]);

  const availableYears = useMemo(() => {
    return [...new Set(data.map(d => d.year))].sort();
  }, [data]);

  const yearData = useMemo(() => {
    let filtered = data.filter(d => d.year === selectedYear);
    if (selectedRegion !== 'all') filtered = filtered.filter(d => d.region_name === selectedRegion);
    return classifyABCD(filtered);
  }, [data, selectedYear, selectedRegion]);

  const gradeStats = useMemo(() => {
    const stats = {};
    ['A', 'B', 'C', 'D'].forEach(g => {
      const items = yearData.filter(d => d.grade === g);
      stats[g] = {
        count: items.length,
        totalSales: items.reduce((a, c) => a + c.net_sales, 0),
        totalCollected: items.reduce((a, c) => a + c.collected, 0),
        pctCount: yearData.length > 0 ? Math.round((items.length / yearData.length) * 100) : 0,
      };
    });
    const grandTotal = yearData.reduce((a, c) => a + c.net_sales, 0);
    ['A', 'B', 'C', 'D'].forEach(g => {
      stats[g].pctSales = grandTotal > 0 ? Math.round((stats[g].totalSales / grandTotal) * 100) : 0;
    });
    return stats;
  }, [yearData]);

  const yearComparison = useMemo(() => {
    const byCode = {};
    data.forEach(d => {
      if (selectedRegion !== 'all' && d.region_name !== selectedRegion) return;
      if (!byCode[d.customer_code]) byCode[d.customer_code] = { name: d.customer_name, region: d.region_name, years: {} };
      byCode[d.customer_code].years[d.year] = (byCode[d.customer_code].years[d.year] || 0) + (d.net_sales || 0);
    });
    return byCode;
  }, [data, selectedRegion]);

  const activityStats = useMemo(() => {
    const codes = Object.entries(yearComparison);
    const curYear = selectedYear;
    const prevYear = curYear - 1;
    const active = codes.filter(([, v]) => (v.years[curYear] || 0) > 0);
    const churned = codes.filter(([, v]) => !(v.years[curYear] > 0) && Object.values(v.years).some(s => s > 0));
    const growing = codes.filter(([, v]) => (v.years[curYear] || 0) > 0 && (v.years[prevYear] || 0) > 0 && v.years[curYear] > v.years[prevYear]);
    const declining = codes.filter(([, v]) => (v.years[curYear] || 0) > 0 && (v.years[prevYear] || 0) > 0 && v.years[curYear] < v.years[prevYear]);
    const newCustomers = codes.filter(([, v]) => (v.years[curYear] || 0) > 0 && !(v.years[prevYear] > 0));
    return { active: active.length, churned: churned.length, growing: growing.length, declining: declining.length, newCustomers: newCustomers.length, total: codes.length };
  }, [yearComparison, selectedYear]);

  const regionStats = useMemo(() => {
    const byRegion = {};
    yearData.forEach(d => {
      if (!byRegion[d.region_name]) byRegion[d.region_name] = { customers: 0, sales: 0, collected: 0, grades: { A: 0, B: 0, C: 0, D: 0 } };
      byRegion[d.region_name].customers++;
      byRegion[d.region_name].sales += d.net_sales;
      byRegion[d.region_name].collected += d.collected;
      byRegion[d.region_name].grades[d.grade]++;
    });
    return Object.entries(byRegion).sort((a, b) => b[1].sales - a[1].sales);
  }, [yearData]);

  const yearlySummary = useMemo(() => {
    return availableYears.map(y => {
      let items = data.filter(d => d.year === y);
      if (selectedRegion !== 'all') items = items.filter(d => d.region_name === selectedRegion);
      return {
        year: y,
        customers: items.length,
        sales: items.reduce((a, c) => a + c.net_sales, 0),
        collected: items.reduce((a, c) => a + c.collected, 0),
      };
    });
  }, [data, availableYears, selectedRegion]);

  const frequencyStats = useMemo(() => {
    const codes = Object.entries(yearComparison);
    const totalYears = availableYears.length;
    const frequent = codes.filter(([, v]) => Object.keys(v.years).filter(y => v.years[y] > 0).length >= totalYears * 0.8);
    const regular = codes.filter(([, v]) => {
      const active = Object.keys(v.years).filter(y => v.years[y] > 0).length;
      return active >= totalYears * 0.5 && active < totalYears * 0.8;
    });
    const occasional = codes.filter(([, v]) => {
      const active = Object.keys(v.years).filter(y => v.years[y] > 0).length;
      return active >= 2 && active < totalYears * 0.5;
    });
    const rare = codes.filter(([, v]) => Object.keys(v.years).filter(y => v.years[y] > 0).length === 1);
    return { frequent: frequent.length, regular: regular.length, occasional: occasional.length, rare: rare.length };
  }, [yearComparison, availableYears]);

  const topGrowing = useMemo(() => {
    const curYear = selectedYear;
    const prevYear = curYear - 1;
    return Object.entries(yearComparison)
      .filter(([, v]) => (v.years[curYear] || 0) > 0 && (v.years[prevYear] || 0) > 0)
      .map(([code, v]) => ({
        code, name: v.name, region: v.region,
        current: v.years[curYear], previous: v.years[prevYear],
        growth: ((v.years[curYear] - v.years[prevYear]) / v.years[prevYear]) * 100,
      }))
      .sort((a, b) => b.growth - a.growth)
      .slice(0, 10);
  }, [yearComparison, selectedYear]);

  const topChurned = useMemo(() => {
    const curYear = selectedYear;
    return Object.entries(yearComparison)
      .filter(([, v]) => !(v.years[curYear] > 0) && Object.values(v.years).some(s => s > 0))
      .map(([code, v]) => {
        const lastYear = Math.max(...Object.keys(v.years).filter(y => v.years[y] > 0).map(Number));
        return { code, name: v.name, region: v.region, lastSales: v.years[lastYear], lastYear };
      })
      .sort((a, b) => b.lastSales - a.lastSales)
      .slice(0, 10);
  }, [yearComparison, selectedYear]);

  if (tableError) {
    return (
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '1rem' }}>📊 تقسيم العملاء</h1>
        <div className="card" style={{ padding: '2rem' }}>
          <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: '1rem', fontSize: '1.1rem' }}>
            الجدول غير موجود في قاعدة البيانات
          </div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            يجب إنشاء جدول <code>customer_yearly_sales</code> أولاً. انسخ الكود التالي والصقه في
            <strong> Supabase SQL Editor</strong>:
          </p>
          <pre style={{ background: '#0f172a', padding: '1rem', borderRadius: 8, fontSize: '0.8rem', overflowX: 'auto', color: '#e2e8f0', direction: 'ltr', textAlign: 'left' }}>{`CREATE TABLE IF NOT EXISTS customer_yearly_sales (
  id BIGSERIAL PRIMARY KEY,
  customer_code TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  region_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  net_sales DECIMAL DEFAULT 0,
  collected DECIMAL DEFAULT 0,
  aging_0_30 DECIMAL DEFAULT 0,
  aging_31_60 DECIMAL DEFAULT 0,
  aging_61_90 DECIMAL DEFAULT 0,
  aging_91_120 DECIMAL DEFAULT 0,
  aging_120_plus DECIMAL DEFAULT 0,
  debt_age TEXT,
  monthly_avg_collection DECIMAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_code, year, region_name)
);

DO $$
BEGIN
  ALTER TABLE customer_yearly_sales
    DROP CONSTRAINT IF EXISTS customer_yearly_sales_customer_code_year_key;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customer_yearly_sales_customer_code_year_region_name_key'
  ) THEN
    ALTER TABLE customer_yearly_sales
      ADD CONSTRAINT customer_yearly_sales_customer_code_year_region_name_key
      UNIQUE (customer_code, year, region_name);
  END IF;
END $$;

ALTER TABLE customer_yearly_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated full access"
  ON customer_yearly_sales FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');`}</pre>
          <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={fetchData}>
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📊 تقسيم العملاء</h1>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="form-select" style={{ width: 'auto' }} value={selectedRegion} onChange={e => setSelectedRegion(e.target.value)}>
            <option value="all">كل المناطق</option>
            {regions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select className="form-select" style={{ width: 'auto' }} value={selectedYear} onChange={e => setSelectedYear(+e.target.value)}>
            {(availableYears.length > 0 ? availableYears : YEARS).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: '1rem' }}>
        <button className={`tab ${activeTab === 'overview' ? 'active' : ''}`} onClick={() => setActiveTab('overview')}>نظرة عامة</button>
        <button className={`tab ${activeTab === 'abcd' ? 'active' : ''}`} onClick={() => setActiveTab('abcd')}>تصنيف A/B/C/D</button>
        <button className={`tab ${activeTab === 'yearly' ? 'active' : ''}`} onClick={() => setActiveTab('yearly')}>مقارنة سنوية</button>
        <button className={`tab ${activeTab === 'regions' ? 'active' : ''}`} onClick={() => setActiveTab('regions')}>المناطق</button>
        <button className={`tab ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>استيراد البيانات</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <>
              {data.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
                  <div style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>لا توجد بيانات بعد</div>
                  <button className="btn btn-primary" style={{ maxWidth: 300, margin: '0 auto', fontSize: '1.1rem', padding: '0.75rem 2rem' }} onClick={runImport} disabled={importing}>
                    {importing ? 'جاري الاستيراد...' : '📥 استيراد البيانات (10,348 عميل)'}
                  </button>
                  {importProgress && (
                    <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1e293b', borderRadius: 8, color: importProgress.includes('خطأ') ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                      {importProgress}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="stats-grid" style={{ marginBottom: '1rem' }}>
                    <div className="stat-card" style={{ borderRight: '4px solid #3b82f6' }}>
                      <div className="stat-label">عدد العملاء ({selectedYear})</div>
                      <div className="stat-value">{formatNumber(yearData.length)}</div>
                    </div>
                    <div className="stat-card" style={{ borderRight: '4px solid #10b981' }}>
                      <div className="stat-label">إجمالي المسحوبات ({selectedYear})</div>
                      <div className="stat-value">{formatCurrency(yearData.reduce((a, c) => a + c.net_sales, 0))}</div>
                    </div>
                    <div className="stat-card" style={{ borderRight: '4px solid #f59e0b' }}>
                      <div className="stat-label">إجمالي المحصل ({selectedYear})</div>
                      <div className="stat-value">{formatCurrency(yearData.reduce((a, c) => a + c.collected, 0))}</div>
                    </div>
                  </div>

                  {availableYears.length > 1 && (
                    <>
                      <div className="card" style={{ marginBottom: '1rem' }}>
                        <div className="card-title">📈 حالة العملاء ({selectedYear} مقارنة بـ {selectedYear - 1})</div>
                        <div className="stats-grid">
                          <div className="stat-card" style={{ borderRight: '4px solid #10b981' }}>
                            <div className="stat-label">نشط</div>
                            <div className="stat-value" style={{ color: '#10b981' }}>{formatNumber(activityStats.active)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #ef4444' }}>
                            <div className="stat-label">متوقف</div>
                            <div className="stat-value" style={{ color: '#ef4444' }}>{formatNumber(activityStats.churned)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #3b82f6' }}>
                            <div className="stat-label">صاعد</div>
                            <div className="stat-value" style={{ color: '#3b82f6' }}>{formatNumber(activityStats.growing)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #f59e0b' }}>
                            <div className="stat-label">متراجع</div>
                            <div className="stat-value" style={{ color: '#f59e0b' }}>{formatNumber(activityStats.declining)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #8b5cf6' }}>
                            <div className="stat-label">جديد</div>
                            <div className="stat-value" style={{ color: '#8b5cf6' }}>{formatNumber(activityStats.newCustomers)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="card" style={{ marginBottom: '1rem' }}>
                        <div className="card-title">🔄 تكرار الشراء (عبر السنوات)</div>
                        <div className="stats-grid">
                          <div className="stat-card" style={{ borderRight: '4px solid #10b981' }}>
                            <div className="stat-label">دائم (80%+ من السنوات)</div>
                            <div className="stat-value" style={{ color: '#10b981' }}>{formatNumber(frequencyStats.frequent)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #3b82f6' }}>
                            <div className="stat-label">منتظم (50-80%)</div>
                            <div className="stat-value" style={{ color: '#3b82f6' }}>{formatNumber(frequencyStats.regular)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #f59e0b' }}>
                            <div className="stat-label">متقطع (سنتين+)</div>
                            <div className="stat-value" style={{ color: '#f59e0b' }}>{formatNumber(frequencyStats.occasional)}</div>
                          </div>
                          <div className="stat-card" style={{ borderRight: '4px solid #ef4444' }}>
                            <div className="stat-label">نادر (سنة واحدة)</div>
                            <div className="stat-value" style={{ color: '#ef4444' }}>{formatNumber(frequencyStats.rare)}</div>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {activeTab === 'abcd' && (
            <>
              <div className="stats-grid" style={{ marginBottom: '1rem' }}>
                {['A', 'B', 'C', 'D'].map(g => (
                  <div key={g} className="stat-card" style={{ borderRight: `4px solid ${GRADE_COLORS[g]}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className="stat-label">{GRADE_LABELS[g]}</div>
                        <div className="stat-value" style={{ color: GRADE_COLORS[g] }}>{formatNumber(gradeStats[g]?.count || 0)}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{gradeStats[g]?.pctCount}% من العملاء</div>
                      </div>
                      <div style={{ textAlign: 'left' }}>
                        <div style={{ fontSize: '1.5rem', fontWeight: 800, color: GRADE_COLORS[g] }}>{g}</div>
                      </div>
                    </div>
                    <div style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                      <div>المبيعات: {formatCurrency(gradeStats[g]?.totalSales || 0)} ({gradeStats[g]?.pctSales}%)</div>
                      <div>المحصل: {formatCurrency(gradeStats[g]?.totalCollected || 0)}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="card-title">تفاصيل العملاء — {selectedYear}</div>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>التصنيف</th><th>الكود</th><th>اسم العميل</th><th>المنطقة</th>
                        <th>صافي المبيعات</th><th>المحصل</th><th>عمر الدين</th>
                      </tr>
                    </thead>
                    <tbody>
                      {yearData.slice(0, 100).map(c => (
                        <tr key={c.customer_code}>
                          <td><span style={{ fontWeight: 800, fontSize: '1.1rem', color: GRADE_COLORS[c.grade] }}>{c.grade}</span></td>
                          <td>{c.customer_code}</td>
                          <td>{c.customer_name}</td>
                          <td>{c.region_name}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(c.net_sales)}</td>
                          <td>{formatCurrency(c.collected)}</td>
                          <td>{c.debt_age || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {yearData.length > 100 && (
                  <div style={{ textAlign: 'center', padding: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    يعرض أول 100 عميل من أصل {yearData.length}
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'yearly' && (
            <>
              <div className="card" style={{ marginBottom: '1rem' }}>
                <div className="card-title">📅 ملخص سنوي</div>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr><th>السنة</th><th>عدد العملاء</th><th>إجمالي المبيعات</th><th>المحصل</th><th>النمو</th></tr>
                    </thead>
                    <tbody>
                      {yearlySummary.map((y, i) => {
                        const prev = i > 0 ? yearlySummary[i - 1].sales : null;
                        const growth = prev ? Math.round(((y.sales - prev) / prev) * 100) : null;
                        return (
                          <tr key={y.year} style={{ background: y.year === selectedYear ? '#1e293b' : '' }}>
                            <td style={{ fontWeight: 700 }}>{y.year}</td>
                            <td>{formatNumber(y.customers)}</td>
                            <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(y.sales)}</td>
                            <td>{formatCurrency(y.collected)}</td>
                            <td style={{ color: growth > 0 ? '#10b981' : growth < 0 ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>
                              {growth !== null ? `${growth > 0 ? '+' : ''}${growth}%` : '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {topGrowing.length > 0 && (
                <div className="card" style={{ marginBottom: '1rem' }}>
                  <div className="card-title">📈 أكثر 10 عملاء نمواً</div>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr><th>العميل</th><th>المنطقة</th><th>السنة السابقة</th><th>السنة الحالية</th><th>النمو</th></tr>
                      </thead>
                      <tbody>
                        {topGrowing.map(c => (
                          <tr key={c.code}>
                            <td>{c.name}</td>
                            <td>{c.region}</td>
                            <td>{formatCurrency(c.previous)}</td>
                            <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(c.current)}</td>
                            <td style={{ color: '#10b981', fontWeight: 700 }}>+{Math.round(c.growth)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {topChurned.length > 0 && (
                <div className="card">
                  <div className="card-title">⚠️ أبرز العملاء المتوقفون</div>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr><th>العميل</th><th>المنطقة</th><th>آخر مبيعات</th><th>آخر سنة نشطة</th></tr>
                      </thead>
                      <tbody>
                        {topChurned.map(c => (
                          <tr key={c.code}>
                            <td>{c.name}</td>
                            <td>{c.region}</td>
                            <td style={{ color: '#ef4444' }}>{formatCurrency(c.lastSales)}</td>
                            <td>{c.lastYear}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'regions' && (
            <div className="card">
              <div className="card-title">🗺️ أداء المناطق — {selectedYear}</div>
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>المنطقة</th><th>العملاء</th><th>المبيعات</th><th>المحصل</th>
                      <th>A</th><th>B</th><th>C</th><th>D</th><th>نسبة التحصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regionStats.map(([name, s]) => {
                      const colPct = s.sales > 0 ? Math.round((s.collected / s.sales) * 100) : 0;
                      return (
                        <tr key={name}>
                          <td style={{ fontWeight: 700 }}>{name}</td>
                          <td>{formatNumber(s.customers)}</td>
                          <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(s.sales)}</td>
                          <td>{formatCurrency(s.collected)}</td>
                          <td style={{ color: GRADE_COLORS.A }}>{s.grades.A}</td>
                          <td style={{ color: GRADE_COLORS.B }}>{s.grades.B}</td>
                          <td style={{ color: GRADE_COLORS.C }}>{s.grades.C}</td>
                          <td style={{ color: GRADE_COLORS.D }}>{s.grades.D}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontWeight: 700, color: colPct >= 80 ? '#10b981' : colPct >= 60 ? '#f59e0b' : '#ef4444' }}>{colPct}%</span>
                              <div className="progress-bar" style={{ flex: 1, minWidth: 60 }}>
                                <div className="progress-fill" style={{ width: `${Math.min(100, colPct)}%`, background: colPct >= 80 ? '#10b981' : colPct >= 60 ? '#f59e0b' : '#ef4444' }} />
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="card" style={{ padding: '2rem' }}>
              <div className="card-title">📥 استيراد بيانات العملاء</div>

              <div style={{ marginBottom: '2rem', padding: '1.5rem', background: '#0f172a', borderRadius: 12, border: '2px solid #3b82f6', textAlign: 'center' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: '0.75rem', fontSize: '1.1rem' }}>
                  استيراد جميع البيانات المحضرة (10,348 عميل — 2022 إلى 2026)
                </div>
                <button className="btn btn-primary" style={{ fontSize: '1.1rem', padding: '0.75rem 2rem' }} onClick={runImport} disabled={importing}>
                  {importing ? 'جاري الاستيراد...' : '📥 استيراد الكل الآن'}
                </button>
                {importProgress && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: '#1e293b', borderRadius: 8, color: importProgress.includes('خطأ') ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                    {importProgress}
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid #334155', paddingTop: '1.5rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem' }}>أو ارفع ملف إكسل يدوياً:</div>
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
                ارفع ملف إكسل لكل سنة. الملف يجب أن يحتوي على شيتات بأسماء المناطق.
              </p>

              {availableYears.length > 0 && (
                <div style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#1e293b', borderRadius: 8 }}>
                  <span style={{ color: '#10b981', fontWeight: 700 }}>البيانات المحملة: </span>
                  {availableYears.map(y => (
                    <span key={y} className="badge badge-success" style={{ marginInlineEnd: '0.5rem' }}>{y}</span>
                  ))}
                  <span style={{ color: 'var(--text-muted)' }}> — إجمالي {formatNumber(data.length)} سجل</span>
                </div>
              )}

              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">اختر السنة</label>
                  <select className="form-select" value={importYear} onChange={e => setImportYear(+e.target.value)}>
                    {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">ملف الإكسل</label>
                  <input type="file" accept=".xlsx,.xls" className="form-input" onChange={handleFileUpload} />
                </div>
              </div>

              {importPreview && (
                <div style={{ marginTop: '1rem', padding: '1rem', background: '#1e293b', borderRadius: 8 }}>
                  <div style={{ marginBottom: '0.75rem' }}>
                    <span style={{ fontWeight: 700 }}>معاينة: </span>
                    {importPreview.sheets} منطقة — {formatNumber(importPreview.total)} عميل — سنة {importYear}
                  </div>
                  <button className="btn btn-primary" onClick={doImport} disabled={importing}>
                    {importing ? 'جاري الاستيراد...' : `استيراد ${formatNumber(importPreview.total)} عميل`}
                  </button>
                </div>
              )}

              {importMsg && (
                <div style={{ marginTop: '1rem', padding: '0.75rem 1rem', borderRadius: 8, background: importMsg.startsWith('خطأ') ? '#450a0a' : '#064e3b', color: importMsg.startsWith('خطأ') ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                  {importMsg}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import CustomerABCAnalysis from './CustomerABCAnalysis';
import CustomerParetoAnalysis from './CustomerParetoAnalysis';
import CustomerLoyaltyAnalysis from './CustomerLoyaltyAnalysis';

const YEARS = [2022, 2023, 2024, 2025, 2026];

export default function CustomerAnalytics() {
  const [activeTab, setActiveTab] = useState('abc'); // abc, pareto, loyalty
  const [selectedYear, setSelectedYear] = useState(2025);

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '1.25rem' }}>
        📊 تحليل العملاء والولاء
      </h1>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          {/* اختيار السنة */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">اختر السنة</label>
            <select
              className="form-select"
              value={selectedYear}
              onChange={e => setSelectedYear(parseInt(e.target.value))}
            >
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={() => setActiveTab('abc')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === 'abc' ? 600 : 400,
              color: activeTab === 'abc' ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: activeTab === 'abc' ? '2px solid var(--primary)' : 'none',
              fontSize: '1rem'
            }}
          >
            📊 تحليل ABC
          </button>
          <button
            onClick={() => setActiveTab('pareto')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === 'pareto' ? 600 : 400,
              color: activeTab === 'pareto' ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: activeTab === 'pareto' ? '2px solid var(--primary)' : 'none',
              fontSize: '1rem'
            }}
          >
            📈 قاعدة باريتو
          </button>
          <button
            onClick={() => setActiveTab('loyalty')}
            style={{
              padding: '0.75rem 1.5rem',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === 'loyalty' ? 600 : 400,
              color: activeTab === 'loyalty' ? 'var(--primary)' : 'var(--text-muted)',
              borderBottom: activeTab === 'loyalty' ? '2px solid var(--primary)' : 'none',
              fontSize: '1rem'
            }}
          >
            💫 تحليل الولاء
          </button>
        </div>

        {/* محتوى الـ Tabs */}
        {activeTab === 'abc' && <CustomerABCAnalysis year={selectedYear} />}
        {activeTab === 'pareto' && <CustomerParetoAnalysis year={selectedYear} />}
        {/* Compare the selected year against the PREVIOUS year (always has prior
            data), instead of a non-existent next year. */}
        {activeTab === 'loyalty' && <CustomerLoyaltyAnalysis baseYear={selectedYear - 1} comparisonYear={selectedYear} />}
      </div>

      {/* معلومات إضافية */}
      <div className="card" style={{ backgroundColor: '#f9fafb', borderRight: '4px solid #3b82f6' }}>
        <h3 style={{ marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>ℹ️ شرح التحليلات</h3>
        
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>📊 تحليل ABC</div>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', lineHeight: '1.5' }}>
            تصنيف العملاء إلى ثلاث فئات:
            <ul style={{ margin: '0.5rem 0 0 1.5rem', paddingLeft: 0 }}>
              <li><strong>فئة A:</strong> العملاء الأساسيون (الأعلى قيمة)</li>
              <li><strong>فئة B:</strong> العملاء المهمون</li>
              <li><strong>فئة C:</strong> العملاء الهامشيون</li>
            </ul>
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>📈 قاعدة باريتو</div>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', lineHeight: '1.5' }}>
            تحدد عدد العملاء المسؤولين عن 80% من المبيعات. القاعدة تنص على أن 20% من العملاء يسهمون بـ 80% من الإيرادات.
          </div>
        </div>

        <div>
          <div style={{ fontWeight: 600, color: '#1f2937', marginBottom: '0.5rem' }}>💫 تحليل الولاء</div>
          <div style={{ fontSize: '0.9rem', color: '#6b7280', lineHeight: '1.5' }}>
            يوضح العملاء الموالين والمستمرين، والعملاء المفقودين، والعملاء الجدد، ومعدل النمو لكل عميل بين سنتين متتاليتين.
          </div>
        </div>
      </div>
    </div>
  );
}

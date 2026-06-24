import React, { useState } from 'react';
import { isWorkingDay } from '../lib/helpers';

const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export default function DateAvailabilityChecker() {
  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [result, setResult] = useState(null);

  const handleCheck = (dateStr) => {
    setSelectedDate(dateStr);
    if (!dateStr) { setResult(null); return; }
    const date = new Date(dateStr);
    const dayName = DAY_NAMES_AR[date.getDay()];
    const available = isWorkingDay(date);
    const formatted = date.toLocaleDateString('ar-SA-u-ca-gregory', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    setResult({ dayName, available, formatted });
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: '2rem',
          left: '2rem',
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: open ? '#2563eb' : '#3b82f6',
          color: 'white',
          border: 'none',
          fontSize: '1.5rem',
          cursor: 'pointer',
          boxShadow: '0 4px 20px rgba(59,130,246,0.4)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s',
        }}
        title="التحقق من توفر يوم"
      >
        {open ? '✕' : '📅'}
      </button>

      {open && (
        <div style={{
          position: 'fixed',
          bottom: '6rem',
          left: '2rem',
          width: 320,
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: 16,
          padding: '1.5rem',
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          direction: 'rtl',
          fontFamily: 'Cairo, sans-serif',
        }}>
          <div style={{
            fontSize: '1rem',
            fontWeight: 700,
            color: '#f1f5f9',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}>
            📅 التحقق من توفر يوم
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{
              display: 'block',
              fontSize: '0.85rem',
              fontWeight: 600,
              color: '#94a3b8',
              marginBottom: '0.5rem',
            }}>
              اختر التاريخ
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => handleCheck(e.target.value)}
              style={{
                width: '100%',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 8,
                padding: '0.625rem 0.875rem',
                color: '#f1f5f9',
                fontFamily: 'Cairo, sans-serif',
                fontSize: '0.9rem',
                direction: 'rtl',
              }}
            />
          </div>

          {result && (
            <div style={{
              background: result.available ? '#064e3b' : '#450a0a',
              border: `1px solid ${result.available ? '#065f46' : '#7f1d1d'}`,
              borderRadius: 12,
              padding: '1.25rem',
              textAlign: 'center',
            }}>
              <div style={{
                fontSize: '2.5rem',
                marginBottom: '0.5rem',
              }}>
                {result.available ? '✅' : '🚫'}
              </div>
              <div style={{
                fontSize: '1.1rem',
                fontWeight: 800,
                color: result.available ? '#10b981' : '#ef4444',
                marginBottom: '0.5rem',
              }}>
                {result.available ? 'يوم متاح' : 'يوم إجازة (الجمعة)'}
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: '#94a3b8',
                marginBottom: '0.25rem',
              }}>
                {result.dayName}
              </div>
              <div style={{
                fontSize: '0.85rem',
                color: '#64748b',
              }}>
                {result.formatted}
              </div>
            </div>
          )}

          {!result && (
            <div style={{
              textAlign: 'center',
              padding: '1.5rem 0',
              color: '#64748b',
              fontSize: '0.85rem',
            }}>
              اختر تاريخ للتحقق من توفره
            </div>
          )}
        </div>
      )}
    </>
  );
}

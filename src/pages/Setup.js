import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

export default function Setup() {
  const [tab, setTab] = useState('regions');
  const [regions, setRegions] = useState([]);
  const [supervisors, setSupervisors] = useState([]);
  const [reps, setReps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [regionName, setRegionName] = useState('');
  const [supName, setSupName] = useState('');
  const [supRegion, setSupRegion] = useState('');
  const [repName, setRepName] = useState('');
  const [repSup, setRepSup] = useState('');
  const [repRegion, setRepRegion] = useState('');

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [r, s, rp] = await Promise.all([
      supabase.from('regions').select('*').order('name'),
      supabase.from('supervisors').select('*, regions(name)').order('name'),
      supabase.from('representatives').select('*, supervisors(name), regions(name)').order('name'),
    ]);
    if (r.data) setRegions(r.data);
    if (s.data) setSupervisors(s.data);
    if (rp.data) setReps(rp.data);
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const addRegion = async () => {
    if (!regionName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('regions').insert({ name: regionName.trim() });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else { showMsg('تم إضافة المنطقة'); setRegionName(''); fetchAll(); }
    setLoading(false);
  };

  const addSupervisor = async () => {
    if (!supName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('supervisors').insert({ name: supName.trim(), region_id: supRegion || null });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else { showMsg('تم إضافة المشرف'); setSupName(''); setSupRegion(''); fetchAll(); }
    setLoading(false);
  };

  const addRep = async () => {
    if (!repName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('representatives').insert({
      name: repName.trim(),
      supervisor_id: repSup || null,
      region_id: repRegion || null,
    });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else { showMsg('تم إضافة المندوب'); setRepName(''); setRepSup(''); setRepRegion(''); fetchAll(); }
    setLoading(false);
  };

  const deleteItem = async (table, id) => {
    if (!window.confirm('هل أنت متأكد من الحذف؟')) return;
    await supabase.from(table).delete().eq('id', id);
    fetchAll();
  };

  const toggleRepActive = async (rep) => {
    await supabase.from('representatives').update({ is_active: !rep.is_active }).eq('id', rep.id);
    fetchAll();
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">⚙️ الإعدادات</h1>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      <div className="tabs">
        {[['regions','🗺️ المناطق'], ['supervisors','👔 المشرفون'], ['reps','👤 المندوبون']].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'regions' && (
        <div>
          <div className="card">
            <div className="card-title">➕ إضافة منطقة</div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">اسم المنطقة</label>
                <input className="form-input" value={regionName} onChange={e => setRegionName(e.target.value)}
                  placeholder="مثال: الرياض" onKeyDown={e => e.key === 'Enter' && addRegion()} />
              </div>
              <button className="btn btn-primary" onClick={addRegion} disabled={loading}>إضافة</button>
            </div>
          </div>
          <div className="card">
            <div className="card-title">قائمة المناطق ({regions.length})</div>
            {regions.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">🗺️</div><div className="empty-state-text">لا توجد مناطق بعد</div></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>#</th><th>اسم المنطقة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {regions.map((r, i) => (
                      <tr key={r.id}><td>{i + 1}</td><td>{r.name}</td>
                        <td><button className="btn btn-danger btn-sm" onClick={() => deleteItem('regions', r.id)}>حذف</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'supervisors' && (
        <div>
          <div className="card">
            <div className="card-title">➕ إضافة مشرف</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">اسم المشرف</label>
                <input className="form-input" value={supName} onChange={e => setSupName(e.target.value)} placeholder="الاسم الكامل" />
              </div>
              <div className="form-group">
                <label className="form-label">المنطقة</label>
                <select className="form-select" value={supRegion} onChange={e => setSupRegion(e.target.value)}>
                  <option value="">-- اختر منطقة --</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={addSupervisor} disabled={loading}>إضافة المشرف</button>
          </div>
          <div className="card">
            <div className="card-title">قائمة المشرفين ({supervisors.length})</div>
            {supervisors.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">👔</div><div className="empty-state-text">لا يوجد مشرفون بعد</div></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>#</th><th>الاسم</th><th>المنطقة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {supervisors.map((s, i) => (
                      <tr key={s.id}><td>{i + 1}</td><td>{s.name}</td><td>{s.regions?.name || '-'}</td>
                        <td><button className="btn btn-danger btn-sm" onClick={() => deleteItem('supervisors', s.id)}>حذف</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'reps' && (
        <div>
          <div className="card">
            <div className="card-title">➕ إضافة مندوب</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">اسم المندوب</label>
                <input className="form-input" value={repName} onChange={e => setRepName(e.target.value)} placeholder="الاسم الكامل" />
              </div>
              <div className="form-group">
                <label className="form-label">المشرف</label>
                <select className="form-select" value={repSup} onChange={e => setRepSup(e.target.value)}>
                  <option value="">-- اختر مشرف --</option>
                  {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">المنطقة</label>
                <select className="form-select" value={repRegion} onChange={e => setRepRegion(e.target.value)}>
                  <option value="">-- اختر منطقة --</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={addRep} disabled={loading}>إضافة المندوب</button>
          </div>
          <div className="card">
            <div className="card-title">قائمة المندوبين ({reps.length})</div>
            {reps.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">👤</div><div className="empty-state-text">لا يوجد مندوبون بعد</div></div>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>#</th><th>الاسم</th><th>المشرف</th><th>المنطقة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {reps.map((r, i) => (
                      <tr key={r.id}>
                        <td>{i + 1}</td><td>{r.name}</td>
                        <td>{r.supervisors?.name || '-'}</td>
                        <td>{r.regions?.name || '-'}</td>
                        <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'نشط' : 'غير نشط'}</span></td>
                        <td style={{ display: 'flex', gap: '0.5rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleRepActive(r)}>{r.is_active ? 'تعطيل' : 'تفعيل'}</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteItem('representatives', r.id)}>حذف</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

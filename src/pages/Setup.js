import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { createRepLoginAccount } from '../lib/auth';
import { buildEffectiveTargetsMap, TARGET_FIELDS } from '../lib/targets';
import { logAuditEvent } from '../lib/audit';

const ACHIEVEMENT_FIELD_BY_TARGET = {
  target_sales: 'daily_sales',
  target_collection: 'daily_collection',
  target_new_customers: 'new_customers',
  target_new_customers_value: 'new_customers_value',
  target_total_visits: 'total_visits',
  target_successful_visits: 'successful_visits',
  target_new_products_skus: 'new_products_skus',
  target_new_products_qty: 'new_products_qty',
  target_working_hours: 'working_hours',
  target_km: 'km',
  overdue_total: 'overdue_collected',
};

const getLocalDateParts = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, date };
};

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
  const [editingRep, setEditingRep] = useState(null);
  const [editRepName, setEditRepName] = useState('');
  const [editRepSup, setEditRepSup] = useState('');
  const [editRepRegion, setEditRepRegion] = useState('');
  const [accountRep, setAccountRep] = useState('');
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');

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

  const generateTempPassword = () => {
    const randomPart = Math.random().toString(36).slice(2, 8).toUpperCase();
    setAccountPassword(`Hwf-${randomPart}-${new Date().getFullYear()}`);
  };

  const addRegion = async () => {
    if (!regionName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('regions').insert({ name: regionName.trim() });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: 'create', pageKey: 'setup', entityType: 'regions', details: { name: regionName.trim() } });
      showMsg('تم إضافة المنطقة'); setRegionName(''); fetchAll();
    }
    setLoading(false);
  };

  const addSupervisor = async () => {
    if (!supName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('supervisors').insert({ name: supName.trim(), region_id: supRegion || null });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: 'create', pageKey: 'setup', entityType: 'supervisors', details: { name: supName.trim(), region_id: supRegion || null } });
      showMsg('تم إضافة المشرف'); setSupName(''); setSupRegion(''); fetchAll();
    }
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
    else {
      await logAuditEvent({ eventType: 'create', pageKey: 'setup', entityType: 'representatives', details: { name: repName.trim(), supervisor_id: repSup || null, region_id: repRegion || null } });
      showMsg('تم إضافة المندوب'); setRepName(''); setRepSup(''); setRepRegion(''); fetchAll();
    }
    setLoading(false);
  };

  const deleteItem = async (table, id) => {
    if (!window.confirm('هل أنت متأكد من الحذف؟')) return;
    await supabase.from(table).delete().eq('id', id);
    await logAuditEvent({ eventType: 'delete', pageKey: 'setup', entityType: table, entityId: id, details: { table } });
    fetchAll();
  };

  const toggleRepActive = async (rep) => {
    await supabase.from('representatives').update({ is_active: !rep.is_active }).eq('id', rep.id);
    await logAuditEvent({
      eventType: 'status_change',
      pageKey: 'setup',
      entityType: 'representatives',
      entityId: rep.id,
      details: { name: rep.name, from: rep.is_active ? 'نشط' : 'غير نشط', to: !rep.is_active ? 'نشط' : 'غير نشط' },
    });
    fetchAll();
  };

  const startEditRep = (rep) => {
    setEditingRep(rep);
    setEditRepName(rep.name || '');
    setEditRepSup(rep.supervisor_id || '');
    setEditRepRegion(rep.region_id || '');
  };

  const cancelEditRep = () => {
    setEditingRep(null);
    setEditRepName('');
    setEditRepSup('');
    setEditRepRegion('');
  };

  const saveRepEdit = async () => {
    if (!editingRep || !editRepName.trim()) return;
    setLoading(true);
    const { error } = await supabase.from('representatives').update({
      name: editRepName.trim(),
      supervisor_id: editRepSup || null,
      region_id: editRepRegion || null,
    }).eq('id', editingRep.id);
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({
        eventType: 'update',
        pageKey: 'setup',
        entityType: 'representatives',
        entityId: editingRep.id,
        details: { from: editingRep.name, to: editRepName.trim(), supervisor_id: editRepSup || null, region_id: editRepRegion || null },
      });
      showMsg('تم تعديل بيانات المندوب'); cancelEditRep(); fetchAll();
    }
    setLoading(false);
  };

  const startAccountForRep = (rep) => {
    setTab('accounts');
    setAccountRep(rep.id);
    setAccountEmail('');
    if (!accountPassword) generateTempPassword();
  };

  const createRepAccount = async () => {
    if (!accountRep) { showMsg('اختر المندوب أولاً', 'error'); return; }
    if (!accountEmail.trim()) { showMsg('أدخل إيميل المندوب', 'error'); return; }
    if (!accountPassword || accountPassword.length < 6) { showMsg('كلمة السر المؤقتة يجب أن تكون 6 أحرف على الأقل', 'error'); return; }

    setLoading(true);
    const { data, error } = await createRepLoginAccount({
      email: accountEmail,
      password: accountPassword,
      repId: accountRep,
    });
    if (error) showMsg('خطأ في إنشاء الحساب: ' + error.message, 'error');
    else {
      const rep = reps.find(item => item.id === accountRep);
      await logAuditEvent({
        eventType: 'account_create',
        pageKey: 'setup',
        entityType: 'representatives',
        entityId: accountRep,
        details: { name: rep?.name || '', email: accountEmail.trim().toLowerCase() },
      });
      const successText = data?.mode === 'linked_existing'
        ? 'الإيميل كان موجودًا بالفعل، وتم ربطه بالمندوب وتحديث كلمة السر المؤقتة.'
        : 'تم إنشاء حساب دخول المندوب. أعطه كلمة السر المؤقتة وسيغيرها عند أول دخول.';
      showMsg(successText);
      setAccountRep('');
      setAccountEmail('');
      setAccountPassword('');
    }
    setLoading(false);
  };

  const handoverRep = async () => {
    if (!editingRep || !editRepName.trim()) return;
    if (!window.confirm('سيتم إنشاء مندوب جديد وتعطيل الحالي مع تقسيم هدف الشهر: المحقق للقديم والمتبقي للجديد. هل تريد المتابعة؟')) return;
    setLoading(true);
    const { year, month, date } = getLocalDateParts();

    const [targetsResult, entriesResult] = await Promise.all([
      supabase.from('monthly_targets').select('*').eq('rep_id', editingRep.id).limit(10000),
      supabase.from('daily_entries').select('*')
        .eq('rep_id', editingRep.id)
        .eq('year', year)
        .eq('month', month)
        .lte('entry_date', date)
        .limit(10000),
    ]);

    if (targetsResult.error || entriesResult.error) {
      showMsg('خطأ في قراءة بيانات التسليم: ' + (targetsResult.error?.message || entriesResult.error?.message), 'error');
      setLoading(false);
      return;
    }

    const targetMap = buildEffectiveTargetsMap(targetsResult.data || [], year, month);
    const currentTarget = targetMap[editingRep.id] || null;
    const entries = entriesResult.data || [];
    const achieved = TARGET_FIELDS.reduce((acc, field) => {
      const entryField = ACHIEVEMENT_FIELD_BY_TARGET[field];
      acc[field] = entries.reduce((sum, entry) => sum + (parseFloat(entry[entryField]) || 0), 0);
      return acc;
    }, {});

    const { data: newRep, error: insertError } = await supabase.from('representatives').insert({
      name: editRepName.trim(),
      supervisor_id: editRepSup || null,
      region_id: editRepRegion || null,
      is_active: true,
    }).select('id').single();
    if (insertError) {
      showMsg('خطأ: ' + insertError.message, 'error');
      setLoading(false);
      return;
    }

    if (currentTarget) {
      const oldTargetPayload = { rep_id: editingRep.id, year, month };
      const newTargetPayload = { rep_id: newRep.id, year, month };
      TARGET_FIELDS.forEach(field => {
        const total = parseFloat(currentTarget[field]) || 0;
        const oldShare = Math.min(parseFloat(achieved[field]) || 0, total);
        oldTargetPayload[field] = oldShare;
        newTargetPayload[field] = Math.max(0, total - oldShare);
      });

      const { error: targetError } = await supabase.from('monthly_targets')
        .upsert([oldTargetPayload, newTargetPayload], { onConflict: 'rep_id,year,month' });

      if (targetError) {
        await supabase.from('representatives').delete().eq('id', newRep.id);
        showMsg('لم يتم التسليم بسبب خطأ في تقسيم الأهداف: ' + targetError.message, 'error');
        setLoading(false);
        return;
      }
    }

    const { error: updateError } = await supabase.from('representatives')
      .update({ is_active: false })
      .eq('id', editingRep.id);
    if (updateError) showMsg('تم إنشاء المندوب الجديد لكن حدث خطأ في تعطيل القديم: ' + updateError.message, 'error');
    else {
      await logAuditEvent({
        eventType: 'handover',
        pageKey: 'setup',
        entityType: 'representatives',
        entityId: editingRep.id,
        details: { from: editingRep.name, to: editRepName.trim(), new_rep_id: newRep.id },
      });
      showMsg(currentTarget ? 'تم التسليم وتقسيم هدف الشهر على القديم والجديد' : 'تم التسليم بدون تقسيم أهداف لعدم وجود هدف سابق'); cancelEditRep(); fetchAll();
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">⚙️ الإعدادات</h1>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      <div className="tabs">
        {[['regions','🗺️ المناطق'], ['supervisors','👔 المشرفون'], ['reps','👤 المندوبون'], ['accounts','🔐 حسابات الدخول']].map(([k, label]) => (
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
                  <option value="">بدون مشرف</option>
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
          {editingRep && (
            <div className="card">
              <div className="card-title">تعديل / تسليم المندوب: {editingRep.name}</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">اسم المندوب</label>
                  <input className="form-input" value={editRepName} onChange={e => setEditRepName(e.target.value)} placeholder="اسم المندوب" />
                </div>
                <div className="form-group">
                  <label className="form-label">المشرف</label>
                  <select className="form-select" value={editRepSup} onChange={e => setEditRepSup(e.target.value)}>
                    <option value="">بدون مشرف</option>
                    {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">المنطقة</label>
                  <select className="form-select" value={editRepRegion} onChange={e => setEditRepRegion(e.target.value)}>
                    <option value="">-- اختر منطقة --</option>
                    {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={saveRepEdit} disabled={loading}>حفظ تعديل نفس المندوب</button>
                <button className="btn btn-success" onClick={handoverRep} disabled={loading}>تسليم لمندوب جديد</button>
                <button className="btn btn-ghost" onClick={cancelEditRep} disabled={loading}>إلغاء</button>
              </div>
              <div style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                خيار التسليم يبقي بيانات القديم باسمه، وينشئ مندوبًا جديدًا، ويقسم هدف الشهر الحالي: المحقق للقديم والمتبقي للجديد.
              </div>
            </div>
          )}
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
                        <td>{r.supervisors?.name || 'بدون مشرف'}</td>
                        <td>{r.regions?.name || '-'}</td>
                        <td><span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'نشط' : 'غير نشط'}</span></td>
                        <td style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => startEditRep(r)}>تعديل</button>
                          <button className="btn btn-success btn-sm" onClick={() => startAccountForRep(r)}>حساب دخول</button>
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
      {tab === 'accounts' && (
        <div>
          <div className="card">
            <div className="card-title">🔐 إنشاء حساب دخول لمندوب</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">المندوب</label>
                <select className="form-select" value={accountRep} onChange={e => setAccountRep(e.target.value)}>
                  <option value="">-- اختر المندوب --</option>
                  {reps.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.name} — {r.regions?.name || 'بدون منطقة'}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">إيميل الدخول</label>
                <input className="form-input" type="email" value={accountEmail}
                  onChange={e => setAccountEmail(e.target.value)}
                  placeholder="rep@hawafel.com" />
              </div>
              <div className="form-group">
                <label className="form-label">كلمة السر المؤقتة</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input className="form-input" type="text" value={accountPassword}
                    onChange={e => setAccountPassword(e.target.value)}
                    placeholder="كلمة سر مؤقتة" />
                  <button className="btn btn-ghost" type="button" onClick={generateTempPassword}>توليد</button>
                </div>
              </div>
            </div>
            <button className="btn btn-primary" onClick={createRepAccount} disabled={loading}>
              {loading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب وربطه بالمندوب'}
            </button>
            <div style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.7 }}>
              بعد الإنشاء أعطِ المندوب الإيميل وكلمة السر المؤقتة. عند أول دخول سيجبره النظام على تغيير كلمة السر قبل عرض صفحته.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

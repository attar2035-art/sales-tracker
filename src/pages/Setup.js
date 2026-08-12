import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { createRepLoginAccount, createManagerLoginAccount } from '../lib/auth';
import { buildEffectiveTargetsMap, TARGET_FIELDS } from '../lib/targets';
import { importRoutePlan, WEEKDAYS } from '../lib/visits';
import { logAuditEvent } from '../lib/audit';

// Accepted Arabic weekday spellings normalised to the canonical WEEKDAYS list.
const DAY_ALIASES = {
  'السبت': 'السبت', 'الأحد': 'الأحد', 'الاحد': 'الأحد',
  'الاثنين': 'الاثنين', 'الإثنين': 'الاثنين', 'الأثنين': 'الاثنين',
  'الثلاثاء': 'الثلاثاء', 'الثلاثا': 'الثلاثاء',
  'الأربعاء': 'الأربعاء', 'الاربعاء': 'الأربعاء',
  'الخميس': 'الخميس', 'الجمعة': 'الجمعة', 'الجمعه': 'الجمعة',
};

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

const MANAGER_TYPE_LABELS = {
  sales_manager: 'مدير المبيعات',
  company_manager: 'مدير الشركة',
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
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  // Route-plan sheet import
  const [routeMsg, setRouteMsg] = useState('');
  const [routePreview, setRoutePreview] = useState(null);
  const [routeImporting, setRouteImporting] = useState(false);
  const routeFileRef = useRef(null);
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
  const [managerName, setManagerName] = useState('');
  const [managerEmail, setManagerEmail] = useState('');
  const [managerType, setManagerType] = useState('sales_manager');
  const [accountManager, setAccountManager] = useState(null);
  const [errors, setErrors] = useState({});
  const containerRef = useRef(null);

  // Auto-advance: Enter (or the phone keyboard's "next") moves focus to the
  // next enabled, visible field within the page's forms.
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    const root = containerRef.current;
    if (!root) return;
    const f = Array.from(
      root.querySelectorAll('input:not([disabled]), select:not([disabled])')
    ).filter(el => el.type !== 'hidden' && el.offsetParent !== null);
    const i = f.indexOf(e.target);
    if (i > -1 && i < f.length - 1) { e.preventDefault(); f[i + 1].focus(); }
  };

  const errCls = (base, key) => `${base}${errors[key] ? ' has-error' : ''}`;

  // Clear a single field's inline error as the user corrects it.
  const clearErr = (key) => setErrors(prev => {
    if (!prev[key]) return prev;
    const next = { ...prev };
    delete next[key];
    return next;
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, []);

  const fetchAll = async () => {
    const [r, s, rp, mg] = await Promise.all([
      supabase.from('regions').select('*').order('name'),
      supabase.from('supervisors').select('*, regions(name)').order('name'),
      supabase.from('representatives').select('*, supervisors(name), regions(name)').order('name'),
      supabase.from('managers').select('*').order('name'),
    ]);
    if (r.error || s.error || rp.error || mg.error) {
      showMsg('تعذّر تحميل بيانات الإعدادات: ' + (r.error?.message || s.error?.message || rp.error?.message || mg.error?.message), 'error');
    }
    if (r.data) setRegions(r.data);
    if (s.data) setSupervisors(s.data);
    if (rp.data) setReps(rp.data);
    if (mg.data) setManagers(mg.data);
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const generateTempPassword = () => {
    // Cryptographically-strong random (not Math.random) for temp credentials.
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    const randomPart = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
    setAccountPassword(`Hwf-${randomPart}-${new Date().getFullYear()}`);
  };

  const addRegion = async () => {
    if (!regionName.trim()) { setErrors(prev => ({ ...prev, regionName: 'أدخل اسم المنطقة' })); return; }
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
    if (!supName.trim()) { setErrors(prev => ({ ...prev, supName: 'أدخل اسم المشرف' })); return; }
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
    if (!repName.trim()) { setErrors(prev => ({ ...prev, repName: 'أدخل اسم المندوب' })); return; }
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
    if (!window.confirm('هل أنت متأكد من الحذف؟ قد يؤثر ذلك على بيانات مرتبطة.')) return;
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) {
      // Most likely a foreign-key constraint (referenced by reps/entries/targets).
      showMsg('تعذّر الحذف — قد يكون العنصر مرتبطًا ببيانات أخرى: ' + error.message, 'error');
      return;
    }
    await logAuditEvent({ eventType: 'delete', pageKey: 'setup', entityType: table, entityId: id, details: { table } });
    showMsg('تم الحذف');
    fetchAll();
  };

  // --- Route-plan sheet import (region + weekday -> planned customers) ---
  const handleRouteFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setRouteMsg(''); setRoutePreview(null);
    const norm = (s) => String(s ?? '').trim();
    if (!/\.(xlsx|xls|csv)$/i.test(file.name || '')) { setRouteMsg('نوع الملف غير مدعوم. ارفع Excel (.xlsx/.xls/.csv).'); return; }
    if (file.size > 10 * 1024 * 1024) { setRouteMsg('حجم الملف كبير جدًا (الحد 10 ميجابايت).'); return; }
    const regionByName = new Map((regions || []).map(r => [norm(r.name), r.id]));
    const reader = new FileReader();
    reader.onerror = () => setRouteMsg('تعذّر قراءة الملف.');
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' });
        const rows = [];
        const unresolvedRegions = new Set();
        const badDays = new Set();
        let skipped = 0; let order = 0;
        for (const sheetName of wb.SheetNames) {
          const json = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
          for (const row of json) {
            const custName = norm(row['اسم العميل'] || row['العميل'] || row['اسم المحل']);
            if (!custName) { skipped += 1; continue; }
            const regionName = norm(row['المنطقة'] || row['منطقة']) || norm(sheetName);
            const regionId = regionByName.get(regionName);
            if (!regionId) { unresolvedRegions.add(regionName || '(فارغ)'); skipped += 1; continue; }
            const day = DAY_ALIASES[norm(row['اليوم'] || row['يوم'])];
            if (!day) { badDays.add(norm(row['اليوم'] || row['يوم']) || '(فارغ)'); skipped += 1; continue; }
            rows.push({
              region_id: regionId,
              day_of_week: day,
              customer_name: custName,
              neighborhood: norm(row['الحي']) || null,
              city: norm(row['المدينة'] || row['المدينه']) || null,
              sort_order: order,
            });
            order += 1;
          }
        }
        if (!rows.length) {
          setRouteMsg('لم يتم العثور على صفوف صالحة. تأكد من الأعمدة: المنطقة، اليوم، اسم العميل، الحي، المدينة.');
          return;
        }
        setRoutePreview({ rows, skipped, unresolvedRegions: [...unresolvedRegions], badDays: [...badDays] });
      } catch (err) {
        console.error('route sheet parse failed', err);
        setRouteMsg('تعذّر قراءة الملف. تأكد أنه سليم وغير تالف.');
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const doImportRoute = async () => {
    if (!routePreview) return;
    setRouteImporting(true); setRouteMsg('');
    const { error, inserted } = await importRoutePlan(routePreview.rows);
    setRouteImporting(false);
    if (error) { setRouteMsg('تعذّر الاستيراد: ' + error.message); return; }
    await logAuditEvent({ eventType: 'import', pageKey: 'setup', entityType: 'route_plan_customers', details: { inserted } });
    setRouteMsg(`✓ تم استيراد ${inserted} عميل في خطوط السير.`);
    setRoutePreview(null);
    if (routeFileRef.current) routeFileRef.current.value = '';
  };

  const toggleRepActive = async (rep) => {
    const { error } = await supabase.from('representatives').update({ is_active: !rep.is_active }).eq('id', rep.id);
    if (error) { showMsg('تعذّر تغيير الحالة: ' + error.message, 'error'); return; }
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
    if (!editingRep) return;
    if (!editRepName.trim()) { setErrors(prev => ({ ...prev, editRepName: 'الاسم مطلوب' })); return; }
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
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail.trim());
    if (!emailValid) { setErrors(prev => ({ ...prev, accountEmail: 'أدخل إيميلًا صحيحًا' })); return; }
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

  const addManager = async () => {
    let hasError = false;
    if (!managerName.trim()) { setErrors(prev => ({ ...prev, managerName: 'أدخل اسم المدير' })); hasError = true; }
    const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(managerEmail.trim());
    if (!emailValid) { setErrors(prev => ({ ...prev, managerEmail: 'أدخل إيميلًا صحيحًا' })); hasError = true; }
    if (hasError) return;
    setLoading(true);
    const { error } = await supabase.from('managers').insert({
      name: managerName.trim(),
      email: managerEmail.trim().toLowerCase(),
      manager_type: managerType,
    });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: 'create', pageKey: 'setup', entityType: 'managers', details: { name: managerName.trim(), email: managerEmail.trim().toLowerCase(), manager_type: managerType } });
      showMsg('تم إضافة المدير'); setManagerName(''); setManagerEmail(''); setManagerType('sales_manager'); fetchAll();
    }
    setLoading(false);
  };

  const toggleManagerActive = async (manager) => {
    const { error } = await supabase.from('managers').update({ is_active: !manager.is_active }).eq('id', manager.id);
    if (error) { showMsg('تعذّر تغيير الحالة: ' + error.message, 'error'); return; }
    await logAuditEvent({
      eventType: 'status_change',
      pageKey: 'setup',
      entityType: 'managers',
      entityId: manager.id,
      details: { name: manager.name, from: manager.is_active ? 'نشط' : 'غير نشط', to: !manager.is_active ? 'نشط' : 'غير نشط' },
    });
    fetchAll();
  };

  const startAccountForManager = (manager) => {
    setAccountManager(manager);
    generateTempPassword();
  };

  const createManagerAccount = async () => {
    if (!accountManager) { showMsg('اختر المدير أولاً', 'error'); return; }
    if (!accountPassword || accountPassword.length < 6) { showMsg('كلمة السر المؤقتة يجب أن تكون 6 أحرف على الأقل', 'error'); return; }
    setLoading(true);
    const { data, error } = await createManagerLoginAccount({
      email: accountManager.email,
      password: accountPassword,
      managerId: accountManager.id,
    });
    if (error) showMsg('خطأ في إنشاء الحساب: ' + error.message, 'error');
    else {
      await logAuditEvent({
        eventType: 'account_create',
        pageKey: 'setup',
        entityType: 'managers',
        entityId: accountManager.id,
        details: { name: accountManager.name || '', email: (accountManager.email || '').trim().toLowerCase() },
      });
      const successText = data?.mode === 'linked_existing'
        ? 'الإيميل كان موجودًا بالفعل، وتم ربطه بالمدير وتحديث كلمة السر المؤقتة.'
        : 'تم إنشاء حساب دخول المدير. أعطه كلمة السر المؤقتة وسيغيرها عند أول دخول.';
      showMsg(successText);
      setAccountManager(null);
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
    const effectiveTarget = targetMap[editingRep.id] || null;
    // Only split a target that truly belongs to THIS month. An inherited target
    // (from a prior month) must not be materialized/split here (BUG-024).
    const monthTarget = effectiveTarget && !effectiveTarget._isInherited ? effectiveTarget : null;
    const entries = entriesResult.data || [];
    const achieved = TARGET_FIELDS.reduce((acc, field) => {
      const entryField = ACHIEVEMENT_FIELD_BY_TARGET[field];
      acc[field] = entries.reduce((sum, entry) => sum + (parseFloat(entry[entryField]) || 0), 0);
      return acc;
    }, {});

    // Step 1: create the new rep.
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

    // Step 2: deactivate the OLD rep first (the ownership transfer). If this fails,
    // undo step 1 so we never end with two active reps.
    const { error: deactivateError } = await supabase.from('representatives')
      .update({ is_active: false })
      .eq('id', editingRep.id);
    if (deactivateError) {
      await supabase.from('representatives').delete().eq('id', newRep.id);
      showMsg('لم يتم التسليم بسبب خطأ في تعطيل المندوب القديم: ' + deactivateError.message, 'error');
      setLoading(false);
      return;
    }

    // Step 3: split this month's target (only if a real month target exists). On
    // failure, compensate fully: reactivate the old rep and delete the new one.
    if (monthTarget) {
      const oldTargetPayload = { rep_id: editingRep.id, year, month };
      const newTargetPayload = { rep_id: newRep.id, year, month };
      TARGET_FIELDS.forEach(field => {
        const total = parseFloat(monthTarget[field]) || 0;
        const oldShare = Math.min(parseFloat(achieved[field]) || 0, total);
        oldTargetPayload[field] = oldShare;
        newTargetPayload[field] = Math.max(0, total - oldShare);
      });

      const { error: targetError } = await supabase.from('monthly_targets')
        .upsert([oldTargetPayload, newTargetPayload], { onConflict: 'rep_id,year,month' });

      if (targetError) {
        await supabase.from('representatives').update({ is_active: true }).eq('id', editingRep.id);
        await supabase.from('representatives').delete().eq('id', newRep.id);
        showMsg('لم يتم التسليم بسبب خطأ في تقسيم الأهداف (تم التراجع): ' + targetError.message, 'error');
        setLoading(false);
        return;
      }
    }

    await logAuditEvent({
      eventType: 'handover',
      pageKey: 'setup',
      entityType: 'representatives',
      entityId: editingRep.id,
      details: { from: editingRep.name, to: editRepName.trim(), new_rep_id: newRep.id, split_target: !!monthTarget },
    });
    showMsg(monthTarget
      ? 'تم التسليم وتقسيم هدف الشهر على القديم والجديد'
      : 'تم التسليم بدون تقسيم أهداف (لا يوجد هدف مخصّص لهذا الشهر)');
    cancelEditRep();
    fetchAll();
    setLoading(false);
  };

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <div className="page-header">
        <h1 className="page-title">⚙️ الإعدادات</h1>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      <div className="tabs">
        {[['regions','🗺️ المناطق'], ['supervisors','👔 المشرفون'], ['reps','👤 المندوبون'], ['managers','👔 المديرون'], ['routes','🧭 خطوط السير'], ['accounts','🔐 حسابات الدخول']].map(([k, label]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'regions' && (
        <div>
          <div className="card">
            <div className="card-title">➕ إضافة منطقة</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label className="form-label">اسم المنطقة</label>
                <input className={errCls('form-input', 'regionName')} value={regionName}
                  enterKeyHint="next"
                  onChange={e => { setRegionName(e.target.value); clearErr('regionName'); }}
                  placeholder="مثال: الرياض" onKeyDown={e => e.key === 'Enter' && addRegion()} />
                {errors.regionName && <div className="form-error">{errors.regionName}</div>}
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
                <table className="responsive-cards">
                  <thead><tr><th>#</th><th>اسم المنطقة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {regions.map((r, i) => (
                      <tr key={r.id}><td data-label="#">{i + 1}</td><td data-label="اسم المنطقة">{r.name}</td>
                        <td className="no-label"><button className="btn btn-danger btn-sm" onClick={() => deleteItem('regions', r.id)}>حذف</button></td>
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
                <input className={errCls('form-input', 'supName')} value={supName} enterKeyHint="next"
                  onChange={e => { setSupName(e.target.value); clearErr('supName'); }} placeholder="الاسم الكامل" />
                {errors.supName && <div className="form-error">{errors.supName}</div>}
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
                <table className="responsive-cards">
                  <thead><tr><th>#</th><th>الاسم</th><th>المنطقة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {supervisors.map((s, i) => (
                      <tr key={s.id}><td data-label="#">{i + 1}</td><td data-label="الاسم">{s.name}</td><td data-label="المنطقة">{s.regions?.name || '-'}</td>
                        <td className="no-label"><button className="btn btn-danger btn-sm" onClick={() => deleteItem('supervisors', s.id)}>حذف</button></td>
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
                <input className={errCls('form-input', 'repName')} value={repName} enterKeyHint="next"
                  onChange={e => { setRepName(e.target.value); clearErr('repName'); }} placeholder="الاسم الكامل" />
                {errors.repName && <div className="form-error">{errors.repName}</div>}
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
                  <input className={errCls('form-input', 'editRepName')} value={editRepName} enterKeyHint="next"
                    onChange={e => { setEditRepName(e.target.value); clearErr('editRepName'); }} placeholder="اسم المندوب" />
                  {errors.editRepName && <div className="form-error">{errors.editRepName}</div>}
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
                <table className="responsive-cards">
                  <thead><tr><th>#</th><th>الاسم</th><th>المشرف</th><th>المنطقة</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {reps.map((r, i) => (
                      <tr key={r.id}>
                        <td data-label="#">{i + 1}</td><td data-label="الاسم">{r.name}</td>
                        <td data-label="المشرف">{r.supervisors?.name || 'بدون مشرف'}</td>
                        <td data-label="المنطقة">{r.regions?.name || '-'}</td>
                        <td data-label="الحالة"><span className={`badge ${r.is_active ? 'badge-success' : 'badge-danger'}`}>{r.is_active ? 'نشط' : 'غير نشط'}</span></td>
                        <td className="no-label" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
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
      {tab === 'managers' && (
        <div>
          <div className="card">
            <div className="card-title">➕ إضافة مدير</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">الاسم</label>
                <input className={errCls('form-input', 'managerName')} value={managerName} enterKeyHint="next"
                  onChange={e => { setManagerName(e.target.value); clearErr('managerName'); }} placeholder="الاسم الكامل" />
                {errors.managerName && <div className="form-error">{errors.managerName}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">البريد الإلكتروني</label>
                <input className={errCls('form-input', 'managerEmail')} type="email" value={managerEmail} enterKeyHint="next"
                  onChange={e => { setManagerEmail(e.target.value); clearErr('managerEmail'); }} placeholder="manager@hawafel.com" />
                {errors.managerEmail && <div className="form-error">{errors.managerEmail}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">النوع</label>
                <select className="form-select" value={managerType} onChange={e => setManagerType(e.target.value)}>
                  <option value="sales_manager">مدير المبيعات</option>
                  <option value="company_manager">مدير الشركة</option>
                </select>
              </div>
            </div>
            <button className="btn btn-primary" onClick={addManager} disabled={loading}>إضافة المدير</button>
          </div>
          {accountManager && (
            <div className="card">
              <div className="card-title">🔐 إنشاء حساب دخول للمدير: {accountManager.name}</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">إيميل الدخول</label>
                  <input className="form-input" type="email" value={accountManager.email || ''} disabled />
                </div>
                <div className="form-group">
                  <label className="form-label">كلمة السر المؤقتة</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <input className="form-input" type="text" value={accountPassword}
                      onChange={e => setAccountPassword(e.target.value)}
                      placeholder="كلمة سر مؤقتة" />
                    <button className="btn btn-ghost" type="button" onClick={generateTempPassword}>توليد</button>
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={createManagerAccount} disabled={loading}>
                  {loading ? 'جاري إنشاء الحساب...' : 'إنشاء الحساب وربطه بالمدير'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setAccountManager(null); setAccountPassword(''); }} disabled={loading}>إلغاء</button>
              </div>
              <div style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.7 }}>
                بعد الإنشاء أعطِ المدير الإيميل وكلمة السر المؤقتة. عند أول دخول سيجبره النظام على تغيير كلمة السر قبل عرض صفحته.
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-title">قائمة المديرين ({managers.length})</div>
            {managers.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">👔</div><div className="empty-state-text">لا يوجد مديرون بعد</div></div>
            ) : (
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead><tr><th>الاسم</th><th>البريد</th><th>النوع</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
                  <tbody>
                    {managers.map(m => (
                      <tr key={m.id}>
                        <td data-label="الاسم">{m.name}</td>
                        <td data-label="البريد">{m.email}</td>
                        <td data-label="النوع">{MANAGER_TYPE_LABELS[m.manager_type] || m.manager_type}</td>
                        <td data-label="الحالة"><span className={`badge ${m.is_active ? 'badge-success' : 'badge-danger'}`}>{m.is_active ? 'نشط' : 'غير نشط'}</span></td>
                        <td className="no-label" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <button className="btn btn-success btn-sm" onClick={() => startAccountForManager(m)}>إنشاء حساب دخول</button>
                          <button className="btn btn-ghost btn-sm" onClick={() => toggleManagerActive(m)}>{m.is_active ? 'إيقاف' : 'تفعيل'}</button>
                          <button className="btn btn-danger btn-sm" onClick={() => deleteItem('managers', m.id)}>حذف</button>
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
      {tab === 'routes' && (
        <div>
          <div className="card">
            <div className="card-title">🧭 رفع خطوط السير</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.8, marginBottom: '0.75rem' }}>
              ارفع ملف Excel أو CSV بالأعمدة: <b>المنطقة</b>، <b>اليوم</b>، <b>اسم العميل</b>، <b>الحي</b>، <b>المدينة</b>.
              اليوم يكون أحد: {WEEKDAYS.join('، ')}. لو تركت عمود «المنطقة» فارغًا، يُستخدم اسم الشيت كمنطقة.
              رفع نفس (المنطقة + اليوم) مرة أخرى يستبدل القائمة القديمة له.
            </div>
            {routeMsg && <div className={`alert ${routeMsg.startsWith('✓') ? 'alert-success' : 'alert-error'}`}>{routeMsg}</div>}
            <input ref={routeFileRef} type="file" accept=".xlsx,.xls,.csv" className="form-input" onChange={handleRouteFile} />

            {routePreview && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ marginBottom: '0.5rem' }}>
                  جاهز للاستيراد: <b>{routePreview.rows.length}</b> عميل
                  {routePreview.skipped > 0 && <span style={{ color: 'var(--text-muted)' }}> — تم تجاهل {routePreview.skipped} صف</span>}
                </div>
                {routePreview.unresolvedRegions.length > 0 && (
                  <div className="alert alert-error">مناطق غير معروفة (لن تُستورد): {routePreview.unresolvedRegions.join('، ')}. أنشئها أولًا في تبويب المناطق أو صحّح الاسم.</div>
                )}
                {routePreview.badDays.length > 0 && (
                  <div className="alert alert-error">أيام غير صحيحة (لن تُستورد): {routePreview.badDays.join('، ')}.</div>
                )}
                <button className="btn btn-primary" onClick={doImportRoute} disabled={routeImporting}>
                  {routeImporting ? 'جاري الاستيراد...' : `استيراد ${routePreview.rows.length} عميل`}
                </button>
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
                <input className={errCls('form-input', 'accountEmail')} type="email" value={accountEmail}
                  enterKeyHint="next"
                  onChange={e => { setAccountEmail(e.target.value); clearErr('accountEmail'); }}
                  placeholder="rep@hawafel.com" />
                {errors.accountEmail && <div className="form-error">{errors.accountEmail}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">كلمة السر المؤقتة</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
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

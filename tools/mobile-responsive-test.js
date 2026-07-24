/* eslint-disable */
/**
 * Mobile responsive test harness.
 *
 * Serves the production build and drives it through Playwright at a range of
 * phone widths, mocking the Supabase auth + REST layer so every page renders
 * without a real backend. For each (role, page, width) it:
 *   - screenshots the page
 *   - detects horizontal overflow (page scrollWidth > viewport) and any
 *     visible element whose box extends past the viewport edges.
 *
 * Usage: node tools/mobile-responsive-test.js
 * Requires: a static server serving ./build on PORT (default 5000) and the
 * preinstalled Chromium at CHROMIUM_PATH.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5000';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = path.join(__dirname, '..', 'qa-reports', 'mobile-screenshots');
fs.mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 768];

// Distinct page components reachable per role (label text used to click nav).
const ROLES = {
  admin: {
    role: 'admin',
    pages: [
      ['dashboard', 'لوحة المتابعة'],
      ['daily', 'الإدخال اليومي'],
      ['targets', 'الأهداف الشهرية'],
      ['repdetails', 'تفاصيل المندوب'],
      ['customers', 'العملاء'],
      ['analytics', 'تحليل العملاء'],
      ['segmentation', 'تقسيم العملاء'],
      ['audit', 'سجل النشاط'],
      ['setup', 'الإعدادات'],
      ['password', 'تغيير كلمة السر'],
    ],
  },
  rep: {
    role: 'rep',
    pages: [
      ['repdashboard', 'تقريري'],
      ['customers', 'العملاء'],
      ['analytics', 'تحليل العملاء'],
      ['password', 'تغيير كلمة السر'],
    ],
  },
};

const SESSION = (role) => ({
  access_token: 'mock-access-token',
  refresh_token: 'mock-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: 4102444800, // year 2100
  user: {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: `${role}@test.local`,
    email_confirmed_at: '2020-01-01T00:00:00Z',
    phone: '',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { must_change_password: false },
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
  },
});

const USER_ROLE_ROW = (role) => ({
  role,
  supervisor_id: role === 'supervisor' ? 1 : null,
  rep_id: role === 'rep' ? 1 : null,
  supervisors: role === 'supervisor' ? { name: 'مشرف تجريبي', id: 1 } : null,
});

async function setupMocks(context, role) {
  // Inject a fake Supabase session into localStorage before any app JS runs.
  await context.addInitScript(([sess]) => {
    try { window.localStorage.setItem('sb-mock-auth-token', JSON.stringify(sess)); } catch (e) {}
  }, [SESSION(role)]);

  // NOTE: Playwright uses last-registered-route-wins, so register the BROAD
  // catch-alls first and the SPECIFIC routes last.
  await context.route('**/rest/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await context.route('**/rest/v1/rpc/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  // user_roles returns the role row (single-object shape for .single()).
  await context.route('**/rest/v1/user_roles*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER_ROLE_ROW(role)) }));
  // Auth: broad first, then the specific user-validation endpoint.
  await context.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }));
  await context.route('**/auth/v1/user*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION(role).user) }));
}

const overflowProbe = () => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const scrollW = Math.max(de.scrollWidth, document.body.scrollWidth);

  // Is `el` inside an ancestor that legitimately scrolls horizontally
  // (overflow-x auto/scroll)? Such elements are contained, not page-breaking.
  const insideScrollContainer = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };

  const offenders = [];       // TRUE page-breaking overflow (no scroll container)
  const scrollWide = [];      // wide content that IS inside a scroll container
  const els = document.body.querySelectorAll('*');
  for (const el of els) {
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.position === 'fixed') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 2 || r.left < -2) {
      const rec = {
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 40),
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width),
      };
      if (insideScrollContainer(el)) scrollWide.push(rec);
      else offenders.push(rec);
    }
  }
  offenders.sort((a, b) => b.w - a.w);
  scrollWide.sort((a, b) => b.w - a.w);
  return { vw, scrollW, pageOverflow: scrollW - vw, offenders: offenders.slice(0, 12), scrollWide: scrollWide.slice(0, 6) };
};

async function openDrawerAndClick(page, label) {
  // On mobile the nav lives in a drawer behind the hamburger.
  const menuBtn = page.locator('.menu-btn');
  if (await menuBtn.isVisible().catch(() => false)) {
    await menuBtn.click();
    await page.waitForTimeout(300);
    await page.locator('.drawer .nav-item', { hasText: label }).first().click();
  } else {
    // desktop sidebar
    await page.locator('.sidebar .nav-item', { hasText: label }).first().click();
  }
  await page.waitForTimeout(500);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });
  const results = [];
  let failCount = 0;

  for (const [roleName, cfg] of Object.entries(ROLES)) {
    for (const width of WIDTHS) {
      const context = await browser.newContext({
        viewport: { width, height: 780 },
        deviceScaleFactor: 2,
        isMobile: width < 768,
        hasTouch: width < 768,
      });
      // Silence the (blocked) Google Fonts request so it doesn't add latency.
      await context.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      await setupMocks(context, cfg.role);
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(1200);

      for (let i = 0; i < cfg.pages.length; i++) {
        const [key, label] = cfg.pages[i];
        try {
          if (i > 0) await openDrawerAndClick(page, label);
        } catch (e) {
          // fall back: reload and try once
        }
        await page.waitForTimeout(400);
        const probe = await page.evaluate(overflowProbe);
        const status = probe.offenders.length === 0 && probe.pageOverflow <= 2 ? 'OK' : 'OVERFLOW';
        if (status === 'OVERFLOW') failCount++;
        const shot = path.join(OUT, `${roleName}-${key}-${width}.png`);
        await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
        results.push({ role: roleName, page: key, width, status, ...probe });
        if (status === 'OVERFLOW') {
          console.log(`  [OVERFLOW] ${roleName}/${key} @${width}px  pageOverflow=${probe.pageOverflow}  offenders=${JSON.stringify(probe.offenders.slice(0,4))}`);
        } else if (probe.scrollWide.length) {
          console.log(`  [scroll-ok] ${roleName}/${key} @${width}px  wide-in-scroll-container=${probe.scrollWide.length} (${probe.scrollWide.map(s=>s.tag+'.'+s.cls.trim()).slice(0,3).join(', ')})`);
        }
      }
      await context.close();
    }
    console.log(`Role ${roleName}: done`);
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT, '_results.json'), JSON.stringify(results, null, 2));

  const total = results.length;
  const ok = results.filter(r => r.status === 'OK').length;
  console.log(`\n==== SUMMARY: ${ok}/${total} page-width combos clean; ${failCount} with overflow ====`);
  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

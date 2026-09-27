/* 探针：CDN 收口为本地自托管后的功能与速度验证
 * 硬核口径：所有外网请求一律 abort（模拟国际 CDN 完全不可达）
 * ⇒ 页面必须仍能正常加载、vendor 全局对象可用、本地 vendor 文件 200、无报错
 * 页面：首页 / Cube/Analyzer / Tools/KGenesis(jszip) / ui/pages/design-system.html(tailwind+lucide)
 */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let pass = 0, fail = 0;
const check = (n, c, e) => { if (c) { pass++; console.log('PASS  ' + n); } else { fail++; console.log('FAIL  ' + n + (e ? '  => ' + e : '')); } };

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext();

  // 外网一律阻断并计数：本地自托管后不应有任何外网依赖
  let externalBlocked = 0;
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost:9527/')) return route.continue();
    externalBlocked++;
    return route.abort();
  });

  // 本地 vendor 文件本身 200
  for (const f of [
    'assets/vendor/supabase/supabase.min.js',
    'assets/vendor/jszip/jszip.min.js',
    'assets/vendor/tailwindcss/index.global.js',
    'assets/vendor/lucide/lucide.min.js',
  ]) {
    const r = await ctx.request.get('http://localhost:9527/' + f);
    check('本地 200: ' + f, r.status() === 200, 'status=' + r.status());
  }

  async function loadPage(path, settle) {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
    const t0 = Date.now();
    await page.goto('http://localhost:9527/' + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(settle || 2000);
    const ms = Date.now() - t0;
    return { page, errs, ms };
  }

  /* ---------- 1. 首页：supabase ---------- */
  {
    const { page, errs, ms } = await loadPage('');
    const out = await page.evaluate(() => ({
      supabase: typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function',
    }));
    console.log('  首页 domcontentloaded ≈ ' + ms + 'ms');
    check('1a 首页 supabase 全局可用（外网全断）', out.supabase === true);
    check('1b 首页无报错', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  /* ---------- 2. Cube/Analyzer：supabase + 页面逻辑 ---------- */
  {
    const { page, errs, ms } = await loadPage('Cube/Analyzer/');
    const out = await page.evaluate(() => ({
      supabase: typeof window.supabase !== 'undefined' && typeof window.supabase.createClient === 'function',
      appBooted: !!document.querySelector('body'),
    }));
    console.log('  Analyzer domcontentloaded ≈ ' + ms + 'ms');
    check('2a Analyzer supabase 全局可用（外网全断）', out.supabase === true);
    check('2b Analyzer 无报错', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  /* ---------- 3. Tools/KGenesis：jszip ---------- */
  {
    const { page, errs, ms } = await loadPage('Tools/KGenesis/');
    const out = await page.evaluate(() => ({
      jszip: typeof window.JSZip === 'function' || (window.JSZip && typeof window.JSZip === 'object'),
    }));
    console.log('  KGenesis domcontentloaded ≈ ' + ms + 'ms');
    check('3a KGenesis JSZip 可用（外网全断）', out.jszip === true);
    check('3b KGenesis 无报错', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  /* ---------- 4. design-system：tailwind + lucide ---------- */
  {
    const { page, errs, ms } = await loadPage('ui/pages/design-system.html', 3000);
    const out = await page.evaluate(() => {
      const sample = Array.from(document.querySelectorAll('[class]')).find(el =>
        /(^|\s)(flex|grid)(\s|$)/.test(el.className));
      let tw = 'n/a';
      if (sample) {
        const d = getComputedStyle(sample).display;
        tw = (sample.className.match(/flex|grid/) || ['?'])[0] + ':' + d;
      }
      return {
        lucide: typeof window.lucide !== 'undefined' && typeof window.lucide.createIcons === 'function',
        tailwind: tw,
      };
    });
    console.log('  design-system domcontentloaded ≈ ' + ms + 'ms  tailwind 样本: ' + out.tailwind);
    check('4a design-system lucide 可用（外网全断）', out.lucide === true);
    if (out.tailwind !== 'n/a') check('4b tailwind JIT 生效（display 已编译）', /:(flex|grid)$/.test(out.tailwind), out.tailwind);
    check('4c design-system 无报错', errs.length === 0, errs.join(' | '));
    await page.close();
  }

  check('5 全程外网请求数 = 0（真·零外网依赖）', externalBlocked === 0, 'blocked=' + externalBlocked);

  await browser.close();
  console.log('\n===== ' + pass + ' PASS / ' + fail + ' FAIL =====');
  process.exit(fail ? 1 : 0);
})();

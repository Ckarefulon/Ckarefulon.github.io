/* 对照实验：国内源 vs 国际源 吞吐；并直测 Supabase 是否可达 */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SB = 'https://sekbhrzxblaxvgspyjxa.supabase.co';
const KEY = 'sb_publishable_ARBg-NY0bMtgd_UnQz6biQ_rGBK5HFK';

const URLS = [
  ['sb-rest-root    ', SB + '/rest/v1/?apikey=' + KEY, { apikey: KEY }],
  ['sb-auth-health  ', SB + '/auth/v1/health', { apikey: KEY }],
  ['domestic-npm-1mb', 'https://registry.npmmirror.com/pdfjs-dist/-/pdfjs-dist-4.0.269.tgz', null],
  ['domestic-cdn-eb ', 'https://registry.npmmirror.com/jquery/-/jquery-3.7.1.tgz', null],
  ['intl-jsdelivr-1m', 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs', null],
  ['intl-unpkg-1m   ', 'https://unpkg.com/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs', null],
];

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');
  const out = await page.evaluate(async (list) => {
    const res = [];
    for (const [label, url, headers] of list) {
      const t0 = performance.now();
      try {
        const r = await fetch(url, { headers: headers || {}, cache: 'no-store' });
        const buf = await r.arrayBuffer();
        const ms = performance.now() - t0;
        const kb = buf.byteLength / 1024;
        res.push(`${label} HTTP ${r.status} | ${Math.round(kb)} KB | ${Math.round(ms)} ms | ~${Math.round(kb / (ms / 1000 || 1e-6))} KB/s | enc=${r.headers.get('content-encoding') || 'none'}`);
      } catch (e) {
        res.push(`${label} ERROR ${String(e).slice(0, 90)}`);
      }
    }
    return res;
  }, URLS);
  out.forEach(l => console.log('  ' + l));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

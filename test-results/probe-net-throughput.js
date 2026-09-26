/* 实测：真实浏览器到 Supabase 的吞吐 vs 对照 CDN 吞吐 + 本机 JSON/localStorage 处理耗时 */
const { chromium } = require('playwright-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SB = 'https://sekbhrzxblaxvgspyjxa.supabase.co';
const KEY = 'sb_publishable_ARBg-NY0bMtgd_UnQz6biQ_rGBK5HFK';

const KB = 1024;

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('about:blank');

  const net = await page.evaluate(async ({ sb, key }) => {
    async function timed(u, headers, label) {
      const t0 = performance.now();
      try {
        const r = await fetch(u, { headers: headers || {}, cache: 'no-store' });
        const buf = await r.arrayBuffer();
        const t1 = performance.now();
        const kb = buf.byteLength / 1024;
        const sec = (t1 - t0) / 1000;
        return {
          label, status: r.status, bytes: buf.byteLength,
          kb: Math.round(kb), ms: Math.round(t1 - t0),
          KBps: Math.round(kb / (sec || 1e-6)),
          server: r.headers.get('content-encoding') || '(none)'
        };
      } catch (e) {
        return { label, error: String(e).slice(0, 140) };
      }
    }
    const out = {};
    // 1) Supabase REST 根（返回 OpenAPI 描述 JSON，体积可观，且无需登录）
    out.supabase_rest_root = await timed(sb + '/rest/v1/?apikey=' + key, { apikey: key }, 'sb-rest-root');
    // 2) Supabase Auth 健康检查（小请求，测纯延迟）
    out.supabase_auth_ping = await timed(sb + '/auth/v1/health', { apikey: key }, 'sb-auth-health');
    // 3) 对照：同一 CDN（jsdelivr）拿两个不同体积的文件
    out.cdn_200kb = await timed('https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js', null, 'cdn-jquery');
    out.cdn_1mb = await timed('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.269/build/pdf.worker.min.mjs', null, 'cdn-1mb');
    return out;
  }, { sb: SB, key: KEY });

  console.log('===== 网络吞吐实测（真实浏览器）=====');
  for (const k of Object.keys(net)) {
    const v = net[k];
    if (v.error) console.log(`  ${k}: ERROR -> ${v.error}`);
    else console.log(`  ${k}: HTTP ${v.status} | ${v.kb} KB | ${v.ms} ms | ~${v.KBps} KB/s | enc=${v.server}`);
  }

  // 本机处理耗时（用真实页面跑，量 JSON + localStorage 的代价）
  const local = await page.evaluate(() => {
    function bench(name, fn) { const t0 = performance.now(); const r = fn(); return { name, ms: +(performance.now() - t0).toFixed(1), r }; }
    const mk = (n, perRec) => ({ name: '训练数据', solves: Array.from({ length: n }, (_, i) => ({ id: 's' + i, pad: 'x'.repeat(perRec) })) });
    const res = [];
    const p13kb = mk(46, 13000);      // 46 条 × ~13KB = 600KB（修复后的量级）
    const p112kb = mk(46, 112000);    // 46 条 × ~112KB = 5MB（修复前的量级，云端现存旧数据）
    for (const [tag, payload] of [['600KB', p13kb], ['5MB', p112kb]]) {
      res.push(bench(tag + ' stringify', () => JSON.stringify(payload)));
      const s = JSON.stringify(payload);
      res.push(bench(tag + ' parse', () => JSON.parse(s)));
      res.push(bench(tag + ' localStorage.setItem', () => { try { localStorage.setItem('__bench_' + tag, s); return 'ok'; } catch (e) { return e.name; } }));
      try { localStorage.removeItem('__bench_' + tag); } catch (e) {}
    }
    return res;
  });

  console.log('===== 本机 JSON / localStorage 处理耗时 =====');
  for (const r of local) console.log(`  ${r.name}: ${r.ms} ms`);

  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

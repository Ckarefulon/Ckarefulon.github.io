/*
 * Analyzer AI 报告（2026-09-29）—— 纯前端直连 OpenAI 兼容 API，无后端。
 *
 * 架构（参照 AI_CFOP 的三件套模式，数据侧用站点更全的指标）：
 *   1. 角色设定 system prompt（中文，输出协议五段强制结构）
 *   2. user 数据配方：总览统计 + 分段均值 + 案例薄弱点 + 基线对比 + 口径注脚（可选 Ao12 深挖回放）
 *   3. 强制输出协议 + 受限 Markdown 渲染（仅 h2 / 列表 / 加粗 / 行内代码，杜绝注入）
 *
 * 供应商预设（2026-09-29 实测 CORS 放行：DeepSeek / SiliconFlow / OpenRouter）：
 *   浏览器 fetch 直连 /chat/completions（SSE 流式），无需任何中转。
 *
 * Key 存储（用户定案）：本地 / 云端二选一；加密可选。
 *   local  → localStorage 'cubeAnalyzerAiConfigV1'
 *   cloud  → user_global_data（globalDataManager，键 cubeAnalyzerAi，独立于 Analyzer 训练数据同步）
 *   加密   → WebCrypto AES-GCM，口令经 PBKDF2(SHA-256, 100000) 派生；密文落盘，明文仅存内存会话。
 */
(() => {
  'use strict';

  const LS_KEY = 'cubeAnalyzerAiConfigV1';
  const CLOUD_KEY = 'cubeAnalyzerAi';

  const PROVIDERS = {
    deepseek:    { label: 'DeepSeek',    baseUrl: 'https://api.deepseek.com/v1',    model: 'deepseek-chat' },
    siliconflow: { label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1',  model: 'deepseek-ai/DeepSeek-V3' },
    openrouter:  { label: 'OpenRouter',  baseUrl: 'https://openrouter.ai/api/v1',   model: 'deepseek/deepseek-chat' },
    custom:      { label: '自定义',       baseUrl: '',                               model: '' },
  };

  const DEFAULT_CFG = { provider: 'deepseek', baseUrl: PROVIDERS.deepseek.baseUrl, model: PROVIDERS.deepseek.model, store: 'local', encrypted: false };

  /* ---------- 配置存取 ---------- */
  let cfg = null;          // 非敏感配置（provider/baseUrl/model/store/encrypted）
  let memKey = null;       // 明文 key 仅存内存（页面刷新后需重输/解密）

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  function writeLocal(v) {
    try { if (v === null) localStorage.removeItem(LS_KEY); else localStorage.setItem(LS_KEY, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }

  async function loadConfig() {
    const local = readLocal();
    cfg = Object.assign({}, DEFAULT_CFG, local && local.cfg ? local.cfg : (local || {}));
    if (local && local.cfg) { cfg = Object.assign({}, DEFAULT_CFG, local.cfg); memKey = local.plainKey || null; }
    // 云端：登录状态下尝试拉取覆盖（本地未存时）
    if (!local && window.globalDataManager) {
      try {
        const r = await window.globalDataManager.getGlobalData();
        const cloudCfg = r?.success && r.data?.[CLOUD_KEY];
        if (cloudCfg && cloudCfg.cfg) { cfg = Object.assign({}, DEFAULT_CFG, cloudCfg.cfg); memKey = cloudCfg.plainKey || null; }
      } catch (e) {}
    }
    return Object.assign({}, cfg, { hasKey: !!memKey || !!(local && local.enc) });
  }

  async function saveConfig(patch, passphrase) {
    cfg = Object.assign({}, cfg, patch);
    if (patch && patch.provider && PROVIDERS[patch.provider] && (patch.baseUrl === undefined || patch.autoPreset)) {
      cfg.baseUrl = PROVIDERS[cfg.provider].baseUrl; cfg.model = PROVIDERS[cfg.provider].model;
    }
    const box = {};
    if (cfg.encrypted && passphrase) {
      box.enc = await encryptText(passphrase, memKey || '');
      memKey = memKey || null; // 密文模式：明文只在解锁后进入内存
    } else if (memKey != null) {
      box.plainKey = memKey;
    }
    const payload = { cfg: { provider: cfg.provider, baseUrl: cfg.baseUrl, model: cfg.model, store: cfg.store, encrypted: !!cfg.encrypted }, ...box };
    writeLocal(payload);
    if (cfg.store === 'cloud' && window.globalDataManager) {
      const r = await window.globalDataManager.getGlobalData();
      if (r?.success) {
        const merged = Object.assign({}, r.data || {});
        merged[CLOUD_KEY] = payload;
        const s = await window.globalDataManager.saveGlobalData(merged);
        if (!s?.success) return { success: false, message: s?.message || '云端保存失败' };
        return { success: true, message: '已保存到云端（user_global_data）' };
      }
      return { success: false, message: '云端不可用（未登录？），仅保存到本地' };
    }
    return { success: true, message: '已保存到本地' };
  }

  /* ---------- 加密（AES-GCM + PBKDF2） ---------- */
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveKey(pass, salt) {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encryptText(pass, plain) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await deriveKey(pass, salt);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plain));
    return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
  }
  async function decryptText(pass, box) {
    const k = await deriveKey(pass, unb64(box.salt));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, k, unb64(box.ct));
    return new TextDecoder().decode(pt);
  }

  async function ensureKey() {
    if (memKey) return memKey;
    const local = readLocal();
    if (local?.enc) {
      const pass = prompt('API Key 已加密。输入加密口令解锁：');
      if (!pass) throw new Error('需要口令解锁 API Key');
      memKey = await decryptText(pass, local.enc);
      return memKey;
    }
    if (local?.plainKey) { memKey = local.plainKey; return memKey; }
    throw new Error('尚未配置 API Key，请先在 AI 设置中填写');
  }

  /* ---------- 流式客户端 ---------- */
  async function chatStream(messages, onDelta, signal) {
    const key = await ensureKey();
    if (!cfg.baseUrl || !cfg.model) throw new Error('请先完成 AI 设置（Base URL / 模型）');
    const res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: cfg.model, messages, stream: true, temperature: 0.4 }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error('API ' + res.status + (t ? '：' + t.slice(0, 180) : ''));
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return full;
        try {
          const j = JSON.parse(payload);
          const d = j.choices?.[0]?.delta?.content;
          if (d) { full += d; if (onDelta) onDelta(d, full); }
        } catch (e) {}
      }
    }
    return full;
  }

  /* ---------- 提示词 ---------- */
  const SYSTEM_REPORT = [
    '你是一位专业魔方 CFOP 教练，基于用户提供的训练统计数据撰写训练分析报告。',
    '数字结论必须引用输入中的数据证据；数据不足时明确说明，不要编造。',
    '聚焦薄弱环节，给出具体、可执行的改进方向。',
    '输出协议（强制）：用二级标题（##）依次输出五个部分：总体结论、数据与趋势、分段诊断、下次训练计划、复测标准。',
    '每个标题后空一行；不使用表格，不使用括号式标题；计划必须包含训练方法、数量、目标与复测方式；',
    '仅当输入包含「Ao12 深挖」数据时，才可在分段诊断之后增加「Ao12 深挖对比」小节。全文中文，不超过 600 字。',
  ].join('\n');

  const SYSTEM_SOLVE = [
    '你是一位专业魔方 CFOP 教练，分析单次复原记录。',
    '输出协议（强制）：用二级标题（##）输出三部分：这把发生了什么、慢在哪里或快在哪里、针对性建议。',
    '不使用表格；引用给出的数字作为证据；全文中文，不超过 220 字。',
  ].join('\n');

  const CALIBER = [
    '【数据口径】DNF 与异常标记记录不参与统计；+2 罚时已计入；CFOP 分段中 U 层转动计为反应/调整而非公式操作；',
    '识别时间 = 看到状态到开始转动，执行时间 = 转动阶段；fluency 为消除 >400ms 停顿后的流畅度百分比。',
  ].join('');

  function ms(msv, d = 2) { return Number.isFinite(Number(msv)) ? (Number(msv) / 1000).toFixed(d) + 's' : '—'; }

  function buildSolvePayload(s, baseline) {
    const L = [];
    L.push(CALIBER);
    L.push(`【单把】${s.analysisType} · ${ms(s.totalTime)}${s.flag === 'plus_two' ? '（+2）' : ''} · TPS ${s.tps ? Number(s.tps).toFixed(2) : '—'} · ${s.turnCount || 0} 步 · Fluency ${Number.isFinite(s.fluencyPercent) ? Math.round(s.fluencyPercent) + '%' : '—'}`);
    if (Array.isArray(s.steps) && s.steps.length) {
      L.push('【分段】' + s.steps.map(x => `${x.label || x.name || x.key}:${x.slotIndex ? 'F2L' + x.slotIndex + ' ' : ''}${ms(x.time)}（识别 ${ms(x.recognition)} / 执行 ${ms(x.execution)}，${x.turns || 0} 步）`).join('；'));
      const cases = s.steps.filter(x => x.caseType && x.caseIndex != null || x.caseName);
      if (cases.length) L.push('【Case】' + cases.map(x => `${x.caseName || (x.caseType + ' ' + x.caseIndex)}（识别 ${ms(x.recognition)}）`).join('；'));
    }
    if (baseline && Number.isFinite(baseline.mean)) {
      const t = Number(s.totalTime), diff = (t - baseline.mean) / baseline.mean;
      L.push(`【对比】个人基线（近 ${baseline.count} 把）均值 ${ms(baseline.mean)}；本把${diff > 0 ? '慢' : '快'} ${Math.abs(diff * 100).toFixed(1)}%${baseline.best && t <= baseline.best ? '；本把为个人最佳！分析为什么快。' : ''}`);
    }
    if (s.scramble) L.push(`【打乱】${s.scramble}`);
    return L.join('\n');
  }

  function buildSessionPayload(solves, opts = {}) {
    const C = window.CubeAnalyzerCore;
    const L = [CALIBER];
    const S = C.solveSummary(solves);
    L.push(`【总览】${S.count} 把（有效 ${S.validCount}，DNF ${S.dnfCount}）；Best ${ms(S.best)}；Mean ${ms(S.mean)}；Median ${ms(S.median)}；CV ${(S.cv * 100).toFixed(1)}%；稳定性 ${Math.round(S.consistency)}%；AO5 ${S.ao5.isDNF ? 'DNF' : ms(S.ao5.time)}；AO12 ${S.ao12.isDNF ? 'DNF' : ms(S.ao12.time)}；AO100 ${S.ao100.isDNF ? 'DNF' : ms(S.ao100.time)}；Median TPS ${S.medianTps ? S.medianTps.toFixed(2) : '—'}；平均流畅度 ${Number.isFinite(S.avgFluency) ? Math.round(S.avgFluency) + '%' : '—'}`);
    const method = opts.method || (solves.length ? solves[solves.length - 1].analysisType : 'CFOP');
    const ms2 = solves.filter(x => x.analysisType === method && x.steps?.length);
    if (ms2.length) {
      const avg = C.averageSplits(ms2, method);
      L.push('【分段均值】' + avg.filter(x => x.time > 0).map(x => `${x.label}: ${ms(x.time)}（识别 ${ms(x.recognition)} / 执行 ${ms(x.execution)}，TPS ${x.tps ? x.tps.toFixed(1) : '—'}，n=${x.count}）`).join('；'));
    }
    const caseRows = C.caseStatistics(solves.filter(x => x.flag !== 'dnf'));
    const weak = caseRows.slice().sort((a, b) => (Number(b.median) || 0) - (Number(a.median) || 0)).slice(0, 12);
    if (weak.length) L.push('【案例薄弱点（按个人中位耗时降序，最多 12 条）】' + weak.map(r => `${r.caseName}: n=${r.count}，中位 ${ms(r.median)}，P20 ${ms(r.p20)} / P80 ${ms(r.p80)}（识别 ${ms(r.medianRecognition)} / 执行 ${ms(r.medianExecution)}）`).join('；'));
    if (opts.baseline) L.push(`【今日 vs 基线】今日 ${opts.baseline.todayCount || 0} 把${opts.baseline.todayMean ? '，均值 ' + ms(opts.baseline.todayMean) : ''}；基线（近 ${opts.baseline.count} 把）均值 ${ms(opts.baseline.mean)}、最优 ${ms(opts.baseline.best)}${opts.baseline.todayMean && opts.baseline.mean ? `；今日相对基线${opts.baseline.todayMean < opts.baseline.mean ? '快' : '慢'} ${Math.abs((opts.baseline.todayMean - opts.baseline.mean) / opts.baseline.mean * 100).toFixed(1)}%` : ''}`);
    if (opts.ao12) L.push('【Ao12 深挖】\n' + opts.ao12);
    return L.join('\n');
  }

  /* Best/Worst Ao12 深挖：滑窗找最优与最差窗口，输出逐把时间线 */
  function ao12DeepDive(solves) {
    const C = window.CubeAnalyzerCore;
    const valid = solves.filter(x => window.CubeAnalyzerQuality ? !window.CubeAnalyzerQuality.active(x) : true).filter(x => x.flag !== 'dnf');
    if (valid.length < 12) return null;
    let best = null, worst = null;
    for (let i = 0; i <= valid.length - 12; i++) {
      const r = C.averageWithFlags(valid.slice(i, i + 12));
      if (!Number.isFinite(r.time)) continue;
      if (!best || r.time < best.time) best = { ...r, start: i };
      if (!worst || r.time > worst.time) worst = { ...r, start: i };
    }
    if (!best || !worst) return null;
    const line = (win) => valid.slice(win.start, win.start + 12).map((s, i) => `${i + 1}.${ms(C.displayTimeMs(s))}${s.steps?.length ? '' : '*'}`).join(' ');
    const fmt = (name, win) => `${name}（AO12 ${ms(win.time)}，起始第 ${win.start + 1} 把）：\n${line(win)}`;
    return `最佳窗口 ${fmt('Best', best)}\n最差窗口 ${fmt('Worst', worst)}\n（* = 无分段数据）`;
  }

  /* ---------- 受限 Markdown 渲染（h2 / 列表 / 加粗 / 行内代码，全部转义） ---------- */
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function inline(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  function renderMd(text) {
    const lines = String(text || '').split(/\r?\n/);
    let html = '', list = null;
    const flush = () => { if (list) { html += `<${list}>${listItems.join('')}</${list}>`; list = null; listItems = []; } };
    let listItems = [];
    for (const raw of lines) {
      const line = raw.trimEnd();
      const h2 = line.match(/^##\s+(.*)$/);
      const ul = line.match(/^[-*]\s+(.*)$/);
      const ol = line.match(/^\d+[.、]\s+(.*)$/);
      if (h2) { flush(); html += `<h2>${inline(h2[1])}</h2>`; continue; }
      if (ul) { if (list !== 'ul') { flush(); list = 'ul'; } listItems.push(`<li>${inline(ul[1])}</li>`); continue; }
      if (ol) { if (list !== 'ol') { flush(); list = 'ol'; } listItems.push(`<li>${inline(ol[1])}</li>`); continue; }
      if (!line.trim()) { flush(); continue; }
      flush(); html += `<p>${inline(line)}</p>`;
    }
    flush();
    return html;
  }

  /* ---------- UI ---------- */
  const el = (id) => document.getElementById(id);
  let hooks = {};   // {getFiltered, getBaseline, getTodayStats}

  function renderTabShell() {
    const host = el('aiContent');
    if (!host || host.dataset.ready) return;
    host.dataset.ready = '1';
    host.innerHTML = `
      <div class="ai-toolbar card compact-card">
        <button class="btn btn-primary" id="aiGenBtn" type="button">生成 AI 报告</button>
        <label class="toolbar-check"><input id="aiAo12Toggle" type="checkbox" checked> <span>Ao12 深挖</span></label>
        <span class="ai-provider-chip" id="aiProviderChip"></span>
        <button class="btn btn-ghost" id="aiSettingsBtn" type="button" style="margin-left:auto">AI 设置</button>
      </div>
      <div class="ai-output card" id="aiOutput" style="margin-top:10px"><div class="empty"><strong>还没有 AI 报告</strong><span>按当前筛选数据生成；口径与统计页一致（DNF 与异常记录自动排除）。</span></div></div>`;
    el('aiGenBtn').onclick = generateReport;
    el('aiSettingsBtn').onclick = openSettings;
    updateChip();
  }

  function updateChip() {
    const chip = el('aiProviderChip');
    if (chip && cfg) chip.textContent = `${(PROVIDERS[cfg.provider] || {}).label || cfg.provider} · ${cfg.model || '未配置模型'}${memKey ? '' : cfg?.encrypted ? ' · 已加密（待解锁）' : ' · 未配置 Key'}`;
  }

  function setOutput(html) { const o = el('aiOutput'); if (o) o.innerHTML = html; }

  async function runChat(system, user, { stream = true } = {}) {
    setOutput('<div class="ai-loading">AI 正在分析…</div>');
    try {
      const full = await chatStream([
        { role: 'system', content: system },
        { role: 'user', content: user },
      ], stream ? (_d, acc) => { const o = el('aiOutput'); if (o) o.innerHTML = `<div class="ai-report">${renderMd(acc)}</div>`; } : null);
      setOutput(`<div class="ai-report">${renderMd(full)}</div>`);
    } catch (e) {
      const msg = String(e?.message || e);
      setOutput(`<div class="empty"><strong>AI 分析失败</strong><span>${esc(msg)}</span></div>`);
    }
  }

  function generateReport() {
    const solves = (hooks.getFiltered ? hooks.getFiltered() : []).filter(x => x.flag !== 'dnf' && !(window.CubeAnalyzerQuality && window.CubeAnalyzerQuality.active(x)));
    if (!solves.length) { setOutput('<div class="empty"><strong>没有可分析的数据</strong><span>调整筛选器或先完成训练。</span></div>'); return; }
    const opts = {
      method: undefined,
      baseline: hooks.getBaseline ? hooks.getBaseline() : null,
      ao12: el('aiAo12Toggle')?.checked ? ao12DeepDive(solves) : null,
    };
    return runChat(SYSTEM_REPORT, buildSessionPayload(solves, opts));
  }

  /* 单把分析：注入到单次详情弹窗 */
  async function askSolve(s, host) {
    const baseline = hooks.getBaseline ? hooks.getBaseline() : null;
    const body = buildSolvePayload(s, baseline);
    const box = document.createElement('div');
    box.className = 'ai-inline';
    box.innerHTML = '<div class="ai-loading">AI 正在分析本把…</div>';
    host.appendChild(box);
    try {
      let acc = '';
      await chatStream([{ role: 'system', content: SYSTEM_SOLVE }, { role: 'user', content: body }], (_d, full) => {
        acc = full; box.innerHTML = `<div class="ai-report">${renderMd(acc)}</div>`;
      });
      box.innerHTML = `<div class="ai-report">${renderMd(acc)}</div>`;
    } catch (e) {
      box.innerHTML = `<div class="ai-inline-error">AI 分析失败：${esc(String(e?.message || e))}</div>`;
    }
  }

  /* ---------- 设置面板 ---------- */
  function openSettings() {
    const local = readLocal();
    const c = Object.assign({}, cfg, {});
    const m = document.createElement('div');
    m.className = 'modal-backdrop'; m.id = 'aiSettingsModal';
    m.innerHTML = `
      <div class="modal card" role="dialog" aria-modal="true" aria-label="AI 设置">
        <div class="modal-head"><h2>AI 设置</h2><button class="icon-btn" data-close type="button">×</button></div>
        <div class="ai-settings-body">
          <label class="field-col"><span>供应商</span>
            <select id="aiProvider">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${c.provider === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
          </label>
          <label class="field-col"><span>Base URL</span><input id="aiBaseUrl" type="text" value="${esc(c.baseUrl || '')}" placeholder="https://api.deepseek.com/v1"></label>
          <label class="field-col"><span>模型</span><input id="aiModel" type="text" value="${esc(c.model || '')}" placeholder="deepseek-chat"></label>
          <label class="field-col"><span>API Key ${local?.enc ? '<em class="ai-hint">已加密保存</em>' : (memKey ? '<em class="ai-hint">已保存</em>' : '')}</span><input id="aiKey" type="password" placeholder="${memKey ? '已保存在本会话' : 'sk-…'}"></label>
          <div class="field-row">
            <span class="field-label">保存位置</span>
            <label class="toolbar-check"><input type="radio" name="aiStore" value="local" ${c.store !== 'cloud' ? 'checked' : ''}> <span>本地</span></label>
            <label class="toolbar-check"><input type="radio" name="aiStore" value="cloud" ${c.store === 'cloud' ? 'checked' : ''}> <span>云端（随账号）</span></label>
          </div>
          <div class="field-row">
            <label class="toolbar-check"><input id="aiEnc" type="checkbox" ${c.encrypted ? 'checked' : ''}> <span>加密保存 Key</span></label>
            <input id="aiPass" type="password" placeholder="加密口令（勾选加密时必填）" style="flex:1;height:34px;border:1px solid var(--border);border-radius:8px;background:var(--input);color:var(--foreground);padding:0 10px">
          </div>
          <p class="ai-hint-line">直连说明：浏览器直连供应商 API，不经任何中转；Key 保存在你的浏览器或你的账号数据（user_global_data）里，加密时落盘为 AES-GCM 密文。实测可直连：DeepSeek / SiliconFlow / OpenRouter。</p>
          <div class="ai-settings-actions">
            <button class="btn btn-ghost" id="aiTestBtn" type="button">测试连接</button>
            <button class="btn btn-primary" id="aiSaveBtn" type="button">保存</button>
          </div>
          <div class="ai-test-result" id="aiTestResult"></div>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) close(); };
    m.querySelector('#aiProvider').onchange = e => {
      const p = PROVIDERS[e.target.value];
      if (p && e.target.value !== 'custom') { m.querySelector('#aiBaseUrl').value = p.baseUrl; m.querySelector('#aiModel').value = p.model; }
    };
    m.querySelector('#aiTestBtn').onclick = async () => {
      const r = m.querySelector('#aiTestResult');
      r.textContent = '测试中…';
      try {
        const baseUrl = m.querySelector('#aiBaseUrl').value.trim(), model = m.querySelector('#aiModel').value.trim();
        const keyIn = m.querySelector('#aiKey').value.trim();
        const key = keyIn || memKey;
        if (!key) throw new Error('请填写 API Key（或已解锁）');
        const res = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 4, stream: false }),
        });
        if (res.ok) r.textContent = `✓ 连接成功（${model}）`;
        else r.textContent = `✗ HTTP ${res.status}：${(await res.text().catch(() => '')).slice(0, 140)}`;
      } catch (e) { r.textContent = '✗ ' + String(e?.message || e); }
    };
    m.querySelector('#aiSaveBtn').onclick = async () => {
      const r = m.querySelector('#aiTestResult');
      const keyIn = m.querySelector('#aiKey').value.trim();
      if (keyIn) memKey = keyIn;
      const encrypted = m.querySelector('#aiEnc').checked;
      const pass = m.querySelector('#aiPass').value;
      if (encrypted && !pass) { r.textContent = '✗ 勾选加密后必须填写加密口令'; return; }
      const res = await saveConfig({
        provider: m.querySelector('#aiProvider').value,
        baseUrl: m.querySelector('#aiBaseUrl').value.trim(),
        model: m.querySelector('#aiModel').value.trim(),
        store: m.querySelector('input[name="aiStore"]:checked')?.value || 'local',
        encrypted, autoPreset: false,
      }, encrypted ? pass : null);
      r.textContent = (res.success ? '✓ ' : '✗ ') + res.message;
      updateChip();
      if (res.success) setTimeout(close, 700);
    };
  }

  /* ---------- 启动 ---------- */
  function init(h) {
    hooks = h || {};
    return loadConfig().then(() => { renderTabShell(); });
  }

  window.CubeAnalyzerAI = { init, generateReport, askSolve, openSettings, renderTabShell, ao12DeepDive };
})();

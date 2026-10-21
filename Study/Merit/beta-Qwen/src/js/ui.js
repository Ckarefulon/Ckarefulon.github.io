/* =========================================================================
 * ui.js —— 通用 UI 工具：图标 / 表单控件 / Toast / Modal / 进度条 / 格式化
 * ========================================================================= */
(function () {
  const ZC = window.ZC;
  ZC.ui = {};

  /* ------------------------------------------------------- HTML 转义 */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  ZC.esc = esc; ZC.ui.esc = esc;

  /* ------------------------------------------------------------- 图标 */
  const P = {
    dashboard: '<rect x="3" y="3" width="7.5" height="8.5" rx="1.6"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.6"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.6"/><rect x="3" y="14.5" width="7.5" height="6.5" rx="1.6"/>',
    shield: '<path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6l7-3z"/><path d="M9.2 12.2l2 2 3.6-3.9"/>',
    rocket: '<path d="M5.5 15.5c-1.5 1.5-2 5-2 5s3.5-.5 5-2c.9-.9.9-2.2 0-3s-2.1-.9-3 0z"/><path d="M9.5 14.5l-3-3C8 8 11 4.5 15.5 3.2c1.6-.5 3.2-.2 4.3.9s1.4 2.7.9 4.3C19.4 12.9 16 15.9 12.5 17.5l-3-3z"/><circle cx="15" cy="9" r="1.6"/>',
    award: '<circle cx="12" cy="9" r="5.5"/><path d="M8.6 13.8L7 22l5-2.6L17 22l-1.6-8.2"/>',
    folder: '<path d="M3 7.5A2 2 0 015 5.5h3.9a2 2 0 011.6.8l.9 1.2H19a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    flask: '<path d="M9.5 3v6.2L4.7 17.4A2 2 0 006.4 20.5h11.2a2 2 0 001.7-3.1L14.5 9.2V3"/><path d="M8.5 3h7"/><path d="M7.3 14.5h9.4"/>',
    users: '<circle cx="9" cy="8" r="3.4"/><path d="M2.8 20c.4-3.4 3.1-5.6 6.2-5.6s5.8 2.2 6.2 5.6"/><path d="M16.5 5.2a3.4 3.4 0 010 6.4"/><path d="M18 14.8c2.1.6 3.5 2.5 3.7 5.2"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7v5.3l3.3 2"/>',
    book: '<path d="M4 5.2A2.2 2.2 0 016.2 3H19v15H6.2A2.2 2.2 0 004 20.2z"/><path d="M4 18.2A2.2 2.2 0 016.2 16H19v5H6.2A2.2 2.2 0 014 18.8z"/>',
    gear: '<circle cx="12" cy="12" r="3.1"/><path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7h-.2a2 2 0 110-4h.1a1.6 1.6 0 001.1-2.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 002.7-1.1v-.2a2 2 0 114 0v.1a1.6 1.6 0 002.8 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 001.1 2.7h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M9.5 7V5.2A1.2 1.2 0 0110.7 4h2.6a1.2 1.2 0 011.2 1.2V7"/><path d="M6.5 7l.8 12.1A1.6 1.6 0 008.9 20.6h6.2a1.6 1.6 0 001.6-1.5L17.5 7"/><path d="M10.3 11v6M13.7 11v6"/>',
    copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M5.5 15H4.8A1.8 1.8 0 013 13.2V4.8A1.8 1.8 0 014.8 3h8.4A1.8 1.8 0 0115 4.8v.7"/>',
    check: '<path d="M4.5 12.5l5 5 10-11"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    down: '<path d="M6 9.5l6 6 6-6"/>',
    right: '<path d="M9.5 6l6 6-6 6"/>',
    download: '<path d="M12 3.5v12"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>',
    upload: '<path d="M12 16.5v-12"/><path d="M7.5 9L12 4.5 16.5 9"/><path d="M4 20h16"/>',
    print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="7" rx="1.8"/><path d="M7 14h10v6H7z"/>',
    undo: '<path d="M4 9h10.5a5 5 0 010 10H8"/><path d="M7.5 5.5L4 9l3.5 3.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    alert: '<path d="M12 3.5l9.5 16.5H2.5z"/><path d="M12 9.5v4.5M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.5M12 7.8h.01"/>',
    bulb: '<path d="M9 17.5h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 00-3.6 10.8c.5.4.8 1 .9 1.7h5.4c.1-.7.4-1.3.9-1.7A6 6 0 0012 3z"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1"/>',
    trend: '<path d="M3.5 16.5l5.5-6 4 4 7.5-8"/><path d="M15 6.5h5.5V12"/>',
    calc: '<rect x="4.5" y="2.8" width="15" height="18.4" rx="2.2"/><path d="M8 7h8"/><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.2h.01M12 18.2h.01M15.5 18.2h.01"/>',
    list: '<path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M3.8 6.5h.01M3.8 12h.01M3.8 17.5h.01"/>',
    pin: '<path d="M12 21s7-6.1 7-11a7 7 0 10-14 0c0 4.9 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
    user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.8 20.2c.5-3.8 3.6-6.2 7.2-6.2s6.7 2.4 7.2 6.2"/>',
    star: '<path d="M12 3.6l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.8l5.9-.8z"/>',
    minus: '<path d="M5 12h14"/>'
  };
  ZC.ui.icon = function (name, size) {
    const s = size || 18;
    return `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.info}</svg>`;
  };

  /* ------------------------------------------------------------ Toast */
  ZC.ui.toast = function (msg, type, ms) {
    const root = document.getElementById('toast-root'); if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast toast--' + (type || 'ok');
    const ic = type === 'danger' ? 'alert' : type === 'warn' ? 'alert' : type === 'muted' ? 'info' : 'check';
    el.innerHTML = ZC.ui.icon(ic, 16) + '<span>' + esc(msg) + '</span>';
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 260); }, ms || 2600);
  };
  ZC.ui.flashSaved = function (memoryOnly) {
    const el = document.getElementById('save-state');
    if (!el) return;
    const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    el.textContent = memoryOnly ? ('已保存（仅本次会话）' + t) : ('已保存 ' + t);
    el.classList.toggle('is-mem', !!memoryOnly);
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
  };

  /* ------------------------------------------------------------ Modal */
  ZC.ui.modal = function (opt) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="mask" data-close="1"><div class="modal ${opt.wide ? 'modal--wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal__hd"><h3>${esc(opt.title || '')}</h3><button class="ibtn" data-close="1" aria-label="关闭">${ZC.ui.icon('x', 18)}</button></div>
      <div class="modal__bd">${opt.body || ''}</div>
      ${opt.actions ? `<div class="modal__ft">${opt.actions}</div>` : ''}
    </div></div>`;
    root.classList.add('on');
    const close = () => { root.classList.remove('on'); root.innerHTML = ''; document.removeEventListener('keydown', onKey); ZC.ui._closeModal = null; };
    ZC.ui._closeModal = close;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', (e) => { if (e.target.closest('.modal') && !e.target.closest('[data-close]')) return; close(); }));
    const okBtn = root.querySelector('[data-ok]');
    if (okBtn) okBtn.addEventListener('click', () => { if (opt.onOk) { if (opt.onOk(root) === false) return; } close(); });
    if (opt.onOpen) opt.onOpen(root, close);
    return { close, root };
  };
  ZC.ui.closeModal = function () { if (ZC.ui._closeModal) ZC.ui._closeModal(); };

  ZC.ui.confirm = function (title, msg, onOk, okLabel) {
    ZC.ui.modal({
      title, body: `<p class="muted" style="margin:0;line-height:1.7">${msg}</p>`,
      actions: `<button class="btn" data-close="1">取消</button><button class="btn btn--danger" data-ok="1">${esc(okLabel || '确定')}</button>`,
      onOk
    });
  };

  /* --------------------------------------------------------- 表单控件 */
  const uidK = (k) => ` data-k="${esc(k)}"`;
  ZC.ui.txt = (k, v, opt) => `<input class="inp" type="text"${uidK(k)} value="${esc(v == null ? '' : v)}" placeholder="${esc((opt || {}).ph || '')}" ${(opt || {}).attr || ''}>`;
  ZC.ui.num = (k, v, opt) => {
    const o = opt || {};
    return `<input class="inp ${o.cls || ''}" type="number" inputmode="decimal"${uidK(k)} data-t="num" value="${v == null || v === '' ? '' : esc(v)}" placeholder="${esc(o.ph || '')}" ${o.min !== undefined ? `min="${o.min}"` : ''} ${o.max !== undefined ? `max="${o.max}"` : ''} ${o.step ? `step="${o.step}"` : 'step="any"'} style="${o.width ? 'width:' + o.width : ''}">`;
  };
  ZC.ui.date = (k, v) => `<input class="inp" type="date"${uidK(k)} value="${esc(v || '')}">`;
  ZC.ui.sel = (k, v, options, opt) => {
    const o = opt || {};
    return `<select class="inp"${uidK(k)} ${o.t ? `data-t="${o.t}"` : ''} style="${o.width ? 'width:' + o.width : ''}">
      ${o.ph ? `<option value="">${esc(o.ph)}</option>` : ''}
      ${options.map(x => {
        const val = typeof x === 'object' ? x.id : x, lab = typeof x === 'object' ? x.label : x;
        return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select>`;
  };
  ZC.ui.chk = (k, v, label, opt) => `<label class="chk ${(opt || {}).cls || ''}"><input type="checkbox"${uidK(k)} data-t="bool" ${v ? 'checked' : ''}><span class="chk__box"></span>${label ? `<span>${label}</span>` : ''}</label>`;
  ZC.ui.field = (label, control, hint) => `<div class="fld"><label class="fld__l">${esc(label)}</label><div class="fld__c">${control}${hint ? `<div class="fld__h">${hint}</div>` : ''}</div></div>`;
  ZC.ui.btn = (label, act, opt) => {
    const o = opt || {};
    return `<button class="btn ${o.cls || ''}" data-act="${esc(act)}" ${o.arg !== undefined ? `data-arg="${esc(o.arg)}"` : ''} ${o.k ? `data-k="${esc(o.k)}"` : ''} ${o.dis ? 'disabled' : ''} title="${esc(o.title || '')}">${o.icon ? ZC.ui.icon(o.icon, o.iconSize || 15) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
  };
  ZC.ui.ibtn = (act, iconName, opt) => {
    const o = opt || {};
    return `<button class="ibtn ${o.cls || ''}" data-act="${esc(act)}" ${o.arg !== undefined ? `data-arg="${esc(o.arg)}"` : ''} title="${esc(o.title || '')}" aria-label="${esc(o.title || iconName)}">${ZC.ui.icon(iconName, o.size || 16)}</button>`;
  };

  /* ------------------------------------------------------- 进度条/环 */
  ZC.ui.bar = function (value, max, opt) {
    const o = opt || {};
    const pct = max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
    return `<div class="bar ${o.cls || ''}" ${o.title ? `title="${esc(o.title)}"` : ''}><i style="width:${pct.toFixed(2)}%;${o.color ? 'background:' + o.color : ''}"></i></div>`;
  };
  ZC.ui.ring = function (value, max, label, sub) {
    const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
    const C = 2 * Math.PI * 42;
    return `<div class="ring">
      <svg viewBox="0 0 100 100" width="132" height="132">
        <circle cx="50" cy="50" r="42" class="ring__bg"/>
        <circle cx="50" cy="50" r="42" class="ring__fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${(C * (1 - pct)).toFixed(1)}"/>
      </svg>
      <div class="ring__c"><b>${ZC.fmt(value)}</b><span>${esc(sub || ('/ ' + max))}</span><em>${esc(label || '')}</em></div>
    </div>`;
  };

  /* ------------------------------------------------------- 徽章 / 标签 */
  ZC.ui.badge = (text, tone, title) => `<span class="badge badge--${tone || 'muted'}" ${title ? `title="${esc(title)}"` : ''}>${esc(text)}</span>`;
  ZC.ui.statusSel = (k, v) => ZC.ui.sel(k, v, ZC.EVIDENCE_STATUS.map(s => ({ id: s.id, label: s.label })), { width: '104px' });
  ZC.ui.statusBadge = (id) => {
    const s = ZC.EVIDENCE_STATUS.find(x => x.id === id) || ZC.EVIDENCE_STATUS[0];
    return ZC.ui.badge(s.label, s.tone);
  };

  /* --------------------------------------------------------- 卡片容器 */
  ZC.ui.card = (title, body, opt) => {
    const o = opt || {};
    return `<section class="card ${o.cls || ''}" ${o.id ? `id="${o.id}"` : ''}>
      ${title ? `<header class="card__hd">${o.icon ? `<span class="card__ic">${ZC.ui.icon(o.icon, 17)}</span>` : ''}<h2>${title}</h2>${o.sub ? `<p class="card__sub">${o.sub}</p>` : ''}${o.actions ? `<div class="card__act">${o.actions}</div>` : ''}</header>` : ''}
      <div class="card__bd">${body}</div>
    </section>`;
  };

  ZC.ui.empty = (iconName, title, desc, action) => `<div class="empty">${ZC.ui.icon(iconName || 'folder', 30)}<h4>${esc(title)}</h4>${desc ? `<p>${desc}</p>` : ''}${action || ''}</div>`;

  /* --------------------------------------------------------- 复制到剪贴板 */
  ZC.ui.copy = async function (text, okMsg) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      ZC.ui.toast(okMsg || '已复制到剪贴板', 'ok');
    } catch (e) { ZC.ui.toast('复制失败，请手动选择文本复制', 'danger'); }
  };

  /* ---------------------------------------------------------  misc */
  ZC.ui.pct = (v) => Math.round(v * 100) + '%';
  ZC.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
})();

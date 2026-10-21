/* =========================================================================
 * merit-ui.js — 图标 / 通用控件 / 卡片等渲染片段
 * 只产出 HTML 字符串，交互统一走 data-k（字段）与 data-act（动作）委托。
 * ========================================================================= */
(function () {
	'use strict';
	var ZC = window.ZC;

	function esc(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}
	ZC.esc = esc;

	/* ------------------------------------------------------------- 图标 */
	var P = {
		overview: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>',
		shield: '<path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M9.2 12.2l2 2 3.6-3.8"/>',
		rocket: '<path d="M13.5 3.5c3.5-.5 6.5 2.5 6 6-3 1-5 3-6.5 6L9 12c3-1.5 3.5-4.5 4.5-8.5z"/><path d="M9 12l-4 1 2 2-1 4 4-1 2 2 1-4"/><circle cx="15.5" cy="8.5" r="1.3"/>',
		award: '<circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2.2L16 21l-1-7.5"/>',
		calc: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 7h8M8 12h2M12 12h2M16 12h.01M8 16h2M12 16h2M16 16h.01"/>',
		folder: '<path d="M3 7.5A2.5 2.5 0 015.5 5h3.2a2 2 0 011.6.8L11.5 7H18a3 3 0 013 3v6.5A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5z"/>',
		flask: '<path d="M9 3h6M10 3v5L5.5 17A2.5 2.5 0 007.8 21h8.4a2.5 2.5 0 002.3-4L14 8V3"/><path d="M7.5 14h9"/>',
		users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 6.2a3 3 0 010 5.6M17 15.2c2 .5 3.5 2.3 3.5 4.8"/>',
		clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
		book: '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/><path d="M4 18.5V5.5M8 7h7M8 11h5"/>',
		gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8l1.4 2.2 2.6-.5.6 2.6 2.2 1.4-1.4 2.2 1.4 2.2-2.2 1.4-.6 2.6-2.6-.5L12 21.2l-1.4-2.2-2.6.5-.6-2.6L5.2 15.4 6.6 13.2 5.2 11l2.2-1.4.6-2.6 2.6.5z"/>',
		user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5c0-3.6 3.4-6 7.5-6s7.5 2.4 7.5 6"/>',
		list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
		download: '<path d="M12 3v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 18.5h15"/>',
		upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4.5 18.5h15"/>',
		trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 13h9.4l.8-13"/><path d="M10.5 11v5M13.5 11v5"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 5.5A2 2 0 0013.5 4H6a2 2 0 00-2 2v7.5a2 2 0 001.5 1.9"/>',
		check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
		x: '<path d="M6 6l12 12M18 6L6 18"/>',
		moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>',
		sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M18.7 5.3L17 7M7 17l-1.7 1.7"/>',
		undo: '<path d="M4 9h10.5a5 5 0 010 10H9"/><path d="M8 5L4 9l4 4"/>',
		alert: '<path d="M12 4.5L21 20H3z"/><path d="M12 10v4.5M12 17h.01"/>',
		info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8h.01"/>',
		bulb: '<path d="M9.5 17.5h5M10 21h4"/><path d="M12 3a6 6 0 00-3.5 10.9V15h7v-1.1A6 6 0 0012 3z"/>',
		trend: '<path d="M4 17l5-5 3.5 3.5L20 8"/><path d="M15.5 8H20v4.5"/>',
		target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
		right: '<path d="M9 5l7 7-7 7"/>',
		down: '<path d="M5 9l7 7 7-7"/>',
		search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>',
		cloud: '<path d="M7 18a4 4 0 01-.4-8A5.5 5.5 0 0117.4 9.5 3.7 3.7 0 0117 18z"/>',
		print: '<path d="M7 8V4h10v4"/><rect x="4" y="8" width="16" height="7" rx="2"/><path d="M7 14h10v6H7z"/>',
		pencil: '<path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14.5 5.5l3 3"/>',
		save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>'
	};

	function icon(name, size) {
		var d = P[name] || P.info;
		var s = size || 18;
		return '<svg class="ico" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
			'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
	}
	ZC.icon = icon;

	/* ------------------------------------------------------------- 进度条 */
	function bar(cur, max, cls) {
		var pct = max > 0 ? Math.min(100, Math.max(0, cur / max * 100)) : 0;
		var full = max > 0 && cur >= max - 1e-9;
		return '<span class="bar ' + (cls || '') + '"><span class="bar-fill ' + (full ? 'is-full' : '') + '" style="width:' + pct.toFixed(1) + '%"></span></span>';
	}
	ZC.bar = bar;

	/* ------------------------------------------------------------- 环形进度 */
	function ring(cur, max, opts) {
		opts = opts || {};
		var pct = max > 0 ? Math.min(1, Math.max(0, cur / max)) : 0;
		var R = 42, C = 2 * Math.PI * R;
		var size = opts.size || 118;
		return '<div class="ring" style="width:' + size + 'px;height:' + size + 'px">' +
			'<svg viewBox="0 0 100 100" aria-hidden="true">' +
			'<circle class="ring-track" cx="50" cy="50" r="' + R + '"/>' +
			'<circle class="ring-fill" cx="50" cy="50" r="' + R + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '"/>' +
			'</svg>' +
			'<div class="ring-text"><b>' + ZC.fmt(cur) + '</b>' + (opts.sub ? '<i>' + opts.sub + '</i>' : '') + '</div>' +
			'</div>';
	}
	ZC.ring = ring;

	/* ------------------------------------------------------------- 卡片 */
	function card(title, body, opts) {
		opts = opts || {};
		return '<section class="card ' + (opts.cls || '') + '">' +
			(opts.bare ? '' : '<header class="card-head">' +
				'<div class="card-title">' + (opts.icon ? '<span class="card-ico">' + icon(opts.icon, 16) + '</span>' : '') + title + '</div>' +
				(opts.actions ? '<div class="card-acts">' + opts.actions + '</div>' : '') +
				'</header>') +
			(opts.sub ? '<p class="card-sub">' + opts.sub + '</p>' : '') +
			'<div class="card-body">' + body + '</div>' +
			'</section>';
	}
	ZC.card = card;

	function btn(label, act, opts) {
		opts = opts || {};
		return '<button type="button" class="btn ' + (opts.cls || '') + '" data-act="' + act + '"' +
			(opts.arg !== undefined ? ' data-arg="' + esc(opts.arg) + '"' : '') +
			(opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' +
			(opts.icon ? icon(opts.icon, 14) : '') + '<span>' + label + '</span></button>';
	}
	ZC.btn = btn;

	function iconBtn(act, name, opts) {
		opts = opts || {};
		return '<button type="button" class="icon-btn ' + (opts.cls || '') + '" data-act="' + act + '"' +
			(opts.arg !== undefined ? ' data-arg="' + esc(opts.arg) + '"' : '') +
			(opts.title ? ' title="' + esc(opts.title) + '" aria-label="' + esc(opts.title) + '"' : '') + '>' +
			icon(name, opts.size || 15) + '</button>';
	}
	ZC.iconBtn = iconBtn;

	function pill(text, tone) {
		return '<span class="pill pill-' + (tone || 'muted') + '">' + esc(text) + '</span>';
	}
	ZC.pill = pill;

	function statusPill(id) {
		var s = ZC.EVIDENCE_STATUS.filter(function (x) { return x.id === id; })[0] || ZC.EVIDENCE_STATUS[0];
		return '<span class="pill pill-' + s.tone + '">' + s.label + '</span>';
	}
	ZC.statusPill = statusPill;

	function empty(name, title, sub) {
		return '<div class="empty"><span class="empty-ico">' + icon(name || 'info', 22) + '</span>' +
			'<b>' + esc(title) + '</b>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</div>';
	}
	ZC.empty = empty;

	/* ------------------------------------------------------------- 表单控件 */
	function val(v) { return v == null ? '' : String(v); }

	function txt(path, value, opts) {
		opts = opts || {};
		return '<input class="inp" type="text" data-k="' + path + '" data-t="text" value="' + esc(val(value)) + '"' +
			(opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') +
			(opts.max ? ' maxlength="' + opts.max + '"' : '') + ' autocomplete="off">';
	}
	function numIn(path, value, opts) {
		opts = opts || {};
		return '<input class="inp inp-num" type="number" data-k="' + path + '" data-t="num" value="' + esc(val(value)) + '"' +
			(opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') +
			(opts.min !== undefined ? ' min="' + opts.min + '"' : '') +
			(opts.max !== undefined ? ' max="' + opts.max + '"' : '') +
			(opts.step !== undefined ? ' step="' + opts.step + '"' : '') +
			' inputmode="decimal">';
	}
	function area(path, value, opts) {
		opts = opts || {};
		return '<textarea class="inp inp-ta" data-k="' + path + '" data-t="text" rows="' + (opts.rows || 3) + '"' +
			(opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') + '>' + esc(val(value)) + '</textarea>';
	}
	function dateIn(path, value) {
		return '<input class="inp inp-date" type="date" data-k="' + path + '" data-t="text" value="' + esc(val(value)) + '">';
	}
	function sel(path, value, options, opts) {
		opts = opts || {};
		var html = '<select class="inp inp-sel" data-k="' + path + '" data-t="text">';
		(options || []).forEach(function (o) {
			var id = (typeof o === 'string') ? o : o.id;
			var label = (typeof o === 'string') ? o : o.label;
			html += '<option value="' + esc(id) + '"' + (String(id) === String(value) ? ' selected' : '') + '>' + esc(label) + '</option>';
		});
		html += '</select>';
		return html;
	}
	function field(label, control, hint) {
		return '<label class="field"><span class="field-label">' + label + '</span>' + control +
			(hint ? '<span class="field-hint">' + hint + '</span>' : '') + '</label>';
	}

	function switchCtl(path, checked, text) {
		return '<label class="sw"><input type="checkbox" data-k="' + path + '" data-t="bool"' + (checked ? ' checked' : '') + '>' +
			'<span class="sw-track"><span class="sw-knob"></span></span>' +
			(text ? '<span class="sw-text">' + text + '</span>' : '') + '</label>';
	}

	function stepper(path, value, opts) {
		opts = opts || {};
		var step = opts.step === undefined ? 1 : opts.step;
		var min = opts.min === undefined ? 0 : opts.min;
		var max = opts.max === undefined ? 99 : opts.max;
		return '<span class="stepper">' +
			'<button type="button" class="step-btn" data-act="dec" data-arg="' + path + '|' + step + '|' + min + '" aria-label="减少">−</button>' +
			'<input class="step-in" type="number" data-k="' + path + '" data-t="num" value="' + esc(val(value)) + '" min="' + min + '" max="' + max + '" step="' + step + '" inputmode="numeric">' +
			'<button type="button" class="step-btn" data-act="inc" data-arg="' + path + '|' + step + '|' + max + '" aria-label="增加">+</button>' +
			'</span>';
	}

	function seg(path, value, options) {
		return '<span class="seg">' + (options || []).map(function (o) {
			var id = (typeof o === 'string') ? o : o.id;
			var label = (typeof o === 'string') ? o : o.label;
			return '<button type="button" class="seg-btn' + (String(id) === String(value) ? ' is-on' : '') +
				'" data-act="seg" data-arg="' + path + '|' + esc(id) + '">' + label + '</button>';
		}).join('') + '</span>';
	}

	function row(label, control, opts) {
		opts = opts || {};
		return '<div class="row ' + (opts.cls || '') + '">' +
			'<div class="row-main"><span class="row-label">' + label + '</span>' +
			(opts.sub ? '<span class="row-sub">' + opts.sub + '</span>' : '') + '</div>' +
			'<div class="row-ctl">' + control + '</div>' +
			(opts.val !== undefined ? '<div class="row-val ' + (opts.valOn ? 'is-on' : '') + '">' + opts.val + '</div>' : '') +
			'</div>';
	}

	ZC.ui = {
		esc: esc, icon: icon, bar: bar, ring: ring, card: card, btn: btn, iconBtn: iconBtn,
		pill: pill, statusPill: statusPill, empty: empty,
		txt: txt, num: numIn, area: area, date: dateIn, sel: sel, field: field,
		sw: switchCtl, stepper: stepper, seg: seg, row: row
	};
})();

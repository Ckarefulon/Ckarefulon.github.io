/*
 * 打乱公式动态视图 —— 功能块（算法 + HTML + 样式，都在 /Cube/assets/scramble/）
 *
 * 输入「已做的转动」和「目标打乱序列」，算出一串带状态的记号并渲染成一个功能块：
 *   pending   未进行（紫）
 *   current   进行中（青；有且仅有一个，位于已完成与待打乱交界；打乱完成时没有）
 *   done      已打乱（半透明）
 *   fix       当前修正步（青 + 青底；转错后的补救步）
 *   fixDone   已做掉的修正步（半透明，按当初的插入位置保留在列表里）
 *
 * 规则：把已做的转动化简（同面合并、抵消）后与打乱序列做前缀匹配；
 *       多出来的「错拧」取逆作为修正步，与原剩余首步同面时自动合并。
 *       任何状态按当前公式继续转，最终都到达目标打乱状态。
 *
 * 边界：这是「一个完整功能块」—— 算法、HTML 结构、三态配色都在这里，各页引用即得同一套外观
 *       （视觉规范见同目录 scramble.css，页面只需负责容器的字号 / 对齐 / 内边距）。
 *       页面不必再自己传类名映射，也不必自己复制一份三态配色。
 *
 * 用法：
 *   var view = ScrambleView.compute({
 *     observed: ['R', "U'", 'R'],        // 已观测转动（同一种记号即可）
 *     target:   ['R', "U'", 'F', 'R2'],  // 目标打乱序列
 *     store:    st.scrambleView,         // 调用页持有的记账对象，首次传 {} 即可
 *     fixMode:  'exact'                  // 「已做掉的修正步」插入位置匹配：'exact'（默认）| 'lte'
 *   });
 *   ScrambleView.render(el, view);                       // 直接渲染（推荐）
 *   ScrambleView.renderMoves(el, ['R', "U'"], { allDone: true });  // 渲染一串无状态记号
 *   view.progress / view.correcting / view.done
 */
(function (global) {
	'use strict';

	var MOVE_RE = /^([URFDLB])(?:([2])|('))?$/;

	/* 记号解析：'R' / 'R2' / "R'" → { face:'R', power:1|2|3 } */
	function parse(move) {
		var m = String(move == null ? '' : move).trim().replace(/[\u2019`]/g, "'").match(MOVE_RE);
		if (!m) { return null; }
		return { face: m[1], power: m[2] ? 2 : (m[3] ? 3 : 1) };
	}

	function text(face, power) {
		power = ((power % 4) + 4) % 4;
		return power === 1 ? face : power === 2 ? face + '2' : power === 3 ? face + "'" : '';
	}

	/* 化简：同面合并（含 360° 归零、A A' 抵消） */
	function simplify(moves) {
		var out = [];
		for (var i = 0; i < (moves || []).length; i++) {
			var m = parse(moves[i]);
			if (!m) { continue; }
			var last = out[out.length - 1];
			if (last && last.face === m.face) {
				last.power = (last.power + m.power) % 4;
				if (!last.power) { out.pop(); }
			} else {
				out.push({ face: m.face, power: m.power });
			}
		}
		return out.map(function (x) { return text(x.face, x.power); });
	}

	/* 取逆：整体倒序 + 每步反向 */
	function invert(moves) {
		return (moves || []).slice().reverse().map(function (raw) {
			var m = parse(raw);
			return m ? text(m.face, 4 - m.power) : '';
		}).filter(Boolean);
	}

	/* 状态 → 类名（本功能块自带，页面不需要再传）；样式见同目录 scramble.css */
	var CLASS = {
		pending: 'isPending',
		current: 'isCurrent',
		done: 'isDone',
		fix: 'isFix',
		fixDone: 'isFixDone'
	};

	var BASE = 'scramble-step';

	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function compute(opts) {
		opts = opts || {};
		var target = (opts.target || []).slice();
		var store = opts.store || (opts.store = {});
		if (!store.fixDone) { store.fixDone = []; }
		if (!store.prevCorr) { store.prevCorr = []; }

		var simp = simplify(opts.observed);
		var k = 0;
		while (k < simp.length && k < target.length && simp[k] === target[k]) { k++; }
		var extra = simp.slice(k);
		var correcting = extra.length > 0 && k < target.length;

		var corr = [], rest = null, ri = 0, i;
		if (correcting) {
			corr = invert(extra);
			rest = target.slice(k);
			var changed = true;
			while (changed && corr.length && ri < rest.length) {
				changed = false;
				var a = parse(corr[corr.length - 1]);
				var b = parse(rest[ri]);
				if (a && b && a.face === b.face) {
					var pw = (a.power + b.power) % 4;
					corr.pop();
					if (pw) { corr.push(text(a.face, pw)); }
					ri++;
					changed = true;
				}
			}
		}

		/* 记账：corr 相比上一帧「单纯缩短」⇒ 前缀里的修正步已被做掉，按插入位置留存 */
		var prev = store.prevCorr;
		if (prev.length > corr.length) {
			var off = prev.length - corr.length, plain = true;
			for (i = 0; i < corr.length; i++) {
				if (prev[off + i] !== corr[i]) { plain = false; break; }
			}
			if (plain) {
				for (i = 0; i < off; i++) { store.fixDone.push({ pos: k, move: prev[i] }); }
			}
		}
		store.prevCorr = corr.slice();

		/* 组装 items */
		var items = [], fixes = store.fixDone;
		var lte = opts.fixMode === 'lte';
		var fi = 0, used = {};

		function emitFix(pos) {
			if (lte) {
				for (var idx = 0; idx < fixes.length; idx++) {
					if (!used[idx] && fixes[idx].pos <= pos) {
						used[idx] = true;
						items.push({ text: fixes[idx].move, state: 'fixDone' });
					}
				}
				return;
			}
			while (fi < fixes.length && fixes[fi].pos === pos) {
				items.push({ text: fixes[fi].move, state: 'fixDone' });
				fi++;
			}
		}

		if (correcting) {
			for (i = 0; i < k; i++) { emitFix(i); items.push({ text: target[i], state: 'done' }); }
			emitFix(k);
			for (i = 0; i < corr.length; i++) { items.push({ text: corr[i], state: i === 0 ? 'fix' : 'pending' }); }
			for (i = ri; i < rest.length; i++) { items.push({ text: rest[i], state: 'pending' }); }
		} else {
			for (i = 0; i < target.length; i++) {
				emitFix(i);
				items.push({ text: target[i], state: i < k ? 'done' : (i === k ? 'current' : 'pending') });
			}
			emitFix(target.length);
		}

		return {
			items: items,
			progress: k,
			correcting: correcting,
			done: k === target.length && extra.length === 0
		};
	}

	/* items → HTML 片段（class 由 base + map 决定，默认走本模块自带的一套） */
	function toHTML(items, opts) {
		opts = opts || {};
		var base = opts.base || BASE;
		var map = opts.map || CLASS;
		var escape = opts.escape || esc;
		return (items || []).map(function (it) {
			var cls = map[it.state] !== undefined ? map[it.state] : CLASS[it.state];
			return '<span class="' + base + (cls ? ' ' + cls : '') + '">' + escape(it.text) + '</span>';
		}).join('');
	}

	/* 直接把算好的视图渲染进元素（推荐入口） */
	function render(el, view) {
		if (!el) { return; }
		el.innerHTML = toHTML(view && view.items ? view.items : view);
	}

	/* 渲染一串「没有状态」的记号（例如非打乱阶段：全部中性，或已打乱时全部半透明） */
	function renderMoves(el, moves, opts) {
		opts = opts || {};
		if (!el) { return; }
		var cls = opts.allDone ? ' ' + CLASS.done : '';
		var html = '';
		for (var i = 0; i < (moves || []).length; i++) {
			html += '<span class="' + BASE + cls + '">' + esc(moves[i]) + '</span>';
		}
		el.innerHTML = html;
	}

	global.ScrambleView = {
		MOVE_RE: MOVE_RE,
		CLASS: CLASS,
		parse: parse,
		text: text,
		simplify: simplify,
		invert: invert,
		compute: compute,
		toHTML: toHTML,
		render: render,
		renderMoves: renderMoves
	};
})(typeof window !== 'undefined' ? window : this);

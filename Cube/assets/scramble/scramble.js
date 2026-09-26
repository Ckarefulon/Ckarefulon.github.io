/*
 * 打乱公式动态视图 —— 功能块（算法 + HTML + 样式，都在 /Cube/assets/scramble/）
 *
 * 输入「已做的转动」和「目标打乱序列」，算出一串带状态的记号并渲染成一个功能块：
 *   pending   未进行（紫）
 *   current   进行中（青；非修正态时有且仅有一个 = 第一个未完成的步；打乱完成时没有）
 *   done      已打乱（半透明）
 *   fix       当前修正步（青 + 青底；转错后的补救步）
 *   fixDone   已做掉的修正步（半透明，按当初的插入位置保留在列表里）
 *
 * 匹配规则（2026-09-26 起，按份量记账，不按字面前缀；同日第二次修订统一「进度」与「错拧」）：
 *   每个 token 记一份累计份量 acc（mod 4），累计到 acc ≡ power 即完成——仅此一条硬规则。
 *   1. 180° 的 X2 允许拆成两段完成：X X、X' X'（甚至 X 转了又扳回去再继续）
 *      都按「同一个 X2 的进度」累计，不报错、不加步。
 *   2. 互不干扰（同轴异面：U/D、R/L、F/B）的动作先后不敏感：
 *      目标里靠后的步，只要与它插队跨过的每一步都可交换，就允许先做。
 *   3. 同面转错方向（目标 R 做成了 R'）不是错：按负进度记在该 token 头上，
 *      该步的显示改为「剩余份量」（R' 之后显示 R2，再转一个 R2 即补齐），
 *      不进修正流、不加步——补齐方式由用户自选（R2 一步或 R R 两步都对）。
 *   4. 真正异物性的错拧（异面、或插入位置与未完成步不可交换）才进修正流：
 *      错拧与其后所有转动一起化简，取逆作为修正步显示在插入点上；照做即逐步
 *      抵消，错拧被自己转回、抵消完自动恢复匹配。悔步（把已完成的步转回去）
 *      自动退账，不算错。
 *   显示口径：未完成的步一律显示「剩余份量」（= power - acc），做了一半的 X2
 *   显示 X 或 X'，负进度显示 X2——屏幕上永远是你接下来要做满这一步还差多少。
 *   不做任何「自动加步」：视图只记账和给修正建议，不代替用户转。
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
 *   view.progress / view.correcting / view.done / view.corr / view.accs
 */
(function (global) {
	'use strict';

	var MOVE_RE = /^([URFDLB])(?:([2])|('))?$/;
	/* 同轴分组：同轴异面 = 互不干扰（可交换） */
	var AXIS = { U: 'ud', D: 'ud', R: 'rl', L: 'rl', F: 'fb', B: 'fb' };

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

	/* 可交换 = 同轴异面；同面 / 异轴都不可交换 */
	function commutes(a, b) {
		return !!a && !!b && a !== b && AXIS[a] === AXIS[b];
	}

	/* 化简：相邻同面合并（含 360° 归零、A A' 抵消） */
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

	/* ---------- 匹配：按 token 记账 ---------- */
	function compute(opts) {
		opts = opts || {};
		var store = opts.store || (opts.store = {});
		if (!store.fixDone) { store.fixDone = []; }
		if (!store.prevCorr) { store.prevCorr = []; }

		/* 目标解析：解析不了的记号原样保留，只允许按序精确匹配（不参与交换 / 拆段） */
		var T = [], i, j, c;
		var rawTarget = opts.target || [];
		for (i = 0; i < rawTarget.length; i++) {
			var tm = parse(rawTarget[i]);
			T.push(tm ? { raw: text(tm.face, tm.power), face: tm.face, power: tm.power }
				: { raw: String(rawTarget[i]), face: null, power: 0 });
		}
		var n = T.length;

		var done = [], acc = [], doneOrder = [];
		for (i = 0; i < n; i++) { done.push(false); acc.push(0); }

		var extras = [];        /* 错拧：自首个不可吸收的错拧起，其后所有转动都计入 */
		var matching = true;

		function hasContent(i2) { return done[i2] || acc[i2] !== 0; }

		/* 把一份转动记到 token j 头上时，被它插队跨过的 token 都必须与它可交换：
		   i<j 且未完成（这步以后才做，被插队）／ i>j 且已有进度（这步以前做的，被插队） */
		function canPlace(j, face) {
			for (var i2 = 0; i2 < n; i2++) {
				if (i2 === j) { continue; }
				var crossing = (i2 < j && !done[i2]) || (i2 > j && hasContent(i2));
				if (crossing && !commutes(face, T[i2].face)) { return false; }
			}
			return true;
		}

		/* 完成条件只有一条：acc ≡ power (mod 4)。任意中间份量（含反向的负进度）
		   都是合法状态，显示层负责把它换算成「剩余份量」告诉用户。 */
		function complete(j) { done[j] = true; acc[j] = 0; doneOrder.push(j); }

		function pushExtra(raw) {
			var m = parse(raw);
			var last = extras[extras.length - 1];
			if (m && last && last.face === m.face) {
				last.power = (last.power + m.power) % 4;
				if (!last.power) {
					extras.pop();
					if (!extras.length) { matching = true; } /* 错拧被自己转回来了，恢复匹配 */
				} else {
					last.raw = text(last.face, last.power); /* raw 必须跟着份量走，否则修正步会算错 */
				}
			} else {
				extras.push({ raw: String(raw), face: m ? m.face : null, power: m ? m.power : 0 });
			}
		}

		var obs = opts.observed || [];
		for (i = 0; i < obs.length; i++) {
			var raw = String(obs[i] == null ? '' : obs[i]);
			var m = parse(raw);
			if (!m) {
				/* 解析不了的观测：只允许与第一个未完成 token 原样精确对上 */
				if (matching) {
					for (j = 0; j < n && done[j]; j++) { /* 找第一个未完成 */ }
					if (j < n && T[j].face == null && T[j].raw === raw) { complete(j); }
				}
				continue;
			}
			if (!matching) { pushExtra(raw); continue; }

			var placed = false;

			/* 1) 记到某个未完成 token 头上：有进度的半成品优先，其余按下标从前往后 */
			var cands = [];
			for (j = 0; j < n; j++) {
				if (!done[j] && T[j].face === m.face) { cands.push({ j: j, open: acc[j] !== 0 }); }
			}
			cands.sort(function (a, b) { return (b.open - a.open) || (a.j - b.j); });
			for (c = 0; c < cands.length; c++) {
				var jj = cands[c].j, na = (acc[jj] + m.power) % 4;
				if (canPlace(jj, m.face)) {
					if (na === T[jj].power) { complete(jj); } else { acc[jj] = na; }
					placed = true;
					break;
				}
			}

			/* 2) 记不上去 ⇒ 悔步：把最近完成的同面 token 退回对应进度 */
			if (!placed) {
				for (c = doneOrder.length - 1; c >= 0 && !placed; c--) {
					var j2 = doneOrder[c];
					if (T[j2].face !== m.face) { continue; }
					var na2 = (T[j2].power + m.power) % 4;
					if (canPlace(j2, m.face)) {
						done[j2] = false;
						doneOrder.splice(c, 1);
						acc[j2] = na2; /* 0 = 完全退回，1/3 = 退成 180° 的半成品 */
						placed = true;
					}
				}
			}

			/* 3) 都记不上去 ⇒ 错拧：其后所有转动转入修正流 */
			if (!placed) {
				var wasClean = extras.length === 0;
				pushExtra(raw);
				if (wasClean) { matching = false; }
			}
		}

		var extraText = [];
		for (i = 0; i < extras.length; i++) { extraText.push(extras[i].raw); }
		var corr = extraText.length ? invert(simplify(extraText)) : [];

		var progress = 0, frontier = n;
		for (i = 0; i < n; i++) {
			if (done[i]) { progress++; }
			else if (frontier === n) { frontier = i; }
		}
		var correcting = extraText.length > 0;
		var isDone = progress === n && !correcting;

		/* 记账：corr 相比上一帧「单纯缩短」⇒ 前缀里的修正步已被做掉，按插入位置留存 */
		var prev = store.prevCorr;
		if (prev.length > corr.length) {
			var off = prev.length - corr.length, plain = true;
			for (i = 0; i < corr.length; i++) {
				if (prev[off + i] !== corr[i]) { plain = false; break; }
			}
			if (plain) {
				for (i = 0; i < off; i++) { store.fixDone.push({ pos: frontier, move: prev[i] }); }
			}
		}
		store.prevCorr = corr.slice();

		/* 组装 items（按 target 顺序展示；修正步插在第一个未完成步之前） */
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

		var corrEmitted = false;
		for (i = 0; i < n; i++) {
			emitFix(i);
			if (correcting && i === frontier && !corrEmitted) {
				for (c = 0; c < corr.length; c++) {
					items.push({ text: corr[c], state: c === 0 ? 'fix' : 'pending' });
				}
				corrEmitted = true;
			}
			/* 显示剩余份量：power - acc。没动过 = 原文；做了一半的 X2 显示 X / X'；
			   负进度（目标 R 做成 R'）显示 R2。已完成的 acc 归零 ⇒ 显示回原文。 */
			items.push({
				text: T[i].face == null ? T[i].raw
					: text(T[i].face, (T[i].power - acc[i] + 4) % 4),
				state: done[i] ? 'done' : (!correcting && i === frontier ? 'current' : 'pending')
			});
		}
		emitFix(n);
		if (correcting && !corrEmitted) {
			for (c = 0; c < corr.length; c++) {
				items.push({ text: corr[c], state: c === 0 ? 'fix' : 'pending' });
			}
		}

		return {
			items: items,
			progress: progress,
			correcting: correcting,
			done: isDone,
			corr: corr,          /* 当前修正步序列（correcting 时非空） */
			accs: acc.slice(),   /* 各 token 的累计份量（mod 4；任意中间值合法，含负进度） */
			dones: done.slice()  /* 各 token 是否已完成 */
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
		commutes: commutes,
		simplify: simplify,
		invert: invert,
		compute: compute,
		toHTML: toHTML,
		render: render,
		renderMoves: renderMoves
	};
})(typeof window !== 'undefined' ? window : this);

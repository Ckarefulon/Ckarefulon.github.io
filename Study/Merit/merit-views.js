/* =========================================================================
 * merit-views.js — 全部页面视图
 * 每个视图导出 { render(ctx) -> html, after?(ctx) }
 * ctx = { p, R, res, insights, map }
 * ========================================================================= */
(function () {
	'use strict';
	var ZC = window.ZC;
	var ui = ZC.ui, esc = ZC.esc, fmt = ZC.fmt;
	var V = ZC.views;

	var icon = ui.icon, card = ui.card, bar = ui.bar, btn = ui.btn, pill = ui.pill;
	var fld = ui.field, sw = ui.sw, stepper = ui.stepper, seg = ui.seg, sel = ui.sel;
	var txt = ui.txt, numIn = ui.num, area = ui.area, dateIn = ui.date;

	var LIST_PATH = {
		collective: 'pinxing.collective.entries',
		deduction: 'pinxing.deductions',
		academic: 'ability.academic',
		culture: 'ability.culture',
		position: 'ability.position',
		reward: 'reward.items',
		classmate: 'classmates'
	};
	ZC.LIST_PATH = LIST_PATH;

	function opts(list, labelKey, idKey) {
		return (list || []).map(function (o) {
			return { id: o[idKey || 'id'], label: o[labelKey || 'label'] };
		});
	}

	/** 把分值写进选项文字（奖励分等级） */
	function valueOpts(list, labelKey, valueKey) {
		return (list || []).map(function (o) {
			return { id: o.id, label: o[labelKey || 'label'] + '（+' + ZC.fmt(o[valueKey || 'v']) + '）' };
		});
	}

	/** 把「等次 → 分值」写进选项文字，选之前就知道能拿几分 */
	function awardOpts(levelObj) {
		if (!levelObj || !levelObj.awards) return [];
		return Object.keys(levelObj.awards).map(function (k) {
			return { id: k, label: k + '（+' + ZC.fmt(levelObj.awards[k]) + '）' };
		});
	}

	/* ---------------------------------------------------------- 小片段 */
	function capChip(name, sub, over) {
		var pct;
		var raw = sub.raw, fin = sub.final, cap = sub.cap;
		var isOver = raw > cap + 1e-9;
		pct = cap > 0 ? Math.min(100, fin / cap * 100) : 0;
		return '<div class="chip' + (isOver ? ' is-over' : '') + '">' +
			'<span class="chip-head"><b>' + name + '</b><i>' + fmt(fin) + '<em>/' + fmt(cap) + '</em></i></span>' +
			bar(fin, cap) +
			'<span class="chip-foot">' + (isOver ? '原始 ' + fmt(raw) + '，溢出 ' + fmt(ZC.r2(raw - cap)) + ' 不计' : '上限 ' + fmt(cap)) + '</span>' +
			'</div>';
	}

	function entryOps(path, idx) {
		return ui.iconBtn('dup', 'copy', { arg: path + '|' + idx, title: '复制一条' }) +
			ui.iconBtn('del', 'trash', { arg: path + '|' + idx, title: '删除', cls: 'is-danger' });
	}

	function entryShell(o) {
		return '<article class="entry' + (o.off ? ' is-off' : '') + (o.bad ? ' is-bad' : '') + '">' +
			'<header class="entry-head">' +
				'<div class="entry-name">' + o.name + (o.tag ? ' ' + o.tag : '') + '</div>' +
				'<div class="entry-pts' + (o.off ? ' is-off' : '') + '">' + o.pts + '</div>' +
				'<div class="entry-ops">' + (o.ops || '') + '</div>' +
			'</header>' +
			(o.meta ? '<p class="entry-meta">' + o.meta + '</p>' : '') +
			(o.body ? '<div class="entry-body">' + o.body + '</div>' : '') +
			'</article>';
	}

	function trophyOf(item) {
		return item.kind === 'competition' ? '竞赛' : item.kind === 'paper' ? '论文' : item.kind === 'patent' ? '专利' : '专著';
	}

	/* ==================================================================
	 * 一、概览
	 * ================================================================== */
	V.overview = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R, res = ctx.res, H = res.headroom;
			var target = +p.target.score || 0;
			var cp = res.composite;

			var segCards = [
				{ title: '品行素质分', val: res.pinxing.final, max: R.frame.pinxing, nav: 'pinxing', rows: [
					['基准分', res.pinxing.base], ['集体活动', res.pinxing.subs.collective.final],
					['思政学习', res.pinxing.subs.ideology.final], ['社会服务', res.pinxing.subs.service.final],
					['扣分', res.pinxing.deduction ? '−' + fmt(res.pinxing.deduction) : '0']
				] },
				{ title: '能力拓展分', val: res.ability.final, max: R.frame.ability, nav: 'ability', rows: [
					['学术科研', res.ability.subs.academic.final], ['文体竞赛', res.ability.subs.culture.final],
					['组织任职', res.ability.subs.position.final]
				] },
				{ title: '奖励分', val: res.reward.final, max: R.reward.cap, nav: 'reward', rows: [
					['荣誉 / 好事', res.reward.final]
				] }
			];

			var hero = '<section class="hero">' +
				'<div class="hero-main">' +
					ui.ring(res.total, res.maxTotal, { size: 132, sub: '/ ' + res.maxTotal }) +
					'<div class="hero-info">' +
						'<div class="hero-kicker">综合素质测评成绩</div>' +
						'<h2 class="hero-name">' + esc(p.meta.name || '未命名档案') + '</h2>' +
						'<p class="hero-meta">' + esc(p.meta.college) + ' · ' + esc(p.meta.academicYear) + ' 学年' +
							(p.meta.grade ? ' · ' + esc(p.meta.grade) : '') + '</p>' +
						'<div class="hero-target">' +
							'<span class="hero-target-label">目标分</span>' + numIn('target.score', p.target.score, { ph: '如 92', width: '76px' }) +
							(target ? '<span class="hero-gap ' + (res.total >= target ? 'is-pos' : 'is-neg') + '">' +
								(res.total >= target ? '已达成 +' + fmt(ZC.r2(res.total - target)) : '还差 ' + fmt(ZC.r2(target - res.total))) + '</span>' : '') +
						'</div>' +
					'</div>' +
				'</div>' +
				'<div class="hero-segs">' + segCards.map(function (s) {
					return '<a class="seg-card" href="#/' + s.nav + '" data-nav="' + s.nav + '">' +
						'<div class="seg-head"><span>' + s.title + '</span><b>' + fmt(s.val) + '<i>/' + fmt(s.max) + '</i></b></div>' +
						bar(s.val, s.max) +
						'<div class="seg-rows">' + s.rows.map(function (r) {
							return '<span>' + r[0] + '<b>' + (typeof r[1] === 'string' ? r[1] : fmt(r[1])) + '</b></span>';
						}).join('') + '</div>' +
						'</a>';
				}).join('') + '</div>' +
			'</section>';

			/* 综合成绩 */
			var compCard = card('综合成绩 · ' + esc(cp.preset.name),
				'<div class="comp">' +
					'<div class="comp-val' + (cp.incomplete ? ' is-part' : '') + '">' + fmt(cp.total) +
						(cp.incomplete ? '<em>部分成绩未填</em>' : '') + '</div>' +
					'<div class="comp-formula">' + cp.parts.map(function (x) {
						return '<span class="' + (x.filled ? '' : 'is-empty') + '">' + esc(x.label) +
							' <b>' + (x.filled ? fmt(x.value) : '—') + '</b> × ' + Math.round(x.weight * 100) + '%</span>';
					}).join('<i>+</i>') + '</div>' +
					'<p class="comp-note">综测每 +1 分 → 综合成绩 +' + fmt(cp.sensitivity) + ' 分。' +
						'<button class="link" data-act="go" data-arg="composite">口径与资格自检 ' + icon('right', 12) + '</button></p>' +
				'</div>',
				{ icon: 'calc', sub: esc(cp.preset.desc) });

			/* 提示 */
			var f = ZC.state.ui.tipsFilter || 'all';
			var counts = { all: ctx.insights.length, danger: 0, warn: 0, good: 0, info: 0 };
			ctx.insights.forEach(function (i) { counts[i.level]++; });
			var shown = f === 'all' ? ctx.insights : ctx.insights.filter(function (i) { return i.level === f; });
			var tips = card('提示与风险预警',
				'<div class="tips-filter">' +
				[['all', '全部'], ['danger', '风险'], ['warn', '待办'], ['good', '机会'], ['info', '规则']].map(function (x) {
					return '<button type="button" class="fbtn' + (f === x[0] ? ' is-on' : '') + '" data-act="tips-filter" data-arg="' + x[0] + '">' +
						x[1] + (counts[x[0]] ? '<b>' + counts[x[0]] + '</b>' : '') + '</button>';
				}).join('') + '</div>' +
				(shown.length ? '<div class="tips">' + shown.map(function (t) {
					return '<div class="tip tip--' + t.level + '">' +
						'<span class="tip-ico">' + icon(t.level === 'danger' ? 'alert' : t.level === 'warn' ? 'alert' : t.level === 'good' ? 'trend' : 'info', 15) + '</span>' +
						'<div class="tip-main"><h4>' + esc(t.title) + (t.tag ? '<span class="tip-tag">' + esc(t.tag) + '</span>' : '') + '</h4>' +
						'<p>' + t.body + '</p></div>' +
						(t.cta ? '<button class="tip-go" data-act="go" data-arg="' + t.cta + '">处理</button>' : '') +
						'</div>';
				}).join('') + '</div>' : ui.empty('check', '该分类下暂无提示')),
				{ icon: 'bulb', sub: '按当前录入数据、校级办法与所选书院口径自动生成' });

			/* ROI */
			var rec = ZC.recommend(p, R, res).slice(0, 6);
			var nextCard = card('下一步：投入产出比最高的 6 件事',
				rec.length ? '<ol class="rec">' + rec.map(function (x) {
					return '<li><span class="rec-gain">+' + fmt(x.gain) + '</span>' +
						'<span class="rec-main"><b>' + esc(x.label) + '</b><em>投入' + ZC.EFFORT_LABEL[x.effort] +
						'（约 ' + x.hours + ' 小时）' + (x.note ? ' · ' + esc(x.note) : '') + '</em></span>' +
						'<span class="rec-roi" title="每 100 小时投入可换的分值">' + fmt(x.roi * 100) + '</span></li>';
				}).join('') + '</ol><p class="hint">右侧数字 = 每 100 小时投入大约能换多少分，仅用于排序参考。</p>'
					: ui.empty('star', '各项均已拿满', '在当前规则口径下已无可提升空间。'),
				{ icon: 'trend', sub: '剩余空间 × 单位投入产出' });

			/* 计算过程 */
			var trace = card('计算过程（可逐行核对）',
				'<div class="trace">' + res.trace.map(function (t) {
					return '<div class="trace-row lv' + t.indent + '"><span class="trace-label">' + esc(t.label) + '</span>' +
						'<span class="trace-note">' + esc(t.note) + '</span><span class="trace-val">' + esc(t.value) + '</span></div>';
				}).join('') +
				'<div class="trace-row is-sum"><span class="trace-label">综合素质测评成绩</span>' +
				'<span class="trace-note">满分 ' + res.maxTotal + '</span><span class="trace-val">' + fmt(res.total) + '</span></div></div>' +
				(res.merged.length ? '<div class="note note-info"><b>触发的合并 / 取最高：</b><ul>' + res.merged.map(function (m) {
					return '<li>' + esc(m.cat) + '「' + esc(m.name) + '」少计 ' + m.dropped + ' 分 — ' + esc(m.reason) + '</li>';
				}).join('') + '</ul></div>' : '') +
				(res.blocked.length ? '<div class="note note-danger"><b>不予认定的成果：</b><ul>' + res.blocked.map(function (m) {
					return '<li>' + esc(m.label) + ' — ' + esc(m.reason) + '</li>';
				}).join('') + '</ul></div>' : ''),
				{ icon: 'list', actions: btn('复制自评表', 'copy-md', { cls: 'btn-sm', icon: 'copy' }) });

			/* 空间 */
			var space = card('还能拿多少分',
				'<div class="chips">' +
					capChip('集体活动', res.pinxing.subs.collective) +
					capChip('思政学习', res.pinxing.subs.ideology) +
					capChip('社会服务', res.pinxing.subs.service) +
					capChip('学术科研', res.ability.subs.academic) +
					capChip('文体竞赛', res.ability.subs.culture) +
					capChip('组织任职', res.ability.subs.position) +
					capChip('奖励分', res.reward) +
				'</div><p class="space-sum">理论上限还可提升 <b>' + fmt(H.total) + '</b> 分（不含扣分风险）</p>',
				{ icon: 'target', sub: '每个分项都有封顶，超出部分不计 —— 先补没满的' });

			var quick = '<div class="quick">' + [
				['pinxing', 'shield', '录入品行加分 / 扣分'],
				['ability', 'rocket', '竞赛 · 论文 · 任职'],
				['reward', 'award', '荣誉与表彰'],
				['materials', 'folder', '整理佐证材料'],
				['simulate', 'flask', '如果再加一项'],
				['procedure', 'clock', '公示与申诉时效']
			].map(function (q) {
				return '<a class="quick-item" href="#/' + q[0] + '" data-nav="' + q[0] + '">' + icon(q[1], 17) + '<span>' + q[2] + '</span></a>';
			}).join('') + '</div>';

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">概览</h1>' +
					'<p class="page-sub">' + esc(p.meta.academicYear) + ' 学年 · 数据实时保存在本机浏览器' + (ZC.cloud.state === 'cloud' ? '，并同步到云端' : '') + '</p></div>' +
				(p.meta.note ? '<div class="note note-muted">' + esc(p.meta.note) + '</div>' : '') +
				hero +
				'<div class="grid2">' +
					'<div class="col">' + tips + trace + '</div>' +
					'<div class="col">' + compCard + nextCard + space + card('快速开始', quick, { icon: 'rocket' }) + '</div>' +
				'</div>' +
			'</div>';
		}
	};

	/* ==================================================================
	 * 二、品行素质分
	 * ================================================================== */
	V.pinxing = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R, res = ctx.res;
			var PX = R.pinxing, s = res.pinxing.subs;
			var COL = p.pinxing.collective;

			var baseCard = card('基准分',
				'<div class="base-row">' +
					sw('meta.assessPass', p.meta.assessPass, '经班级评议小组评议合格，且书院审定通过') +
					'<div class="base-val ' + (p.meta.assessPass ? 'is-on' : '') + '">' + fmt(res.pinxing.base) + '<i> / ' + fmt(PX.base) + '</i></div>' +
				'</div>' +
				'<p class="hint">基准分是品行素质分的主体。未通过评议将直接失去这部分分值，同时通常也意味着取消当年评奖评优资格。</p>',
				{ icon: 'shield', sub: '满 ' + fmt(PX.base) + ' 分，占品行素质分的绝大部分' });

			var colList = (COL.entries || []).map(function (e, i) {
				var base = LIST_PATH.collective + '[' + i + ']';
				var pts = ZC.r2((+e.times || 0) * (+PX.collective.perTime || 0));
				return entryShell({
					name: esc(e.name || '未命名活动'),
					pts: '+' + fmt(pts),
					ops: ui.iconBtn('toggle', 'pencil', { arg: 'c:' + e.id, title: '编辑' }) + entryOps(LIST_PATH.collective, i),
					meta: (e.times || 0) + ' 次 × ' + fmt(PX.collective.perTime) + ' 分 · ' +
						(e.date ? esc(e.date) + ' · ' : '') + ui.statusPill(e.status),
					body: ZC.state.ui.expanded['c:' + e.id] ?
						'<div class="entry-grid">' +
							fld('活动名称', txt(base + '.name', e.name, { ph: '如：书院迎新晚会' })) +
							fld('参与次数', stepper(base + '.times', e.times, { min: 0, max: 99 })) +
							fld('活动日期', dateIn(base + '.date', e.date)) +
							fld('材料状态', sel(base + '.status', e.status, ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; }))) +
							fld('佐证材料', txt(base + '.evidence', e.evidence, { ph: '主办单位名单 / 活动证明' }), 'full') +
						'</div>' : ''
				});
			}).join('');

			var colBody = seg('pinxing.collective.mode', COL.mode, [{ id: 'count', label: '按次数计分' }, { id: 'flat', label: '突出贡献（一次性满分）' }]) +
				'<p class="hint">' + (COL.mode === 'flat'
					? '对集体荣誉作出突出贡献，经书院认定可一次性获得满分 ' + fmt(PX.collective.outstandingFull) + ' 分。'
					: '当前单个活动 ' + fmt(PX.collective.perTime) + ' 分 / 次，封顶 ' + fmt(PX.caps.collective) + ' 分。校级办法未统一规定单次分值，可在「设置」里改成你所在书院的口径。') + '</p>' +
				(COL.mode === 'count'
					? (colList || ui.empty('users', '还没有活动记录', '点下面的按钮把参加过的活动记一条，会自动按次数算分。')) +
						'<div class="add-row">' + btn('添加活动', 'add', { arg: 'collective|collective', cls: 'btn-primary btn-sm', icon: 'plus' }) + '</div>'
					: '');

			var colCard = card('集体活动分',
				colBody + '<div class="sub-cap">' + capChipInner(s.collective) + '</div>',
				{ icon: 'users', sub: '上限 ' + fmt(PX.caps.collective) + ' 分 · 多参加就多拿，封顶为止' });

			var ideoCard = card('思想政治理论学习分',
				'<div class="rows">' +
					row2('各级党团组织的理论学习培训（含网络学习）', '每次 +' + fmt(PX.ideology.orgTraining), stepper('pinxing.ideology.orgTraining', p.pinxing.ideology.orgTraining, { max: 9 })) +
					row2('参加省、部级理论学习培训', '每次 +' + fmt(PX.ideology.provincialTraining), stepper('pinxing.ideology.provincialTraining', p.pinxing.ideology.provincialTraining, { max: 9 })) +
					row2('培训获「优秀学员」称号', '额外 +' + fmt(PX.ideology.excellentTrainee), stepper('pinxing.ideology.excellentTrainee', p.pinxing.ideology.excellentTrainee, { max: 9 })) +
				'</div>' +
				'<p class="hint">三项可叠加，总分封顶 ' + fmt(PX.caps.ideology) + ' 分。网络学习是成本最低的一项。</p>' +
				'<div class="sub-cap">' + capChipInner(s.ideology) + '</div>',
				{ icon: 'bulb', sub: '上限 ' + fmt(PX.caps.ideology) + ' 分' });

			var hours = +p.pinxing.service.volunteerHours || 0;
			var req = +PX.service.volunteerHours || 32;
			var svcCard = card('社会服务分',
				'<div class="vol">' +
					'<div class="vol-head"><span>志愿服务时长</span>' +
						'<span class="vol-input">' + numIn('pinxing.service.volunteerHours', hours, { min: 0, max: 500, step: 1 }) + '<i>小时</i></span>' +
					'</div>' +
					bar(Math.min(hours, req), req) +
					'<p class="vol-note">' + (hours >= req ? '已满 ' + req + ' 小时，+1 分到手' : '还差 ' + fmt(ZC.r2(req - hours)) + ' 小时满 ' + req + ' 小时（不足按比例）') + '</p>' +
				'</div>' +
				'<div class="rows">' +
					row2('校级社会实践（考核合格的团队成员）', '+' + fmt(PX.service.schoolPractice), stepper('pinxing.service.schoolPractice', p.pinxing.service.schoolPractice, { max: 9 })) +
					row2('市、县级挂职锻炼及政府见习', '+' + fmt(PX.service.cityIntern), stepper('pinxing.service.cityIntern', p.pinxing.service.cityIntern, { max: 9 })) +
					row2('省、部级挂职 / 政府见习 / 国际组织见习', '+' + fmt(PX.service.provIntern), stepper('pinxing.service.provIntern', p.pinxing.service.provIntern, { max: 9 })) +
					row2('获先进个人及表彰', '+' + fmt(PX.service.advanced), stepper('pinxing.service.advanced', p.pinxing.service.advanced, { max: 9 })) +
				'</div>' +
				'<div class="entry-grid">' +
					fld('志愿材料状态', sel('pinxing.service.volunteerStatus', p.pinxing.service.volunteerStatus, ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; }))) +
					fld('志愿佐证材料', txt('pinxing.service.volunteerNote', p.pinxing.service.volunteerNote, { ph: '志愿汇截图 / 主办方证明' })) +
				'</div>' +
				'<p class="hint">志愿服务每学年 ≥' + req + ' 小时计 1 分，不足按比例；其余各项可累计，总分封顶 ' + fmt(PX.caps.service) + ' 分。</p>' +
				'<div class="sub-cap">' + capChipInner(s.service) + '</div>',
				{ icon: 'clock', sub: '上限 ' + fmt(PX.caps.service) + ' 分 · 志愿时长按学年累计' });

			/* 扣分 */
			var dedRows = (PX.deduction.types || []).map(function (t) {
				var idx = -1;
				(p.pinxing.deductions || []).forEach(function (d, i) { if (d.type === t.id) idx = i; });
				var entry = idx >= 0 ? p.pinxing.deductions[idx] : null;
				var cnt = entry ? (+entry.count || 0) : 0;
				var per = entry && t.editable ? (+entry.customPer || t.per) : t.per;
				var sub = cnt > 0 ? '−' + fmt(ZC.r2(cnt * per)) : '0';
				var extra = '';
				if (entry && cnt > 0) {
					var base = LIST_PATH.deduction + '[' + idx + ']';
					extra = '<div class="ded-extra">' +
						fld('备注', txt(base + '.note', entry.note, { ph: '如：10 月宿舍卫生检查' })) +
						fld('日期', dateIn(base + '.date', entry.date)) +
						'</div>';
				}
				return '<div class="ded-row' + (cnt > 0 ? ' is-hit' : '') + '">' +
					'<div class="row-main"><span class="row-label">' + t.label + '</span>' +
						'<span class="row-sub">−' + fmt(t.per) + ' / ' + t.unit + '</span></div>' +
					stepper('@@ded:' + t.id, cnt, { max: 99 }) +
					'<div class="row-val ' + (cnt > 0 ? 'is-neg' : '') + '">' + sub + '</div>' + extra + '</div>';
			}).join('');

			var dedCard = card('品行素质扣分',
				'<p class="hint hint-strong">' + icon('alert', 14) + ' 扣分不设上限，直接从 70 分基准分里扣。很多排名落差来自旷课、宿舍卫生这些「小事」。</p>' +
				'<div class="rows rows-ded">' + dedRows + '</div>' +
				'<div class="ded-sum">已扣 <b>' + fmt(res.pinxing.deduction) + '</b> 分' +
					(res.pinxing.deduction > 0 ? '（约等于 ' + fmt(ZC.r2(res.pinxing.deduction / 4)) + ' 个校级竞赛一等奖）' : '') + '</div>',
				{ icon: 'alert', sub: '无上限 · 受纪律处分还将取消奖学金参评资格' });

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">品行素质分</h1>' +
					'<p class="page-sub">满分 ' + fmt(R.frame.pinxing) + ' 分 = 基准 ' + fmt(PX.base) + ' + 集体 ≤' + fmt(PX.caps.collective) +
					' + 思政 ≤' + fmt(PX.caps.ideology) + ' + 社会服务 ≤' + fmt(PX.caps.service) + ' − 扣分（无上限）</p>' +
					'<div class="page-metric"><b>' + fmt(res.pinxing.final) + '</b><span>/ ' + fmt(R.frame.pinxing) + '</span></div></div>' +
				baseCard + colCard + ideoCard + svcCard + dedCard +
			'</div>';
		}
	};

	function capChipInner(sub) {
		var over = sub.raw > sub.cap + 1e-9;
		return '<span class="cap-line">' + bar(sub.final, sub.cap) +
			'<span class="cap-text">' + fmt(sub.final) + ' / ' + fmt(sub.cap) +
			(over ? ' <em>原始 ' + fmt(sub.raw) + '</em>' : '') + '</span></span>';
	}
	function row2(label, sub, control) {
		return '<div class="row"><div class="row-main"><span class="row-label">' + label + '</span>' +
			'<span class="row-sub">' + sub + '</span></div><div class="row-ctl">' + control + '</div></div>';
	}

	/* ==================================================================
	 * 三、能力拓展分
	 * ================================================================== */
	V.ability = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R, res = ctx.res, map = ctx.map;
			var AB = R.ability;

			/* ---- 学术科研 ---- */
			var acadList = (p.ability.academic || []).map(function (it, i) {
				var base = LIST_PATH.academic + '[' + i + ']';
				var c = map.academic[it.id] || { _pts: 0, _reason: '', _counted: true };
				var full = esc(it.project || it.name || '未命名成果');
				var cls = pubClassOf(it, AB);
				var body = '';
				if (ZC.state.ui.expanded['a:' + it.id]) {
					body = '<div class="entry-grid">' +
						fld('项目 / 成果名称', txt(base + '.project', it.project || it.name || '', { ph: '如：全国大学生数学建模竞赛' }),
							'同一项目获多个奖时填同一个名称 ——「取最高」按它归组；留空则各自单独计入') +
						(it.kind === 'competition'
							? fld('竞赛级别', sel(base + '.level', it.level, opts(AB.competition.levels, 'label', 'id'))) +
							  fld('获奖等次', sel(base + '.award', it.award, awardOpts(AB.competition.levels.filter(function (l) { return l.id === it.level; })[0])))
							: '') +
						(it.kind === 'paper'
							? fld('论文类别', sel(base + '.pubClass', it.pubClass, opts(AB.publication.classes.filter(function (c) { return !c.bookStyle; }), 'label', 'id'))) +
							  fld('署名位次', sel(base + '.rank', it.rank, rankOpts(cls))) +
							  fld('第一署名单位', txt(base + '.signUnit', it.signUnit, { ph: '西安交通大学' })) +
							  '<label class="chk">' + '<input type="checkbox" data-k="' + base + '.excellentPaper" data-t="bool"' + (it.excellentPaper ? ' checked' : '') + '>' +
							  '<span class="chk-box"></span><span>会议入围优秀论文（额外 +1）</span></label>'
							: '') +
						(it.kind === 'patent'
							? fld('专利类型', sel(base + '.patentType', it.patentType, Object.keys(AB.publication.patentMap).map(function (k) { return { id: k, label: k }; }))) +
							  fld('完成人位次', sel(base + '.rank', it.rank, rankOpts(cls))) +
							  fld('第一署名单位', txt(base + '.signUnit', it.signUnit, { ph: '西安交通大学' }))
							: '') +
						(it.kind === 'book'
							? fld('署名位次', sel(base + '.rank', it.rank, rankOpts(cls))) +
							  fld('第一署名单位', txt(base + '.signUnit', it.signUnit, { ph: '西安交通大学' })) +
							  '<label class="chk">' + '<input type="checkbox" data-k="' + base + '.isEditor" data-t="bool"' + (it.isEditor ? ' checked' : '') + '>' +
							  '<span class="chk-box"></span><span>参编（+1）</span></label>' +
							  (cls && cls.note ? '<p class="hint" style="grid-column:1/-1;margin-top:-2px">' + esc(cls.note) + '</p>' : '')
							: '') +
						fld('材料状态', sel(base + '.status', it.status, ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; }))) +
						fld('佐证材料', txt(base + '.evidence', it.evidence, { ph: '获奖证书 / 录用通知 / 专利证书' })) +
						fld('日期', dateIn(base + '.date', it.date)) +
						'</div>';
				}
				return entryShell({
					name: full + ' ' + pill(trophyOf(it), 'muted'),
					pts: c._blocked ? '不认定' : (c._counted ? '+' + fmt(c._pts) : '0'),
					off: !c._counted,
					bad: !!c._blocked,
					ops: ui.iconBtn('toggle', 'pencil', { arg: 'a:' + it.id, title: '编辑' }) + entryOps(LIST_PATH.academic, i),
					meta: esc(c._reason || '') + (c._merged && !c._counted ? ' · 同一项目取最高，本条未计入' : '') +
						(it.evidence ? ' · ' + esc(it.evidence) : '') + ' ' + ui.statusPill(it.status),
					tag: c._blocked ? pill('署名单位不符', 'danger') : '',
					body: body
				});
			}).join('');

			var acadCard = card('学术科研及创新创业',
				(acadList || ui.empty('rocket', '还没有录入成果', '竞赛、论文、专利、专著都可以记在这里，同一项目多个奖项只取最高。')) +
				'<div class="add-row">' +
					btn('竞赛获奖', 'add', { arg: 'academic|academic-comp', cls: 'btn-sm', icon: 'plus' }) +
					btn('论文', 'add', { arg: 'academic|academic-paper', cls: 'btn-sm', icon: 'plus' }) +
					btn('专利 / 软著', 'add', { arg: 'academic|academic-patent', cls: 'btn-sm', icon: 'plus' }) +
					btn('专著', 'add', { arg: 'academic|academic-book', cls: 'btn-sm', icon: 'plus' }) +
				'</div>' +
				'<div class="sub-cap">' + capChipInner(res.ability.subs.academic) + '</div>' +
				'<p class="hint">同一项目获不同奖项不累计、取最高；不同项目可累计。论文 / 专利 / 专著的第一署名单位须为西安交通大学。</p>',
				{ icon: 'rocket', sub: '上限 ' + fmt(AB.caps.academic) + ' 分' });

			/* ---- 文体竞赛 ---- */
			var culList = (p.ability.culture || []).map(function (it, i) {
				var base = LIST_PATH.culture + '[' + i + ']';
				var c = map.culture[it.id] || { _pts: 0, _reason: '', _counted: true };
				var tbl = it.kind === 'sport' ? AB.sport : AB.art;
				var curLevel = tbl.levels.filter(function (l) { return l.id === it.level; })[0] || tbl.levels[0];
				var body = ZC.state.ui.expanded['u:' + it.id] ? '<div class="entry-grid">' +
					fld('赛事类别', seg(base + '.kind', it.kind, [{ id: 'art', label: '文艺' }, { id: 'sport', label: '体育' }])) +
					fld('赛事级别', sel(base + '.level', it.level, opts(tbl.levels, 'label', 'id'))) +
					fld(it.kind === 'sport' ? '名次' : '获奖等次', sel(base + '.award', it.award, awardOpts(curLevel))) +
					(it.kind === 'sport' ? '<label class="chk"><input type="checkbox" data-k="' + base + '.record" data-t="bool"' + (it.record ? ' checked' : '') +
						'><span class="chk-box"></span><span>破纪录（省级及以上 +' + fmt(AB.sport.record.provincialOrAbove) + ' / 校级 +' + fmt(AB.sport.record.school) + '）</span></label>' : '') +
					fld('赛事名称', txt(base + '.name', it.name, { ph: '如：书院合唱比赛' }),
						'同一赛事的多条记录填同一个名称 ——「取最高」按它归组') +
					fld('材料状态', sel(base + '.status', it.status, ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; }))) +
					fld('佐证材料', txt(base + '.evidence', it.evidence, { ph: '获奖证书' })) +
					fld('日期', dateIn(base + '.date', it.date)) +
					'</div>' : '';
				return entryShell({
					name: (esc(it.name || '未命名赛事')) + ' ' + pill(it.kind === 'sport' ? '体育' : '文艺', 'muted'),
					pts: c._counted ? '+' + fmt(c._pts) : '0',
					off: !c._counted,
					ops: ui.iconBtn('toggle', 'pencil', { arg: 'u:' + it.id, title: '编辑' }) + entryOps(LIST_PATH.culture, i),
					meta: esc(c._reason || '') + (c._merged && !c._counted ? ' · 同一项目取最高，本条未计入' : '') + ' ' + ui.statusPill(it.status),
					body: body
				});
			}).join('');

			var culCard = card('文体竞赛',
				(culList || ui.empty('award', '还没有录入获奖', '文艺、体育都算，同一项目取最高。')) +
				'<div class="add-row">' +
					btn('文艺比赛', 'add', { arg: 'culture|culture-art', cls: 'btn-sm', icon: 'plus' }) +
					btn('体育竞赛', 'add', { arg: 'culture|culture-sport', cls: 'btn-sm', icon: 'plus' }) +
				'</div>' +
				'<div class="sub-cap">' + capChipInner(res.ability.subs.culture) + '</div>' +
				'<p class="hint">破省级及以上纪录 +' + fmt(AB.sport.record.provincialOrAbove) + '，破校级纪录 +' + fmt(AB.sport.record.school) + '。</p>',
				{ icon: 'award', sub: '上限 ' + fmt(AB.caps.culture) + ' 分' });

			/* ---- 任职 ---- */
			var posList = (p.ability.position || []).map(function (it, i) {
				var base = LIST_PATH.position + '[' + i + ']';
				var c = map.position[it.id] || { _pts: 0, _reason: '' };
				var body = ZC.state.ui.expanded['p:' + it.id] ? '<div class="entry-grid">' +
					fld('组织 / 部门', txt(base + '.org', it.org, { ph: '如：彭康书院学生会' })) +
					fld('职务', txt(base + '.role', it.role, { ph: '如：宣传部部长' })) +
					fld('职务档位', sel(base + '.tier', it.tier, opts(AB.position.tiers, 'label', 'id')), '档位说明较长，鼠标悬停可看全') +
					fld('考核等次', sel(base + '.assessment', it.assessment, AB.position.assessments.map(function (a) { return { id: a, label: a }; }))) +
					fld('任期开始', dateIn(base + '.startDate', it.startDate)) +
					fld('任期结束（留空 = 在职中）', dateIn(base + '.endDate', it.endDate)) +
					fld('材料状态', sel(base + '.status', it.status, ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; }))) +
					fld('佐证材料', txt(base + '.evidence', it.evidence, { ph: '任职文件 / 聘书 / 考核结果' })) +
					'</div>' : '';
				return entryShell({
					name: esc((it.org || '') + ' ' + (it.role || '任职')),
					pts: c._pts ? '+' + fmt(c._pts) : '0',
					off: !c._counted,
					ops: ui.iconBtn('toggle', 'pencil', { arg: 'p:' + it.id, title: '编辑' }) + entryOps(LIST_PATH.position, i),
					meta: esc(c._reason || '') + (it._counted === false ? ' · 兼任取最高，本条未计入' : '') + ' ' + ui.statusPill(it.status),
					body: body
				});
			}).join('');

			var posCard = card('学生组织、社团任职',
				(posList || ui.empty('users', '还没有录入任职', '兼任多项只取最高、不累加 —— 专注一个做满一年更划算。')) +
				'<div class="add-row">' + btn('添加任职', 'add', { arg: 'position|position', cls: 'btn-primary btn-sm', icon: 'plus' }) + '</div>' +
				'<div class="sub-cap">' + capChipInner(res.ability.subs.position) + '</div>' +
				'<p class="hint">四档职务 × 优 / 良 / 合格。兼任多项按最高分计、不累加；考核不合格不加分。不满一年按实际月数折算（口径可在设置里切换）。</p>',
				{ icon: 'users', sub: '上限 ' + fmt(AB.caps.position) + ' 分' });

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">能力拓展分</h1>' +
					'<p class="page-sub">满分 ' + fmt(R.frame.ability) + ' 分 = 学术 ≤' + fmt(AB.caps.academic) + ' + 文体 ≤' + fmt(AB.caps.culture) + ' + 任职 ≤' + fmt(AB.caps.position) + '</p>' +
					'<div class="page-metric"><b>' + fmt(res.ability.final) + '</b><span>/ ' + fmt(R.frame.ability) + '</span></div></div>' +
				acadCard + culCard + posCard +
			'</div>';
		}
	};

	/** 某条成果落在哪个论文 / 专著类别上（决定递减表与缺省回退） */
	function pubClassOf(it, AB) {
		var PUB = AB.publication;
		var id = it.pubClass;
		if (it.kind === 'patent') id = PUB.patentMap[it.patentType] || 'ii';
		if (it.kind === 'book') id = 'book';
		return (PUB.classes || []).filter(function (c) { return c.id === id; })[0] || null;
	}

	/** 署名位次选项：直接标出该位次在这张表里值几分（含表外回退值） */
	function rankOpts(cls) {
		var rk = (cls && cls.ranks) || [];
		var out = [];
		for (var i = 1; i <= 10; i++) {
			var v = i <= rk.length ? rk[i - 1] : (cls ? cls.rest : 0);
			out.push({
				id: String(i),
				label: (i <= 3 ? '第 ' + i + ' 作者' : '第 ' + i + ' 位') + '（+' + ZC.fmt(v) + '）'
			});
		}
		return out;
	}

	/* ==================================================================
	 * 四、奖励分
	 * ================================================================== */
	V.reward = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R, res = ctx.res, map = ctx.map;
			var RW = R.reward;
			var list = (p.reward.items || []).map(function (it, i) {
				var base = LIST_PATH.reward + '[' + i + ']';
				var c = map.reward[it.id] || { _pts: 0, _reason: '' };
				var cat = RW.categories.filter(function (x) { return x.id === it.category; })[0] || RW.categories[0];
				var body = ZC.state.ui.expanded['r:' + it.id] ? '<div class="entry-grid">' +
					fld('表彰类型', sel(base + '.category', it.category, opts(RW.categories, 'label', 'id'))) +
					(cat.mode === 'level' ? fld('表彰级别', sel(base + '.level', it.level, valueOpts(RW.levels, 'label', 'v'))) : '') +
					fld('名称', txt(base + '.name', it.name, { ph: '如：优秀学生标兵' })) +
					fld('材料状态', sel(base + '.status', it.status, ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; }))) +
					fld('佐证材料', txt(base + '.evidence', it.evidence, { ph: '表彰文件 / 证书' })) +
					fld('日期', dateIn(base + '.date', it.date)) +
					'</div>' : '';
				return entryShell({
					name: esc(it.name || '未命名表彰'),
					pts: '+' + fmt(c._pts),
					ops: ui.iconBtn('toggle', 'pencil', { arg: 'r:' + it.id, title: '编辑' }) + entryOps(LIST_PATH.reward, i),
					meta: esc(c._reason || '') + ' ' + ui.statusPill(it.status),
					body: body
				});
			}).join('');

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">奖励分</h1>' +
					'<p class="page-sub">满分 ' + fmt(RW.cap) + ' 分，累加超过 ' + fmt(RW.cap) + ' 按 ' + fmt(RW.cap) + ' 计。这是在 100 分之外的额外分。</p>' +
					'<div class="page-metric"><b>' + fmt(res.reward.final) + '</b><span>/ ' + fmt(RW.cap) + '</span></div></div>' +
				card('精神文明与表彰',
					(list || ui.empty('award', '还没有录入表彰', '荣誉表彰、见义勇为、做好事受表扬都记在这里。')) +
					'<div class="add-row">' + btn('添加表彰 / 事迹', 'add', { arg: 'reward|reward', cls: 'btn-primary btn-sm', icon: 'plus' }) + '</div>' +
					'<div class="sub-cap">' + capChipInner(res.reward) + '</div>' +
					'<p class="hint">精神文明集体 / 个人荣誉表彰：全国 5 · 省 4 · 市 3 · 校 2 · 院 1；见义勇为、舍己救人、拾金不昧同标准；做好事受表扬、为校争光每项 +1 可累加。</p>',
					{ icon: 'award', sub: '按级别计分，封顶 ' + fmt(RW.cap) + ' 分' }) +
			'</div>';
		}
	};

	/* ==================================================================
	 * 五、综合成绩与资格
	 * ================================================================== */
	V.composite = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R, res = ctx.res;
			var cp = res.composite, cw = p.coursework || {};
			var presets = R.composite.presets || [];
			var preset = cp.preset;

			var presetCard = card('综合成绩口径',
				'<div class="preset-list">' + presets.map(function (x) {
					return '<button type="button" class="preset' + (x.id === cp.presetId ? ' is-on' : '') +
						'" data-act="seg" data-arg="ruleOverride.composite.preset|' + x.id + '">' +
						'<b>' + esc(x.name) + '</b><span>' + esc(x.desc) + '</span></button>';
				}).join('') + '</div>' +
				'<p class="hint">' + (preset.source ? '依据：' + esc(preset.source) : '自定义口径：可自行调整各部分权重。') + '</p>' +
				(preset.id === 'custom' ? '<div class="entry-grid">' + (preset.parts || []).map(function (pt, i) {
					return fld(esc(pt.label) + ' 权重', numIn('customWeights.' + pt.key, (p.customWeights || {})[pt.key] !== undefined ? p.customWeights[pt.key] : pt.weight, { min: 0, max: 1, step: 0.05 }));
				}).join('') + '</div>' : ''),
				{ icon: 'calc', sub: '不同用途 / 书院的口径不一样，选一个最接近你的' });

			var keys = (preset.parts || []).map(function (x) { return x.key; });
			var inputs = '';
			if (keys.indexOf('course') >= 0) inputs += fld('课程考核 / 智育成绩', numIn('coursework.score', cw.score, { ph: '如 86.4', min: 0, max: 100, step: 0.1 }));
			if (keys.indexOf('deyu') >= 0) inputs += fld('思想品德行为成绩', numIn('coursework.deyu', cw.deyu, { ph: '按书院细则', min: 0, max: 100, step: 0.1 }));
			if (keys.indexOf('pe') >= 0) inputs += fld('体育成绩', numIn('coursework.pe', cw.pe, { ph: '按书院细则', min: 0, max: 100, step: 0.1 }));

			var resultCard = card('综合成绩',
				'<div class="comp big">' +
					'<div class="comp-val' + (cp.incomplete ? ' is-part' : '') + '">' + fmt(cp.total) + (cp.incomplete ? '<em>部分成绩未填</em>' : '') + '</div>' +
					'<div class="comp-formula">' + cp.parts.map(function (x) {
						return '<span class="' + (x.filled ? '' : 'is-empty') + '">' + esc(x.label) + ' <b>' + (x.filled ? fmt(x.value) : '—') +
							'</b> × ' + Math.round(x.weight * 100) + '% = ' + fmt(x.contrib) + '</span>';
					}).join('<i>+</i>') + '</div>' +
				'</div>' +
				'<div class="entry-grid">' + inputs + '</div>' +
				'<p class="hint">综测每 +1 分 → 综合成绩 +' + fmt(cp.sensitivity) + ' 分（权重合计 ' + Math.round(cp.weightSum * 100) + '%）。' +
					'综测满分 ' + res.maxTotal + ' 分，是否折算成百分制可在设置里开关。</p>',
				{ icon: 'trend', sub: '看清楚：综测每多 1 分，综合成绩涨多少' });

			/* 资格自检 */
			var EL = R.eligibility;
			var sch = p.eligibility.scholarship || {};
			var schRows = (EL.scholarship || []).map(function (x) {
				if (x.id === 'pe') {
					return '<div class="row"><div class="row-main"><span class="row-label">' + x.label + '</span>' +
						'<span class="row-sub">国奖 / 励志通常要求良好及以上，校级要求及格</span></div>' +
						'<div class="row-ctl">' + sel('meta.pe', p.meta.pe, [
							{ id: '', label: '未测 / 不填' }, { id: 'excellent', label: '优秀' }, { id: 'good', label: '良好' },
							{ id: 'pass', label: '及格' }, { id: 'fail', label: '不及格' }]) + '</div></div>';
				}
				return '<label class="row row-check">' +
					'<input type="checkbox" data-k="eligibility.scholarship.' + x.id + '" data-t="bool"' + (sch[x.id] ? ' checked' : '') + '>' +
					'<span class="chk-box"></span><span class="row-label">' + x.label + '</span></label>';
			}).join('');
			var com = p.eligibility.commend || {};
			var comRows = (EL.commend || []).map(function (x) {
				return '<label class="row row-check">' +
					'<input type="checkbox" data-k="eligibility.commend.' + x.id + '" data-t="bool"' + (com[x.id] ? ' checked' : '') + '>' +
					'<span class="chk-box"></span><span class="row-label">' + x.label + '</span></label>';
			}).join('');
			var blockedSch = !!(sch.fail || sch.punish);
			var peBad = p.meta.pe === 'fail';
			var verdict = blockedSch
				? '<div class="note note-danger"><b>奖学金参评资格：不通过</b><p>存在红线项，按办法取消当年度奖学金参评资格。若为误填请及时更正；若属处分，注意解除时间是否在参评学年内。</p></div>'
				: (peBad ? '<div class="note note-warn"><b>奖学金参评资格：体测未达标</b><p>多数校级奖学金要求体测及格，国奖 / 励志通常要求良好及以上。请以当年评审通知为准。</p></div>'
					: '<div class="note note-ok"><b>奖学金参评资格：暂未触发红线</b><p>红线只有两条：必修课不及格（补考、重修视同不及格）与校级 / 院级纪律处分（含尚未解除）。</p></div>');

			var eligCard = card('参评资格自检',
				verdict +
				'<h4 class="sub-title">奖学金</h4>' + schRows +
				'<h4 class="sub-title">表彰奖励</h4>' + comRows,
				{ icon: 'shield', sub: '勾选前务必核对：一次误判可能白准备一学期' });

			var tierRows = (R.scholarshipTiers || []).map(function (t) {
				var peOk = (t.pe === '及格' && (p.meta.pe === 'pass' || p.meta.pe === 'good' || p.meta.pe === 'excellent')) ||
					(t.pe !== '及格' && (p.meta.pe === 'good' || p.meta.pe === 'excellent'));
				return '<tr><td>' + esc(t.name) + '</td><td class="tr">' + t.amount.toLocaleString('en-US') + ' 元</td>' +
					'<td>' + esc(t.pe) + '</td><td>' + (blockedSch ? pill('资格不符', 'danger') : peOk ? pill('体测达标', 'ok') : pill('体测待确认', 'warn')) + '</td></tr>';
			}).join('');
			var tierCard = card('奖学金档位与门槛',
				'<div class="tbl-wrap"><table class="tbl"><thead><tr><th>奖学金</th><th class="tr">金额 / 年</th><th>体测要求</th><th>你的状态</th></tr></thead><tbody>' +
				tierRows + '</tbody></table></div>' +
				'<p class="hint">奖学金按<b>排名</b>竞争，不是划线。金额与体测要求以当年评审通知为准；名额比例可在「班级对比」里估算。</p>',
				{ icon: 'award' });

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">综合成绩与资格</h1>' +
					'<p class="page-sub">综测只是中间量 —— 真正决定奖学金 / 分流 / 推免的是加权后的综合成绩，以及有没有踩红线。</p></div>' +
				resultCard + presetCard + eligCard + tierCard +
			'</div>';
		}
	};

	/* ==================================================================
	 * 六、材料清单
	 * ================================================================== */
	V.materials = {
		render: function (ctx) {
			var p = ctx.p, res = ctx.res, map = ctx.map;
			var rows = [];
			var add = function (o) { rows.push(o); };

			(p.pinxing.collective.entries || []).forEach(function (e, i) {
				add({ cat: '集体活动', label: e.name || '未命名活动', path: LIST_PATH.collective + '[' + i + ']', status: e.status, evidence: e.evidence, date: e.date });
			});
			if (+p.pinxing.service.volunteerHours > 0) {
				add({ cat: '社会服务', label: '志愿服务 ' + fmt(p.pinxing.service.volunteerHours) + ' 小时', path: 'pinxing.service', status: p.pinxing.service.volunteerStatus, evidence: p.pinxing.service.volunteerNote, date: '', extra: 'statusKey' });
			}
			(p.ability.academic || []).forEach(function (it, i) {
				var c = map.academic[it.id];
				add({ cat: '学术科研', label: it.project || it.name || '未命名成果', path: LIST_PATH.academic + '[' + i + ']', status: it.status, evidence: it.evidence, date: it.date, pts: c ? c._pts : 0, note: c ? c._reason : '' });
			});
			(p.ability.culture || []).forEach(function (it, i) {
				var c = map.culture[it.id];
				add({ cat: '文体竞赛', label: it.name || '未命名赛事', path: LIST_PATH.culture + '[' + i + ']', status: it.status, evidence: it.evidence, date: it.date, pts: c ? c._pts : 0, note: c ? c._reason : '' });
			});
			(p.ability.position || []).forEach(function (it, i) {
				var c = map.position[it.id];
				add({ cat: '组织任职', label: (it.org || '') + ' ' + (it.role || ''), path: LIST_PATH.position + '[' + i + ']', status: it.status, evidence: it.evidence, date: '', pts: c ? c._pts : 0, note: c ? c._reason : '' });
			});
			(p.reward.items || []).forEach(function (it, i) {
				var c = map.reward[it.id];
				add({ cat: '奖励分', label: it.name || (c ? c._reason : '未命名表彰'), path: LIST_PATH.reward + '[' + i + ']', status: it.status, evidence: it.evidence, date: it.date, pts: c ? c._pts : 0 });
			});
			(p.pinxing.deductions || []).forEach(function (d, i) {
				add({ cat: '扣分', label: d.label || d.type, path: LIST_PATH.deduction + '[' + i + ']', status: d.status, evidence: '', date: d.date, pts: -1, note: d.note });
			});

			var by = function (s) { return rows.filter(function (r) { return (r.status || 'none') === s; }).length; };
			var filter = ZC.state.ui.matFilter || 'all';
			var shown = filter === 'all' ? rows : rows.filter(function (r) { return (r.status || 'none') === filter; });

			var stats = '<div class="stats">' + ZC.EVIDENCE_STATUS.map(function (s) {
				return '<button type="button" class="stat' + (filter === s.id ? ' is-on' : '') + '" data-act="mat-filter" data-arg="' + s.id + '">' +
					'<b class="tone-' + s.tone + '">' + by(s.id) + '</b><span>' + s.label + '</span></button>';
			}).join('') +
				'<button type="button" class="stat' + (filter === 'all' ? ' is-on' : '') + '" data-act="mat-filter" data-arg="all">' +
				'<b>' + rows.length + '</b><span>全部</span></button></div>';

			var list = shown.length ? '<div class="mat-list">' + shown.map(function (r) {
				var statusKey = r.extra === 'statusKey' ? (r.path + '.volunteerStatus') : (r.path + '.status');
				var evidenceKey = r.extra === 'statusKey' ? (r.path + '.volunteerNote') : (r.path + '.evidence');
				return '<div class="mat-row' + (r.status === 'rejected' ? ' is-bad' : r.status === 'approved' ? ' is-ok' : '') + '">' +
					'<div class="mat-main"><div class="mat-title">' + esc(r.label) + ' ' + pill(r.cat, 'muted') +
						(r.pts !== undefined && r.pts !== null ? '<span class="mat-pts ' + (r.pts < 0 ? 'is-neg' : '') + '">' + (r.pts < 0 ? '−' : '+') + fmt(Math.abs(r.pts)) + '</span>' : '') +
					'</div>' + (r.note ? '<p class="mat-note">' + esc(r.note) + '</p>' : '') + '</div>' +
					'<div class="mat-ctl">' +
						sel(statusKey, r.status || 'none', ZC.EVIDENCE_STATUS.map(function (x) { return { id: x.id, label: x.label }; })) +
						txt(evidenceKey, r.evidence, { ph: '佐证材料' }) +
					'</div></div>';
			}).join('') + '</div>' : ui.empty('folder', '该状态下暂无条目', '先去录入加分项，这里会自动汇总成材料清单。');

			var GUIDE = [
				['竞赛获奖', '获奖证书原件扫描件 / 照片；官网公示名单截图；证书编号。团队项目需附成员名单页，证明你在名单内。'],
				['论文', '录用通知（Acceptance Letter）或期刊封面 + 目录 + 正文页；检索证明（如 SCI / EI 检索号）。<b>第一署名单位必须为西安交通大学</b>。'],
				['专利 / 软著', '专利证书或授权公告；软件著作权登记证书。注意完成人排序。'],
				['志愿服务', '志愿服务信息系统时长记录截图（含姓名、总时长、学年区间）；主办方盖章的服务证明。'],
				['社会实践', '立项文件 + 结项 / 考核合格证明 + 团队成员名单。'],
				['挂职 / 见习', '接收单位证明（含起止时间、岗位）、政府见习鉴定表。'],
				['任职', '任职文件 / 聘书 / 选举结果公示；年度考核结果（优 / 良 / 合格）；任期起止时间证明。'],
				['集体活动', '主办单位（学校或书 / 学院）发布的名单、通知、签到表或活动证明。'],
				['荣誉表彰', '表彰决定文件（含文号）、证书。'],
				['扣分事项', '一般由书院 / 班级直接认定，无需学生举证；如有异议请在公示期内提出。']
			];
			var guideCard = card('各类材料准备要点',
				'<div class="guide">' + GUIDE.map(function (g) {
					return '<div class="guide-item"><b>' + g[0] + '</b><p>' + g[1] + '</p></div>';
				}).join('') + '</div>' +
				'<div class="note note-warn"><b>时间建议：</b>从大一开学就建立个人成果清单，竞赛证书、志愿时长、活动证明、任职文件随手归档（建议一个云盘文件夹 + 命名规范「学年_类别_项目名」）。志愿服务 32 小时<b>按学年累计</b>，早做早从容。</div>',
				{ icon: 'bulb' });

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">佐证材料清单</h1>' +
					'<p class="page-sub">综测评定的实质是「材料评定」—— 没有佐证的加分在班级评议阶段极易被剔除</p>' +
					'<div class="page-metric"><b>' + rows.filter(function (r) { return r.status === 'approved'; }).length + '</b><span>/ ' + rows.length + ' 已认定</span></div></div>' +
				stats +
				card('清单（状态与材料可在这里直接改）', list,
					{ icon: 'folder', actions: btn('导出 CSV', 'exp-csv', { cls: 'btn-sm', icon: 'download' }) + btn('打印', 'print', { cls: 'btn-sm', icon: 'print' }) }) +
				guideCard +
			'</div>';
		}
	};

	/* ==================================================================
	 * 七、情景模拟
	 * ================================================================== */
	V.simulate = {
		render: function (ctx) {
			var base = ZC.getRealProfile();
			var R = ZC.getRules(base);
			var baseRes = ZC.compute(base, R);
			var inSim = ZC.state.simMode;
			var draft = inSim ? ZC.state.simDraft : base;
			var draftRes = inSim ? ZC.compute(draft, R) : baseRes;

			var QUICK = [
				['品行加分', [['vol32', '志愿服务补满 32h'], ['orgtrain', '党团理论学习 +1 次'], ['provtrain', '省部级培训 +1 次'], ['collect', '集体活动 +1 次'], ['practice', '校级社会实践 +1 项'], ['provint', '省部级见习 +1 项']]],
				['学术科研', [['c_sch_3', '校级竞赛 三等奖'], ['c_sch_1', '校级竞赛 一等奖'], ['c_prov_2', '省级竞赛 二等奖'], ['c_nat_3', '国家级竞赛 三等奖'], ['p_gen', '一般期刊论文（一作）'], ['p_core', '核心 / 国际会议（一作）'], ['p_util', '实用新型专利']]],
				['文体竞赛', [['a_sch_3', '校级文艺 三等奖'], ['a_sch_1', '校级文艺 一等奖'], ['a_prov_1', '省级文艺 一等奖'], ['s_sch_48', '校级体育 第 4—8 名']]],
				['任职与奖励', [['pos_dorm', '宿舍长（合格）'], ['pos_banz', '班长（优秀）'], ['pos_head', '院级组织正职（优秀）'], ['r_coll', '院级表彰'], ['r_school', '校级表彰'], ['r_deed', '做好事 +1']]],
				['反向模拟：如果出事了', [['ded_kuangke', '旷课 1 次'], ['ded_weisheng', '宿舍卫生不合格'], ['ded_jinggao', '警告处分']]]
			];

			var segs = [
				['品行素质分', baseRes.pinxing.final, draftRes.pinxing.final, R.frame.pinxing],
				['能力拓展分', baseRes.ability.final, draftRes.ability.final, R.frame.ability],
				['奖励分', baseRes.reward.final, draftRes.reward.final, R.reward.cap],
				['综合素质测评成绩', baseRes.total, draftRes.total, baseRes.maxTotal]
			];
			var cb = ZC.composite(base, R, baseRes.total);
			var cd = ZC.composite(draft, R, draftRes.total);

			var cmp = '<div class="tbl-wrap"><table class="tbl tbl-cmp"><thead><tr><th>项目</th><th class="tr">当前正式</th>' +
				'<th class="tr">' + (inSim ? '模拟草稿' : '未开始模拟') + '</th><th class="tr">变化</th><th class="tr">满分</th></tr></thead><tbody>' +
				segs.map(function (s) {
					var d = ZC.r2(s[2] - s[1]);
					return '<tr class="' + (s[0].indexOf('测评成绩') >= 0 ? 'is-sum' : '') + '"><td>' + s[0] + '</td><td class="tr">' + fmt(s[1]) + '</td>' +
						'<td class="tr">' + fmt(s[2]) + '</td><td class="tr">' + (d === 0 ? '<span class="na">0</span>' :
							'<b class="' + (d > 0 ? 'pos' : 'neg') + '">' + ZC.signed(d) + '</b>') + '</td><td class="tr na">' + fmt(s[3]) + '</td></tr>';
				}).join('') +
				'<tr class="is-sum"><td>' + esc(cb.preset.name) + '综合成绩</td><td class="tr">' + fmt(cb.total) + '</td><td class="tr">' + fmt(cd.total) + '</td>' +
				'<td class="tr">' + (ZC.r2(cd.total - cb.total) === 0 ? '<span class="na">0</span>' :
					'<b class="' + (cd.total > cb.total ? 'pos' : 'neg') + '">' + ZC.signed(ZC.r2(cd.total - cb.total)) + '</b>') + '</td><td class="tr na">—</td></tr>' +
				'</tbody></table></div>';

			var gapPlan = '';
			var t = +base.target.score || 0;
			if (t) {
				var gap = ZC.r2(t - baseRes.total);
				if (gap <= 0) {
					gapPlan = '<div class="note note-ok"><b>已达成目标 ' + fmt(t) + ' 分</b>（当前 ' + fmt(baseRes.total) + '，超出 ' + fmt(-gap) + ' 分）。</div>';
				} else {
					var plan = ZC.recommend(base, R, baseRes, gap);
					var acc = 0;
					gapPlan = '<div class="plan"><h4>目标反推：从 ' + fmt(baseRes.total) + ' 到 ' + fmt(t) + '（差 ' + fmt(gap) + ' 分）</h4><ol>' +
						plan.map(function (x) {
							acc = ZC.r2(acc + x.gain);
							return '<li><span class="rec-gain">+' + fmt(x.gain) + '</span><b>' + esc(x.label) + '</b>' +
								'<em>投入' + ZC.EFFORT_LABEL[x.effort] + '</em><span class="plan-acc">累计 ' + fmt(ZC.r2(baseRes.total + acc)) + '</span></li>';
						}).join('') + '</ol>' +
						(acc < gap ? '<p class="hint">按当前剩余空间，最多还能提升 ' + fmt(acc) + ' 分，仍差 ' + fmt(ZC.r2(gap - acc)) + ' 分。可能需要核对书院细则或调整目标。</p>' : '') +
						'</div>';
				}
			}

			var head = '<div class="page-head"><h1 class="page-title">情景模拟</h1>' +
				'<p class="page-sub">「如果我再做一件事，综测会涨多少？」—— 先模拟，再决定把时间花在哪</p>' +
				(inSim ? '<div class="sim-chip">' + icon('flask', 14) + ' 模拟模式进行中</div>' : '') + '</div>';

			var simBar = inSim
				? '<div class="note note-sim"><b>' + icon('flask', 15) + ' 你正在编辑模拟草稿</b>' +
					'<p>现在所有页面的改动都只作用于草稿，正式档案不受影响。左侧导航照常使用即可。</p>' +
					'<div class="add-row">' + btn('应用到正式档案', 'sim-apply', { cls: 'btn-primary btn-sm', icon: 'check' }) +
					btn('重置草稿', 'sim-reset', { cls: 'btn-sm', icon: 'undo' }) +
					btn('丢弃并退出', 'sim-discard', { cls: 'btn-sm btn-danger', icon: 'x' }) + '</div></div>'
				: '<div class="note note-info"><b>两种玩法</b><p>① 点下面的快捷按钮，一键叠加「假设成果」看变化；② 进入完整模拟模式，用真实的录入界面搭任意场景（含扣分、任职任期等复杂情况）。</p>' +
					'<div class="add-row">' + btn('进入完整模拟模式', 'sim-enter', { cls: 'btn-primary btn-sm', icon: 'flask' }) + '</div></div>';

			var quickCard = card('一键叠加假设成果',
				'<div class="qk">' + QUICK.map(function (g) {
					return '<div class="qk-group"><h4>' + g[0] + '</h4><div class="qk-body">' + g[1].map(function (x) {
						return '<button type="button" class="qbtn" data-act="sim-quick" data-arg="' + x[0] + '">' + icon('plus', 12) + esc(x[1]) + '</button>';
					}).join('') + '</div></div>';
				}).join('') + '</div>',
				{ icon: 'flask', sub: '每次点击都会在草稿上叠加一项，可反复点击模拟「多做几次」' });

			return '<div class="page">' + head + simBar +
				card('对比结果', cmp, { icon: 'trend', sub: '实时计算，含综合成绩联动' }) +
				quickCard +
				(gapPlan ? card('目标反推', gapPlan, { icon: 'target' }) : '') +
				card('模拟结果说明', '<p class="hint">模拟采用与正式计分完全相同的引擎与规则口径（含各项封顶、同一项目取最高、任职取最高、扣分不设上限）。因此结果可直接作为决策依据，但<b>最终分值以班级评议与书院认定为准</b> —— 尤其是书院集体活动单次分值、竞赛级别认定与任职考核等级。</p>',
					{ icon: 'info' }) +
			'</div>';
		}
	};

	/* ==================================================================
	 * 八、班级对比
	 * ================================================================== */
	V.rank = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R, res = ctx.res;
			p.classmates = p.classmates || [];
			var useComposite = !!(+p.coursework.score);
			var selfScore = useComposite ? ZC.composite(p, R, res.total).total : res.total;
			var list = p.classmates.map(function (m) {
				return { name: m.name || '同学', v: useComposite ? (+m.composite || 0) : (+m.zongce || 0), id: m.id, raw: m };
			});
			var all = list.concat([{ name: p.meta.name || '我', v: selfScore, self: true }]).filter(function (x) { return x.v > 0; })
				.sort(function (a, b) { return b.v - a.v; });
			var myRank = all.findIndex(function (x) { return x.self; }) + 1;
			var total = all.length;
			var q = R.classQuota || { te: 1, yi: 5, er: 15, san: 30 };
			var pct = total ? myRank / total * 100 : 0;
			var tier = pct <= q.te ? '特等' : pct <= q.yi ? '一等' : pct <= q.er ? '二等' : pct <= q.san ? '三等' : '未达档位';

			var maxV = all.length ? all[0].v : 100;
			var minV = all.length ? all[all.length - 1].v : 0;
			var dist = all.map(function (x) {
				var h = Math.max(8, (x.v - minV) / ((maxV - minV) || 1) * 54 + 8);
				return '<span class="dist-bar' + (x.self ? ' is-me' : '') + '" style="height:' + h.toFixed(1) + 'px" title="' + esc(x.name) + ' ' + fmt(x.v) + '"></span>';
			}).join('');

			var rankBody = total ? '<div class="rankbox">' +
				'<div class="rank-num">#' + myRank + '<span>/ ' + total + '</span></div>' +
				'<div class="rank-body"><div class="rank-bar"><i style="left:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%"></i></div>' +
					'<p class="rank-meta">前 ' + fmt(Math.round(pct * 10) / 10) + '% · ' +
					(useComposite ? '按综合成绩（' + esc(res.composite.preset.name) + '）' : '按综测原始分') + '排名 · 估算档位 <b>' + tier + '</b></p>' +
					'<div class="dist">' + dist + '</div></div></div>'
				: ui.empty('users', '还没有可对比的数据', '至少录入 1 位同学的成绩；填写自己的课程成绩后会自动切换为按综合成绩排名。');

			var rows = p.classmates.map(function (m, i) {
				var base = 'classmates[' + i + ']';
				return '<div class="cm-row">' + txt(base + '.name', m.name, { ph: '姓名 / 代号' }) +
					numIn(base + '.composite', m.composite, { ph: '综合成绩', min: 0, max: 150, step: 0.1 }) +
					numIn(base + '.zongce', m.zongce, { ph: '综测分', min: 0, max: 120, step: 0.1 }) +
					ui.iconBtn('del', 'trash', { arg: 'classmates|' + i, title: '删除', cls: 'is-danger' }) + '</div>';
			}).join('');

			var pasteOpen = !!ZC.state.ui.expanded.paste;
			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">班级对比与排名估算</h1>' +
					'<p class="page-sub">综测最终落到排名上 —— 录入同学成绩，估算自己的位置与奖学金档位</p>' +
					'<div class="page-metric"><b>' + (myRank ? '#' + myRank : '—') + '</b><span>/ ' + (total || '—') + ' 估算排名</span></div></div>' +
				'<div class="note note-warn">' + icon('alert', 14) + ' <b>估算性质说明：</b>本模块仅用于自我定位。真实评奖按专业 / 班级分别排名，名额比例、体测要求、资格红线与加权口径各学院不同，同学数据也未必完整。请以书院公示结果为准，并尊重他人隐私 —— 不要录入他人学号等敏感信息。</div>' +
				card('我的位置', rankBody, { icon: 'users', sub: total ? '共 ' + total + ' 人参与对比（含你自己）' : '录入同学成绩后显示位置' }) +
				card('名额比例设置（%）',
					'<div class="entry-grid">' +
						fld('特等 ≤', numIn('ruleOverride.classQuota.te', q.te, { min: 0, max: 100, step: 0.5 })) +
						fld('一等 ≤', numIn('ruleOverride.classQuota.yi', q.yi, { min: 0, max: 100, step: 0.5 })) +
						fld('二等 ≤', numIn('ruleOverride.classQuota.er', q.er, { min: 0, max: 100, step: 0.5 })) +
						fld('三等 ≤', numIn('ruleOverride.classQuota.san', q.san, { min: 0, max: 100, step: 0.5 })) +
					'</div><p class="hint">默认值是常见量级的示意，请改成你所在学院 / 班级当年公布的比例。</p>',
					{ icon: 'gear' }) +
				card('同学名单',
					(rows ? '<div class="cm-list">' + rows + '</div>' : '<p class="hint">尚未录入。可以用「批量粘贴」一次性导入。</p>') +
					'<div class="add-row">' +
						btn('添加一行', 'add', { arg: 'classmate|classmate', cls: 'btn-sm btn-primary', icon: 'plus' }) +
						btn(pasteOpen ? '收起批量粘贴' : '批量粘贴导入', 'toggle', { arg: 'paste', cls: 'btn-sm', icon: 'upload' }) +
					'</div>' +
					(pasteOpen ? '<div class="paste"><p class="hint">每行一条：<code>姓名,综合成绩</code> 或 <code>姓名,综合成绩,综测分</code>，逗号可用中文逗号、空格或制表符。</p>' +
						area('@@paste', '', { rows: 6, ph: '张三,88.6,95\n李四 86.2 91\n王五,90.1,98' }) +
						'<div class="add-row">' + btn('导入', 'paste-do', { cls: 'btn-sm btn-primary', icon: 'check' }) + '</div></div>' : ''),
					{ icon: 'list', sub: useComposite ? '当前按「综合成绩」排序' : '当前按「综测分」排序（填写自己的课程成绩后切换为综合成绩）' }) +
			'</div>';
		}
	};

	/* ==================================================================
	 * 九、程序与时效
	 * ================================================================== */
	V.procedure = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R;
			var STEPS = [
				['学生提交', '提交学年总结及支撑材料（本工具可一键导出自评表 Markdown）'],
				['班级初评', '班级评议小组（班主任 + 学生干部 + 学生代表）由班主任主持初评'],
				['本人确认', '学生核对初评结果并<b>签字确认</b> —— 最后一次低成本纠错机会'],
				['书院审核', '书院综测工作组（院领导 + 辅导员 + 班主任 + 学生代表）审核'],
				['院内公示', '公示<b>不少于 3 个工作日</b>，同时报学生处审核并报相关学院'],
				['异议', '公示起 <b>3 个工作日内</b>向书院工作组提出书面异议 → 书院 <b>3 个工作日内</b>答复'],
				['申诉', '对答复不服，在答复后 <b>3 个工作日内</b>向学生处书面申诉（附书院答复）'],
				['最终处理', '学生处 <b>3 个工作日内</b>调查审核并出具最终处理意见']
			];
			var pd = p.meta.publicityDate;
			var tl = pd ? ZC.appealTimeline(pd, R) : null;
			var now = new Date();
			var left = function (d) {
				if (!d) return null;
				var x = new Date(d.getTime());
				x.setHours(23, 59, 59);
				return Math.ceil((x - now) / 86400000);
			};

			var tlRows = tl ? [['书面异议截止', tl.objection, '向书院综测工作组提交'], ['书院答复截止', tl.reply, '书院工作组答复'],
				['向学生处申诉截止', tl.appeal, '需附书院答复意见'], ['学生处最终处理', tl.final, '出具最终处理意见']].map(function (t, i) {
					var n = left(t[1]);
					return '<div class="tl-item' + (n < 0 ? ' is-past' : n <= 3 ? ' is-urgent' : '') + '">' +
						'<span class="tl-dot"></span>' +
						'<div class="tl-main"><b>' + t[0] + '</b><em>' + t[2] + '</em></div>' +
						'<div class="tl-date">' + ZC.dateStr(t[1]) + '<span>' + (n < 0 ? '已过' : '剩 ' + n + ' 天') + '</span></div></div>';
				}).join('') : '';

			var calc = card('时效计算器',
				'<div class="entry-grid">' +
					fld('院内公示起始日', dateIn('meta.publicityDate', pd), '填写后自动推算后续全部截止日（按工作日，跳过周六周日）') +
					fld('本人已签字确认', sw('meta.signedOff', p.meta.signedOff, p.meta.signedOff ? '已签字' : '未签字')) +
				'</div>' +
				(tl ? '<div class="tl">' + tlRows + '</div><p class="hint">⚑ 上述按「工作日」推算，仅跳过周六周日；<b>法定节假日与寒暑假需自行顺延核对</b>，以书院通知的具体日期为准。</p>'
					: '<p class="hint">填写公示起始日后，这里会显示四个关键截止日期与倒计时。</p>'),
				{ icon: 'clock', sub: '三个「3 个工作日」错过即丧失程序权利' });

			var flow = card('完整评定流程',
				'<div class="flow">' + STEPS.map(function (s, i) {
					return '<div class="flow-item"><span class="flow-num">' + (i + 1) + '</span>' +
						'<div><b>' + s[0] + '</b><p>' + s[1] + '</p></div></div>';
				}).join('') + '</div>',
				{ icon: 'list', sub: '每学年第一学期集中开展' });

			var tpl = '关于 ' + (p.meta.academicYear || '') + ' 学年本科生综合素质测评结果的书面异议\n\n' +
				'致：' + (p.meta.college || '') + '综合素质测评工作组\n\n' +
				'本人 ' + (p.meta.name || '') + '（学号 ' + (p.meta.studentId || '________') + '，' + (p.meta.grade || '____班') + '），' +
				'现就本学年综合素质测评公示结果提出书面异议，具体事项如下：\n\n' +
				'一、异议事项\n（请逐条写明：哪一项加分 / 扣分、公示分值、你认为的正确分值、依据的规则条款）\n1.\n2.\n\n' +
				'二、事实与依据\n（请写明佐证材料名称、编号、取得时间，以及对应的规则条款）\n\n' +
				'三、请求\n请求工作组对上述事项重新核定，并在 3 个工作日内予以书面答复。\n\n' +
				'附：佐证材料清单\n1.\n2.\n\n' +
				'异议人（签字）：__________　　日期：______年____月____日';

			var appeal = card('申诉文书模板（可复制）',
				'<textarea class="inp inp-ta" id="appeal-ta" rows="14">' + esc(tpl) + '</textarea>' +
				'<div class="add-row">' + btn('复制模板', 'copy-appeal', { cls: 'btn-sm btn-primary', icon: 'copy' }) + '</div>' +
				'<div class="note note-info"><b>写作要点：</b>① 只写事实与规则条款，不写情绪；② 每一条异议都要配一份可核验的佐证材料；' +
				'③ 明确写「请求 3 个工作日内书面答复」，把程序时限固定下来；④ 若对书院答复不服，须在答复后 3 个工作日内向学生处申诉，并<b>附上书院的答复原件</b>。</div>',
				{ icon: 'book' });

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">评定程序与申诉时效</h1>' +
					'<p class="page-sub">把日期算清楚 —— 公示起 3 个工作日提异议，答复后 3 个工作日申诉，学生处 3 个工作日最终处理</p></div>' +
				calc + flow + appeal +
			'</div>';
		}
	};

	/* ==================================================================
	 * 十、规则手册
	 * ================================================================== */
	V.rulebook = {
		render: function () {
			var q = (ZC.state.ui.rbQuery || '').trim().toLowerCase();
			var groups = ZC.RULEBOOK.map(function (g, gi) {
				var blocks = g.b.filter(function (b) {
					return !q || (b[0] + b[1]).toLowerCase().indexOf(q) >= 0 || g.q.join(' ').toLowerCase().indexOf(q) >= 0;
				});
				return blocks.length ? { g: g.g, blocks: blocks, gi: gi, open: !!ZC.state.ui.expanded['rb:' + gi] || !!q } : null;
			}).filter(Boolean);
			var total = groups.reduce(function (s, g) { return s + g.blocks.length; }, 0);

			var body = groups.length ? groups.map(function (g) {
				return '<section class="rb-group">' +
					'<button type="button" class="rb-head" data-act="toggle" data-arg="rb:' + g.gi + '">' +
						'<span>' + esc(g.g) + '</span><i>' + g.blocks.length + '</i>' + icon(g.open ? 'down' : 'right', 14) + '</button>' +
					(g.open ? '<div class="rb-body">' + g.blocks.map(function (b) {
						return '<article class="rb-item"><h4>' + hl(b[0], q) + '</h4><div class="rb-text">' + hl(b[1], q) + '</div></article>';
					}).join('') + '</div>' : '') +
					'</section>';
			}).join('') : ui.empty('search', '没有匹配的内容', '换个关键词试试，例如「志愿」「任职」「署名」「旷课」。');

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">规则手册</h1>' +
					'<p class="page-sub">校级办法速查 · <span class="flag">⚑</span> 标记为常见误解或需按书院口径确认之处</p></div>' +
				'<div class="searchbar">' + icon('search', 16) +
					'<input class="inp" id="rb-search" data-k="ui.rbQuery" data-t="text" placeholder="搜索规则、分值、关键词…（按 / 聚焦）" value="' + esc(ZC.state.ui.rbQuery || '') + '">' +
					'<span class="muted">' + (q ? '匹配 ' + total + ' 条' : '共 ' + ZC.RULEBOOK.reduce(function (s, g) { return s + g.b.length; }, 0) + ' 条') + '</span></div>' +
				body +
				'<div class="note note-muted"><b>免责声明：</b>本工具依据公开发布的《西安交通大学本科生综合素质测评成绩评定办法》（2018）及其实施细则整理，用于学生自评与材料准备。校级办法是底线标准，各书（学）院可在集体活动认定、任职考核、社会服务细化等方面另行规定，<b>最终以你所在书院当年公示的细则和班级评议、书院审定结果为准</b>。</div>' +
			'</div>';
		}
	};
	function hl(text, q) {
		if (!q) return text;
		try {
			return text.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>');
		} catch (e) { return text; }
	}

	/* ==================================================================
	 * 十一、设置
	 * ================================================================== */
	V.settings = {
		render: function (ctx) {
			var p = ctx.p, R = ctx.R;
			var RO = 'ruleOverride';
			var used = '—';
			try { used = (new Blob([localStorage.getItem('merit.zongce.v1') || '']).size / 1024).toFixed(1) + ' KB'; } catch (e) { used = '—'; }

			var profileCard = card('档案信息',
				'<div class="entry-grid">' +
					fld('姓名', txt('meta.name', p.meta.name, { ph: '可留空' })) +
					fld('学号', txt('meta.studentId', p.meta.studentId, { ph: '仅本机保存 / 可留空' })) +
					fld('书院', sel('meta.college', p.meta.college, ZC.COLLEGES)) +
					fld('专业', txt('meta.major', p.meta.major)) +
					fld('班级', txt('meta.grade', p.meta.grade, { ph: '如 计算机 0001 班' })) +
					fld('学年', txt('meta.academicYear', p.meta.academicYear, { ph: '如 2025—2026' })) +
					fld('体测', sel('meta.pe', p.meta.pe, [
						{ id: '', label: '未测 / 不填' }, { id: 'excellent', label: '优秀' }, { id: 'good', label: '良好' },
						{ id: 'pass', label: '及格' }, { id: 'fail', label: '不及格' }])) +
				'</div>' +
				fld('备注（显示在概览顶部）', area('meta.note', p.meta.note, { rows: 2, ph: '例如：本学年重点冲省级竞赛 + 补志愿时长' })) +
				'<div class="add-row">' + btn('档案管理（多学年 / 多人）', 'profiles-open', { cls: 'btn-sm', icon: 'folder' }) + '</div>',
				{ icon: 'user', sub: '所有信息只保存在本机浏览器，登录后才会同步到你的云端' });

			var ruleCard = card('书院口径与规则参数',
				'<div class="entry-grid">' +
					fld('集体活动 单次分值', numIn(RO + '.pinxing.collective.perTime', R.pinxing.collective.perTime, { min: 0, step: 0.1 }), '0.6 = 彭康口径；填 0 表示按校级未定口径') +
					fld('突出贡献一次性满分', numIn(RO + '.pinxing.collective.outstandingFull', R.pinxing.collective.outstandingFull, { min: 0, step: 0.5 })) +
					fld('志愿服务达标小时数', numIn(RO + '.pinxing.service.volunteerHours', R.pinxing.service.volunteerHours, { min: 1 }), '默认 32 小时') +
					fld('基准分', numIn(RO + '.pinxing.base', R.pinxing.base, { min: 0 })) +
					fld('集体活动上限', numIn(RO + '.pinxing.caps.collective', R.pinxing.caps.collective, { min: 0, step: 0.5 })) +
					fld('思政学习上限', numIn(RO + '.pinxing.caps.ideology', R.pinxing.caps.ideology, { min: 0, step: 0.5 })) +
					fld('社会服务上限', numIn(RO + '.pinxing.caps.service', R.pinxing.caps.service, { min: 0, step: 0.5 })) +
					fld('学术科研上限', numIn(RO + '.ability.caps.academic', R.ability.caps.academic, { min: 0, step: 0.5 })) +
					fld('文体竞赛上限', numIn(RO + '.ability.caps.culture', R.ability.caps.culture, { min: 0, step: 0.5 })) +
					fld('任职上限', numIn(RO + '.ability.caps.position', R.ability.caps.position, { min: 0, step: 0.5 })) +
					fld('奖励分上限', numIn(RO + '.reward.cap', R.reward.cap, { min: 0, step: 0.5 })) +
					fld('品行素质分满分', numIn(RO + '.frame.pinxing', R.frame.pinxing, { min: 0, step: 0.5 })) +
				'</div>' +
				'<div class="entry-grid">' +
					fld('任职不满一年的口径', sel(RO + '.ability.position.partialTerm.mode', R.ability.position.partialTerm.mode, [
						{ id: 'prorate', label: '按实际工作时间比例（月数 / 12）' },
						{ id: 'half', label: '最高不超过满一年的 1/2' },
						{ id: 'custom', label: '自定义固定系数' },
						{ id: 'none', label: '不加分' }])) +
					fld('自定义系数', numIn(RO + '.ability.position.partialTerm.custom', R.ability.position.partialTerm.custom, { min: 0, max: 1, step: 0.05 }), 'half / custom 模式生效') +
				'</div>' +
				'<label class="chk"><input type="checkbox" data-k="' + RO + '.pinxing.floorAtZero" data-t="bool"' + (R.pinxing.floorAtZero ? ' checked' : '') + '>' +
					'<span class="chk-box"></span><span>品行素质分扣到 0 为止（不出现负分）</span></label>' +
				'<label class="chk"><input type="checkbox" data-k="' + RO + '.ability.publication.mustBeFirstUnit" data-t="bool"' + (R.ability.publication.mustBeFirstUnit ? ' checked' : '') + '>' +
					'<span class="chk-box"></span><span>论文 / 专利必须校验第一署名单位为西安交通大学（强烈建议开启）</span></label>' +
				'<label class="chk"><input type="checkbox" data-k="' + RO + '.composite.normalizeZongce" data-t="bool"' + (R.composite.normalizeZongce ? ' checked' : '') + '>' +
					'<span class="chk-box"></span><span>把综测（满分 105）折算成百分制再参与综合成绩加权</span></label>' +
				'<p class="hint">⚑ 修改会立即影响计分。校级办法是底线标准，书院可在集体活动认定、任职考核、社会服务细化等方面另行规定。' +
					btn('恢复校级默认', 'reset-rules', { cls: 'btn-sm', icon: 'undo' }) + '</p>',
				{ icon: 'gear', sub: '当前档案：' + esc(p.meta.college) + ' · 只对本档案生效' });

			/* 云同步 */
			var stMap = {
				local: ['本地', 'muted', '未登录，数据只在本机'],
				cloud: ['云端已同步', 'ok', '最近同步：' + (ZC.cloud.lastSync ? ZC.cloud.lastSync.toLocaleTimeString('zh-CN') : '—')],
				syncing: ['同步中', 'info', '正在与云端交换数据'],
				error: ['同步失败', 'danger', ZC.cloud.message || '请检查网络后重试'],
				noscope: ['无作用域', 'warn', '当前路径未登记站点作用域，已禁用云同步'],
				conflict: ['作用域冲突', 'danger', '云端该作用域已有其它站点的数据，已停止上传']
			};
			var st = stMap[ZC.cloud.state] || stMap.local;
			var logged = !!(window.authManager && window.authManager.isLoggedIn());
			var user = logged ? window.authManager.getUser() : null;
			var cloudCard = card('云同步（Supabase）',
				'<div class="cloud-row">' +
					'<span class="cloud-dot is-' + st[1] + '"></span>' +
					'<div class="cloud-main"><b>' + st[0] + '</b><p>' + esc(st[2]) + '</p></div>' +
				'</div>' +
				'<div class="cloud-meta">' +
					'<span>账号：' + (logged ? esc(user.email || user.id.slice(0, 8)) : '未登录') + '</span>' +
					'<span>作用域：' + (window.getCurrentSiteScope ? (window.getCurrentSiteScope() || '未登记') : '—') + '</span>' +
				'</div>' +
				'<label class="chk"><input type="checkbox" data-k="@@autoSync" data-t="bool"' + (ZC.cloud.auto ? ' checked' : '') + '>' +
					'<span class="chk-box"></span><span>登录后自动同步（改动 1.4 秒后上传）</span></label>' +
				'<div class="add-row">' +
					btn('立即上传', 'cloud-push', { cls: 'btn-sm', icon: 'upload' }) +
					btn('从云端恢复', 'cloud-pull', { cls: 'btn-sm', icon: 'download' }) +
					btn(logged ? '退出登录' : '登录 / 注册', logged ? 'cloud-signout' : 'cloud-login', { cls: 'btn-sm', icon: 'user' }) +
				'</div>' +
				'<p class="hint">登录入口在站点顶栏头像菜单里（与本站其它工具共用同一账号）。数据按「档案 + 修改时间」合并，换设备登录会先合并再上传，不会把这边的新记录冲掉。未登录时一切功能照常可用，只是不上云。</p>',
				{ icon: 'cloud', sub: '账号与 Formula / Question 等页面共用' });

			var dataCard = card('数据管理',
				'<div class="quick">' +
					'<button class="quick-item" data-act="exp-json">' + icon('download', 18) + '<span>导出备份 (JSON)</span></button>' +
					'<button class="quick-item" data-act="import">' + icon('upload', 18) + '<span>导入备份</span></button>' +
					'<button class="quick-item" data-act="exp-md">' + icon('list', 18) + '<span>导出自评表 (MD)</span></button>' +
					'<button class="quick-item" data-act="exp-csv">' + icon('calc', 18) + '<span>导出明细 (CSV)</span></button>' +
					'<button class="quick-item" data-act="print">' + icon('print', 18) + '<span>打印 / 存为 PDF</span></button>' +
					'<button class="quick-item" data-act="demo">' + icon('star', 18) + '<span>载入示例档案</span></button>' +
					'<button class="quick-item is-danger" data-act="clear-profile">' + icon('trash', 18) + '<span>清空当前档案</span></button>' +
				'</div>' +
				'<p class="hint">存储状态：' + (ZC.storageOK ? '<b class="pos">正常（localStorage）</b>' : '<b class="neg">不可用，仅本次会话有效</b>') +
					' · 占用约 ' + used + ' · 共 ' + ZC.state.profiles.length + ' 个档案。<br>' +
					'<b>数据存在这台设备的浏览器里</b>：清除浏览器数据、换设备或换浏览器都会丢失，请养成定期导出 JSON 的习惯。</p>',
				{ icon: 'folder' });

			var profiles = ZC.state.profiles.map(function (pr) {
				var r = ZC.getRules(pr), rs = ZC.compute(pr, r);
				return '<div class="pf' + (pr.id === ZC.state.activeId ? ' is-on' : '') + '">' +
					'<div class="pf-main"><b>' + esc(pr.meta.name || '未命名档案') + '</b>' +
						'<em>' + esc(pr.meta.college) + ' · ' + esc(pr.meta.academicYear) + (pr.meta.grade ? ' · ' + esc(pr.meta.grade) : '') + '</em></div>' +
					'<div class="pf-score">' + fmt(rs.total) + ' 分</div>' +
					'<div class="pf-ops">' +
						(pr.id === ZC.state.activeId ? pill('当前', 'ok') : ui.iconBtn('prof-switch', 'check', { arg: pr.id, title: '切换到此档案' })) +
						ui.iconBtn('prof-dup', 'copy', { arg: pr.id, title: '复制（用于新学年）' }) +
						ui.iconBtn('prof-del', 'trash', { arg: pr.id, title: '删除', cls: 'is-danger' }) +
					'</div></div>';
			}).join('');
			var pfCard = card('档案管理',
				(profiles || '') + '<div class="add-row">' + btn('新建档案', 'prof-new', { cls: 'btn-sm btn-primary', icon: 'plus' }) + '</div>' +
				'<p class="hint">建议每学年建一个档案；也可以给室友各建一个用来互相核对（数据仍只存在本机）。</p>',
				{ icon: 'folder', actions: btn('新建', 'prof-new', { cls: 'btn-sm', icon: 'plus' }) });

			var about = card('关于本工具',
				'<p>「综测算分器」是给西安交通大学本科生做的综合素质测评自评工具：算得准、看得懂、用得上。</p>' +
				'<ul class="about-list">' +
					'<li><b>算得准</b>：三大板块七个分项的封顶规则、同一项目取最高、任职兼任取最高、任期酌情系数、署名单位校验、不设上限的扣分，全部实现。</li>' +
					'<li><b>看得懂</b>：每一分都给出计算依据，「计算过程」可逐行核对，导出报表带完整轨迹。</li>' +
					'<li><b>用得上</b>：提示引擎主动指出风险（资格红线、材料缺失、扣分、署名不符）与机会（剩余空间、投入产出比、目标反推）。</li>' +
					'<li><b>可带回</b>：登录后自动同步云端；也可以导出 JSON 在任何设备恢复。</li>' +
				'</ul>' +
				'<p class="hint">快捷键：Ctrl / ⌘ + Z 撤销 · Ctrl / ⌘ + S 立即保存 · / 在规则手册中聚焦搜索。<br>' +
				'本工具为个人学习用途的自研工具，与学校官方系统无关。计分口径以学校与书院当年正式文件为准。</p>',
				{ icon: 'info' });

			return '<div class="page">' +
				'<div class="page-head"><h1 class="page-title">设置</h1>' +
					'<p class="page-sub">个人信息 · 书院口径 · 云同步 · 数据备份</p></div>' +
				profileCard + ruleCard + cloudCard + dataCard + pfCard + about +
			'</div>';
		}
	};
})();

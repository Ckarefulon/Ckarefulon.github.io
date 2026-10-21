/* ============================================================
   merit-rules.js — 西安交通大学本科生综合素质测评 评分规则数据
   依据：学生工作部（处）《西安交通大学本科生综合素质测评成绩评定办法》
        2018 年 5 月印发；2018-07-12 校长办公会审议通过的《实施细则》
        与《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41 号）

   本文件只放**静态规则数据与纯函数**，不含任何 DOM 逻辑。
   ============================================================ */
(function (root) {
	'use strict';

	/* ---------- 总结构 ---------- */
	var CAP = { pin: 80, cap: 20, reward: 5 };   // 三区满分
	var TOTAL_MAX = CAP.pin + CAP.cap + CAP.reward; // 105

	/* ---------- 能力拓展：竞赛 / 论文 / 文艺 / 体育 / 任职 / 奖励 ---------- */

	// 竞赛获奖（学术科研及创新创业）
	var COMPETITION = {
		key: 'academic',
		title: '学术科研及创新创业',
		cap: 10,
		prizes: [
			{ id: 'special', name: '特等奖' },
			{ id: 'first', name: '一等奖' },
			{ id: 'second', name: '二等奖' },
			{ id: 'third', name: '三等奖' },
			{ id: 'merit', name: '优秀奖' }
		],
		levels: [
			{
				id: 'intl', name: '高水平国际、国家级',
				values: { special: 10, first: 10, second: 9, third: 8, merit: null }
			},
			{ id: 'prov', name: '省级', values: { special: 8, first: 8, second: 6, third: 4, merit: null } },
			{
				id: 'school',
				name: '校级 / 地方行政部门 / 行业（企业）/ 学会（协会）',
				values: { special: 4, first: 4, second: 3, third: 2, merit: 1 }
			}
		],
		hint: '特等奖单列成档，与一等奖同分。同一项目获不同奖项不累计、取最高。'
	};

	// 论文 / 专著 / 专利
	var PAPER = {
		key: 'academic',
		kinds: [
			{
				id: 'i', name: '学校认定的国际期刊论文', ranks: { r1: 10, r2: 8, r3: 6, r4: 2 }
			},
			{
				id: 'ii', name: '国内核心期刊、国际会议论文', ranks: { r1: 6, r2: 5, r3: 4, r4: 1 }
			},
			{ id: 'iii', name: '国内一般期刊、国内会议论文', ranks: { r1: 3, r2: 2, r3: 1, r4: null } },
			{
				id: 'book', name: '出版专著',
				ranks: { r1: 10, r2: 8, r3: 6, r4: 5, r5: 4, r6: 3, r7: 2, r8: 1 },
				extra: '第一至第八位 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1；第九位及以后 1 分；参编 +1'
			},
			{
				id: 'patent', name: '发明专利（按 i 类计）', ranks: { r1: 10, r2: 8, r3: 6, r4: 2 }
			},
			{
				id: 'utility', name: '实用新型 / 软件著作权（按 ii 类计）', ranks: { r1: 6, r2: 5, r3: 4, r4: 1 }
			}
		],
		rankNames: {
			r1: '第一作者', r2: '第二作者', r3: '第三作者', r4: '第四作者',
			r5: '第五作者', r6: '第六作者', r7: '第七作者', r8: '第八作者', r9: '第九位及以后'
		},
		/* 每种成果可选的位次：专著递减到第八位（第九位及以后按 1 分），
		   其余成果第四及以后同分，所以只列到 r4 */
		rankOptions: {
			i: ['r1', 'r2', 'r3', 'r4'],
			ii: ['r1', 'r2', 'r3', 'r4'],
			iii: ['r1', 'r2', 'r3', 'r4'],
			patent: ['r1', 'r2', 'r3', 'r4'],
			utility: ['r1', 'r2', 'r3', 'r4'],
			book: ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9']
		},
		hint: '第一署名单位须为「西安交通大学」或「Xi’an Jiaotong University」，需录用通知 / 专利证书等佐证。'
	};

	// 文艺比赛
	var ART = {
		key: 'culture',
		kind: 'art',
		title: '文艺比赛',
		prizes: [
			{ id: 'first', name: '一等奖' },
			{ id: 'second', name: '二等奖' },
			{ id: 'third', name: '三等奖' },
			{ id: 'merit', name: '优秀奖' }
		],
		levels: [
			{ id: 'nat', name: '国际级 / 国家级', values: { first: 6, second: 5, third: 4, merit: 3 } },
			{ id: 'prov', name: '省级', values: { first: 4, second: 3.5, third: 3, merit: 2 } },
			{ id: 'school', name: '校级', values: { first: 2, second: 1.5, third: 1, merit: null } }
		]
	};

	// 体育竞赛
	var SPORT = {
		key: 'culture',
		kind: 'sport',
		title: '体育竞赛',
		prizes: [
			{ id: 'rank1', name: '第 1 名' },
			{ id: 'rank2', name: '第 2 名' },
			{ id: 'rank3', name: '第 3 名' },
			{ id: 'rank48', name: '第 4–8 名' }
		],
		levels: [
			{ id: 'nat', name: '国际级 / 国家级', values: { rank1: 6, rank2: 5, rank3: 4, rank48: 3 } },
			{ id: 'prov', name: '省级', values: { rank1: 4, rank2: 3.5, rank3: 3, rank48: 2 } },
			{ id: 'school', name: '校级', values: { rank1: 2, rank2: 1.5, rank3: 1, rank48: 0.5 } }
		],
		breakBonus: { nat: 5, school: 3 },
		breakNote: '破省级及以上纪录 +5，破校级纪录 +3'
	};

	// 学生组织、社团任职
	var DUTY = {
		key: 'duty',
		grades: [
			{ id: 'excellent', name: '优秀' },
			{ id: 'good', name: '良好' },
			{ id: 'pass', name: '合格' }
		],
		posts: [
			{
				id: 'top', name: '大学生党委副书记/党委委员、院党总支副书记、院团工委副书记、院级及以上学生组织正职',
				values: { excellent: 4, good: 3.5, pass: 3 }
			},
			{
				id: 'vice', name: '党总支委员、院级及以上学生组织副职、优秀社团正职',
				values: { excellent: 3.5, good: 3, pass: 2.5 }
			},
			{
				id: 'minister', name: '党支部委员、院级及以上学生组织部长、甲级社团正职、班级团支书、班长',
				values: { excellent: 2, good: 1.5, pass: 1 }
			},
			{
				id: 'member', name: '团学组织干事、班级和社团一般干部、宿舍长',
				values: { excellent: 1, good: 0.75, pass: 0.5 }
			}
		],
		terms: [
			{ id: 'year', name: '任期满一年（原则上）' },
			{ id: 'half', name: '任期约一学期' },
			{ id: 'short', name: '任期不满一学期' }
		],
		hint: '兼任多项职务按最高分计、不累加；考核不合格不加分。'
	};

	// 奖励分
	var REWARD = {
		key: 'reward',
		cap: 5,
		levels: [
			{ id: 'country', name: '全国', value: 5 },
			{ id: 'prov', name: '省', value: 4 },
			{ id: 'city', name: '市', value: 3 },
			{ id: 'school', name: '校', value: 2 },
			{ id: 'college', name: '院', value: 1 }
		],
		types: [
			{ id: 'honor', name: '精神文明集体 / 个人荣誉表彰' },
			{ id: 'deed', name: '见义勇为、舍己救人、拾金不昧等受表彰' },
			{
				id: 'praise', name: '做好事受表扬 / 为校争光、突出贡献',
				note: '每项 +1，可累加，封顶 5'
			}
		]
	};

	/* ---------- 品行素质：集体活动口径 ---------- */
	var COLLECTIVE = {
		schoolDefault: { mode: 'count', perTime: null, note: '校级办法未统一规定单次分值，由各书（学）院自行认定。' },
		pengkang: { perTime: 0.6, note: '彭康书院细化口径：参与一次加 0.6 分，封顶 3 分。' }
	};
	var VOL_HOURS_STEP = 32;   // 每学年 ≥32 小时计 1 分

	var IDEOLOGY = [
		{ id: 'ideo_base', text: '参加各级党团组织的理论学习培训（含网络学习）', score: 1 },
		{ id: 'ideo_prov', text: '参加省、部级理论学习培训', score: 2 },
		{ id: 'ideo_star', text: '培训获「优秀学员」称号', score: 1 }
	];
	var SOCIAL = [
		{ id: 'soc_school', text: '校级社会实践考核合格的团队成员', score: 1 },
		{ id: 'soc_city', text: '市、县级挂职锻炼及政府见习', score: 1 },
		{ id: 'soc_prov', text: '省、部级挂职锻炼、政府见习、国际组织见习', score: 2 },
		{ id: 'soc_honor', text: '获先进个人及表彰', score: 1 }
	];
	var DEDUCT_RULES = [
		{ id: 'd_notify', text: '通报批评', per: 2, unit: '次' },
		{ id: 'd_warn', text: '警告', per: 4, unit: '次' },
		{ id: 'd_serious', text: '严重警告', per: 6, unit: '次' },
		{ id: 'd_record', text: '记过', per: 8, unit: '次' },
		{ id: 'd_probation', text: '留校察看', per: 10, unit: '次' },
		{ id: 'd_skip', text: '旷课（未达处分条件）', per: 1, unit: '次' },
		{ id: 'd_dorm', text: '宿舍卫生不合格（每人每次）', per: 1, unit: '次' }
	];

	/* ---------- 奖学金 ---------- */
	var SCHOLARSHIP = {
		national: [
			{ name: '国家奖学金', amount: 8000, peNote: '体测通常要求良好及以上' },
			{ name: '国家励志奖学金', amount: 5000, peNote: '体测通常要求良好及以上' }
		],
		school: [
			{ name: '校级特等', amount: 10000, peNote: '体测要求及格' },
			{ name: '校级一等', amount: 5000, peNote: '体测要求及格' },
			{ name: '校级二等', amount: 3000, peNote: '体测要求及格' },
			{ name: '校级三等', amount: 1000, peNote: '体测要求及格' }
		],
		redline: [
			'参评学年必修课考核不及格（补考、重修视同不及格）',
			'受到校级、院级纪律处分（含尚未解除）'
		]
	};

	/* ---------- 通用工具 ---------- */
	function fmt1(v) {
		if (!isFinite(v)) return '0';
		var r = Math.round(v * 100) / 100;
		return (Math.round(r * 10) / 10).toFixed(1).replace(/\.0$/, '');
	}
	function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
	function money(v) {
		if (v >= 10000) {
			var w = v / 10000;
			return (Math.round(w * 100) / 100) + ' 万元';
		}
		return v + ' 元';
	}
	/** 某种成果可选的署名位次（含标签），供表单直接使用 */
	function rankNamesFor(kindId) {
		var ids = PAPER.rankOptions[kindId] || PAPER.rankOptions.i;
		return ids.map(function (id) { return { id: id, name: PAPER.rankNames[id] }; });
	}

	root.MeritRules = {
		CAP: CAP,
		TOTAL_MAX: TOTAL_MAX,
		COMPETITION: COMPETITION,
		PAPER: PAPER,
		ART: ART,
		SPORT: SPORT,
		DUTY: DUTY,
		REWARD: REWARD,
		COLLECTIVE: COLLECTIVE,
		VOL_HOURS_STEP: VOL_HOURS_STEP,
		IDEOLOGY: IDEOLOGY,
		SOCIAL: SOCIAL,
		DEDUCT_RULES: DEDUCT_RULES,
		SCHOLARSHIP: SCHOLARSHIP,
		fmt1: fmt1,
		clamp: clamp,
		money: money,
		rankNamesFor: rankNamesFor
	};
})(window);

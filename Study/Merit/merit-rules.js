/* =========================================================================
 * merit-rules.js — 规则单一数据源
 * 依据：学生工作部（处）《西安交通大学本科生综合素质测评成绩评定办法》
 *       （2018 年 5 月印发）及 2018-07-12 校长办公会审议通过的《实施细则》，
 *       配套《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41 号）。
 *
 * 只放静态数据与纯函数，不含任何 DOM 逻辑。
 * 所有可能被书院细化的口径都做成「可覆盖的默认值」，不写死在代码里。
 * ========================================================================= */
(function () {
	'use strict';
	var ZC = (window.ZC = window.ZC || {});

	/* ---------------------------------------------------------------- 书院 */
	ZC.COLLEGES = [
		'彭康书院', '文治书院', '宗濂书院', '启德书院', '仲英书院',
		'励志书院', '崇实书院', '南洋书院', '钱学森书院', '其他 / 未定'
	];

	/* ------------------------------------------------------------ 规则默认值 */
	ZC.DEFAULT_RULES = {
		schema: 1,
		/* 总框架：品行 80 + 能力 20 + 奖励 5 = 105 */
		frame: {
			pinxing: 80,
			ability: 20,
			reward: 5
		},

		/* ===== 一、品行素质分（满分 80） ===== */
		pinxing: {
			base: 70,
			floorAtZero: true,
			caps: { collective: 3, ideology: 3, service: 4 },

			/* 集体活动：校级办法未定单次分值，由书院认定 */
			collective: {
				perTime: 0.6,
				outstandingFull: 3
			},

			/* 思想政治理论学习 */
			ideology: {
				orgTraining: 1,
				provincialTraining: 2,
				excellentTrainee: 1
			},

			/* 社会服务 */
			service: {
				volunteerHours: 32,
				volunteerPoint: 1,
				volunteerProrate: true,
				schoolPractice: 1,
				cityIntern: 1,
				provIntern: 2,
				advanced: 1
			},

			/* 扣分：不设上限 */
			deduction: {
				types: [
					{ id: 'tongbao',  label: '通报批评',            per: 2,  unit: '次' },
					{ id: 'jinggao',  label: '警告',                per: 4,  unit: '次' },
					{ id: 'yanzhong', label: '严重警告',            per: 6,  unit: '次' },
					{ id: 'jiguo',    label: '记过',                per: 8,  unit: '次' },
					{ id: 'liuxiao',  label: '留校察看',            per: 10, unit: '次' },
					{ id: 'kuangke',  label: '旷课（未达处分条件）', per: 1,  unit: '次' },
					{ id: 'weisheng', label: '宿舍卫生不合格',       per: 1,  unit: '人·次' },
					{ id: 'other',    label: '其他（书院认定）',     per: 1,  unit: '次', editable: true }
				]
			}
		},

		/* ===== 二、能力拓展分（满分 20） ===== */
		ability: {
			caps: { academic: 10, culture: 6, position: 4 },

			/* 学术科研及创新创业：竞赛获奖
			   特等奖显式枚举（与一等奖同分），不靠文字「参照」 */
			competition: {
				levels: [
					{ id: 'intl_nat', label: '高水平国际、国家级',
						awards: { '特等奖': 10, '一等奖': 10, '二等奖': 9, '三等奖': 8 } },
					{ id: 'prov', label: '省级',
						awards: { '特等奖': 8, '一等奖': 8, '二等奖': 6, '三等奖': 4 } },
					{ id: 'school', label: '校级 / 地方行政部门 / 行业（企业）/ 学会（协会）',
						awards: { '特等奖': 4, '一等奖': 4, '二等奖': 3, '三等奖': 2, '优秀奖': 1 } }
				],
				prizes: ['特等奖', '一等奖', '二等奖', '三等奖', '优秀奖']
			},

			/* 学术科研及创新创业：论文 / 专著 / 专利
			   专著按原文「第四位起依次递减 1」展开成完整递减表，
			   ranks 用尽后回退 rest（专著下限 1 分，一般期刊为 0 分） */
			publication: {
				mustBeFirstUnit: true,
				/* 归一化（小写、去空格与标点）后做包含匹配：能认 XJTU / Xian Jiaotong Univ. 等写法，
				   不会把「北京交通大学」误判为西安交大 */
				firstUnitPatterns: ['西安交通', 'xjtu', 'xianjiaotong'],
				classes: [
					{ id: 'i',       label: '学校认定的国际期刊论文（i 类）', ranks: [10, 8, 6], rest: 2, bookStyle: false },
					{ id: 'ii',      label: '国内核心期刊、国际会议论文（ii 类）', ranks: [6, 5, 4], rest: 1, bookStyle: false },
					{ id: 'general', label: '国内一般期刊、国内会议论文', ranks: [3, 2, 1], rest: 0, bookStyle: false },
					{ id: 'book',    label: '出版专著', ranks: [10, 8, 6, 5, 4, 3, 2, 1], rest: 1, bookStyle: true, editor: 1,
						note: '第一至第八位 10/8/6/5/4/3/2/1，第九位及以后 1 分；参编 +1' }
				],
				patentMap: { '发明专利': 'i', '实用新型专利': 'ii', '软件著作权': 'ii' },
				excellentPaperBonus: 1
			},

			/* 文体竞赛：文艺 */
			art: {
				levels: [
					{ id: 'intl_nat', label: '国际级 / 国家级', awards: { '一等奖': 6, '二等奖': 5, '三等奖': 4, '优秀奖': 3 } },
					{ id: 'prov',     label: '省级',            awards: { '一等奖': 4, '二等奖': 3.5, '三等奖': 3, '优秀奖': 2 } },
					{ id: 'school',   label: '校级',            awards: { '一等奖': 2, '二等奖': 1.5, '三等奖': 1 } }
				],
				prizes: ['一等奖', '二等奖', '三等奖', '优秀奖']
			},

			/* 文体竞赛：体育 */
			sport: {
				levels: [
					{ id: 'intl_nat', label: '国际级 / 国家级', awards: { '第1名': 6, '第2名': 5, '第3名': 4, '第4—8名': 3 } },
					{ id: 'prov',     label: '省级',            awards: { '第1名': 4, '第2名': 3.5, '第3名': 3, '第4—8名': 2 } },
					{ id: 'school',   label: '校级',            awards: { '第1名': 2, '第2名': 1.5, '第3名': 1, '第4—8名': 0.5 } }
				],
				prizes: ['第1名', '第2名', '第3名', '第4—8名'],
				record: { provincialOrAbove: 5, school: 3 }
			},

			/* 学生组织、社团任职 */
			position: {
				tiers: [
					{ id: 't1', label: '大学生党委副书记 / 党委委员、院党总支副书记、院团工委副书记、院级及以上学生组织正职',
						values: { '优秀': 4, '良好': 3.5, '合格': 3 } },
					{ id: 't2', label: '党总支委员、院级及以上学生组织副职、优秀社团正职',
						values: { '优秀': 3.5, '良好': 3, '合格': 2.5 } },
					{ id: 't3', label: '党支部委员、院级及以上学生组织部长、甲级社团正职、班级团支书、班长',
						values: { '优秀': 2, '良好': 1.5, '合格': 1 } },
					{ id: 't4', label: '团学组织干事、班级和社团一般干部、宿舍长',
						values: { '优秀': 1, '良好': 0.75, '合格': 0.5 } }
				],
				assessments: ['优秀', '良好', '合格', '不合格'],
				takeHighestOnly: true,
				failNoPoint: true,
				/* 任期：官方原文「原则上满一年；不满一年根据工作时间酌情加分，
				   最高不得超过任期满一年的加分」 —— 折减口径做成可切换 */
				partialTerm: { mode: 'prorate', custom: 0.5 }
			}
		},

		/* ===== 三、奖励分（满分 5） ===== */
		reward: {
			cap: 5,
			levels: [
				{ id: 'nation',  label: '全国', v: 5 },
				{ id: 'prov',    label: '省',   v: 4 },
				{ id: 'city',    label: '市',   v: 3 },
				{ id: 'school',  label: '校',   v: 2 },
				{ id: 'college', label: '院',   v: 1 }
			],
			categories: [
				{ id: 'honor', label: '精神文明集体 / 个人荣誉表彰', mode: 'level' },
				{ id: 'brave', label: '见义勇为、舍己救人、拾金不昧等受表彰', mode: 'level' },
				{ id: 'deed',  label: '做好事受表扬 / 为校争光、突出贡献', mode: 'each', each: 1 }
			]
		},

		/* ===== 综合成绩口径（按用途 / 书院不同） ===== */
		composite: {
			preset: 'scholarship',
			normalizeZongce: false,
			presets: [
				{ id: 'scholarship', name: '奖学金口径',
					desc: '综合成绩 = 课程考核成绩 × 80% + 综合素质测评成绩 × 20%',
					parts: [{ key: 'course', label: '课程考核成绩', weight: 0.8 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.2 }],
					source: '《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41 号）配套口径' },
				{ id: 'transfer', name: '转专业 / 大一分流口径',
					desc: '综合成绩 = 智育成绩 × 90% + 综合素质测评成绩 × 10%',
					parts: [{ key: 'course', label: '智育成绩', weight: 0.9 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.1 }],
					source: '公开可查的转专业政策表述；具体以书院与接收学院当年办法为准' },
				{ id: 'baoyan', name: '推免（保研）口径 · 示例',
					desc: '综合成绩 = 学业成绩 × 90% + 综合素质测评成绩 × 10%（占比因学院而异）',
					parts: [{ key: 'course', label: '学业成绩', weight: 0.9 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.1 }],
					source: '电气工程学院指导意见「建议占比 10%」、公共政策与管理学院细则「占 10%」；不存在全校统一数值' },
				{ id: 'chongshi', name: '崇实书院口径（2015 细则）',
					desc: '综合成绩 = 思想品德行为成绩 × 20% + 课程学习成绩 × 70% + 体育成绩 × 10%',
					parts: [{ key: 'deyu', label: '思想品德行为成绩', weight: 0.2 }, { key: 'course', label: '课程学习成绩', weight: 0.7 }, { key: 'pe', label: '体育成绩', weight: 0.1 }],
					source: '《西安交通大学崇实书院学生综合素质测评细则》（cssy.xjtu.edu.cn，2015-09-10）' },
				{ id: 'custom', name: '自定义',
					desc: '自行设置各部分权重',
					parts: [{ key: 'course', label: '课程 / 智育成绩', weight: 0.8 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.2 }] }
			]
		},

		/* ===== 参评资格红线 ===== */
		eligibility: {
			scholarship: [
				{ id: 'fail',   label: '参评学年必修课考核不及格（补考、重修视同不及格）', fatal: true },
				{ id: 'punish', label: '受到校级、院级纪律处分（含尚未解除）', fatal: true },
				{ id: 'pe',     label: '体测未达标（国奖 / 励志通常要求良好及以上，校级要求及格）', fatal: false, warn: true }
			],
			commend: [
				{ id: 'punish',  label: '受校院级纪律处分', fatal: true },
				{ id: 'hygiene', label: '宿舍卫生不达标', fatal: true },
				{ id: 'leave',   label: '保留学籍一年及以上 / 休学', fatal: true },
				{ id: 'delay',   label: '延期毕业', fatal: true }
			]
		},

		/* ===== 奖学金档位（金额供参考） ===== */
		scholarshipTiers: [
			{ id: 'guo',    name: '国家奖学金',     amount: 8000,  pe: '良好及以上' },
			{ id: 'lizhi',  name: '国家励志奖学金', amount: 5000,  pe: '良好及以上' },
			{ id: 'te',     name: '校级特等奖学金', amount: 10000, pe: '及格' },
			{ id: 'yi',     name: '校级一等奖学金', amount: 5000,  pe: '及格' },
			{ id: 'er',     name: '校级二等奖学金', amount: 3000,  pe: '及格' },
			{ id: 'san',    name: '校级三等奖学金', amount: 1000,  pe: '及格' }
		],

		/* 奖学金名额比例（% 以内，用于班级对比的档位估算） */
		classQuota: { te: 1, yi: 5, er: 15, san: 30 },

		/* 评定程序时效（工作日） */
		procedure: { publicityDays: 3, replyDays: 3, appealDays: 3, finalDays: 3 }
	};

	/* ------------------------------------------------- 机会目录（ROI 推荐） */
	/* effort 为经验估计的小时数，只用于排序，可在界面上调整 */
	ZC.OPPORTUNITIES = [
		{ id: 'vol',       cap: 'service',    label: '补齐志愿服务 32 小时',                  effort: 'low',     dyn: true },
		{ id: 'orgtrain',  cap: 'ideology',   label: '参加 1 次党团组织理论学习（含网络学习）', points: 1, effort: 'low' },
		{ id: 'provtrain', cap: 'ideology',   label: '参加省、部级理论学习培训',               points: 2, effort: 'mid' },
		{ id: 'collect',   cap: 'collective', label: '参加学校 / 书院主办的重大活动',          effort: 'low',     dyn: true },
		{ id: 'practice',  cap: 'service',    label: '校级社会实践团队（考核合格）',            points: 1, effort: 'mid' },
		{ id: 'cityint',   cap: 'service',    label: '市、县级挂职锻炼 / 政府见习',             points: 1, effort: 'high' },
		{ id: 'provint',   cap: 'service',    label: '省部级挂职 / 政府见习 / 国际组织见习',    points: 2, effort: 'high' },
		{ id: 'c_sch_3',   cap: 'academic',   label: '校级（行业 / 学会）竞赛 三等奖',           points: 2, effort: 'mid' },
		{ id: 'c_sch_2',   cap: 'academic',   label: '校级（行业 / 学会）竞赛 二等奖',           points: 3, effort: 'mid' },
		{ id: 'c_sch_1',   cap: 'academic',   label: '校级（行业 / 学会）竞赛 一等奖',           points: 4, effort: 'midhigh' },
		{ id: 'c_prov_3',  cap: 'academic',   label: '省级竞赛 三等奖',                        points: 4, effort: 'high' },
		{ id: 'c_prov_2',  cap: 'academic',   label: '省级竞赛 二等奖',                        points: 6, effort: 'high' },
		{ id: 'c_nat_3',   cap: 'academic',   label: '高水平国际 / 国家级竞赛 三等奖',          points: 8, effort: 'vhigh' },
		{ id: 'p_gen',     cap: 'academic',   label: '国内一般期刊 / 国内会议论文（一作）',      points: 3, effort: 'high' },
		{ id: 'p_util',    cap: 'academic',   label: '实用新型专利 / 软件著作权（第一完成人）',  points: 6, effort: 'high' },
		{ id: 'p_core',    cap: 'academic',   label: '国内核心 / 国际会议论文（一作）',          points: 6, effort: 'vhigh' },
		{ id: 'a_sch_3',   cap: 'culture',    label: '校级文艺比赛 三等奖',                    points: 1, effort: 'low' },
		{ id: 's_sch_48',  cap: 'culture',    label: '校级体育竞赛 第 4—8 名',                  points: 0.5, effort: 'low' },
		{ id: 'a_sch_1',   cap: 'culture',    label: '校级文艺比赛 一等奖',                    points: 2, effort: 'mid' },
		{ id: 'a_prov_1',  cap: 'culture',    label: '省级文艺比赛 一等奖',                    points: 4, effort: 'high' },
		{ id: 'pos_dorm',  cap: 'position',   label: '宿舍长（考核合格）',                      points: 0.5, effort: 'low' },
		{ id: 'pos_ganshi',cap: 'position',   label: '团学组织干事（考核良好）',                points: 0.75, effort: 'low' },
		{ id: 'pos_banz',  cap: 'position',   label: '班长 / 团支书（考核优秀）',               points: 2, effort: 'mid' },
		{ id: 'pos_buzh',  cap: 'position',   label: '院级及以上学生组织部长（考核优秀）',       points: 2, effort: 'mid' },
		{ id: 'pos_head',  cap: 'position',   label: '院级及以上学生组织正职（考核优秀）',       points: 4, effort: 'high' },
		{ id: 'r_coll',    cap: 'reward',     label: '院级精神文明 / 个人荣誉表彰',             points: 1, effort: 'low' },
		{ id: 'r_school',  cap: 'reward',     label: '校级精神文明 / 个人荣誉表彰',             points: 2, effort: 'mid' },
		{ id: 'r_deed',    cap: 'reward',     label: '做好事受表扬 / 为校争光（每项 +1）',       points: 1, effort: 'low' }
	];

	ZC.EFFORT_HOURS = { low: 8, mid: 30, midhigh: 60, high: 120, vhigh: 300 };
	ZC.EFFORT_LABEL = { low: '低', mid: '中', midhigh: '中高', high: '高', vhigh: '很高' };

	/* ------------------------------------------------------- 材料状态 */
	ZC.EVIDENCE_STATUS = [
		{ id: 'none',      label: '未准备', tone: 'muted' },
		{ id: 'todo',      label: '待提交', tone: 'warn' },
		{ id: 'submitted', label: '已提交', tone: 'info' },
		{ id: 'approved',  label: '已认定', tone: 'ok' },
		{ id: 'rejected',  label: '被驳回', tone: 'danger' }
	];

	/* ------------------------------------------------- 规则原文速查 */
	ZC.RULE_TEXT = {
		formula: '综合素质测评成绩 = 品行素质分（80 分） + 能力拓展分（20 分） + 奖励分（5 分），满分 105 分。',
		collective: '学校及书（学）院主办或发起的重大活动，以主办单位名单 / 证明为依据。参与一次的具体分值，校级办法未作统一规定，明确「由各书（学）院自行认定」。对集体荣誉作出突出贡献，经书院认定可一次性获得满分（3 分）。',
		term: '任期原则上要求满一年；若不满一年，根据工作时间酌情加分，最高不得超过任期满一年的加分。兼任多项职务按最高分计、不累加；考核不合格不加分。',
		sign: '第一署名单位须为「西安交通大学」或「Xi\'an Jiaotong University」；需录用通知 / 专利证书等佐证材料。',
		dedup: '同一项目获不同奖项不累计、取最高；不同项目可累计。',
		psy: '推免生及部分研究生复试环节的「综合素质测试」实质是心理测评，主要了解个人态度和反应模式，答案无对错之分（登录地址 yzxlcs.xjtu.edu.cn/psytest），与综测加分是两回事。',
		procedure: '学生提交学年总结及支撑材料 → 班级评议小组初评 → 学生核对并签字确认 → 书院工作组审核 → 院内公示不少于 3 个工作日 → 报学生处审核。公示起 3 个工作日内可书面异议，3 个工作日内答复；仍不服，在答复后 3 个工作日内向学生处书面申诉，学生处 3 个工作日内出具最终处理意见。',
		volunteer: '志愿服务每学年 ≥32 小时加 1 分，不足 32 小时按比例计分。'
	};

	/* ------------------------------------------------------ 规则手册正文 */
	ZC.RULEBOOK = [
		{ g: '总则', q: ['总公式', '评定时间', '评定主体', '用途', '依据'], b: [
			['总公式', '综合素质测评成绩 = 品行素质分（80 分） + 能力拓展分（20 分） + 奖励分（5 分），满分 105 分。'],
			['文件依据', '学生工作部（处）《西安交通大学本科生综合素质测评成绩评定办法》（2018 年 5 月印发）；2018 年 7 月 12 日经校长办公会审议通过的《实施细则》与《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41 号）共同发布，自 2018—2019 学年起统一执行。'],
			['评定时间', '每学年第一学期集中开展，由学生处（学生资助管理中心）组织实施。'],
			['评定主体', '书院成立综测工作组（院领导 + 辅导员 + 班主任 + 学生代表）；班级成立评议小组（班主任 + 学生干部 + 学生代表）。'],
			['用途', '关系到奖学金、推免保研、表彰奖励评定等。评奖学金综合成绩 = 课程考核成绩 × 80% + 综测 × 20%；推免中综测占比因学院而异；大一分流以接收学院当年公布的分流办法为准。']
		]},
		{ g: '品行素质分', q: ['基准分', '集体活动', '思想政治', '社会服务', '志愿服务', '扣分', '旷课', '宿舍卫生', '处分'], b: [
			['基准分（70 分）', '经班级评议小组评议合格、书院审定通过即可获得。'],
			['集体活动分（上限 3 分）', '学校及书（学）院主办或发起的重大活动，以主办单位名单 / 证明为依据。<b>参与一次的具体分值，校级办法未作统一规定，明确「由各书（学）院自行认定」</b>。<span class="flag">⚑</span>「参与一次加 0.6 分」为彭康书院层面的细化口径，其他书院可能不同。对集体荣誉作出突出贡献，经书院认定可一次性获得满分（3 分）。'],
			['思想政治理论学习分（上限 3 分）', '参加各级党团组织的理论学习培训（含网络学习）+1；参加省、部级理论学习培训 +2；培训获「优秀学员」称号额外 +1。三项可叠加，总封顶 3 分。'],
			['社会服务分（上限 4 分）', '志愿服务每学年 ≥32 小时 +1，不足 32 小时按比例；校级社会实践考核合格的团队成员 +1；市、县级挂职锻炼及政府见习 +1；省、部级挂职锻炼及政府见习、国际组织见习 +2；获先进个人及表彰额外 +1。各项可累计、封顶 4 分。'],
			['品行素质扣分（不设上限）', '通报批评 −2/次；警告 −4/次；严重警告 −6/次；记过 −8/次；留校察看 −10/次；旷课（未达处分条件）−1/次；宿舍卫生不合格 宿舍每人每次 −1。']
		]},
		{ g: '能力拓展分', q: ['学术科研', '创新创业', '竞赛', '论文', '专利', '专著', '署名', '文艺', '体育', '破纪录', '任职', '社团', '任期', '兼任'], b: [
			['学术科研及创新创业（上限 10 分）', '同一项目获不同奖项不累计、取最高；不同项目可累计。竞赛：高水平国际 / 国家级 特等 10、一等 10、二等 9、三等 8；省级 特等 8、一等 8、二等 6、三等 4；校级、地方行政部门、行业（企业）、学会（协会）特等 4、一等 4、二等 3、三等 2、优秀奖 1。特等奖单列成档，与一等奖同分。'],
			['论文 / 专著 / 专利', '第一署名单位须为「西安交通大学」或「Xi\'an Jiaotong University」，需录用通知 / 专利证书等佐证。<br>· 学校认定的国际期刊论文（i 类）：一作 10、二作 8、三作 6、第四及以后 2<br>· 国内核心期刊、国际会议论文（ii 类）：6 / 5 / 4 / 1<br>· 国内一般期刊、国内会议论文：3 / 2 / 1 / 第四及以后 0<br>· 出版专著：第一至第八位 <b>10 / 8 / 6 / 5 / 4 / 3 / 2 / 1</b>，第九位及以后 1 分（原文「第四位起依次递减 1」，最低不低于 1），参编 +1<br>· 发明专利等同 i 类；实用新型、软件著作权等同 ii 类<br>· 会议入围优秀论文额外 +1'],
			['文体竞赛（上限 6 分）', '同一项目取最高、不同项目可累计。文艺：国际级 / 国家级 一等 6、二等 5、三等 4、优秀奖 3；省级 4 / 3.5 / 3 / 2；校级 2 / 1.5 / 1 / —。体育：国际级 / 国家级 第 1 名 6、第 2 名 5、第 3 名 4、第 4—8 名 3；省级 4 / 3.5 / 3 / 2；校级 2 / 1.5 / 1 / 0.5。破省级及以上纪录 +5，破校级纪录 +3。'],
			['学生组织、社团任职（上限 4 分）', '四档职务 × 优 / 良 / 合格三级考核。<b><span class="flag">⚑</span> 任期规则：</b>官方原文为「任期原则上要求满一年；若不满一年，根据工作时间酌情加分，最高不得超过任期满一年的加分」—— 不满一年不是一分没有，而是可获酌情分，上限不超过对应档位。兼任多项职务按最高分计、不累加；考核不合格不加分。']
		]},
		{ g: '奖励分', q: ['奖励', '荣誉', '见义勇为', '拾金不昧', '做好事'], b: [
			['奖励分（5 分，累加超 5 按 5 计）', '精神文明集体 / 个人荣誉表彰：全国 5、省 4、市 3、校 2、院 1；见义勇为、舍己救人、拾金不昧等受表彰同标准；做好事受表扬、为校争光、突出贡献每项 +1，可累加，封顶 5 分。']
		]},
		{ g: '用途与关联', q: ['奖学金', '国家奖学金', '励志', '推免', '保研', '分流', '转专业', '体测', '不及格', '资格'], b: [
			['评奖学金', '综合成绩 = 课程考核成绩 × 80% + 综合素质测评成绩 × 20%。<b>参评资格红线：</b>参评学年必修课考核不及格（补考、重修视同不及格），或受到校级、院级纪律处分（含尚未解除），取消当年度奖学金参评资格。体测：国家奖学金、国家励志奖学金通常要求良好及以上，校级奖学金要求及格。金额（供参考）：国家奖学金 8000 元 / 年、国家励志 5000 元 / 年、校级特等 10000 / 一等 5000 / 二等 3000 / 三等 1000 元 / 年。'],
			['推免保研', '综测事关推免评定，但<b>推免综合成绩中综测的具体占比因学院而异</b>。例如电气工程学院指导意见为「素质测评成绩建议占比 10%」，公共政策与管理学院细则为「综合素质测评占 10%」。不存在全校统一的推免综测占比数值，务必以所在学院当年推免办法为准。'],
			['大一分流 / 转专业', '公开可查的转专业政策表述为「综合素质测评成绩占综合成绩的 10%，智育成绩占 90%」。这是转专业 / 分流环节的口径，不是全校所有书院统一的固定比例，具体以所在书院和接收学院当年公布的分流办法为准。'],
			['表彰奖励参评', '受校院级纪律处分、宿舍卫生不达标、保留学籍一年及以上、休学或延期毕业者，通常取消当年度表彰奖励参评资格。具体以当年《本科生表彰奖励办法》及书院通知为准。'],
			['另一套口径的存在', '部分书院历史上执行《本科生表彰奖励办法》的三部分口径，例如崇实书院 2015 年细则：综合成绩 = 思想品德行为成绩 × 20% + 课程学习成绩 × 70% + 体育成绩 × 10%。本工具已在「综合成绩」页内置多套口径可切换。']
		]},
		{ g: '程序与申诉', q: ['程序', '公示', '异议', '申诉', '签字', '工作日'], b: [
			['评定程序', '学生提交学年总结及支撑材料 → 班级评议小组由班主任主持初评 → 学生核对并签字确认 → 报书院工作组 → 书院工作组审核 → 院内公示不少于 3 个工作日 → 报学生处审核，同时报相关学院。'],
			['异议处理', '公示起 3 个工作日内向书院工作组书面异议 → 3 个工作日内答复；仍不服，在答复后 3 个工作日内向学生处书面申诉（附书院答复）→ 学生处 3 个工作日内调查审核并出具最终处理意见。']
		]},
		{ g: '易混淆与避坑', q: ['心理测评', '综合素质测试', '0.6', '彭康', '书院', '32小时', '署名单位', '不满一年', '差异'], b: [
			['① 推免 / 复试「综合素质测试」≠ 综测加分', '推免生及部分研究生复试环节需要完成的「综合素质测试」，<b>实质是心理测评</b>，主要了解个人态度和反应模式，答案无对错之分（登录地址 yzxlcs.xjtu.edu.cn/psytest）。综测加分依据的是学年学业与表现材料，不通过该系统完成。'],
			['② 志愿服务工时口径', '现行标准为每学年 ≥32 小时加 1 分（不足按比例），依据为 2018 年评定办法原文。不要与早期版本或其他口径混用。'],
			['③ 集体活动「0.6 分 / 次」的书院属性', '校级办法未规定单次分值，由书院自行认定。0.6 分 / 次是彭康书院层面的细化口径，不可当作全校通用标准。'],
			['④ 任职「不满一年」的弹性空间', '官方明确「不满一年，根据工作时间酌情加分」。不同书院在「酌情」的具体幅度上可能有自己的细化规则（例如有的书院细则规定不满一年最高加对应档位的 1/2），但校级层面保留了酌情空间，不是绝对零分。'],
			['⑤ 论文 / 专利署名单位', '第一署名单位必须为「西安交通大学」或「Xi\'an Jiaotong University」，否则不予认定。参与外单位科研项目时务必提前确认署名安排。'],
			['⑥ 院级细则差异', '各书院（彭康、南洋、崇实、仲英、文治、宗濂、启德、励志、钱学森等）在集体活动认定、任职考核、社会服务细化方式上可能存在差异。校级办法是底线标准，所在书院当年公示的细则才是最终执行依据。']
		]},
		{ g: '朋辈引航', q: ['大一', '规划', '避坑', '建议', '过程分', '归档'], b: [
			['核心认知：综测是「过程分」', '从大一开学就建立个人成果清单，竞赛证书、志愿时长、活动证明、任职文件随手归档。志愿服务每学年 32 小时是按学年累计的，早做早从容，不要拖到学年末。'],
			['避坑：不设上限的扣分最伤', '旷课（−1/次）、宿舍卫生不合格（每人每次 −1）、违纪处分（−4 至 −10/次）不设上限，直接从 70 分基准分里扣。很多排名落差来自这些「小事」。'],
			['任职：专注一个，尽量做满一年', '兼任多项只取最高、不累加。做满一年并争取「优秀」考核是收益最大化的路径；如果中途退出，按官方规则仍有酌情分，但上限受限、性价比下降，所以选择组织时就要考虑能否坚持一年。'],
			['竞赛与科研：注意「同一项目」和「署名单位」', '同一项目多个奖项只取最高，一学期聚焦 1 个核心方向比广撒网更划算。论文 / 专利的第一署名单位必须是西安交大，参与外部项目前先确认署名安排。'],
			['申诉时效：三个「3 个工作日」不要错过', '公示起 3 个工作日内提异议 → 3 个工作日内答复 → 不服再 3 个工作日内向学生处申诉 → 学生处 3 个工作日内最终处理。错过窗口即丧失程序权利。']
		]}
	];

	/* ------------------------------------------------------ 工具函数 */
	ZC.clone = function (o) {
		if (o === undefined || o === null) return o;
		if (typeof o !== 'object') return o;
		return JSON.parse(JSON.stringify(o));
	};

	/** 深合并：override 覆盖 base 中已存在的键（undefined 跳过，不污染默认值） */
	ZC.mergeRules = function (base, override) {
		if (!override) return ZC.clone(base);
		var out = ZC.clone(base);
		(function walk(t, s) {
			Object.keys(s || {}).forEach(function (k) {
				var sv = s[k];
				if (sv === undefined) return;
				var tv = t[k];
				if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) walk(tv, sv);
				else t[k] = ZC.clone(sv);
			});
		})(out, override);
		return out;
	};

	ZC.currentAcademicYear = function () {
		var d = new Date(), y = d.getFullYear(), m = d.getMonth() + 1;
		var start = m >= 9 ? y : y - 1;
		return start + '—' + String(start + 1).slice(2);
	};

	ZC.uid = function () {
		return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
	};

	/** 生成一份空档案 */
	ZC.blankProfile = function (name, college, year) {
		return {
			id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
			createdAt: Date.now(),
			updatedAt: Date.now(),
			meta: {
				name: name || '',
				studentId: '',
				college: college || '彭康书院',
				major: '',
				grade: '',
				academicYear: year || ZC.currentAcademicYear(),
				assessPass: true,
				publicityDate: '',
				signedOff: false,
				pe: '',
				note: ''
			},
			ruleOverride: {},
			pinxing: {
				collective: { mode: 'count', entries: [] },
				ideology: { orgTraining: 0, provincialTraining: 0, excellentTrainee: 0 },
				service: { volunteerHours: 0, volunteerStatus: 'todo', volunteerNote: '', schoolPractice: 0, cityIntern: 0, provIntern: 0, advanced: 0 },
				deductions: []
			},
			ability: { academic: [], culture: [], position: [] },
			reward: { items: [] },
			coursework: { score: '', deyu: '', pe: '' },
			target: { score: '' },
			eligibility: {
				scholarship: { fail: false, punish: false, pe: true },
				commend: { punish: false, hygiene: false, leave: false, delay: false }
			},
			classmates: [],
			notes: ''
		};
	};

	/* 全局注册表：避免脚本加载顺序问题 */
	ZC.actions = ZC.actions || {};
	ZC.views = ZC.views || {};
})(window);

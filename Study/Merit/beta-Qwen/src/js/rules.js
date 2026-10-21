/* =========================================================================
 * rules.js —— 规则单一数据源（Single Source of Truth）
 * 依据：《西安交通大学本科生综合素质测评成绩评定办法》(2018年5月印发)
 *       及其《实施细则》(2018年7月12日校长办公会审议通过)
 * 所有可被书院细化的口径，一律做成"可配置项"，不写死。
 * ========================================================================= */
(function () {
  const ZC = (window.ZC = window.ZC || {});

  /* ---------------------------------------------------------------- 书院 */
  ZC.COLLEGES = [
    '彭康书院', '文治书院', '宗濂书院', '启德书院', '仲英书院',
    '励志书院', '崇实书院', '南洋书院', '钱学森书院', '其他/未定'
  ];

  /* --------------------------------------------- 校级默认规则（可覆盖） */
  ZC.DEFAULT_RULES = {
    schema: 3,

    /* ---- 总框架 ---- */
    frame: {
      pinxing: 80,      // 品行素质分满分
      ability: 20,      // 能力拓展分满分
      reward: 5,        // 奖励分满分
      get total() { return 105; }
    },

    /* ---- 一、品行素质分 ---- */
    pinxing: {
      base: 70,                       // 基准分：班级评议合格 + 书院审定通过
      floorAtZero: true,              // 扣到 0 为止（不允许负分）
      caps: { collective: 3, ideology: 3, service: 4 },

      collective: {
        perTime: 0.6,                 // ⚑ 校级办法未统一规定，由各书（学）院自行认定
        perTimeSource: '校级办法未作统一规定，明确"由各书（学）院自行认定"。0.6 分/次为彭康书院层面的细化口径，其他书院可能不同。',
        outstandingFull: 3            // 对集体荣誉作出突出贡献，经书院认定可一次性满分
      },

      ideology: {                     // 思想政治理论学习分
        orgTraining: 1,               // 各级党团组织理论学习培训（含网络学习）
        provincialTraining: 2,        // 省、部级理论学习培训
        excellentTrainee: 1           // 培训获"优秀学员"称号（额外）
      },

      service: {                      // 社会服务分
        volunteerHours: 32,           // 每学年 ≥32 小时
        volunteerPoint: 1,
        volunteerProrate: true,       // 不足 32 小时按比例
        schoolPractice: 1,            // 校级社会实践，考核合格的团队成员
        cityIntern: 1,                // 市、县级挂职锻炼及政府见习
        provIntern: 2,                // 省、部级挂职锻炼及政府见习、国际组织见习
        advanced: 1                   // 获先进个人及表彰（额外）
      },

      /* 扣分：不设上限，直接从品行素质分中扣除 */
      deduction: {
        types: [
          { id: 'tongbao',   label: '通报批评',        per: 2,  unit: '次' },
          { id: 'jinggao',   label: '警告',            per: 4,  unit: '次' },
          { id: 'yanzhong',  label: '严重警告',        per: 6,  unit: '次' },
          { id: 'jiguo',     label: '记过',            per: 8,  unit: '次' },
          { id: 'liuxiao',   label: '留校察看',        per: 10, unit: '次' },
          { id: 'kuangke',   label: '旷课（未达处分条件）', per: 1, unit: '次' },
          { id: 'weisheng',  label: '宿舍卫生不合格',   per: 1,  unit: '人/次' },
          { id: 'other',     label: '其他（书院认定）', per: 1,  unit: '次', editable: true }
        ]
      }
    },

    /* ---- 二、能力拓展分 ---- */
    ability: {
      caps: { academic: 10, culture: 6, position: 4 },

      /* 1. 学术科研及创新创业：竞赛 */
      competition: {
        levels: [
          { id: 'intl_nat', label: '高水平国际、国家级', awards: { '特等奖': 10, '一等奖': 10, '二等奖': 9, '三等奖': 8 } },
          { id: 'prov',     label: '省级',               awards: { '特等奖': 8,  '一等奖': 8,  '二等奖': 6, '三等奖': 4 } },
          { id: 'school',   label: '校级 / 地方行政部门 / 行业（企业）/ 学会（协会）',
                                 awards: { '特等奖': 4,  '一等奖': 4,  '二等奖': 3, '三等奖': 2, '优秀奖': 1 } }
        ],
        note: '特等奖参照一等奖计分；高水平国际、国家级与省级无"优秀奖"档。'
      },

      /* 1. 学术科研及创新创业：论文 / 专著 / 专利 */
      publication: {
        mustBeFirstUnit: true,
        firstUnitAlias: ['西安交通大学', "Xi'an Jiaotong University"],
        /* 归一化（转小写、去掉空格与标点）后做包含匹配；
           可覆盖"西安交通大学 / Xi'an Jiaotong University / Xian Jiaotong Univ. / XJTU"等写法，
           同时排除"北京交通大学"等其他单位。 */
        firstUnitPatterns: ['西安交通', 'xjtu', 'xianjiaotong'],
        classes: [
          { id: 'i',       label: '学校认定的国际期刊论文（i 类）',              ranks: [10, 8, 6], rest: 2, bookStyle: false },
          { id: 'ii',      label: '国内核心期刊、国际会议论文（ii 类）',          ranks: [6, 5, 4],  rest: 1, bookStyle: false },
          { id: 'general', label: '国内一般期刊、国内会议论文',                   ranks: [3, 2, 1],  rest: 0, bookStyle: false },
          { id: 'book',    label: '出版专著',                                     ranks: [10, 8, 6, 5, 4, 3, 2, 1], rest: 1, bookStyle: true, editor: 1,
            note: '第一至第八位 10 / 8 / 6 / 5 / 4 / 3 / 2 / 1，第九位及以后 1 分；参编 +1' }
        ],
        patentMap: { '发明专利': 'i', '实用新型专利': 'ii', '软件著作权': 'ii' },
        excellentPaperBonus: 1,        // 会议入围优秀论文 额外 +1
        bookNote: '专著第 4 位及以后依次递减 1 分；参编 +1 分。'
      },

      /* 2. 文体竞赛：文艺 */
      art: {
        levels: [
          { id: 'intl_nat', label: '国际级 / 国家级', awards: { '一等奖': 6, '二等奖': 5, '三等奖': 4, '优秀奖': 3 } },
          { id: 'prov',     label: '省级',            awards: { '一等奖': 4, '二等奖': 3.5, '三等奖': 3, '优秀奖': 2 } },
          { id: 'school',   label: '校级',            awards: { '一等奖': 2, '二等奖': 1.5, '三等奖': 1 } }
        ]
      },

      /* 2. 文体竞赛：体育 */
      sport: {
        levels: [
          { id: 'intl_nat', label: '国际级 / 国家级', awards: { '第1名': 6, '第2名': 5, '第3名': 4, '第4—8名': 3 } },
          { id: 'prov',     label: '省级',            awards: { '第1名': 4, '第2名': 3.5, '第3名': 3, '第4—8名': 2 } },
          { id: 'school',   label: '校级',            awards: { '第1名': 2, '第2名': 1.5, '第3名': 1, '第4—8名': 0.5 } }
        ],
        record: { provincialOrAbove: 5, school: 3 }
      },

      /* 3. 学生组织、社团任职 */
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
        takeHighestOnly: true,         // 兼任多项按最高分计、不累加
        failNoPoint: true,             // 考核不合格不加分
        /* 任期规则：官方原文——任期原则上要求满一年；若不满一年，
           根据工作时间酌情加分，最高不得超过任期满一年的加分。 */
        partialTerm: {
          mode: 'prorate',             // prorate 按实际月数比例 | half 书院口径最高1/2 | custom 自定义系数 | none 不加分
          custom: 0.5,
          note: '校级原文保留"酌情"空间；部分书院细则规定不满一年最高加对应档位的 1/2。请按你所在书院当年公示口径设置。'
        }
      }
    },

    /* ---- 三、奖励分 ---- */
    reward: {
      cap: 5,
      levels: [
        { id: 'nation', label: '全国', v: 5 },
        { id: 'prov',   label: '省',   v: 4 },
        { id: 'city',   label: '市',   v: 3 },
        { id: 'school', label: '校',   v: 2 },
        { id: 'college',label: '院',   v: 1 }
      ],
      categories: [
        { id: 'honor',  label: '精神文明集体 / 个人荣誉表彰',      mode: 'level' },
        { id: 'brave',  label: '见义勇为、舍己救人、拾金不昧等受表彰', mode: 'level' },
        { id: 'deed',   label: '做好事受表扬 / 为校争光、突出贡献',  mode: 'each', each: 1 }
      ]
    },

    /* ---- 综合成绩口径（按用途/书院不同，可切换） ---- */
    composite: {
      preset: 'scholarship',
      normalizeZongce: false,   // 是否把综测（满分105）折算成百分制再参与加权
      presets: [
        { id: 'scholarship', name: '奖学金口径',
          desc: '评奖学金综合成绩 = 课程考核成绩 × 80% + 综合素质测评成绩 × 20%',
          parts: [{ key: 'course', label: '课程考核成绩', weight: 0.8 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.2 }],
          source: '《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41号）配套口径' },
        { id: 'transfer', name: '转专业 / 大一分流口径',
          desc: '综合成绩 = 智育成绩 × 90% + 综合素质测评成绩 × 10%',
          parts: [{ key: 'course', label: '智育成绩', weight: 0.9 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.1 }],
          source: '公开可查的转专业政策表述；具体以书院与接收学院当年办法为准' },
        { id: 'baoyan', name: '推免（保研）口径 · 示例',
          desc: '综合成绩 = 学业成绩 × 90% + 综合素质测评成绩 × 10%（占比因学院而异）',
          parts: [{ key: 'course', label: '学业成绩', weight: 0.9 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.1 }],
          source: '电气工程学院指导意见"建议占比10%"、公共政策与管理学院细则"占10%"；不存在全校统一数值' },
        { id: 'chongshi', name: '崇实书院口径（2015 细则）',
          desc: '综合成绩 = 思想品德行为成绩 × 20% + 课程学习成绩 × 70% + 体育成绩 × 10%',
          parts: [{ key: 'deyu', label: '思想品德行为成绩', weight: 0.2 }, { key: 'course', label: '课程学习成绩', weight: 0.7 }, { key: 'pe', label: '体育成绩', weight: 0.1 }],
          source: '《西安交通大学崇实书院学生综合素质测评细则》（cssy.xjtu.edu.cn，2015-09-10）' },
        { id: 'custom', name: '自定义', desc: '自行设置各部分权重', parts: [{ key: 'course', label: '课程/智育成绩', weight: 0.8 }, { key: 'zongce', label: '综合素质测评成绩', weight: 0.2 }] }
      ]
    },

    /* ---- 参评资格红线 ---- */
    eligibility: {
      scholarship: [
        { id: 'fail',   label: '参评学年必修课考核不及格（补考、重修视同不及格）', fatal: true },
        { id: 'punish', label: '受到校级、院级纪律处分（含尚未解除）',              fatal: true },
        { id: 'pe',     label: '体测未达标（国奖/励志通常要求良好及以上，校级要求及格）', fatal: false, warn: true }
      ],
      commend: [
        { id: 'punish',  label: '受校院级纪律处分',                    fatal: true },
        { id: 'hygiene', label: '宿舍卫生不达标',                      fatal: true },
        { id: 'leave',   label: '保留学籍一年及以上 / 休学',            fatal: true },
        { id: 'delay',   label: '延期毕业',                            fatal: true }
      ]
    },

    /* ---- 奖学金档位（金额供参考） ---- */
    scholarshipTiers: [
      { id: 'guo',    name: '国家奖学金',       amount: 8000,  pe: '良好及以上' },
      { id: 'lizhi',  name: '国家励志奖学金',   amount: 5000,  pe: '良好及以上' },
      { id: 'te',     name: '校级特等奖学金',   amount: 10000, pe: '及格' },
      { id: 'yi',     name: '校级一等奖学金',   amount: 5000,  pe: '及格' },
      { id: 'er',     name: '校级二等奖学金',   amount: 3000,  pe: '及格' },
      { id: 'san',    name: '校级三等奖学金',   amount: 1000,  pe: '及格' }
    ],

    /* ---- 程序时效（工作日） ---- */
    procedure: { publicityDays: 3, replyDays: 3, appealDays: 3, finalDays: 3, minPublicityWorkdays: 3 }
  };

  /* ------------------------------- 机会目录：用于"下一步做什么"ROI 推荐 */
  /* effort 小时数为经验估计，仅用于排序，可在设置中调整 */
  ZC.OPPORTUNITIES = [
    { id: 'vol',      cap: 'service',    label: '补齐志愿服务 32 小时',                 effort: 'low',  dyn: true },
    { id: 'orgtrain', cap: 'ideology',   label: '参加 1 次党团组织理论学习（含网络学习）', points: 1, effort: 'low' },
    { id: 'provtrain',cap: 'ideology',   label: '参加省、部级理论学习培训',              points: 2, effort: 'mid' },
    { id: 'collect',  cap: 'collective', label: '参加学校/书院主办的重大活动',           dyn: true, effort: 'low' },
    { id: 'practice', cap: 'service',    label: '校级社会实践团队（考核合格）',           points: 1, effort: 'mid' },
    { id: 'cityint',  cap: 'service',    label: '市、县级挂职锻炼 / 政府见习',            points: 1, effort: 'high' },
    { id: 'provint',  cap: 'service',    label: '省部级挂职 / 政府见习 / 国际组织见习',   points: 2, effort: 'high' },
    { id: 'c_sch_3',  cap: 'academic',   label: '校级（行业/学会）竞赛 三等奖',           points: 2, effort: 'mid' },
    { id: 'c_sch_2',  cap: 'academic',   label: '校级（行业/学会）竞赛 二等奖',           points: 3, effort: 'mid' },
    { id: 'c_sch_1',  cap: 'academic',   label: '校级（行业/学会）竞赛 一等奖',           points: 4, effort: 'midhigh' },
    { id: 'c_prov_3', cap: 'academic',   label: '省级竞赛 三等奖',                       points: 4, effort: 'high' },
    { id: 'c_prov_2', cap: 'academic',   label: '省级竞赛 二等奖',                       points: 6, effort: 'high' },
    { id: 'c_nat_3',  cap: 'academic',   label: '高水平国际/国家级竞赛 三等奖',           points: 8, effort: 'vhigh' },
    { id: 'p_gen',    cap: 'academic',   label: '国内一般期刊 / 国内会议论文（一作）',     points: 3, effort: 'high' },
    { id: 'p_util',   cap: 'academic',   label: '实用新型专利 / 软件著作权（第一完成人）', points: 6, effort: 'high' },
    { id: 'p_core',   cap: 'academic',   label: '国内核心 / 国际会议论文（一作）',        points: 6, effort: 'vhigh' },
    { id: 'a_sch_3',  cap: 'culture',    label: '校级文艺比赛 三等奖',                   points: 1, effort: 'low' },
    { id: 's_sch_48', cap: 'culture',    label: '校级体育竞赛 第4—8名',                  points: 0.5, effort: 'low' },
    { id: 'a_sch_1',  cap: 'culture',    label: '校级文艺比赛 一等奖',                   points: 2, effort: 'mid' },
    { id: 'a_prov_1', cap: 'culture',    label: '省级文艺比赛 一等奖',                   points: 4, effort: 'high' },
    { id: 'pos_dorm', cap: 'position',   label: '宿舍长（考核合格）',                    points: 0.5, effort: 'low' },
    { id: 'pos_ganshi',cap:'position',   label: '团学组织干事（考核良好）',               points: 0.75, effort: 'low' },
    { id: 'pos_banz', cap: 'position',   label: '班长 / 团支书（考核优秀）',              points: 2, effort: 'mid' },
    { id: 'pos_buzh', cap: 'position',   label: '院级及以上学生组织部长（考核优秀）',      points: 2, effort: 'mid' },
    { id: 'pos_head', cap: 'position',   label: '院级及以上学生组织正职（考核优秀）',      points: 4, effort: 'high' },
    { id: 'r_coll',   cap: 'reward',     label: '院级精神文明 / 个人荣誉表彰',            points: 1, effort: 'low' },
    { id: 'r_school', cap: 'reward',     label: '校级精神文明 / 个人荣誉表彰',            points: 2, effort: 'mid' },
    { id: 'r_deed',   cap: 'reward',     label: '做好事受表扬 / 为校争光（每项 +1）',     points: 1, effort: 'low' }
  ];

  ZC.EFFORT_HOURS = { low: 8, mid: 30, midhigh: 60, high: 120, vhigh: 300 };
  ZC.EFFORT_LABEL = { low: '低', mid: '中', midhigh: '中高', high: '高', vhigh: '很高' };

  /* ------------------------------------------------------- 材料状态 */
  ZC.EVIDENCE_STATUS = [
    { id: 'none',     label: '未准备',   tone: 'muted' },
    { id: 'todo',     label: '待提交',   tone: 'warn' },
    { id: 'submitted',label: '已提交',   tone: 'info' },
    { id: 'approved', label: '已认定',   tone: 'ok' },
    { id: 'rejected', label: '被驳回',   tone: 'danger' }
  ];

  /* ------------------------------------------------- 规则原文速查卡片 */
  ZC.RULE_TEXT = {
    formula: '综合素质测评成绩 = 品行素质分（80分） + 能力拓展分（20分） + 奖励分（5分）',
    collective: '学校及书（学）院主办或发起的重大活动，以主办单位名单/证明为依据。参与一次的具体分值，校级办法未作统一规定，明确"由各书（学）院自行认定"。对集体荣誉作出突出贡献，经书院认定可一次性获得满分（3分）。',
    term: '任期原则上要求满一年；若不满一年，根据工作时间酌情加分，最高不得超过任期满一年的加分。兼任多项职务按最高分计、不累加；考核不合格不加分。',
    sign: '第一署名单位须为"西安交通大学"或"Xi\'an Jiaotong University"；需录用通知 / 专利证书等佐证材料。',
    dedup: '同一项目获不同奖项不累计、取最高；不同项目可累计。',
    psy: '推免生及部分研究生复试环节的"综合素质测试"实质是心理测评，主要了解个人态度和反应模式，答案无对错之分（登录地址 yzxlcs.xjtu.edu.cn/psytest），与综测加分是两回事。',
    procedure: '学生提交学年总结及支撑材料 → 班级评议小组初评 → 学生核对并签字确认 → 书院工作组审核 → 院内公示不少于3个工作日 → 报学生处审核。公示起3个工作日内可书面异议，3个工作日内答复；仍不服，在答复后3个工作日内向学生处书面申诉，学生处3个工作日内出具最终处理意见。',
    volunteer: '志愿服务每学年≥32小时加1分，不足32小时按比例计分。'
  };

  /* -------------------------------------- 全局注册表（避免脚本加载顺序问题） */
  ZC.actions = ZC.actions || {};
  ZC.views = ZC.views || {};

  /* ------------------------------------------------------ 工具函数 */
  ZC.clone = function (o) {
    if (o === undefined || o === null) return o;
    if (typeof o !== 'object') return o;
    return JSON.parse(JSON.stringify(o));
  };

  /** 深合并：用 override 覆盖 base（仅覆盖已存在的叶子/新键） */
  ZC.mergeRules = function (base, override) {
    if (!override) return ZC.clone(base);
    const out = ZC.clone(base);
    (function walk(t, s) {
      Object.keys(s || {}).forEach(k => {
        const sv = s[k];
        if (sv === undefined) return;                     // 跳过空值，避免污染默认规则
        const tv = t[k];
        if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) walk(tv, sv);
        else t[k] = ZC.clone(sv);
      });
    })(out, override);
    return out;
  };

  /** 生成一份空档案 */
  ZC.blankProfile = function (name, college, year) {
    return {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      meta: {
        name: name || '未命名档案',
        studentId: '',
        college: college || '彭康书院',
        major: '',
        grade: '',
        academicYear: year || ZC.currentAcademicYear(),
        assessPass: true,           // 班级评议合格 + 书院审定通过
        publicityDate: '',          // 院内公示起始日
        signedOff: false            // 学生核对并签字确认
      },
      ruleOverride: {},
      pinxing: {
        collective: { outstanding: false, outstandingNote: '', entries: [] },
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

  ZC.currentAcademicYear = function () {
    const d = new Date(); const y = d.getFullYear(); const m = d.getMonth() + 1;
    const start = m >= 9 ? y : y - 1;
    return start + '—' + String(start + 1).slice(2);
  };

  ZC.uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
})();

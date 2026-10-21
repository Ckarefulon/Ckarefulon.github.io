/* =========================================================================
 * views-tools.js —— 材料清单 / 情景模拟 / 班级对比 / 程序时效 / 规则手册 / 设置
 * ========================================================================= */
(function () {
  const ZC = window.ZC;
  const ui = ZC.ui, esc = ZC.esc, fmt = ZC.fmt;
  const V = ZC.views;
  const fld = (label, control, hint) => `<div class="fld"><label class="fld__l">${label}</label><div class="fld__c">${control}${hint ? `<div class="fld__h">${hint}</div>` : ''}</div></div>`;

  /* ==================================================================
   * 材料清单
   * ================================================================== */
  V.materials = {
    render(ctx) {
      const { p, res } = ctx;
      const rows = [];
      const add = (cat, name, pts, status, evidence, date, note) => rows.push({ cat, name, pts, status, evidence, date, note });
      res.pinxing.subs.collective.items.forEach(i => add('集体活动', i.label, i.points, i.status, i.evidence, i.date, i.note));
      if (p.pinxing.service.volunteerHours > 0) add('社会服务', `志愿服务 ${fmt(p.pinxing.service.volunteerHours)} 小时`, '', p.pinxing.service.volunteerStatus || 'todo', p.pinxing.service.volunteerNote || '', '', '需志愿服务系统时长记录截图 / 主办方盖章证明');
      res.ability.subs.academic.items.forEach(i => add('学术科研', i.project || i.name || '未命名', i._counted ? i._pts : 0, i.status, i.evidence, i.date, i._reason));
      res.ability.subs.culture.items.forEach(i => add('文体竞赛', i.name || i.project || '未命名', i._counted ? i._pts : 0, i.status, i.evidence, i.date, i._reason));
      res.ability.subs.position.items.forEach(i => add('组织任职', `${i.org || ''} ${i.role || ''}`, i._counted ? i._pts : 0, i.status, i.evidence, i.date, i._reason));
      res.reward.items.forEach(i => add('奖励分', i.name || i._reason, i._pts, i.status, i.evidence, i.date, i._reason));
      res.pinxing.deductions.forEach(i => add('扣分', i.label, -i.points, i.status, '', i.date, i.note));

      const by = (s) => rows.filter(r => r.status === s).length;
      const st = ZC.EVIDENCE_STATUS;
      const filter = ZC.state.ui.matFilter || 'all';
      const shown = filter === 'all' ? rows : rows.filter(r => (r.status || 'none') === filter);

      const GUIDE = [
        ['竞赛获奖', '获奖证书原件扫描件 / 照片；官网公示名单截图；证书编号。团队项目需附成员名单页，证明你在名单内。'],
        ['论文', '录用通知（Acceptance Letter）或期刊封面+目录+正文页；检索证明（如 SCI/EI 检索号）。<b>第一署名单位必须为"西安交通大学"或"Xi\'an Jiaotong University"</b>。'],
        ['专利 / 软著', '专利证书或授权公告；软件著作权登记证书。注意完成人排序。'],
        ['志愿服务', '志愿服务信息系统时长记录截图（含姓名、总时长、学年区间）；主办方盖章的服务证明。'],
        ['社会实践', '立项文件 + 结项/考核合格证明 + 团队成员名单。'],
        ['挂职 / 见习', '接收单位证明（含起止时间、岗位）、政府见习鉴定表。'],
        ['任职', '任职文件 / 聘书 / 选举结果公示；年度考核结果（优/良/合格）；任期起止时间证明。'],
        ['集体活动', '主办单位（学校或书/学院）发布的名单、通知、签到表或活动证明。'],
        ['荣誉表彰', '表彰决定文件（含文号）、证书。'],
        ['扣分事项', '一般由书院/班级直接认定，无需学生举证；如有异议请在公示期内提出。']
      ];

      return `<div class="page">
        <div class="page__hd"><h1>佐证材料清单</h1><p>综测评定的实质是"材料评定"——没有佐证的加分在班级评议阶段极易被剔除</p>
          <div class="page__score"><b>${rows.filter(r => r.status === 'approved').length}<span>/${rows.length}</span></b><span>已认定</span></div></div>

        <div class="stat-row">
          ${st.map(s => `<button class="stat ${filter === s.id ? 'on' : ''}" data-act="mat-filter" data-arg="${s.id}">
            <b class="tone-${s.tone}">${by(s.id)}</b><span>${s.label}</span></button>`).join('')}
          <button class="stat ${filter === 'all' ? 'on' : ''}" data-act="mat-filter" data-arg="all"><b>${rows.length}</b><span>全部</span></button>
        </div>

        ${ui.card('清单', rows.length ? `<div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>类别</th><th>项目</th><th class="tr">分值</th><th>材料状态</th><th>已归档材料</th><th>日期</th></tr></thead>
          <tbody>${shown.map(r => `<tr class="${r.status === 'rejected' ? 'row--bad' : r.status === 'approved' ? 'row--ok' : ''}">
            <td>${ui.badge(r.cat, 'muted')}</td>
            <td class="tl"><b>${esc(r.name || '未命名')}</b>${r.note ? `<em class="sub">${esc(r.note)}</em>` : ''}</td>
            <td class="tr">${r.pts === '' ? '—' : (r.pts < 0 ? '<span class="neg">' + fmt(r.pts) + '</span>' : '+' + fmt(r.pts))}</td>
            <td>${ui.statusBadge(r.status)}</td>
            <td class="tl">${esc(r.evidence || '—')}</td>
            <td>${esc(r.date || '—')}</td></tr>`).join('') || `<tr><td colspan="6" class="empty-sm">该状态下暂无条目</td></tr>`}
          </tbody></table></div>` : ui.empty('folder', '还没有任何条目', '先去录入加分项，这里会自动汇总成材料清单。'),
          { icon: 'folder', actions: `<div class="btns">${ui.btn('复制清单', 'copy-materials', { cls: 'btn--sm', icon: 'copy' })}${ui.btn('导出 CSV', 'exp-csv', { cls: 'btn--sm', icon: 'download' })}${ui.btn('打印', 'print', { cls: 'btn--sm', icon: 'print' })}</div>` })}

        ${ui.card('各类材料准备要点', `<div class="guide">${GUIDE.map(g => `<div class="guide__i"><b>${g[0]}</b><p>${g[1]}</p></div>`).join('')}</div>
          <div class="callout callout--warn"><b>时间建议：</b>从大一开学就建立个人成果清单，竞赛证书、志愿时长、活动证明、任职文件随手归档（建议一个云盘文件夹 + 命名规范「学年_类别_项目名」）。志愿服务 32 小时<b>按学年累计</b>，早做早从容。</div>`,
          { icon: 'bulb' })}
      </div>`;
    }
  };
  ZC.actions['mat-filter'] = (arg) => { ZC.state.ui.matFilter = arg; ZC.rerender(); };
  ZC.actions['copy-materials'] = async () => {
    const { p, R, res } = ZC.ctx();
    await ui.copy(ZC.buildMarkdownReport(p, R, res), '材料清单已复制（Markdown 格式）');
  };

  /* ==================================================================
   * 情景模拟（草稿模式：所有页面都在改草稿，随时对比 / 应用 / 丢弃）
   * ================================================================== */
  ZC.sim = {
    enter() {
      if (ZC.state.simMode) return;
      ZC.state.simDraft = ZC.clone(ZC.getProfile());
      ZC.state.simMode = true; ZC.save(true); ZC.rerender();
      ui.toast('已进入模拟模式：所有改动只影响草稿', 'ok', 3200);
    },
    exit(applyIt) {
      if (!ZC.state.simMode) return;
      if (applyIt) {
        ZC.snapshot('应用模拟结果');
        const d = ZC.state.simDraft;
        const i = ZC.state.profiles.findIndex(x => x.id === d.id);
        if (i >= 0) ZC.state.profiles[i] = d;
        ui.toast('模拟结果已应用到正式档案（可撤销）', 'ok', 4000);
      } else ui.toast('已丢弃模拟草稿', 'muted');
      ZC.state.simMode = false; ZC.state.simDraft = null; ZC.save(true); ZC.rerender();
    },
    reset() {
      ZC.state.simDraft = ZC.clone(ZC.state.profiles.find(x => x.id === ZC.state.activeId));
      ZC.rerender(); ui.toast('草稿已重置为当前正式数据', 'ok');
    },
    quick(arg) {
      if (!ZC.state.simMode) ZC.sim.enter();
      const d = ZC.state.simDraft, R = ZC.getRules(d);
      switch (arg) {
        case 'vol32': d.pinxing.service.volunteerHours = Math.max(+d.pinxing.service.volunteerHours || 0, R.pinxing.service.volunteerHours); break;
        case 'orgtrain': d.pinxing.ideology.orgTraining = (+d.pinxing.ideology.orgTraining || 0) + 1; break;
        case 'provtrain': d.pinxing.ideology.provincialTraining = (+d.pinxing.ideology.provincialTraining || 0) + 1; break;
        case 'collect': d.pinxing.collective.entries.push({ id: ZC.uid(), name: '假设：重大活动', times: 1, status: 'todo', evidence: '' }); break;
        case 'practice': d.pinxing.service.schoolPractice = (+d.pinxing.service.schoolPractice || 0) + 1; break;
        case 'provint': d.pinxing.service.provIntern = (+d.pinxing.service.provIntern || 0) + 1; break;
        case 'c_sch_1': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：校级竞赛', level: 'school', award: '一等奖', status: 'todo', evidence: '' }); break;
        case 'c_sch_3': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：校级竞赛', level: 'school', award: '三等奖', status: 'todo', evidence: '' }); break;
        case 'c_prov_2': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：省级竞赛', level: 'prov', award: '二等奖', status: 'todo', evidence: '' }); break;
        case 'c_nat_3': d.ability.academic.push({ id: ZC.uid(), kind: 'competition', project: '假设：国家级竞赛', level: 'intl_nat', award: '三等奖', status: 'todo', evidence: '' }); break;
        case 'p_gen': d.ability.academic.push({ id: ZC.uid(), kind: 'paper', name: '假设：一般期刊论文', pubClass: 'general', rank: 1, signUnit: '西安交通大学', status: 'todo', evidence: '', noMerge: true }); break;
        case 'p_core': d.ability.academic.push({ id: ZC.uid(), kind: 'paper', name: '假设：核心/国际会议论文', pubClass: 'ii', rank: 1, signUnit: '西安交通大学', status: 'todo', evidence: '', noMerge: true }); break;
        case 'p_util': d.ability.academic.push({ id: ZC.uid(), kind: 'patent', name: '假设：实用新型专利', patentType: '实用新型专利', rank: 1, signUnit: '西安交通大学', status: 'todo', evidence: '', noMerge: true }); break;
        case 'a_sch_1': d.ability.culture.push({ id: ZC.uid(), kind: 'art', name: '假设：校级文艺比赛', level: 'school', award: '一等奖', status: 'todo', evidence: '' }); break;
        case 'a_sch_3': d.ability.culture.push({ id: ZC.uid(), kind: 'art', name: '假设：校级文艺比赛', level: 'school', award: '三等奖', status: 'todo', evidence: '' }); break;
        case 'a_prov_1': d.ability.culture.push({ id: ZC.uid(), kind: 'art', name: '假设：省级文艺比赛', level: 'prov', award: '一等奖', status: 'todo', evidence: '' }); break;
        case 's_sch_48': d.ability.culture.push({ id: ZC.uid(), kind: 'sport', name: '假设：校级体育竞赛', level: 'school', award: '第4—8名', status: 'todo', evidence: '' }); break;
        case 'pos_dorm': d.ability.position.push({ id: ZC.uid(), org: '假设：宿舍', role: '宿舍长', tier: 't4', assessment: '合格', startDate: ZC.today().slice(0, 4) + '-09-01', endDate: ZC.today().slice(0, 4 + 1) + '-08-31', status: 'todo', evidence: '' }); break;
        case 'pos_banz': d.ability.position.push({ id: ZC.uid(), org: '假设：班级', role: '班长', tier: 't3', assessment: '优秀', startDate: ZC.today().slice(0, 4) + '-09-01', endDate: ZC.today().slice(0, 4 + 1) + '-08-31', status: 'todo', evidence: '' }); break;
        case 'pos_head': d.ability.position.push({ id: ZC.uid(), org: '假设：院级学生组织', role: '主席', tier: 't1', assessment: '优秀', startDate: ZC.today().slice(0, 4) + '-09-01', endDate: ZC.today().slice(0, 4 + 1) + '-08-31', status: 'todo', evidence: '' }); break;
        case 'r_coll': d.reward.items.push({ id: ZC.uid(), category: 'honor', level: 'college', name: '假设：院级表彰', status: 'todo', evidence: '' }); break;
        case 'r_school': d.reward.items.push({ id: ZC.uid(), category: 'honor', level: 'school', name: '假设：校级表彰', status: 'todo', evidence: '' }); break;
        case 'r_deed': d.reward.items.push({ id: ZC.uid(), category: 'deed', name: '假设：做好事受表扬', status: 'todo', evidence: '' }); break;
        case 'ded_kuangke': d.pinxing.deductions.push({ id: ZC.uid(), type: 'kuangke', count: 1, note: '假设：旷课 1 次', status: 'todo' }); break;
        case 'ded_weisheng': d.pinxing.deductions.push({ id: ZC.uid(), type: 'weisheng', count: 1, note: '假设：宿舍卫生不合格', status: 'todo' }); break;
        case 'ded_jinggao': d.pinxing.deductions.push({ id: ZC.uid(), type: 'jinggao', count: 1, note: '假设：警告处分', status: 'todo' }); break;
      }
      ZC.save(true); ZC.rerender();
    },
    apply() { ZC.sim.exit(true); },
    discard() { ZC.sim.exit(false); }
  };
  ZC.actions['sim-enter'] = () => ZC.sim.enter();
  ZC.actions['sim-apply'] = () => ZC.sim.exit(true);
  ZC.actions['sim-discard'] = () => ui.confirm('丢弃模拟草稿', '草稿中的所有假设改动将被丢弃，正式档案不受影响。', () => ZC.sim.exit(false), '丢弃');
  ZC.actions['sim-quick'] = (arg) => ZC.sim.quick(arg);

  V.simulate = {
    render(ctx) {
      const base = ZC.state.profiles.find(x => x.id === ZC.state.activeId);
      const R = ZC.getRules(base);
      const baseRes = ZC.compute(base, R);
      const inSim = ZC.state.simMode;
      const draft = inSim ? ZC.state.simDraft : base;
      const draftRes = inSim ? ctx.res : baseRes;

      const QUICK = [
        ['🟢 品行加分', [['vol32', '志愿服务补满 32h'], ['orgtrain', '党团理论学习 +1 次'], ['provtrain', '省部级培训 +1 次'], ['collect', '集体活动 +1 次'], ['practice', '校级社会实践 +1 项'], ['provint', '省部级见习 +1 项']]],
        ['🔵 学术科研', [['c_sch_3', '校级竞赛 三等奖'], ['c_sch_1', '校级竞赛 一等奖'], ['c_prov_2', '省级竞赛 二等奖'], ['c_nat_3', '国家级竞赛 三等奖'], ['p_gen', '一般期刊论文（一作）'], ['p_core', '核心/国际会议（一作）'], ['p_util', '实用新型专利']]],
        ['🟣 文体竞赛', [['a_sch_3', '校级文艺 三等奖'], ['a_sch_1', '校级文艺 一等奖'], ['a_prov_1', '省级文艺 一等奖'], ['s_sch_48', '校级体育 第4—8名']]],
        ['🟠 任职与奖励', [['pos_dorm', '宿舍长（合格）'], ['pos_banz', '班长（优秀）'], ['pos_head', '院级组织正职（优秀）'], ['r_coll', '院级表彰'], ['r_school', '校级表彰'], ['r_deed', '做好事 +1']]],
        ['🔴 反向模拟：如果出事了', [['ded_kuangke', '旷课 1 次'], ['ded_weisheng', '宿舍卫生不合格'], ['ded_jinggao', '警告处分']]]
      ];

      const segs = [
        ['品行素质分', baseRes.pinxing.final, draftRes.pinxing.final, R.frame.pinxing],
        ['能力拓展分', baseRes.ability.final, draftRes.ability.final, R.frame.ability],
        ['奖励分', baseRes.reward.final, draftRes.reward.final, R.reward.cap],
        ['综合素质测评成绩', baseRes.total, draftRes.total, baseRes.maxTotal]
      ];
      const cb = ZC.composite(base, R, baseRes.total), cd = ZC.composite(draft, R, draftRes.total);

      const cmp = `<div class="tbl-wrap"><table class="tbl tbl--cmp">
        <thead><tr><th>项目</th><th class="tr">当前正式</th><th class="tr">${inSim ? '模拟草稿' : '（未开始模拟）'}</th><th class="tr">变化</th><th class="tr">满分</th></tr></thead>
        <tbody>${segs.map(s => {
          const d = ZC.r2(s[2] - s[1]);
          return `<tr class="${s[0].includes('测评成绩') ? 'row--sum' : ''}"><td class="tl">${s[0]}</td><td class="tr">${fmt(s[1])}</td><td class="tr">${fmt(s[2])}</td>
            <td class="tr">${d === 0 ? '<span class="na">0</span>' : `<b class="${d > 0 ? 'pos' : 'neg'}">${ZC.signed(d)}</b>`}</td><td class="tr na">${fmt(s[3])}</td></tr>`;
        }).join('')}
        <tr class="row--sum"><td class="tl">${esc(cb.preset.name)}综合成绩</td><td class="tr">${fmt(cb.total)}</td><td class="tr">${fmt(cd.total)}</td>
          <td class="tr">${ZC.r2(cd.total - cb.total) === 0 ? '<span class="na">0</span>' : `<b class="${cd.total > cb.total ? 'pos' : 'neg'}">${ZC.signed(ZC.r2(cd.total - cb.total))}</b>`}</td><td class="tr na">—</td></tr>
        </tbody></table></div>`;

      const gapPlan = (function () {
        const t = +base.target.score || 0;
        if (!t) return '';
        const gap = ZC.r2(t - baseRes.total);
        if (gap <= 0) return `<div class="callout callout--ok"><b>已达成目标 ${fmt(t)} 分</b>（当前 ${fmt(baseRes.total)}，超出 ${fmt(-gap)} 分）。</div>`;
        const plan = ZC.recommend(base, R, baseRes, gap);
        let acc = 0;
        return `<div class="plan"><h4>目标反推：从 ${fmt(baseRes.total)} 到 ${fmt(t)}（差 ${fmt(gap)} 分）</h4>
          <ol>${plan.map(x => { acc = ZC.r2(acc + x.gain); return `<li><span class="plan__g">+${fmt(x.gain)}</span><b>${esc(x.label)}</b><em>投入${ZC.EFFORT_LABEL[x.effort]}</em><span class="plan__acc">累计 ${fmt(ZC.r2(baseRes.total + acc))}</span>
            <button class="lbtn" data-act="sim-quick" data-arg="${simIdFor(x.id)}" ${simIdFor(x.id) ? '' : 'disabled'}>加入模拟</button></li>`; }).join('')}</ol>
          ${acc < gap ? `<p class="warn-t">按当前剩余空间，最多还能提升 ${fmt(acc)} 分，仍差 ${fmt(ZC.r2(gap - acc))} 分。可能需要核对书院细则或调整目标。</p>` : `<p class="muted">完成前 ${plan.findIndex((x, i) => ZC.r2(plan.slice(0, i + 1).reduce((s, y) => s + y.gain, 0)) >= gap) + 1 || plan.length} 项即可达标。</p>`}
        </div>`;
      })();

      return `<div class="page">
        <div class="page__hd"><h1>情景模拟</h1><p>「如果我再做一件事，综测会涨多少？」——先模拟，再决定把时间花在哪</p>
          ${inSim ? `<div class="simmode">${ui.icon('flask', 15)} 模拟模式进行中</div>` : ''}</div>

        ${inSim ? `<div class="callout callout--sim">
          <b>${ui.icon('flask', 15)} 你正在编辑模拟草稿</b>
          <p>现在全站所有页面的改动都只作用于草稿，正式档案不受影响。左侧导航照常使用即可。</p>
          <div class="btns">${ui.btn('应用到正式档案', 'sim-apply', { cls: 'btn--primary btn--sm', icon: 'check' })}${ui.btn('重置草稿', 'sim-reset', { cls: 'btn--sm', icon: 'undo' })}${ui.btn('丢弃并退出', 'sim-discard', { cls: 'btn--sm btn--danger', icon: 'x' })}</div>
        </div>` : `<div class="simstart">
          <div><b>两种玩法</b><p>① 点下面的快捷按钮，一键叠加"假设成果"看变化；② 进入完整模拟模式，用真实的录入界面搭建任意场景（含扣分、任职任期等复杂情况）。</p></div>
          <div class="btns">${ui.btn('进入完整模拟模式', 'sim-enter', { cls: 'btn--primary', icon: 'flask' })}</div>
        </div>`}

        ${ui.card('对比结果', cmp, { icon: 'trend', sub: '实时计算，含综合成绩联动' })}
        ${ui.card('一键叠加假设成果', `<div class="qk">${QUICK.map(g => `<div class="qk__g"><h4>${g[0]}</h4><div class="qk__b">${g[1].map(x => `<button class="qbtn" data-act="sim-quick" data-arg="${x[0]}">${ui.icon('plus', 13)}${esc(x[1])}</button>`).join('')}</div></div>`).join('')}</div>`,
          { icon: 'flask', sub: '每次点击都会在草稿上叠加一项，可反复点击模拟"多做几次"' })}
        ${gapPlan}
        ${ui.card('模拟结果说明', `<p class="hint">模拟采用与正式计分完全相同的引擎与规则口径（含各项封顶、同一项目取最高、任职取最高、扣分不设上限）。因此模拟结果可直接作为决策依据，但<b>最终分值以班级评议与书院认定为准</b>——尤其是"待认定"的竞赛级别、书院集体活动单次分值、任职考核等级。</p>`, { icon: 'info' })}
      </div>`;
    }
  };
  function simIdFor(oppId) {
    const m = { vol: 'vol32', orgtrain: 'orgtrain', provtrain: 'provtrain', collect: 'collect', practice: 'practice', provint: 'provint', c_sch_3: 'c_sch_3', c_sch_1: 'c_sch_1', c_prov_2: 'c_prov_2', c_nat_3: 'c_nat_3', p_gen: 'p_gen', p_core: 'p_core', p_util: 'p_util', a_sch_3: 'a_sch_3', a_sch_1: 'a_sch_1', a_prov_1: 'a_prov_1', s_sch_48: 's_sch_48', pos_dorm: 'pos_dorm', pos_banz: 'pos_banz', pos_head: 'pos_head', r_coll: 'r_coll', r_school: 'r_school', r_deed: 'r_deed' };
    return m[oppId] || '';
  }
  ZC.actions['sim-reset'] = () => ZC.sim.reset();

  /* ==================================================================
   * 班级对比
   * ================================================================== */
  V.class = {
    render(ctx) {
      const { p, R, res } = ctx;
      p.classmates = p.classmates || [];
      const list = p.classmates.slice();
      const selfScore = +p.coursework.score ? ZC.composite(p, R, res.total).total : res.total;
      const useComposite = !!p.coursework.score;
      list.forEach(m => { m._v = useComposite ? (+m.composite || 0) : (+m.zongce || 0); });
      const me = { id: '__self', name: p.meta.name + '（我）', _v: selfScore, self: true };
      const all = list.concat([me]).filter(x => x._v > 0).sort((a, b) => b._v - a._v);
      const myRank = all.findIndex(x => x.self) + 1;
      const total = all.length;
      const q = R.classQuota || { te: 1, yi: 5, er: 15, san: 30 };
      const pct = total ? (myRank / total * 100) : 0;
      const tierOf = (pc) => pc <= q.te ? '特等' : pc <= q.yi ? '一等' : pc <= q.er ? '二等' : pc <= q.san ? '三等' : '未达档位';

      const maxV = all.length ? all[0]._v : 100;
      const minV = all.length ? all[all.length - 1]._v : 0;

      const bars = all.map(x => {
        const h = Math.max(8, (x._v - minV) / ((maxV - minV) || 1) * 54 + 8);
        return `<span class="dist__b ${x.self ? 'is-me' : ''}" style="height:${h.toFixed(1)}px" title="${esc(x.name)} ${fmt(x._v)}"></span>`;
      }).join('');
      const rankBody = total ? `<div class="rankbox">
          <div class="rankbox__n">#${myRank}<span>/ ${total}</span></div>
          <div class="rankbox__b">
            <div class="rankbar"><i style="left:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></div>
            <div class="rankbox__m">前 ${fmt(Math.round(pct * 10) / 10)}% · ${useComposite ? '按综合成绩（' + esc(res.composite.preset.name) + '）' : '按综测原始分'}排名 · 估算档位 <b>${esc(tierOf(pct))}</b></div>
          </div>
          <div class="dist">${bars}</div>
        </div>`
        : ui.empty('users', '还没有可对比的数据', '至少录入 1 位同学的成绩，并在「综合成绩」页填写自己的课程成绩。');
      const rankSub = total ? `共 ${total} 人参与对比（含你自己）` : '录入同学成绩后显示位置';

      return `<div class="page">
        <div class="page__hd"><h1>班级对比与排名估算</h1><p>综测最终要落到排名上——录入同学的综合成绩，估算自己的位置与奖学金档位</p>
          <div class="page__score"><b>${myRank ? '#' + myRank : '—'}<span>/${total || '—'}</span></b><span>估算排名</span></div></div>

        <div class="callout callout--warn">${ui.icon('alert', 15)} <b>估算性质说明：</b>本模块仅用于自我定位。真实评奖按专业/班级分别排名，名额比例、体测要求、资格红线与加权口径各学院不同，且同学数据未必完整。请以书院公示结果为准，并尊重他人隐私——不要录入他人学号等敏感信息。</div>

        ${ui.card('我的位置', rankBody, { icon: 'users', sub: rankSub })}

        ${ui.card('名额比例设置（%）', `<div class="fgrid fgrid--4">
          ${fld('特等 ≤', ui.num('ruleOverride.classQuota.te', q.te, { width: '76px', min: 0, step: 0.5 }))}
          ${fld('一等 ≤', ui.num('ruleOverride.classQuota.yi', q.yi, { width: '76px', min: 0, step: 0.5 }))}
          ${fld('二等 ≤', ui.num('ruleOverride.classQuota.er', q.er, { width: '76px', min: 0, step: 0.5 }))}
          ${fld('三等 ≤', ui.num('ruleOverride.classQuota.san', q.san, { width: '76px', min: 0, step: 0.5 }))}
        </div><p class="hint">默认值为常见量级的示意，请改成你所在学院/班级当年公布的比例。</p>`, { icon: 'gear' })}

        ${ui.card('同学名单', `<div class="list list--tight">
          ${p.classmates.map((m, i) => {
            const k = `classmates[${i}]`;
            return `<div class="cm">
              ${ui.txt(k + '.name', m.name, { ph: '姓名/代号' })}
              ${ui.num(k + '.composite', m.composite, { ph: '综合成绩', width: '110px' })}
              ${ui.num(k + '.zongce', m.zongce, { ph: '综测分', width: '96px' })}
              ${ui.ibtn('del', 'trash', { arg: `classmates|${i}`, cls: 'ibtn--danger', title: '删除' })}
            </div>`;
          }).join('') || '<p class="muted">尚未录入。可以用下方"批量粘贴"一次性导入。</p>'}
        </div>
        <div class="btns">${ui.btn('添加一行', 'add', { arg: 'classmate|classmate', cls: 'btn--sm btn--primary', icon: 'plus' })}${ui.btn('批量粘贴导入', 'paste-class', { cls: 'btn--sm', icon: 'upload' })}</div>`,
          { icon: 'list', sub: useComposite ? '当前按「综合成绩」列排序' : '当前按「综测分」列排序（填写自己的课程成绩后自动切换为综合成绩）' })}
      </div>`;
    }
  };
  ZC.actions['paste-class'] = () => {
    ui.modal({
      title: '批量粘贴同学成绩', wide: true,
      body: `<p class="muted">每行一条，格式：<code>姓名,综合成绩</code> 或 <code>姓名,综合成绩,综测分</code>，逗号可用中文逗号、空格或制表符。示例：</p>
        <textarea class="inp ta" id="paste-ta" rows="8" placeholder="张三,88.6,95&#10;李四 86.2 91&#10;王五,90.1,98"></textarea>`,
      actions: `<button class="btn" data-close="1">取消</button><button class="btn btn--primary" data-ok="1">导入</button>`,
      onOk(root) {
        const txt = root.querySelector('#paste-ta').value || '';
        const lines = txt.split(/\n+/).map(s => s.trim()).filter(Boolean);
        if (!lines.length) { ui.toast('没有可导入的内容', 'warn'); return false; }
        ZC.snapshot('批量导入同学');
        const p = ZC.getProfile(); p.classmates = p.classmates || [];
        let n = 0;
        lines.forEach(l => {
          const parts = l.split(/[,，\t ]+/).filter(Boolean);
          if (!parts.length) return;
          const name = isNaN(+parts[0]) ? parts.shift() : ('同学' + (p.classmates.length + 1));
          const nums = parts.map(x => +x).filter(x => !isNaN(x));
          p.classmates.push({ id: ZC.uid(), name, composite: nums[0] !== undefined ? nums[0] : '', zongce: nums[1] !== undefined ? nums[1] : '', self: false });
          n++;
        });
        ZC.save(); ZC.rerender(); ui.toast(`已导入 ${n} 位同学`, 'ok');
      }
    });
  };

  /* ==================================================================
   * 程序与时效
   * ================================================================== */
  V.procedure = {
    render(ctx) {
      const { p, R } = ctx;
      const STEPS = [
        ['学生提交', '提交学年总结及支撑材料（本工具可一键导出自评表 Markdown）'],
        ['班级初评', '班级评议小组（班主任 + 学生干部 + 学生代表）由班主任主持初评'],
        ['本人确认', '学生核对初评结果并<b>签字确认</b>——最后一次低成本纠错机会'],
        ['书院审核', '书院综测工作组（院领导 + 辅导员 + 班主任 + 学生代表）审核'],
        ['院内公示', '公示<b>不少于 3 个工作日</b>，同时报学生处审核并报相关学院'],
        ['异议', '公示起 <b>3 个工作日内</b>向书院工作组提出书面异议 → 书院 <b>3 个工作日内</b>答复'],
        ['申诉', '对答复不服，在答复后 <b>3 个工作日内</b>向学生处书面申诉（附书院答复）'],
        ['最终处理', '学生处 <b>3 个工作日内</b>调查审核并出具最终处理意见']
      ];
      const pd = p.meta.publicityDate;
      const tl = pd ? ZC.appealTimeline(pd, R) : null;
      const now = new Date();
      const cd = (d) => d ? Math.ceil((d.setHours(23, 59, 59) - now) / 86400000) : null;

      const switchHtml = `<label class="switch"><input type="checkbox" data-k="meta.signedOff" data-t="bool" ${p.meta.signedOff ? 'checked' : ''}><span class="switch__t"></span><span class="switch__l">${p.meta.signedOff ? '已签字' : '未签字'}</span></label>`;
      const tlRows = tl ? [['书面异议截止', tl.objection, '向书院综测工作组提交'], ['书院答复截止', tl.reply, '书院工作组答复'],
        ['向学生处申诉截止', tl.appeal, '需附书院答复意见'], ['学生处最终处理', tl.final, '出具最终处理意见']].map(([t, d, sub], i) => {
          const left = cd(new Date(d));
          return `<div class="tl__i ${left < 0 ? 'is-past' : left <= 3 ? 'is-urgent' : ''}">
            <span class="tl__n">${i + 1}</span>
            <div class="tl__b"><b>${t}</b><em>${esc(sub)}</em></div>
            <div class="tl__d">${ZC.dateStr(d)}<span>${left < 0 ? '已过' : '剩 ' + left + ' 天'}</span></div></div>`;
        }).join('') : '';
      const calcBody = `<div class="fgrid fgrid--2">
          ${fld('院内公示起始日', ui.date('meta.publicityDate', pd), '填写后自动推算后续所有截止日（按工作日计，跳过周六周日）')}
          ${fld('本人已签字确认', switchHtml)}
        </div>` + (tl ? `<div class="tl">${tlRows}</div>
        <p class="hint">⚑ 上述按"工作日"推算，仅跳过周六周日；<b>法定节假日与寒暑假需自行顺延核对</b>，以书院通知的具体日期为准。</p>`
        : '<p class="muted">填写公示起始日后，这里会显示四个关键截止日期与倒计时。</p>');

      return `<div class="page">
        <div class="page__hd"><h1>评定程序与申诉时效</h1><p>三个"3 个工作日"错过即丧失程序权利——把日期算清楚</p></div>

        ${ui.card('时效计算器', calcBody, { icon: 'clock', sub: '公示不少于 3 个工作日；异议、答复、申诉、最终处理各 3 个工作日' })}

        ${ui.card('完整评定流程', `<div class="steps">${STEPS.map((s, i) => `<div class="step2"><span class="step2__n">${i + 1}</span><div><b>${s[0]}</b><p>${s[1]}</p></div></div>`).join('')}</div>
          <p class="hint"><button class="lbtn" data-act="rule" data-arg="procedure">查看程序原文</button>　评定在每学年第一学期集中开展，由学生处（学生资助管理中心）组织实施。</p>`, { icon: 'list' })}

        ${ui.card('申诉文书模板（可复制）', `<div class="tpl">
            <textarea class="inp ta" id="appeal-ta" rows="12">关于 ${esc(p.meta.academicYear)} 学年本科生综合素质测评结果的书面异议

致：${esc(p.meta.college)}综合素质测评工作组

本人 ${esc(p.meta.name)}（学号 ${esc(p.meta.studentId || '________')}，${esc(p.meta.grade || '____班')}），现就本学年综合素质测评公示结果提出书面异议，具体事项如下：

一、异议事项
（请逐条写明：哪一项加分/扣分、公示分值、你认为的正确分值、依据的规则条款）
1.
2.

二、事实与依据
（请写明佐证材料名称、编号、取得时间，以及对应的规则条款。例如：《西安交通大学本科生综合素质测评成绩评定办法》中关于"______"的规定）

三、请求
请求工作组对上述事项重新核定，并在 3 个工作日内予以书面答复。

附：佐证材料清单
1.
2.

异议人（签字）：__________　　日期：______年____月____日</textarea>
            <div class="btns">${ui.btn('复制模板', 'copy-appeal', { cls: 'btn--sm btn--primary', icon: 'copy' })}</div>
          </div>
          <div class="callout callout--info callout--sm"><b>写作要点：</b>①只写事实与规则条款，不写情绪；②每一条异议都要配一份可核验的佐证材料；③明确写"请求 3 个工作日内书面答复"，把程序时限固定下来；④若对书院答复不服，须在答复后 3 个工作日内向学生处申诉，并<b>附上书院的答复原件</b>。</div>`,
          { icon: 'book' })}
      </div>`;
    }
  };
  ZC.actions['copy-appeal'] = async () => { await ui.copy(document.getElementById('appeal-ta').value, '申诉模板已复制'); };

  /* ==================================================================
   * 规则手册
   * ================================================================== */
  const RB = [
    { g: '总则', q: ['总公式', '评定时间', '评定主体', '用途'], b: [
      ['总公式', '综合素质测评成绩 = 品行素质分（80 分） + 能力拓展分（20 分） + 奖励分（5 分），满分 105 分。'],
      ['文件依据', '学生工作部（处）《西安交通大学本科生综合素质测评成绩评定办法》（2018 年 5 月印发）；2018 年 7 月 12 日经校长办公会审议通过的《实施细则》与《西安交通大学本科生奖学金管理办法》（西交学〔2018〕41 号）共同发布，自 2018—2019 学年起统一执行。'],
      ['评定时间', '每学年第一学期集中开展，由学生处（学生资助管理中心）组织实施。'],
      ['评定主体', '书院成立综测工作组（院领导 + 辅导员 + 班主任 + 学生代表）；班级成立评议小组（班主任 + 学生干部 + 学生代表）。'],
      ['用途', '关系到奖学金、推免保研、表彰奖励评定等。评奖学金综合成绩 = 课程考核成绩 × 80% + 综测 × 20%；推免中综测占比因学院而异；大一分流以接收学院当年公布的分流办法为准。']
    ]},
    { g: '品行素质分', q: ['基准分', '集体活动', '思想政治', '社会服务', '志愿服务', '扣分', '旷课', '宿舍卫生', '处分'], b: [
      ['基准分（70 分）', '经班级评议小组评议合格、书院审定通过即可获得。'],
      ['集体活动分（上限 3 分）', '学校及书（学）院主办或发起的重大活动，以主办单位名单/证明为依据。<b>参与一次的具体分值，校级办法未作统一规定，明确"由各书（学）院自行认定"</b>。⚑ "参与一次加 0.6 分"为彭康书院层面的细化口径，其他书院可能不同。对集体荣誉作出突出贡献，经书院认定可一次性获得满分（3 分）。'],
      ['思想政治理论学习分（上限 3 分）', '参加各级党团组织的理论学习培训（含网络学习）+1；参加省、部级理论学习培训 +2；培训获"优秀学员"称号额外 +1。三项可叠加，总封顶 3 分。'],
      ['社会服务分（上限 4 分）', '志愿服务每学年 ≥32 小时 +1，不足 32 小时按比例；校级社会实践考核合格的团队成员 +1；市、县级挂职锻炼及政府见习 +1；省、部级挂职锻炼及政府见习、国际组织见习 +2；获先进个人及表彰额外 +1。各项可累计、封顶 4 分。'],
      ['品行素质扣分（不设上限）', '通报批评 −2/次；警告 −4/次；严重警告 −6/次；记过 −8/次；留校察看 −10/次；旷课（未达处分条件）−1/次；宿舍卫生不合格 宿舍每人每次 −1。']
    ]},
    { g: '能力拓展分', q: ['学术科研', '创新创业', '竞赛', '论文', '专利', '专著', '署名', '文艺', '体育', '破纪录', '任职', '社团', '任期', '兼任'], b: [
      ['学术科研及创新创业（上限 10 分）', '同一项目获不同奖项不累计、取最高；不同项目可累计。竞赛：高水平国际/国家级 一等 10、二等 9、三等 8；省级 一等 8、二等 6、三等 4；校级、地方行政部门、行业（企业）、学会（协会）一等 4、二等 3、三等 2、优秀奖 1。特等奖参照一等奖。'],
      ['论文 / 专著 / 专利', '第一署名单位须为"西安交通大学"或"Xi\'an Jiaotong University"，需录用通知 / 专利证书等佐证。<br>· 学校认定的国际期刊论文（i 类）：一作 10、二作 8、三作 6、第四及以后 2<br>· 国内核心期刊、国际会议论文（ii 类）：6 / 5 / 4 / 1<br>· 国内一般期刊、国内会议论文：3 / 2 / 1 / —<br>· 出版专著：10 / 8 / 6，第四位起依次递减 1，参编 +1<br>· 发明专利等同 i 类；实用新型、软件著作权等同 ii 类<br>· 会议入围优秀论文额外 +1'],
      ['文体竞赛（上限 6 分）', '同一项目取最高、不同项目可累计。文艺：国际级/国家级 一等 6、二等 5、三等 4、优秀奖 3；省级 4 / 3.5 / 3 / 2；校级 2 / 1.5 / 1 / —。体育：国际级/国家级 第1名 6、第2名 5、第3名 4、第4—8名 3；省级 4 / 3.5 / 3 / 2；校级 2 / 1.5 / 1 / 0.5。破省级及以上纪录 +5，破校级纪录 +3。'],
      ['学生组织、社团任职（上限 4 分）', '四档职务 × 优/良/合格三级考核。<b>⚑ 任期规则：</b>官方原文为"任期原则上要求满一年；若不满一年，根据工作时间酌情加分，最高不得超过任期满一年的加分"——不满一年不是一分没有，而是可获酌情分，上限不超过对应档位。兼任多项职务按最高分计、不累加；考核不合格不加分。']
    ]},
    { g: '奖励分', q: ['奖励', '荣誉', '见义勇为', '拾金不昧', '做好事'], b: [
      ['奖励分（5 分，累加超 5 按 5 计）', '精神文明集体/个人荣誉表彰：全国 5、省 4、市 3、校 2、院 1；见义勇为、舍己救人、拾金不昧等受表彰同标准；做好事受表扬、为校争光、突出贡献每项 +1，可累加，封顶 5 分。']
    ]},
    { g: '用途与关联', q: ['奖学金', '国家奖学金', '励志', '推免', '保研', '分流', '转专业', '体测', '不及格', '资格'], b: [
      ['评奖学金', '综合成绩 = 课程考核成绩 × 80% + 综合素质测评成绩 × 20%。<b>参评资格红线：</b>参评学年必修课考核不及格（补考、重修视同不及格），或受到校级、院级纪律处分（含尚未解除），取消当年度奖学金参评资格。体测：国家奖学金、国家励志奖学金通常要求良好及以上，校级奖学金要求及格。金额（供参考）：国家奖学金 8000 元/年、国家励志 5000 元/年、校级特等 10000 / 一等 5000 / 二等 3000 / 三等 1000 元/年。'],
      ['推免保研', '综测事关推免评定，但<b>推免综合成绩中综测的具体占比因学院而异</b>。例如电气工程学院指导意见为"素质测评成绩建议占比 10%"，公共政策与管理学院细则为"综合素质测评占 10%"。不存在全校统一的推免综测占比数值，务必以所在学院当年推免办法为准。'],
      ['大一分流 / 转专业', '公开可查的转专业政策表述为"综合素质测评成绩占综合成绩的 10%，智育成绩占 90%"。这是转专业/分流环节的口径，不是全校所有书院统一的固定比例，具体以所在书院和接收学院当年公布的分流办法为准。'],
      ['表彰奖励参评', '受校院级纪律处分、宿舍卫生不达标、保留学籍一年及以上、休学或延期毕业者，通常取消当年度表彰奖励参评资格。具体以当年《本科生表彰奖励办法》及书院通知为准。'],
      ['另一套口径的存在', '部分书院历史上执行《本科生表彰奖励办法》的三部分口径，例如崇实书院 2015 年细则：综合成绩 = 思想品德行为成绩 × 20% + 课程学习成绩 × 70% + 体育成绩 × 10%。本工具已在「综合成绩」页内置多套口径可切换。']
    ]},
    { g: '程序与申诉', q: ['程序', '公示', '异议', '申诉', '签字', '工作日'], b: [
      ['评定程序', '学生提交学年总结及支撑材料 → 班级评议小组由班主任主持初评 → 学生核对并签字确认 → 报书院工作组 → 书院工作组审核 → 院内公示不少于 3 个工作日 → 报学生处审核，同时报相关学院。'],
      ['异议处理', '公示起 3 个工作日内向书院工作组书面异议 → 3 个工作日内答复；仍不服，在答复后 3 个工作日内向学生处书面申诉（附书院答复）→ 学生处 3 个工作日内调查审核并出具最终处理意见。']
    ]},
    { g: '易混淆与避坑', q: ['心理测评', '综合素质测试', '0.6', '彭康', '书院', '32小时', '署名单位', '不满一年', '差异'], b: [
      ['① 推免/复试"综合素质测试" ≠ 综测加分', '推免生及部分研究生复试环节需要完成的"综合素质测试"，<b>实质是心理测评</b>，主要了解个人态度和反应模式，答案无对错之分（登录地址 yzxlcs.xjtu.edu.cn/psytest）。综测加分依据的是学年学业与表现材料，不通过该系统完成。'],
      ['② 志愿服务工时口径', '现行标准为每学年 ≥32 小时加 1 分（不足按比例），依据为 2018 年评定办法原文。不要与早期版本或其他口径混用。'],
      ['③ 集体活动"0.6 分/次"的书院属性', '校级办法未规定单次分值，由书院自行认定。0.6 分/次是彭康书院层面的细化口径，不可当作全校通用标准。'],
      ['④ 任职"不满一年"的弹性空间', '官方明确"不满一年，根据工作时间酌情加分"。不同书院在"酌情"的具体幅度上可能有自己的细化规则（例如有的书院细则规定不满一年最高加对应档位的 1/2），但校级层面保留了酌情空间，不是绝对零分。'],
      ['⑤ 论文/专利署名单位', '第一署名单位必须为"西安交通大学"或"Xi\'an Jiaotong University"，否则不予认定。参与外单位科研项目时务必提前确认署名安排。'],
      ['⑥ 院级细则差异', '各书院（彭康、南洋、崇实、仲英、文治、宗濂、启德、励志、钱学森等）在集体活动认定、任职考核、社会服务细化方式上可能存在差异。校级办法是底线标准，所在书院当年公示的细则才是最终执行依据。']
    ]},
    { g: '朋辈引航', q: ['大一', '规划', '避坑', '建议', '过程分', '归档'], b: [
      ['核心认知：综测是"过程分"', '从大一开学就建立个人成果清单，竞赛证书、志愿时长、活动证明、任职文件随手归档。志愿服务每学年 32 小时是按学年累计的，早做早从容，不要拖到学年末。'],
      ['避坑：不设上限的扣分最伤', '旷课（−1/次）、宿舍卫生不合格（每人每次 −1）、违纪处分（−4 至 −10/次）不设上限，直接从 70 分基准分里扣。很多排名落差来自这些"小事"。'],
      ['任职：专注一个，尽量做满一年', '兼任多项只取最高、不累加。做满一年并争取"优秀"考核是收益最大化的路径；如果中途退出，按官方规则仍有酌情分，但上限受限、性价比下降，所以选择组织时就要考虑能否坚持一年。'],
      ['竞赛与科研：注意"同一项目"和"署名单位"', '同一项目多个奖项只取最高，一学期聚焦 1 个核心方向比广撒网更划算。论文/专利的第一署名单位必须是西安交大，参与外部项目前先确认署名安排。'],
      ['申诉时效：三个"3 个工作日"不要错过', '公示起 3 个工作日内提异议 → 3 个工作日内答复 → 不服再 3 个工作日内向学生处申诉 → 学生处 3 个工作日内最终处理。错过窗口即丧失程序权利。']
    ]}
  ];

  V.rulebook = {
    render() {
      const q = (ZC.state.ui.rbQuery || '').trim().toLowerCase();
      const groups = RB.map(g => {
        const blocks = g.b.filter(([t, c]) => !q || (t + c).toLowerCase().includes(q) || g.q.join(' ').toLowerCase().includes(q));
        return blocks.length ? { g: g.g, blocks } : null;
      }).filter(Boolean);
      const total = groups.reduce((s, g) => s + g.blocks.length, 0);
      return `<div class="page">
        <div class="page__hd"><h1>规则手册</h1><p>校级办法全文速查 · ⚑ 标记为常见误解或需要按书院口径确认之处</p></div>
        <div class="rb-bar">
          <div class="search">${ui.icon('search', 16)}<input class="inp" id="rb-search" data-rb="1" placeholder="搜索规则、分值、关键词…（按 / 聚焦）" value="${esc(ZC.state.ui.rbQuery || '')}"></div>
          <span class="muted">${q ? `匹配 ${total} 条` : `共 ${RB.reduce((s, g) => s + g.b.length, 0)} 条`}</span>
        </div>
        ${groups.length ? groups.map(g => `<section class="rb">
          <h3 class="rb__g">${esc(g.g)}</h3>
          ${g.blocks.map(([t, c]) => `<article class="rb__i"><h4>${hl(t, q)}</h4><div class="rb__c">${hl(c, q)}</div></article>`).join('')}
        </section>`).join('') : ui.empty('search', '没有匹配的内容', `换个关键词试试，例如「志愿」「任职」「署名」「旷课」。`)}
        <div class="callout callout--muted"><b>免责声明：</b>本工具依据公开发布的《西安交通大学本科生综合素质测评成绩评定办法》（2018）及其实施细则整理，用于学生自评与材料准备。校级办法为底线标准，各书（学）院可在集体活动认定、任职考核、社会服务细化等方面另行规定，<b>最终以你所在书院当年公示的细则和班级评议、书院审定结果为准</b>。</div>
      </div>`;
    },
    after() {
      const s = document.getElementById('rb-search');
      if (s && !s._b) {
        s._b = true;
        let t;
        s.addEventListener('input', () => {
          ZC.state.ui.rbQuery = s.value;
          clearTimeout(t);
          t = setTimeout(() => {
            const pos = s.selectionStart;
            ZC.rerender();
            requestAnimationFrame(() => { const n = document.getElementById('rb-search'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) {} } });
          }, 180);
        });
      }
    }
  };
  function hl(text, q) {
    if (!q) return text;
    try { return text.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'), '<mark>$1</mark>'); }
    catch (e) { return text; }
  }

  /* ==================================================================
   * 设置
   * ================================================================== */
  V.settings = {
    render(ctx) {
      const { p, R } = ctx;
      const RO = 'ruleOverride';
      const used = (function () { try { return (new Blob([localStorage.getItem('xjtu_zongce_v3') || '']).size / 1024).toFixed(1) + ' KB'; } catch (e) { return '—'; } })();

      const profileCard = ui.card('档案信息', `<div class="fgrid fgrid--3">
          ${fld('姓名', ui.txt('meta.name', p.meta.name))}
          ${fld('学号', ui.txt('meta.studentId', p.meta.studentId, { ph: '仅本机保存' }))}
          ${fld('书院', ui.sel('meta.college', p.meta.college, ZC.COLLEGES))}
          ${fld('专业', ui.txt('meta.major', p.meta.major))}
          ${fld('班级', ui.txt('meta.grade', p.meta.grade, { ph: '如 计算机0001班' }))}
          ${fld('学年', ui.txt('meta.academicYear', p.meta.academicYear, { ph: '如 2025—2026' }))}
        </div>
        ${fld('备注（显示在仪表盘顶部）', `<textarea class="inp ta" data-k="notes" rows="2" placeholder="例如：本学年重点冲省级竞赛 + 补志愿时长">${esc(p.notes || '')}</textarea>`)}
        <div class="btns">${ui.btn('管理档案（多学年/多人）', 'profiles', { cls: 'btn--sm', icon: 'folder' })}</div>`,
        { icon: 'user', sub: '所有信息只保存在本机浏览器，不会上传' });

      const collegeCard = ui.card('书院口径与规则参数', `
        <div class="fgrid fgrid--3">
          ${fld('集体活动 单次分值', `<div class="inline">${ui.num(RO + '.pinxing.collective.perTime', R.pinxing.collective.perTime, { width: '86px', step: 0.1, min: 0 })}<span class="unit">分/次</span></div>`, '校级未统一规定，由书院认定；0.6 为彭康口径')}
          ${fld('突出贡献一次性满分', ui.num(RO + '.pinxing.collective.outstandingFull', R.pinxing.collective.outstandingFull, { width: '86px', min: 0 }), '默认 3 分')}
          ${fld('志愿服务达标小时数', `<div class="inline">${ui.num(RO + '.pinxing.service.volunteerHours', R.pinxing.service.volunteerHours, { width: '86px', min: 1 })}<span class="unit">小时</span></div>`, '默认 32 小时')}
          ${fld('集体活动上限', ui.num(RO + '.pinxing.caps.collective', R.pinxing.caps.collective, { width: '86px', min: 0 }))}
          ${fld('思政学习上限', ui.num(RO + '.pinxing.caps.ideology', R.pinxing.caps.ideology, { width: '86px', min: 0 }))}
          ${fld('社会服务上限', ui.num(RO + '.pinxing.caps.service', R.pinxing.caps.service, { width: '86px', min: 0 }))}
          ${fld('学术科研上限', ui.num(RO + '.ability.caps.academic', R.ability.caps.academic, { width: '86px', min: 0 }))}
          ${fld('文体竞赛上限', ui.num(RO + '.ability.caps.culture', R.ability.caps.culture, { width: '86px', min: 0 }))}
          ${fld('任职上限', ui.num(RO + '.ability.caps.position', R.ability.caps.position, { width: '86px', min: 0 }))}
          ${fld('奖励分上限', ui.num(RO + '.reward.cap', R.reward.cap, { width: '86px', min: 0 }))}
          ${fld('基准分', ui.num(RO + '.pinxing.base', R.pinxing.base, { width: '86px', min: 0 }))}
          ${fld('品行素质分满分', ui.num(RO + '.frame.pinxing', R.frame.pinxing, { width: '86px', min: 0 }))}
        </div>
        <div class="fgrid fgrid--2">
          ${fld('任职不满一年的口径', ui.sel(RO + '.ability.position.partialTerm.mode', R.ability.position.partialTerm.mode, [
            { id: 'prorate', label: '按实际工作时间比例（月数/12）' }, { id: 'half', label: '最高不超过满一年的 1/2' },
            { id: 'custom', label: '自定义固定系数' }, { id: 'none', label: '不加分' }], { width: 'auto' }))}
          ${fld('自定义系数（half/custom 模式生效）', ui.num(RO + '.ability.position.partialTerm.custom', R.ability.position.partialTerm.custom, { width: '96px', min: 0, max: 1, step: 0.05 }))}
        </div>
        <label class="chk"><input type="checkbox" data-k="${RO}.pinxing.floorAtZero" data-t="bool" ${R.pinxing.floorAtZero ? 'checked' : ''}><span class="chk__box"></span><span>品行素质分扣到 0 为止（不出现负分）</span></label>
        <label class="chk"><input type="checkbox" data-k="${RO}.ability.publication.mustBeFirstUnit" data-t="bool" ${R.ability.publication.mustBeFirstUnit ? 'checked' : ''}><span class="chk__box"></span><span>论文/专利必须校验第一署名单位为西安交通大学（强烈建议开启）</span></label>
        <p class="hint">⚑ 修改规则参数会立即影响计分。校级办法是底线标准，书院可在集体活动认定、任职考核、社会服务细化等方面另行规定。<button class="lbtn" data-act="reset-rules">恢复校级默认</button></p>`,
        { icon: 'gear', sub: '当前档案：' + esc(p.meta.college) + ' · 修改仅对本档案生效' });

      const dataCard = ui.card('数据管理', `<div class="exp">
          <button class="exp__i" data-act="exp-json">${ui.icon('download', 20)}<b>导出备份 (JSON)</b><span>全部档案 + 规则设置</span></button>
          <button class="exp__i" data-act="import">${ui.icon('upload', 20)}<b>导入备份</b><span>从 JSON 文件恢复 / 迁移设备</span></button>
          <button class="exp__i" data-act="exp-md">${ui.icon('list', 20)}<b>导出自评表 (MD)</b><span>粘贴进学年总结</span></button>
          <button class="exp__i" data-act="exp-csv">${ui.icon('calc', 20)}<b>导出明细 (CSV)</b><span>Excel 逐项核对</span></button>
          <button class="exp__i" data-act="demo">${ui.icon('star', 20)}<b>载入示例档案</b><span>快速了解各项怎么填</span></button>
          <button class="exp__i exp__i--danger" data-act="clear-profile">${ui.icon('trash', 20)}<b>清空当前档案</b><span>保留档案信息，清除全部条目</span></button>
        </div>
        <p class="hint">存储状态：${ZC.storageOK ? '<b style="color:var(--ok)">正常（localStorage）</b>' : '<b style="color:var(--danger)">不可用，仅内存保存</b>'} · 占用约 ${used} · 共 ${ZC.state.profiles.length} 个档案。<br><b>数据只存在这台设备的浏览器里</b>：清除浏览器数据、更换设备或换浏览器都会丢失，请养成定期导出 JSON 的习惯（Ctrl/⌘+S 会提示备份）。</p>`,
        { icon: 'folder' });

      const about = ui.card('关于本工具', `<div class="about">
        <p><b>综测算分器</b>是为西安交通大学本科生做的综合素质测评自评工具，纯静态、无后端、无账号、无数据上传，可离线使用。</p>
        <ul>
          <li><b>算得准</b>：完整实现三大板块、七个分项的封顶规则、同一项目取最高、任职兼任取最高、任期酌情系数、署名单位校验、不设上限的扣分。</li>
          <li><b>看得懂</b>：每一分都给出计算依据，「计算过程」面板可逐行核对，导出报表带完整轨迹。</li>
          <li><b>用得上</b>：温馨提示引擎会主动指出风险（资格红线、材料缺失、扣分、署名不符）与机会（剩余空间、投入产出比排序、目标反推）。</li>
          <li><b>可定制</b>：书院口径、各项上限、综合成绩权重全部可改；支持多档案（多学年 / 多人）。</li>
        </ul>
        <p class="muted">快捷键：Ctrl/⌘+Z 撤销 · Ctrl/⌘+S 提示备份 · / 在规则手册中聚焦搜索</p>
        <p class="muted">本工具为个人学习用途的自研工具，与学校官方系统无关。计分口径以学校与书院当年正式文件为准。</p>
      </div>`, { icon: 'info' });

      return `<div class="page">
        <div class="page__hd"><h1>设置</h1><p>个人信息 · 书院口径 · 规则参数 · 数据备份</p></div>
        ${profileCard}${collegeCard}${dataCard}${about}
      </div>`;
    },
    profileModal() {
      const list = ZC.state.profiles.map(p => {
        const R = ZC.getRules(p); const res = ZC.compute(p, R);
        return `<div class="pf ${p.id === ZC.state.activeId ? 'on' : ''}">
          <div class="pf__b"><b>${esc(p.meta.name)}</b><em>${esc(p.meta.college)} · ${esc(p.meta.academicYear)}${p.meta.grade ? ' · ' + esc(p.meta.grade) : ''}</em></div>
          <div class="pf__s">${fmt(res.total)} 分</div>
          <div class="pf__o">
            ${p.id === ZC.state.activeId ? ui.badge('当前', 'ok') : ui.ibtn('prof-switch', 'check', { arg: p.id, title: '切换到此档案' })}
            ${ui.ibtn('prof-dup', 'copy', { arg: p.id, title: '复制（用于新学年）' })}
            ${ui.ibtn('prof-del', 'trash', { arg: p.id, cls: 'ibtn--danger', title: '删除' })}
          </div></div>`;
      }).join('');
      ui.modal({
        title: '档案管理', wide: true,
        body: `<p class="muted">建议每学年建一个档案；也可以给室友/同学各建一个用来互相核对（数据仍只存在你本机）。</p><div class="pfs">${list}</div>`,
        actions: `<button class="btn" data-close="1">关闭</button><button class="btn btn--primary" data-act="prof-new">${ui.icon('plus', 15)} 新建档案</button>`
      });
    },
    newProfile() {
      const years = [];
      const cy = new Date().getFullYear();
      for (let y = cy + 1; y >= cy - 5; y--) years.push(y + '—' + String(y + 1).slice(2));
      ui.modal({
        title: '新建档案',
        body: `<div class="fgrid">
            ${fld('姓名 / 档案名', `<input class="inp" id="np-name" placeholder="如：张三 或 大二上">`)}
            ${fld('书院', `<select class="inp" id="np-col">${ZC.COLLEGES.map(c => `<option ${c === (ZC.getProfile().meta.college) ? 'selected' : ''}>${c}</option>`).join('')}</select>`)}
            ${fld('学年', `<select class="inp" id="np-year">${years.map(y => `<option ${y === ZC.currentAcademicYear() ? 'selected' : ''}>${y}</option>`).join('')}</select>`)}
            ${fld('初始数据', `<label class="chk"><input type="checkbox" id="np-copy" checked><span class="chk__box"></span><span>从当前档案复制（新学年沿用个人信息与规则口径）</span></label>`)}
          </div>`,
        actions: `<button class="btn" data-close="1">取消</button><button class="btn btn--primary" data-ok="1">创建</button>`,
        onOk(root) {
          const name = root.querySelector('#np-name').value.trim() || '新档案';
          const col = root.querySelector('#np-col').value;
          const year = root.querySelector('#np-year').value;
          const copy = root.querySelector('#np-copy').checked ? ZC.getProfile() : null;
          ZC.addProfile(name, col, year, copy);
          ZC.rerender(); ui.toast('已创建并切换到新档案', 'ok');
        }
      });
    }
  };
  ZC.actions['prof-new'] = () => V.settings.newProfile();
})();

/* =========================================================================
 * views-core.js —— 仪表盘 / 品行素质分 / 能力拓展分 / 奖励分 / 综合成绩
 * ========================================================================= */
(function () {
  const ZC = window.ZC;
  const ui = ZC.ui, esc = ZC.esc, fmt = ZC.fmt;
  const V = (ZC.views = ZC.views || {});

  /* ------------------------------------------------- 公共：条目卡片壳 */
  function entry(o) {
    const cls = ['ent'];
    if (o.counted === false) cls.push('ent--off');
    if (o.blocked) cls.push('ent--blocked');
    return `<article class="${cls.join(' ')}">
      <div class="ent__hd">
        <div class="ent__ti">${o.title || ''}${o.badges || ''}</div>
        <div class="ent__pt ${o.counted === false ? 'is-off' : ''}">${o.points}</div>
      </div>
      ${o.note ? `<div class="ent__note">${o.note}</div>` : ''}
      <div class="ent__bd">${o.body || ''}</div>
      <div class="ent__ft">
        <div class="ent__st">${o.status || ''}</div>
        <div class="ent__ops">${o.ops || ''}</div>
      </div>
    </article>`;
  }
  const ops = (path, i) => `${ui.ibtn('dup', 'copy', { arg: `${path}|${i}`, title: '复制一条' })}${ui.ibtn('del', 'trash', { arg: `${path}|${i}`, title: '删除', cls: 'ibtn--danger' })}`;
  const fld = (label, control) => `<div class="fld"><label class="fld__l">${label}</label>${control}</div>`;

  function pointsTag(v, counted, reason) {
    const t = counted === false ? '未计入' : (v > 0 ? '+' + fmt(v) : fmt(v));
    return `<span class="pt ${counted === false ? 'pt--off' : v > 0 ? 'pt--on' : ''}" ${reason ? `title="${esc(reason)}"` : ''}>${t}</span>`;
  }

  /* 封顶进度小卡 */
  function capChip(label, raw, final, cap) {
    const over = raw > cap + 1e-9;
    return `<div class="chip ${over ? 'chip--over' : ''}" title="${over ? `原始合计 ${fmt(raw)} 分，超出上限部分不计入` : `上限 ${fmt(cap)} 分`}">
      <span class="chip__l">${label}</span>
      <span class="chip__v">${fmt(final)}<i>/${fmt(cap)}</i></span>
      ${ui.bar(final, cap, { cls: 'bar--xs' })}
      ${over ? `<span class="chip__w">溢出 ${fmt(ZC.r2(raw - cap))} 分不计</span>` : ''}
    </div>`;
  }

  /* ==================================================================
   * 仪表盘
   * ================================================================== */
  V.dashboard = {
    render(ctx) {
      const { p, R, res, insights } = ctx;
      const H = res.headroom;
      const target = +p.target.score || 0;
      const f = ZC.state.ui.tipsFilter || 'all';
      const shown = f === 'all' ? insights : insights.filter(i => i.level === f);
      const counts = { all: insights.length, danger: 0, warn: 0, good: 0, info: 0 };
      insights.forEach(i => counts[i.level]++);
      const rec = ZC.recommend(p, R, res).slice(0, 6);

      /* --- 主卡 --- */
      const hero = `<section class="hero">
        <div class="hero__l">
          ${ui.ring(res.total, res.maxTotal, '综合素质测评成绩', '/ ' + res.maxTotal)}
          <div class="hero__meta">
            <div class="hero__nm">${esc(p.meta.name)}</div>
            <div class="hero__sub">${esc(p.meta.college)} · ${esc(p.meta.academicYear)} 学年${p.meta.grade ? ' · ' + esc(p.meta.grade) : ''}</div>
            <div class="hero__goal">
              <label>目标分</label>${ui.num('target.score', p.target.score, { ph: '如 92', width: '78px' })}
              ${target ? `<span class="hero__gap ${res.total >= target ? 'is-pos' : 'is-neg'}">${res.total >= target ? '已达成 +' + fmt(ZC.r2(res.total - target)) : '还差 ' + fmt(ZC.r2(target - res.total))}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="hero__r">
          ${segCard('品行素质分', res.pinxing.final, R.frame.pinxing, 'pinxing', [
            ['基准分', res.pinxing.base], ['集体活动', res.pinxing.subs.collective.final],
            ['思政学习', res.pinxing.subs.ideology.final], ['社会服务', res.pinxing.subs.service.final],
            ['扣分', res.pinxing.deduction ? '−' + fmt(res.pinxing.deduction) : '0']
          ])}
          ${segCard('能力拓展分', res.ability.final, R.frame.ability, 'ability', [
            ['学术科研', res.ability.subs.academic.final], ['文体竞赛', res.ability.subs.culture.final], ['组织任职', res.ability.subs.position.final]
          ])}
          ${segCard('奖励分', res.reward.final, R.reward.cap, 'reward', [['荣誉/好事', res.reward.final]])}
        </div>
      </section>`;

      /* --- 综合成绩 --- */
      const cp = res.composite;
      const compCard = ui.card(
        `综合成绩 <span class="tagline">${esc(cp.preset.name)}</span>`,
        `<div class="comp">
          <div class="comp__v ${cp.incomplete ? 'is-part' : ''}">${fmt(cp.total)}${cp.incomplete ? '<em>部分成绩未填</em>' : ''}</div>
          <div class="comp__f">${cp.parts.map(x => `<span class="${x.filled ? '' : 'is-empty'}">${esc(x.label)} <b>${x.filled ? fmt(x.value) : '—'}</b> × ${Math.round(x.weight * 100)}%</span>`).join('<i>+</i>')}</div>
          <div class="comp__note">综测每 +1 分 → 综合成绩 +${fmt(cp.sensitivity)} 分。
            <a href="#/composite" data-nav="composite">去设置口径与资格自检 ${ui.icon('right', 12)}</a></div>
        </div>`,
        { icon: 'calc', sub: esc(cp.preset.desc), actions: `<button class="lbtn" data-act="goto" data-arg="composite">详情</button>` }
      );

      /* --- 提示 --- */
      const tips = ui.card('温馨提示与风险预警',
        `<div class="tips">
          <div class="tips__f">
            ${[['all', '全部'], ['danger', '风险'], ['warn', '待办'], ['good', '机会'], ['info', '规则']].map(([k, l]) =>
              `<button class="fbtn ${f === k ? 'on' : ''}" data-act="tips-filter" data-arg="${k}">${l}${counts[k] ? `<b>${counts[k]}</b>` : ''}</button>`).join('')}
          </div>
          ${shown.length ? shown.map(t => `<div class="tip tip--${t.level}">
              <span class="tip__i">${t.icon}</span>
              <div class="tip__b"><h4>${esc(t.title)}${t.tag ? `<span class="tip__tag">${esc(t.tag)}</span>` : ''}</h4><p>${t.body}</p></div>
              ${t.cta ? `<a class="tip__go" href="#/${t.cta}" data-nav="${t.cta}">去处理${ui.icon('right', 12)}</a>` : ''}
            </div>`).join('') : '<div class="empty-sm">该分类下暂无提示</div>'}
        </div>`,
        { icon: 'bulb', sub: '基于你当前录入的数据、校级办法与所选书院口径自动生成' });

      /* --- 下一步 --- */
      const next = ui.card('下一步：投入产出比最高的 6 件事',
        rec.length ? `<ol class="rec">
          ${rec.map(x => `<li>
            <span class="rec__g">+${fmt(x.gain)}</span>
            <span class="rec__b"><b>${esc(x.label)}</b><em>投入${ZC.EFFORT_LABEL[x.effort]}（约 ${x.hours} 小时） · ${esc(x.note || '剩余空间内')}${x.cap ? ' · 计入' + capName(x.cap) : ''}</em></span>
            <span class="rec__r" title="每 100 小时投入可换取的分值">${fmt(x.roi * 100)} 分/100h</span>
          </li>`).join('')}
        </ol><p class="rec__n">投入小时数为经验估计，仅用于排序参考；实际收益受你所在书院细则、名额与认定结果影响。</p>`
          : ui.empty('star', '各项均已拿满', '在当前规则口径下已无可提升空间。'),
        { icon: 'trend', sub: '按"剩余空间 × 单位投入产出"自动排序' });

      /* --- 计算过程 --- */
      const trace = ui.card('计算过程（可逐行核对）',
        `<div class="trace">${res.trace.map(t => `<div class="trace__r trace__r--${t.indent}">
            <span class="trace__l">${esc(t.label)}</span>
            <span class="trace__n">${esc(t.note || '')}</span>
            <span class="trace__v">${esc(t.value)}</span></div>`).join('')}
          <div class="trace__r trace__r--sum"><span class="trace__l">综合素质测评成绩</span><span class="trace__n">满分 ${res.maxTotal}</span><span class="trace__v">${fmt(res.total)}</span></div>
        </div>
        ${res.merged.length ? `<div class="callout callout--info"><b>触发的合并/取最高规则：</b><ul>${res.merged.map(m => `<li>${esc(m.cat)}「${esc(m.name)}」少计 ${m.dropped} 分 — ${esc(m.reason)}</li>`).join('')}</ul></div>` : ''}
        ${res.blocked.length ? `<div class="callout callout--danger"><b>不予认定的成果：</b><ul>${res.blocked.map(m => `<li>${esc(m.label)} — ${esc(m.reason)}</li>`).join('')}</ul></div>` : ''}`,
        { icon: 'list', actions: `<button class="lbtn" data-act="copy-md">${ui.icon('copy', 13)} 复制自评表</button>` });

      /* --- 剩余空间 --- */
      const space = ui.card('还能拿多少分',
        `<div class="chips">
          ${capChip('集体活动', res.pinxing.subs.collective.raw, res.pinxing.subs.collective.final, R.pinxing.caps.collective)}
          ${capChip('思政学习', res.pinxing.subs.ideology.raw, res.pinxing.subs.ideology.final, R.pinxing.caps.ideology)}
          ${capChip('社会服务', res.pinxing.subs.service.raw, res.pinxing.subs.service.final, R.pinxing.caps.service)}
          ${capChip('学术科研', res.ability.subs.academic.raw, res.ability.subs.academic.final, R.ability.caps.academic)}
          ${capChip('文体竞赛', res.ability.subs.culture.raw, res.ability.subs.culture.final, R.ability.caps.culture)}
          ${capChip('组织任职', res.ability.subs.position.raw, res.ability.subs.position.final, R.ability.caps.position)}
          ${capChip('奖励分', res.reward.raw, res.reward.final, R.reward.cap)}
        </div>
        <div class="space__sum">理论上限还可提升 <b>${fmt(H.total)}</b> 分（不含扣分风险）</div>`,
        { icon: 'target', sub: '每个分项都有封顶，超出部分不计入——先补没满的' });

      /* --- 快捷入口 --- */
      const quick = `<div class="quick">
        ${[['pinxing', 'shield', '录入品行加分/扣分'], ['ability', 'rocket', '录入竞赛·论文·任职'], ['reward', 'award', '录入荣誉表彰'],
           ['materials', 'folder', '整理佐证材料'], ['simulate', 'flask', '如果再加一项会怎样'], ['procedure', 'clock', '公示与申诉时效']].map(([v, i, l]) =>
          `<a class="quick__i" href="#/${v}" data-nav="${v}">${ui.icon(i, 17)}<span>${l}</span></a>`).join('')}
      </div>`;

      return `<div class="page">
        <div class="page__hd"><h1>仪表盘</h1><p>${esc(p.meta.academicYear)} 学年综测总览 · 数据实时保存在本机浏览器</p></div>
        ${p.notes ? `<div class="callout callout--muted">${esc(p.notes)}</div>` : ''}
        ${hero}
        <div class="grid2">
          <div class="col">${tips}${trace}${space}</div>
          <div class="col">${compCard}${next}${ui.card('快速开始', quick, { icon: 'rocket' })}</div>
        </div>
      </div>`;
    }
  };
  function capName(c) {
    return { collective: '集体活动分', ideology: '思政学习分', service: '社会服务分', academic: '学术科研', culture: '文体竞赛', position: '组织任职', reward: '奖励分' }[c] || c;
  }
  function segCard(title, val, max, view, rows) {
    return `<a class="seg" href="#/${view}" data-nav="${view}">
      <div class="seg__hd"><span>${title}</span><b>${fmt(val)}<i>/${max}</i></b></div>
      ${ui.bar(val, max)}
      <div class="seg__rows">${rows.map(r => `<span>${r[0]}<b>${typeof r[1] === 'string' ? r[1] : fmt(r[1])}</b></span>`).join('')}</div>
    </a>`;
  }

  /* ==================================================================
   * 品行素质分
   * ================================================================== */
  V.pinxing = {
    render(ctx) {
      const { p, R, res } = ctx;
      const PX = R.pinxing, s = res.pinxing.subs;
      const per = PX.collective.perTime;

      /* 基准分 */
      const baseCard = ui.card('基准分',
        `<div class="base">
          <label class="switch">
            <input type="checkbox" data-k="meta.assessPass" data-t="bool" ${p.meta.assessPass ? 'checked' : ''}>
            <span class="switch__t"></span>
            <span class="switch__l">班级评议小组评议合格，且书院审定通过</span>
          </label>
          <div class="base__v ${p.meta.assessPass ? 'is-on' : 'is-off'}">${p.meta.assessPass ? fmt(res.pinxing.base) + ' 分' : '0 分'}</div>
        </div>
        <p class="hint">基准分是品行素质分的主体（占 ${fmt(PX.base)}/${R.frame.pinxing}）。未通过评议将直接失去这部分分值，同时通常也意味着取消当年评奖评优资格。</p>`,
        { icon: 'shield' });

      /* 集体活动 */
      const col = p.pinxing.collective;
      const colBody = `
        ${capChip('集体活动分', s.collective.raw, s.collective.final, PX.caps.collective)}
        <div class="rowset">
          ${fld('单次参与分值（书院口径）', `<div class="inline">${ui.num('ruleOverride.pinxing.collective.perTime', per, { width: '86px', step: '0.1', min: 0 })}<span class="unit">分 / 次</span></div>`,
            `<button class="lbtn" data-act="rule" data-arg="collective">查看原文</button> · 校级办法未统一规定，由各书（学）院自行认定。0.6 为彭康书院细化口径。`)}
          <label class="chk chk--wide"><input type="checkbox" data-k="pinxing.collective.outstanding" data-t="bool" ${col.outstanding ? 'checked' : ''}><span class="chk__box"></span><span>对集体荣誉作出突出贡献，经书院认定 → 一次性满分 ${fmt(PX.collective.outstandingFull)} 分</span></label>
        </div>
        <div class="list">
          ${(col.entries || []).map((e, i) => {
            const k = `pinxing.collective.entries[${i}]`;
            const pts = ZC.r2((+e.times || 0) * per);
            return entry({
              title: esc(e.name || '未命名活动'),
              badges: pts > s.collective.cap ? '' : '',
              points: pointsTag(pts, null, `${e.times || 0} 次 × ${fmt(per)}`),
              body: `<div class="fgrid">
                ${fld('活动名称', ui.txt(k + '.name', e.name, { ph: '如：书院迎新晚会' }))}
                ${fld('参与次数', ui.num(k + '.times', e.times, { width: '76px', min: 0, step: 1 }))}
                ${fld('日期', ui.date(k + '.date', e.date))}
                ${fld('佐证材料', ui.txt(k + '.evidence', e.evidence, { ph: '主办单位名单 / 证明' }))}
              </div>`,
              status: ui.statusSel(k + '.status', e.status),
              ops: ops('pinxing.collective.entries', i)
            });
          }).join('') || ui.empty('folder', '还没有集体活动记录', '学校及书（学）院主办或发起的重大活动才可计入，需以主办单位名单/证明为依据。')}
        </div>`;
      const colCard = ui.card('集体活动分', colBody, {
        icon: 'users', sub: `上限 ${fmt(PX.caps.collective)} 分`,
        actions: ui.btn('添加活动', 'add', { arg: 'collective|collective', icon: 'plus', cls: 'btn--sm btn--primary' })
      });

      /* 思想政治理论学习 */
      const ID = p.pinxing.ideology, IDR = PX.ideology;
      const idCard = ui.card('思想政治理论学习分',
        `${capChip('思政学习分', s.ideology.raw, s.ideology.final, PX.caps.ideology)}
        <div class="steppers">
          ${stepper('pinxing.ideology.orgTraining', ID.orgTraining, `各级党团组织理论学习培训（含网络学习）`, `+${fmt(IDR.orgTraining)}/次`)}
          ${stepper('pinxing.ideology.provincialTraining', ID.provincialTraining, `省、部级理论学习培训`, `+${fmt(IDR.provincialTraining)}/次`)}
          ${stepper('pinxing.ideology.excellentTrainee', ID.excellentTrainee, `培训获"优秀学员"称号`, `额外 +${fmt(IDR.excellentTrainee)}`)}
        </div>
        <p class="hint">三项可叠加，合计封顶 ${fmt(PX.caps.ideology)} 分。网络学习是成本最低的入口。</p>`,
        { icon: 'book', sub: `上限 ${fmt(PX.caps.ideology)} 分` });

      /* 社会服务 */
      const SV = p.pinxing.service, SR = PX.service;
      const hours = +SV.volunteerHours || 0;
      const volPct = Math.min(100, hours / SR.volunteerHours * 100);
      const volItem = s.service.items.find(i => String(i.label).indexOf('志愿服务') === 0);
      const volPts = volItem ? volItem.points : 0;
      const svCard = ui.card('社会服务分',
        `${capChip('社会服务分', s.service.raw, s.service.final, PX.caps.service)}
        <div class="vol">
          <div class="vol__hd"><span>志愿服务时长</span><b>${fmt(hours)} <i>/ ${SR.volunteerHours} 小时</i></b></div>
          <div class="bar bar--lg"><i style="width:${volPct.toFixed(1)}%"></i></div>
          <div class="vol__ft">
            ${ui.num('pinxing.service.volunteerHours', SV.volunteerHours, { width: '96px', min: 0, step: '0.5', ph: '小时' })}
            <span class="muted">当前计 ${fmt(volPts)} 分</span>
            <span class="muted">时长证明</span>${ui.statusSel('pinxing.service.volunteerStatus', SV.volunteerStatus || 'todo')}
            ${hours >= SR.volunteerHours ? ui.badge('已达标', 'ok') : ui.badge(`还差 ${fmt(ZC.r2(SR.volunteerHours - hours))} 小时`, 'warn')}
            <button class="lbtn" data-act="rule" data-arg="volunteer">口径说明</button>
          </div>
        </div>
        <div class="steppers">
          ${stepper('pinxing.service.schoolPractice', SV.schoolPractice, '校级社会实践（考核合格的团队成员）', `+${fmt(SR.schoolPractice)}/项`)}
          ${stepper('pinxing.service.cityIntern', SV.cityIntern, '市、县级挂职锻炼及政府见习', `+${fmt(SR.cityIntern)}/项`)}
          ${stepper('pinxing.service.provIntern', SV.provIntern, '省、部级挂职锻炼及政府见习 / 国际组织见习', `+${fmt(SR.provIntern)}/项`)}
          ${stepper('pinxing.service.advanced', SV.advanced, '获先进个人及表彰（额外）', `额外 +${fmt(SR.advanced)}`)}
        </div>
        <p class="hint">各项可累计，合计封顶 ${fmt(PX.caps.service)} 分。志愿服务不足 ${SR.volunteerHours} 小时按比例计分，${SR.volunteerHours} 小时以上不再加分。</p>`,
        { icon: 'pin', sub: `上限 ${fmt(PX.caps.service)} 分` });

      /* 扣分 */
      const ded = p.pinxing.deductions || [];
      const dedCard = ui.card('品行素质扣分',
        `<div class="callout callout--danger">
          <b>${ui.icon('alert', 15)} 扣分不设上限，直接从品行素质分中扣除。</b>
          当前累计 <b class="big">−${fmt(res.pinxing.deduction)}</b> 分。
          ${res.pinxing.deduction > 0 ? `这相当于抹掉 ${fmt(res.pinxing.deduction)} 分的加分成果。` : '暂无扣分，保持住。'}
        </div>
        <div class="dedsum">${PX.deduction.types.map(t => `<span class="dedsum__i" title="${esc(t.label)}：每次 −${t.per} 分">${esc(t.label)} <b>−${t.per}</b></span>`).join('')}</div>
        <div class="list">
          ${ded.map((d, i) => {
            const k = `pinxing.deductions[${i}]`;
            const t = PX.deduction.types.find(x => x.id === d.type) || { label: '其他', per: 1, unit: '次' };
            const per2 = d.type === 'other' ? (+d.customPer || 0) : t.per;
            return entry({
              title: esc(t.label) + ((+d.count || 1) > 1 ? ` × ${d.count}` : ''),
              points: `<span class="pt pt--neg">−${fmt(ZC.r2(per2 * (+d.count || 1)))}</span>`,
              body: `<div class="fgrid">
                ${fld('类型', ui.sel(k + '.type', d.type, PX.deduction.types.map(x => ({ id: x.id, label: x.label }))))}
                ${fld('次数', ui.num(k + '.count', d.count, { width: '76px', min: 1, step: 1 }))}
                ${fld('发生日期', ui.date(k + '.date', d.date))}
                ${fld('说明 / 备注', ui.txt(k + '.note', d.note, { ph: '如：10 月宿舍卫生检查' }))}
                ${d.type === 'other' ? fld('单次扣分', ui.num(k + '.customPer', d.customPer, { width: '86px', min: 0, step: 0.5 })) : ''}
              </div>
              ${['jinggao', 'yanzhong', 'jiguo', 'liuxiao'].includes(d.type) ? '<div class="callout callout--danger callout--sm">纪律处分将取消当年度奖学金参评资格，并通常取消表彰奖励参评资格。</div>' : ''}
              ${d.type === 'weisheng' ? '<div class="callout callout--warn callout--sm">宿舍卫生不合格为"宿舍每人每次 −1"，全宿舍共同承担。</div>' : ''}`,
              status: ui.statusSel(k + '.status', d.status),
              ops: ops('pinxing.deductions', i)
            });
          }).join('') || ui.empty('check', '没有扣分记录', '旷课 −1/次、宿舍卫生 −1/人·次、通报批评 −2/次、警告及以上 −4~−10/次。这些"小事"是排名落差的主要来源。')}
        </div>`,
        {
          icon: 'alert', sub: '不设上限 · 从基准分中扣除',
          actions: `<div class="btns">${PX.deduction.types.slice(0, 4).map(t => ui.btn(t.label, 'add', { arg: 'deduction|' + t.id, cls: 'btn--sm', icon: 'plus' })).join('')}
            <select class="inp inp--sm" data-act-select="deduction">${PX.deduction.types.map(t => `<option value="${t.id}">+ ${esc(t.label)}</option>`).join('')}</select></div>`
        });

      return `<div class="page">
        <div class="page__hd"><h1>品行素质分</h1><p>满分 ${R.frame.pinxing} 分 = 基准分 ${fmt(PX.base)} + 集体活动 ≤${fmt(PX.caps.collective)} + 思政学习 ≤${fmt(PX.caps.ideology)} + 社会服务 ≤${fmt(PX.caps.service)} − 扣分（不设上限）</p>
          <div class="page__score"><b>${fmt(res.pinxing.final)}</b><span>/ ${R.frame.pinxing}</span></div></div>
        ${baseCard}${colCard}${idCard}${svCard}${dedCard}
      </div>`;
    },
    after() {
      // 扣分类型快捷下拉
      const sel = document.querySelector('[data-act-select="deduction"]');
      if (sel && !sel._b) {
        sel._b = true;
        sel.addEventListener('change', () => { ZC.actions.add('deduction|' + sel.value); });
      }
    }
  };

  function stepper(k, val, label, unit) {
    const v = +val || 0;
    return `<div class="step">
      <div class="step__l"><b>${label}</b><span>${unit}</span></div>
      <div class="step__c">
        <button class="sbtn" data-act="step" data-arg="${k}|-1" title="减少">${ui.icon('minus', 14)}</button>
        <input class="inp inp--c" type="number" data-k="${k}" data-t="num" min="0" step="1" value="${v}">
        <button class="sbtn" data-act="step" data-arg="${k}|1" title="增加">${ui.icon('plus', 14)}</button>
      </div>
    </div>`;
  }
  ZC.actions.step = function (arg) {
    const [k, d] = arg.split('|');
    const p = ZC.getProfile();
    ZC.snapshot('调整计数');
    const cur = +ZC.getPath(p, k) || 0;
    ZC.setPath(p, k, Math.max(0, cur + (+d)));
    ZC.save(); ZC.rerender();
  };

  /* ==================================================================
   * 能力拓展分
   * ================================================================== */
  V.ability = {
    render(ctx) {
      const { p, R, res } = ctx;
      const AB = R.ability, s = res.ability.subs;

      /* ---------- 学术科研 ---------- */
      const compLevels = AB.competition.levels;
      const acad = (p.ability.academic || []).map((it, i) => {
        const r = s.academic.items.find(x => x.id === it.id) || {};
        const k = `ability.academic[${i}]`;
        const kindLabel = { competition: '竞赛获奖', paper: '论文', patent: '专利', book: '专著' }[it.kind] || '成果';
        let body = '';
        if (it.kind === 'competition') {
          const lv = compLevels.find(l => l.id === it.level);
          const awards = lv ? Object.keys(lv.awards) : [];
          body = `<div class="fgrid">
            ${fld('项目 / 竞赛名称', ui.txt(k + '.project', it.project, { ph: '同一项目名会自动合并取最高' }))}
            ${fld('级别', ui.sel(k + '.level', it.level, compLevels.map(l => ({ id: l.id, label: l.label }))))}
            ${fld('奖项', ui.sel(k + '.award', it.award, awards))}
            ${fld('获奖日期', ui.date(k + '.date', it.date))}
            ${fld('佐证材料', ui.txt(k + '.evidence', it.evidence, { ph: '证书编号 / 扫描件' }))}
            ${fld('同一项目分组', ui.txt(k + '.group', it.group, { ph: '留空=按项目名自动分组' }))}
          </div>`;
        } else {
          const cls = it.kind === 'patent'
            ? Object.keys(AB.publication.patentMap).map(t => ({ id: t, label: t + '（' + (AB.publication.patentMap[t] === 'i' ? 'i 类' : 'ii 类') + '）' }))
            : AB.publication.classes.filter(c => it.kind === 'book' ? c.id === 'book' : c.id !== 'book').map(c => ({ id: c.id, label: c.label }));
          const key = it.kind === 'patent' ? k + '.patentType' : k + '.pubClass';
          const val = it.kind === 'patent' ? it.patentType : it.pubClass;
          body = `<div class="fgrid">
            ${fld(it.kind === 'book' ? '书名' : '成果名称', ui.txt(k + '.name', it.name, { ph: it.kind === 'paper' ? '论文题目' : it.kind === 'patent' ? '专利/软著名称' : '专著名称' }))}
            ${fld(it.kind === 'patent' ? '专利类型' : '成果类别', ui.sel(key, val, cls))}
            ${fld(it.isEditor && it.kind === 'book' ? '身份（参编）' : '署名位次', it.kind === 'book' && it.isEditor
              ? `<div class="inline">${ui.chk(k + '.isEditor', true, '参编（+' + fmt(AB.publication.classes.find(c => c.id === 'book').editor) + ' 分）')}</div>`
              : ui.num(k + '.rank', it.rank, { width: '86px', min: 1, step: 1 }))}
            ${fld('第一署名单位', ui.txt(k + '.signUnit', it.signUnit, { ph: '须为 西安交通大学' }))}
            ${fld('日期', ui.date(k + '.date', it.date))}
            ${fld('佐证材料', ui.txt(k + '.evidence', it.evidence, { ph: '录用通知 / 证书号' }))}
          </div>
          <div class="rowset">
            ${it.kind === 'book' && !it.isEditor ? `<label class="chk"><input type="checkbox" data-k="${k}.isEditor" data-t="bool" ${it.isEditor ? 'checked' : ''}><span class="chk__box"></span><span>我是参编（非署名作者）</span></label>` : ''}
            ${it.kind === 'paper' ? `<label class="chk"><input type="checkbox" data-k="${k}.excellentPaper" data-t="bool" ${it.excellentPaper ? 'checked' : ''}><span class="chk__box"></span><span>会议入围优秀论文（额外 +${fmt(AB.publication.excellentPaperBonus)}）</span></label>` : ''}
          </div>`;
        }
        return entry({
          title: esc(it.project || it.name || '未命名成果'),
          badges: `${ui.badge(kindLabel, 'muted')}${r._merged ? ui.badge(r._counted ? '同项目取最高·已计入' : `同项目取最高·未计入`, r._counted ? 'info' : 'warn') : ''}${r._blocked ? ui.badge('署名不符', 'danger') : ''}`,
          points: pointsTag(r._pts || 0, r._blocked ? false : r._counted, r._reason),
          note: r._reason ? `<span class="rsn">${esc(r._reason)}</span>` : '',
          body, status: ui.statusSel(k + '.status', it.status), ops: ops('ability.academic', i)
        });
      }).join('');

      const acadCard = ui.card('学术科研及创新创业',
        `${capChip('学术科研', s.academic.raw, s.academic.final, AB.caps.academic)}
        <div class="tbl-wrap"><table class="tbl tbl--sm">
          <thead><tr><th>竞赛级别</th><th>一等奖</th><th>二等奖</th><th>三等奖</th><th>优秀奖</th></tr></thead>
          <tbody>${compLevels.map(l => `<tr><td class="tl">${esc(l.label)}</td>${['一等奖', '二等奖', '三等奖', '优秀奖'].map(a => `<td>${l.awards[a] === undefined ? '<span class="na">—</span>' : fmt(l.awards[a])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <p class="hint">${esc(AB.competition.note)}　<button class="lbtn" data-act="rule" data-arg="dedup">同一项目取最高</button>　<button class="lbtn" data-act="rule" data-arg="sign">署名单位要求</button></p>
        <div class="list">${acad || ui.empty('folder', '还没有学术成果', '竞赛获奖、论文、专利、专著都可录入。同一项目获不同奖项不累计、取最高；不同项目可累计。')}</div>`,
        {
          icon: 'flask', sub: `上限 ${fmt(AB.caps.academic)} 分 · 特等奖参照一等奖`,
          actions: `<div class="btns">
            ${ui.btn('竞赛获奖', 'add', { arg: 'academic|academic-comp', cls: 'btn--sm btn--primary', icon: 'plus' })}
            ${ui.btn('论文', 'add', { arg: 'academic|academic-paper', cls: 'btn--sm', icon: 'plus' })}
            ${ui.btn('专利/软著', 'add', { arg: 'academic|academic-patent', cls: 'btn--sm', icon: 'plus' })}
            ${ui.btn('专著', 'add', { arg: 'academic|academic-book', cls: 'btn--sm', icon: 'plus' })}</div>`
        });

      /* ---------- 文体竞赛 ---------- */
      const cul = (p.ability.culture || []).map((it, i) => {
        const r = s.culture.items.find(x => x.id === it.id) || {};
        const k = `ability.culture[${i}]`;
        const tbl = it.kind === 'sport' ? AB.sport : AB.art;
        const lv = tbl.levels.find(l => l.id === it.level);
        return entry({
          title: esc(it.name || '未命名项目'),
          badges: `${ui.badge(it.kind === 'sport' ? '体育' : '文艺', it.kind === 'sport' ? 'info' : 'muted')}${r._merged ? ui.badge(r._counted ? '同项目取最高·已计入' : '同项目取最高·未计入', r._counted ? 'info' : 'warn') : ''}${it.record ? ui.badge('破纪录', 'ok') : ''}`,
          points: pointsTag(r._pts || 0, r._counted, r._reason),
          note: `<span class="rsn">${esc(r._reason || '')}</span>`,
          body: `<div class="fgrid">
            ${fld('项目名称', ui.txt(k + '.name', it.name, { ph: '同一项目名自动合并取最高' }))}
            ${fld('类别', ui.sel(k + '.kind', it.kind, [{ id: 'art', label: '文艺比赛' }, { id: 'sport', label: '体育竞赛' }]))}
            ${fld('级别', ui.sel(k + '.level', it.level, tbl.levels.map(l => ({ id: l.id, label: l.label }))))}
            ${fld(it.kind === 'sport' ? '名次' : '奖项', ui.sel(k + '.award', it.award, lv ? Object.keys(lv.awards) : []))}
            ${fld('日期', ui.date(k + '.date', it.date))}
            ${fld('佐证材料', ui.txt(k + '.evidence', it.evidence, { ph: '证书 / 秩序册' }))}
          </div>
          <div class="rowset">
            <label class="chk"><input type="checkbox" data-k="${k}.record" data-t="bool" ${it.record ? 'checked' : ''}><span class="chk__box"></span>
            <span>破纪录（省级及以上 +${fmt(AB.sport.record.provincialOrAbove)} / 校级 +${fmt(AB.sport.record.school)}，按所选级别自动判定）</span></label>
          </div>`,
          status: ui.statusSel(k + '.status', it.status), ops: ops('ability.culture', i)
        });
      }).join('');

      const culCard = ui.card('文体竞赛',
        `${capChip('文体竞赛', s.culture.raw, s.culture.final, AB.caps.culture)}
        <div class="tbl2">
          <div class="tbl-wrap"><h4>文艺比赛</h4><table class="tbl tbl--sm"><thead><tr><th>级别</th><th>一等</th><th>二等</th><th>三等</th><th>优秀</th></tr></thead>
            <tbody>${AB.art.levels.map(l => `<tr><td class="tl">${esc(l.label)}</td>${['一等奖', '二等奖', '三等奖', '优秀奖'].map(a => `<td>${l.awards[a] === undefined ? '<span class="na">—</span>' : fmt(l.awards[a])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <div class="tbl-wrap"><h4>体育竞赛</h4><table class="tbl tbl--sm"><thead><tr><th>级别</th><th>第1名</th><th>第2名</th><th>第3名</th><th>第4—8名</th></tr></thead>
            <tbody>${AB.sport.levels.map(l => `<tr><td class="tl">${esc(l.label)}</td>${['第1名', '第2名', '第3名', '第4—8名'].map(a => `<td>${l.awards[a] === undefined ? '<span class="na">—</span>' : fmt(l.awards[a])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        </div>
        <div class="list">${cul || ui.empty('folder', '还没有文体竞赛记录', '校级文艺三等奖 +1、校级体育第4—8名 +0.5 是门槛最低的入口；破省级及以上纪录另 +5。')}</div>`,
        {
          icon: 'star', sub: `上限 ${fmt(AB.caps.culture)} 分 · 破省级及以上纪录 +${fmt(AB.sport.record.provincialOrAbove)}、破校级纪录 +${fmt(AB.sport.record.school)}`,
          actions: `<div class="btns">${ui.btn('文艺比赛', 'add', { arg: 'culture|culture-art', cls: 'btn--sm btn--primary', icon: 'plus' })}${ui.btn('体育竞赛', 'add', { arg: 'culture|culture-sport', cls: 'btn--sm', icon: 'plus' })}</div>`
        });

      /* ---------- 任职 ---------- */
      const PT = AB.position.partialTerm;
      const pos = (p.ability.position || []).map((it, i) => {
        const r = s.position.items.find(x => x.id === it.id) || {};
        const k = `ability.position[${i}]`;
        const tier = AB.position.tiers.find(t => t.id === it.tier);
        return entry({
          title: `${esc(it.org || '未填组织')} <span class="role">${esc(it.role || '未填职务')}</span>`,
          badges: `${ui.badge(tier ? '第' + tier.id.slice(1) + '档' : '未选档', 'muted')}${r._counted ? ui.badge('计入（最高）', 'ok') : (p.ability.position.length > 1 ? ui.badge('兼任取最高·未计入', 'warn') : '')}${r._months !== null && r._months < 12 ? ui.badge('任期不满一年', 'warn') : ''}`,
          points: pointsTag(r._pts || 0, r._counted, r._reason),
          note: `<span class="rsn">${esc(r._reason || '')}</span>`,
          body: `<div class="fgrid">
            ${fld('组织 / 单位', ui.txt(k + '.org', it.org, { ph: '如：彭康书院学生会' }))}
            ${fld('职务', ui.txt(k + '.role', it.role, { ph: '如：宣传部部长' }))}
            ${fld('职务档位', ui.sel(k + '.tier', it.tier, AB.position.tiers.map(t => ({ id: t.id, label: '第' + t.id.slice(1) + '档 · ' + t.label.slice(0, 26) + (t.label.length > 26 ? '…' : '') }))))}
            ${fld('考核等级', ui.sel(k + '.assessment', it.assessment, AB.position.assessments))}
            ${fld('任期开始', ui.date(k + '.startDate', it.startDate))}
            ${fld('任期结束', ui.date(k + '.endDate', it.endDate, { ph: '在职可留空' }))}
            ${fld('佐证材料', ui.txt(k + '.evidence', it.evidence, { ph: '任职文件 / 聘书' }))}
          </div>
          ${tier ? `<div class="tiervalues">该档位分值：${Object.keys(tier.values).map(a => `${a} <b>${fmt(tier.values[a])}</b>`).join(' · ')}${r._months !== null && r._months < 12 ? ` · 当前酌情系数 <b>${fmt(r._factor)}</b>（${r._months} 个月）` : ''}</div>` : ''}`,
          status: ui.statusSel(k + '.status', it.status), ops: ops('ability.position', i)
        });
      }).join('');

      const posCard = ui.card('学生组织、社团任职',
        `${capChip('组织任职', s.position.raw, s.position.final, AB.caps.position)}
        <div class="tbl-wrap"><table class="tbl tbl--sm">
          <thead><tr><th>职务档位</th><th>优</th><th>良</th><th>合格</th></tr></thead>
          <tbody>${AB.position.tiers.map(t => `<tr><td class="tl">${esc(t.label)}</td>${['优秀', '良好', '合格'].map(a => `<td>${fmt(t.values[a])}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        <div class="rowset rowset--tight">
          <span class="lbl">任期不满一年的处理口径：</span>
          ${ui.sel('ruleOverride.ability.position.partialTerm.mode', PT.mode, [
            { id: 'prorate', label: '按实际工作时间比例（月数/12）— 校级"酌情"的常见实现' },
            { id: 'half', label: '最高不超过满一年的 1/2 — 部分书院细则口径' },
            { id: 'custom', label: '自定义固定系数' },
            { id: 'none', label: '不加分（最严格口径）' }
          ], { width: 'auto' })}
          ${(PT.mode === 'half' || PT.mode === 'custom') ? `<span class="inline">系数 ${ui.num('ruleOverride.ability.position.partialTerm.custom', PT.custom, { width: '76px', min: 0, max: 1, step: 0.05 })}</span>` : ''}
          <button class="lbtn" data-act="rule" data-arg="term">查看原文</button>
        </div>
        <p class="hint">⚑ 官方原文：<b>"任期原则上要求满一年；若不满一年，根据工作时间酌情加分，最高不得超过任期满一年的加分。"</b> 也就是说，不满一年<b>不是零分</b>，而是可获酌情分。兼任多项职务按最高分计、不累加；考核不合格不加分。</p>
        <div class="list">${pos || ui.empty('folder', '还没有任职记录', '最低门槛：宿舍长（考核合格）+0.5；班长/团支书考核优秀可 +2；院级及以上学生组织正职优秀 +4。')}</div>`,
        { icon: 'users', sub: `上限 ${fmt(AB.caps.position)} 分 · 兼任取最高、不累加`, actions: ui.btn('添加任职', 'add', { arg: 'position|position', cls: 'btn--sm btn--primary', icon: 'plus' }) });

      return `<div class="page">
        <div class="page__hd"><h1>能力拓展分</h1><p>满分 ${R.frame.ability} 分 = 学术科研 ≤${fmt(AB.caps.academic)} + 文体竞赛 ≤${fmt(AB.caps.culture)} + 组织任职 ≤${fmt(AB.caps.position)}</p>
          <div class="page__score"><b>${fmt(res.ability.final)}</b><span>/ ${R.frame.ability}</span></div></div>
        ${acadCard}${culCard}${posCard}
      </div>`;
    }
  };

  /* ==================================================================
   * 奖励分
   * ================================================================== */
  V.reward = {
    render(ctx) {
      const { p, R, res } = ctx;
      const RW = R.reward;
      const items = (p.reward.items || []).map((it, i) => {
        const r = res.reward.items[i] || {};
        const k = `reward.items[${i}]`;
        const cat = RW.categories.find(c => c.id === it.category) || RW.categories[0];
        return entry({
          title: esc(it.name || cat.label),
          badges: ui.badge(cat.label, 'muted'),
          points: pointsTag(r._pts || 0, null, r._reason),
          note: `<span class="rsn">${esc(r._reason || '')}</span>`,
          body: `<div class="fgrid">
            ${fld('类别', ui.sel(k + '.category', it.category, RW.categories.map(c => ({ id: c.id, label: c.label }))))}
            ${cat.mode === 'level' ? fld('表彰级别', ui.sel(k + '.level', it.level, RW.levels.map(l => ({ id: l.id, label: `${l.label}（+${l.v}）` })))) : fld('计分方式', `<div class="static">每项 +${fmt(cat.each)} 分，可累加</div>`)}
            ${fld('名称 / 事由', ui.txt(k + '.name', it.name, { ph: '如：校级三好学生 / 拾金不昧受表扬' }))}
            ${fld('日期', ui.date(k + '.date', it.date))}
            ${fld('佐证材料', ui.txt(k + '.evidence', it.evidence, { ph: '表彰文件 / 感谢信' }))}
          </div>`,
          status: ui.statusSel(k + '.status', it.status), ops: ops('reward.items', i)
        });
      }).join('');

      return `<div class="page">
        <div class="page__hd"><h1>奖励分</h1><p>满分 ${fmt(RW.cap)} 分 · 在 100 分之外额外累加，超过 ${fmt(RW.cap)} 分按 ${fmt(RW.cap)} 分计</p>
          <div class="page__score"><b>${fmt(res.reward.final)}</b><span>/ ${fmt(RW.cap)}</span></div></div>
        ${capChip('奖励分', res.reward.raw, res.reward.final, RW.cap)}
        ${ui.card('加分标准', `<div class="tbl-wrap"><table class="tbl tbl--sm">
            <thead><tr><th>类别</th>${RW.levels.map(l => `<th>${esc(l.label)}</th>`).join('')}</tr></thead>
            <tbody>${RW.categories.map(c => `<tr><td class="tl">${esc(c.label)}</td>${c.mode === 'level'
              ? RW.levels.map(l => `<td>${fmt(l.v)}</td>`).join('')
              : `<td colspan="${RW.levels.length}" class="tl">每项 +${fmt(c.each)} 分，可累加</td>`}</tr>`).join('')}</tbody>
          </table></div>`, { icon: 'award' })}
        ${ui.card('已录入的奖励', `<div class="list">${items || ui.empty('award', '还没有奖励分记录', '院级表彰 +1、校级 +2、市级 +3、省级 +4、全国 +5；做好事受表扬每项 +1。志愿服务"先进个人"也可在此计入。')}</div>`,
          { icon: 'star', actions: ui.btn('添加奖励', 'add', { arg: 'reward|reward', cls: 'btn--sm btn--primary', icon: 'plus' }) })}
      </div>`;
    }
  };

  /* ==================================================================
   * 综合成绩与资格
   * ================================================================== */
  V.composite = {
    render(ctx) {
      const { p, R, res } = ctx;
      const cp = res.composite;
      const E = R.eligibility;
      const needDeyu = cp.preset.parts.some(x => x.key === 'deyu');
      const needPe = cp.preset.parts.some(x => x.key === 'pe');

      const presetCard = ui.card('综合成绩口径',
        `<div class="fgrid fgrid--2">
          ${fld('选择口径', ui.sel('ruleOverride.composite.preset', R.composite.preset, R.composite.presets.map(x => ({ id: x.id, label: x.name })), { width: 'auto' }))}
          ${fld('综测是否折算为百分制', ui.sel('ruleOverride.composite.normalizeZongce', R.composite.normalizeZongce ? '1' : '', [{ id: '', label: '否（按原始分 0—105 直接加权）' }, { id: '1', label: '是（综测 ÷ 105 × 100 后加权）' }], { width: 'auto' }))}
        </div>
        <div class="callout callout--info callout--sm"><b>${esc(cp.preset.name)}：</b>${esc(cp.preset.desc)}<br><span class="muted">来源：${esc(cp.preset.source || '')}</span></div>
        <div class="fgrid fgrid--3">
          ${fld('课程考核 / 智育成绩（百分制）', ui.num('coursework.score', p.coursework.score, { ph: '如 86.4' }))}
          ${needDeyu ? fld('思想品德行为成绩', ui.num('coursework.deyu', p.coursework.deyu, { ph: '按书院德育积点折算' })) : ''}
          ${needPe ? fld('体育成绩', ui.num('coursework.pe', p.coursework.pe, { ph: '体育课成绩' })) : ''}
        </div>
        <div class="bigres ${cp.incomplete ? 'is-part' : ''}">
          <span>综合成绩</span><b>${fmt(cp.total)}</b>
          ${cp.incomplete ? '<em class="warn-t">部分成绩未填写，结果为估算值</em>' : ''}
        </div>
        <div class="cmp">${cp.parts.map(x => `<div class="cmp__i"><span>${esc(x.label)}</span><b>${x.filled ? fmt(x.value) : '—'}</b><em>× ${Math.round(x.weight * 100)}% = ${fmt(x.contrib)}</em></div>`).join('')}</div>
        <p class="hint">⚑ 不同用途、不同学院的权重不同：奖学金为 80/20；转专业/分流公开口径为智育 90% + 综测 10%；推免占比因学院而异（电气学院"建议 10%"、公管学院"占 10%"）；崇实书院 2015 细则为德育 20% + 课程 70% + 体育 10%。<b>务必以你所在学院/书院当年公布办法为准。</b></p>
        <div class="sens">综测每 +1 分 → 综合成绩 <b>+${fmt(cp.sensitivity)}</b> 分；综测从 ${fmt(res.total)} 提到 ${fmt(res.maxTotal)}（理论上限）可带来约 <b>+${fmt(ZC.r2((res.maxTotal - res.total) * cp.sensitivity))}</b> 分。</div>`,
        { icon: 'calc' });

      /* 资格自检 */
      const es = p.eligibility || {};
      const schFail = E.scholarship.filter(x => es.scholarship && (x.id === 'pe' ? es.scholarship.pe === false : es.scholarship[x.id])).map(x => x.label);
      const comFail = E.commend.filter(x => es.commend && es.commend[x.id]).map(x => x.label);
      const eligCard = ui.card('参评资格自检',
        `<div class="elig">
          <div class="elig__r ${schFail.length ? 'is-bad' : 'is-ok'}">
            <span class="elig__s">${schFail.length ? ui.icon('x', 20) : ui.icon('check', 20)}</span>
            <div><b>奖学金参评资格</b><p>${schFail.length ? '不通过：' + esc(schFail.join('；')) : '未发现红线情形（最终以当年评审通知为准）'}</p></div>
          </div>
          <div class="elig__r ${comFail.length ? 'is-bad' : 'is-ok'}">
            <span class="elig__s">${comFail.length ? ui.icon('x', 20) : ui.icon('check', 20)}</span>
            <div><b>表彰奖励参评资格</b><p>${comFail.length ? '不通过：' + esc(comFail.join('；')) : '未发现红线情形'}</p></div>
          </div>
        </div>
        <h4 class="sub-h">奖学金红线</h4>
        <div class="checks">
          <label class="chk chk--rev"><input type="checkbox" data-k="eligibility.scholarship.fail" data-t="bool" ${es.scholarship && es.scholarship.fail ? 'checked' : ''}><span class="chk__box"></span><span>参评学年必修课考核不及格（<b>补考、重修视同不及格</b>）</span></label>
          <label class="chk chk--rev"><input type="checkbox" data-k="eligibility.scholarship.punish" data-t="bool" ${es.scholarship && es.scholarship.punish ? 'checked' : ''}><span class="chk__box"></span><span>受到校级、院级纪律处分（含尚未解除）</span></label>
          <label class="chk"><input type="checkbox" data-k="eligibility.scholarship.pe" data-t="bool" ${!es.scholarship || es.scholarship.pe !== false ? 'checked' : ''}><span class="chk__box"></span><span>体测达标（国奖/励志通常要求<b>良好及以上</b>，校级奖学金要求<b>及格</b>）</span></label>
        </div>
        <h4 class="sub-h">表彰奖励常见取消情形</h4>
        <div class="checks">
          ${E.commend.map(x => `<label class="chk chk--rev"><input type="checkbox" data-k="eligibility.commend.${x.id}" data-t="bool" ${es.commend && es.commend[x.id] ? 'checked' : ''}><span class="chk__box"></span><span>${esc(x.label)}</span></label>`).join('')}
        </div>
        <p class="hint">具体取消情形以当年《本科生表彰奖励办法》及书院通知为准。</p>`,
        { icon: 'shield' });

      /* 奖学金档位 */
      const tiers = R.scholarshipTiers;
      const tierCard = ui.card('奖学金档位与金额（供参考）',
        `<div class="tiers">${tiers.map(t => `<div class="tier"><b>${esc(t.name)}</b><span class="tier__a">¥${t.amount.toLocaleString('zh-CN')}</span><em>体测：${esc(t.pe)}</em></div>`).join('')}</div>
        <p class="hint">具体名额比例、评定顺序与体测要求以当年奖学金评审通知为准。可切换到「班级对比」录入同学成绩，估算自己的排名区间。</p>`,
        { icon: 'award', actions: ui.btn('去班级对比', 'goto', { arg: 'class', cls: 'btn--sm' }) });

      return `<div class="page">
        <div class="page__hd"><h1>综合成绩与参评资格</h1><p>综测只是其中一环——把口径、成绩与资格红线一起算清楚</p>
          <div class="page__score"><b>${fmt(cp.total)}</b><span>综合成绩</span></div></div>
        ${presetCard}${eligCard}${tierCard}
      </div>`;
    }
  };
  })();

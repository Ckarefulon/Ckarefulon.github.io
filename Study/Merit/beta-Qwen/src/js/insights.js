/* =========================================================================
 * insights.js —— 温馨提示 / 风险预警 / 下一步行动推荐引擎
 * 输出统一结构：{ level: 'danger'|'warn'|'info'|'good', title, body, cta?, tag? }
 * ========================================================================= */
(function () {
  const ZC = window.ZC;
  const fmt = ZC.fmt;

  const L = { danger: '🔴', warn: '🟡', good: '🟢', info: 'ℹ️' };

  function mk(level, title, body, extra) {
    return Object.assign({ level, icon: L[level] || 'ℹ️', title, body }, extra || {});
  }

  /* ============================================== 主入口 */
  ZC.buildInsights = function (profile, R, res) {
    const out = [];
    const p = profile;
    const H = res.headroom;

    /* ---------- 🔴 红线与风险 ---------- */
    if (!p.meta.assessPass) {
      out.push(mk('danger', '基准分 70 分未计入', '班级评议小组评议合格 + 书院审定通过后才能获得基准分。这是全盘最大的单项分值，务必确认状态。', { cta: 'pinxing' }));
    }
    const fatalDed = res.pinxing.deductions.filter(d => d.fatal);
    if (fatalDed.length) {
      out.push(mk('danger', '存在纪律处分类扣分，可能触发"一票否决"',
        `已登记 ${fatalDed.map(d => d.label).join('、')}。受校级、院级纪律处分（含尚未解除）将取消当年度奖学金参评资格，并通常取消表彰奖励参评资格。请核实处分是否已解除、是否在参评学年内。`, { cta: 'eligibility' }));
    }
    const kua = (p.pinxing.deductions || []).filter(d => d.type === 'kuangke').reduce((s, d) => s + (+d.count || 0), 0);
    if (kua >= 3) {
      out.push(mk('danger', `旷课已累计 ${kua} 次`,
        '旷课虽为 −1/次，但累计到一定程度可能构成纪律处分（警告 −4 起），并直接触发奖学金参评资格红线。', { cta: 'pinxing' }));
    }
    if (res.pinxing.deduction > 0) {
      const equiv = res.pinxing.deduction / 4;
      out.push(mk('danger', `扣分已累计 −${fmt(res.pinxing.deduction)} 分（不设上限）`,
        `扣分直接从品行素质分中扣除，没有上限。当前扣分约等于抹掉 ${equiv >= 1 ? fmt(equiv) + ' 个校级竞赛一等奖' : fmt(res.pinxing.deduction) + ' 分加分成果'}。宿舍卫生、旷课这类"小事"是排名落差的主要来源。`, { cta: 'pinxing' }));
    }
    const blocked = res.blocked || [];
    if (blocked.length) {
      out.push(mk('danger', `${blocked.length} 项成果因署名单位不予认定`,
        blocked.map(b => `「${b.label}」：${b.reason}`).join('；') + '。参与外单位科研项目前务必提前确认署名安排。', { cta: 'ability' }));
    }

    /* ---------- 资格红线自检 ---------- */
    const sch = p.eligibility && p.eligibility.scholarship;
    if (sch && (sch.fail || sch.punish)) {
      out.push(mk('danger', '奖学金参评资格自检：不通过',
        [sch.fail ? '参评学年必修课考核不及格（补考、重修视同不及格）' : '', sch.punish ? '受到校级、院级纪律处分（含尚未解除）' : ''].filter(Boolean).join('；') + ' → 取消当年度奖学金参评资格。', { cta: 'eligibility' }));
    }

    /* ---------- 🟡 材料风险 ---------- */
    const allItems = collectAllItems(res, p);
    const risky = allItems.filter(i => i.status === 'rejected');
    const pending = allItems.filter(i => !i.status || i.status === 'none' || i.status === 'todo');
    if (risky.length) {
      out.push(mk('danger', `${risky.length} 条加分项材料被驳回`,
        risky.slice(0, 4).map(i => `「${i.label}」`).join('、') + (risky.length > 4 ? ' 等' : '') + '。请在公示期内补齐佐证材料，必要时启动异议程序。', { cta: 'materials' }));
    } else if (pending.length) {
      const pts = pending.reduce((s, i) => s + (i.points || 0), 0);
      out.push(mk('warn', `${pending.length} 条加分项尚未备好证明材料`,
        `涉及约 ${fmt(pts)} 分。竞赛证书、录用通知、专利证书、志愿服务时长证明、任职文件、主办单位名单都要归档；无佐证材料的加分在班级评议阶段极易被剔除。`, { cta: 'materials' }));
    }
    if (!p.meta.signedOff) {
      out.push(mk('warn', '尚未完成"学生核对并签字确认"', '初评结果必须由本人核对签字后才报书院工作组。签字前是你最后一次低成本纠错的机会。', { cta: 'procedure' }));
    }

    /* ---------- 申诉时效 ---------- */
    if (p.meta.publicityDate) {
      const t = ZC.appealTimeline(p.meta.publicityDate, R);
      const now = new Date();
      const d1 = t.objection;
      const days = Math.ceil((d1 - now) / 86400000);
      if (days < 0) out.push(mk('info', '异议窗口已关闭', `公示日 ${p.meta.publicityDate} 起 3 个工作日的异议期已过（截止 ${ZC.dateStr(d1)}）。如仍有争议，请查看是否处于后续申诉环节。`, { cta: 'procedure' }));
      else if (days <= 3) out.push(mk('warn', `异议窗口仅剩 ${days} 天`, `书面异议截止 ${ZC.dateStr(d1)}（公示起 3 个工作日内）。错过即丧失程序权利。`, { cta: 'procedure' }));
      else out.push(mk('info', `异议截止：${ZC.dateStr(d1)}`, `公示起 3 个工作日内可向书院工作组书面异议 → 3 个工作日内答复 → 不服再 3 个工作日内向学生处申诉 → 学生处 3 个工作日内出具最终处理意见。`, { cta: 'procedure' }));
    }

    /* ---------- 🟢 涨分机会（按剩余空间） ---------- */
    const SV = p.pinxing.service, SR = R.pinxing.service;
    if ((+SV.volunteerHours || 0) < SR.volunteerHours && H.service > 0) {
      const lack = r1(SR.volunteerHours - (+SV.volunteerHours || 0));
      const gain = Math.min(H.service, r2(SR.volunteerPoint * lack / SR.volunteerHours));
      out.push(mk('good', `志愿服务还差 ${fmt(lack)} 小时`,
        `现行口径为每学年 ≥${SR.volunteerHours} 小时加 ${SR.volunteerPoint} 分，不足按比例。补齐可再得约 ${fmt(gain)} 分。志愿时长按学年累计，早做早从容，别拖到学年末集中刷。`, { cta: 'pinxing' }));
    }
    if (H.collective > 0) {
      const per = parseFloat(R.pinxing.collective.perTime) || 0;
      const need = per > 0 ? Math.ceil(H.collective / per) : 0;
      out.push(mk('good', `集体活动分还有 ${fmt(H.collective)} 分空间`,
        `${per > 0 ? `按当前口径 ${fmt(per)} 分/次，再参加约 ${need} 次` : '按当前口径（单次分值为 0，请在设置中修改）参加'}学校或书（学）院主办/发起的重大活动即可拿满。⚑ 单次分值校级办法未统一规定、由书院自行认定，请在设置中改成你所在书院的口径。对集体荣誉有突出贡献可经书院认定一次性满分。`, { cta: 'pinxing' }));
    }
    if (H.ideology > 0) {
      out.push(mk('good', `思想政治理论学习分还有 ${fmt(H.ideology)} 分空间`,
        `参加 1 次各级党团组织理论学习培训（含网络学习）+1；省部级培训 +2；获"优秀学员"额外 +1。三项可叠加、封顶 3 分。网络学习是成本最低的一项。`, { cta: 'pinxing' }));
    }
    if (H.academic > 0.01) {
      out.push(mk('good', `学术科研还有 ${fmt(H.academic)} 分空间`,
        H.academic >= 8 ? '空间很大：一个高水平国际/国家级竞赛三等奖即 +8，省级二等奖 +6，校级一等奖 +4。' :
        H.academic >= 4 ? '一场校级（行业/学会）竞赛一等奖即 +4，省级三等奖 +4。' :
        '剩余空间较小：校级竞赛优秀奖 +1、三等奖 +2 可补齐；国内一般期刊/会议论文一作 +3（已超空间则不涨分）。', { cta: 'ability' }));
    } else if ((res.ability.subs.academic.raw || 0) > R.ability.caps.academic) {
      out.push(mk('info', '学术科研已封顶 10 分',
        `原始合计 ${fmt(res.ability.subs.academic.raw)} 分，超出部分不计。继续堆同类成果不涨分，建议把精力转向文体竞赛（还可 +${fmt(H.culture)}）或任职（还可 +${fmt(H.position)}）。`, { cta: 'ability' }));
    }
    if (H.culture > 0.01) {
      out.push(mk('good', `文体竞赛还有 ${fmt(H.culture)} 分空间`,
        '性价比最高的入口：校级文艺三等奖 +1、校级体育第4—8名 +0.5、校级文艺一等奖 +2。破省级及以上纪录另 +5、破校级纪录 +3。', { cta: 'ability' }));
    }
    const posItems = p.ability.position || [];
    if (H.position > 0.01) {
      const best = res.ability.subs.position.best;
      let posMsg;
      if (!posItems.length) {
        posMsg = '尚未登记任何任职。最低门槛：宿舍长（考核合格）+0.5、团学组织干事（良好）+0.75；班长/团支书考核优秀可 +2；院级及以上学生组织正职优秀 +4。';
      } else if (best && best.assessment !== '优秀') {
        posMsg = `当前「${best.org || ''} ${best.role || ''}」考核为「${best.assessment}」。同一档位下把考核做到"优秀"就能涨分（例如三档：合格 1 → 良好 1.5 → 优秀 2），比换职务更现实。`;
      } else {
        posMsg = '当前已按兼任中的最高档 + 优秀考核计分。若想再提升，只能换到更高档位职务（如从"部长"到"组织正职"）。';
      }
      out.push(mk('good', `任职分还有 ${fmt(H.position)} 分空间`, posMsg, { cta: 'ability' }));
    }
    if (H.reward > 0.01) {
      out.push(mk('good', `奖励分还有 ${fmt(H.reward)} 分空间（总分外的额外分）`,
        '奖励分是在 100 分之外额外的 5 分：精神文明集体/个人荣誉表彰按全国5·省4·市3·校2·院1；见义勇为、舍己救人、拾金不昧等受表彰同标准；做好事受表扬、为校争光每项 +1 可累加。累计超 5 按 5 计。', { cta: 'reward' }));
    }

    /* ---------- ℹ️ 规则陷阱提示 ---------- */
    if ((res.merged || []).length) {
      out.push(mk('info', `${res.merged.length} 处触发"取最高/不累加"规则`,
        res.merged.map(m => `${m.cat}「${m.name}」少计 ${m.dropped} 分（${m.reason}）`).join('；') + '。录入时不必重复提交同一项目的多个奖项。', { cta: 'ability' }));
    }
    const shortTerm = res.ability.subs.position.items.filter(i => i._months !== null && i._months < 12 && !i._ongoing);
    if (shortTerm.length) {
      const b = shortTerm[0];
      out.push(mk('warn', `任职任期不满一年，只能拿酌情分`,
        `「${b.org || ''} ${b.role || '任职'}」任期仅 ${b._months} 个月，按当前口径系数 ${fmt(b._factor)}，得 ${fmt(b._pts)} 分（满一年可得 ${fmt(b._full)} 分）。⚑ 官方原文是"不满一年根据工作时间酌情加分，最高不得超过任期满一年的加分"——不是零分，但性价比明显下降。不同书院的酌情幅度可能不同，请在设置中切换口径。`, { cta: 'ability' }));
    }
    const ongoing = res.ability.subs.position.items.filter(i => i._ongoing && i._months !== null && i._months < 12);
    if (ongoing.length) {
      const b = ongoing[0];
      out.push(mk('info', `任职在职中（至今 ${b._months} 个月），已按"预计满一年"计分`,
        `「${b.org || ''} ${b.role || ''}」当前计 ${fmt(b._pts)} 分。<b>若中途退任</b>，按现行酌情口径只能拿 ${fmt(b._ifQuitNow)} 分——差价 ${fmt(ZC.r2(b._pts - b._ifQuitNow))} 分。坚持做满一年是收益最大化的路径（兼任多项只取最高，不累加）。`, { cta: 'ability' }));
    }
    if (posItems.length > 1) {
      out.push(mk('info', `兼任 ${posItems.length} 项职务，只取最高分`,
        '按规则兼任多项职务不累加。与其挂名多个部门，不如专注一个并做满一年、争取"优秀"考核。', { cta: 'ability' }));
    }

    /* ---------- 目标与差距 ---------- */
    const target = +p.target.score || 0;
    if (target > 0) {
      const gap = r2(target - res.total);
      if (gap > 0) {
        const plan = ZC.recommend(p, R, res, gap).slice(0, 4);
        out.push(mk('warn', `距离目标 ${fmt(target)} 分还差 ${fmt(gap)} 分`,
          plan.length ? '按投入产出比推荐的路径：' + plan.map((x, i) => `${i + 1}. ${x.label}（+${fmt(x.gain)}，投入${ZC.EFFORT_LABEL[x.effort]}）`).join('；')
            : '现有规则内的可拿分已基本拿满，可考虑在设置中调整各项上限或核对书院细则。', { cta: 'simulate' }));
      } else {
        out.push(mk('good', `已达成目标（超出 ${fmt(-gap)} 分）`, `当前 ${fmt(res.total)} 分，理论上限还有 ${fmt(H.total)} 分空间。`, { cta: 'dashboard' }));
      }
    }

    /* ---------- 综合成绩敏感度 ---------- */
    const sens = res.composite.sensitivity;
    if (sens > 0) {
      out.push(mk('info', `综测每 +1 分 → 「${res.composite.preset.name}」综合成绩 +${fmt(sens)} 分`,
        `当前口径：${res.composite.preset.desc}。综测在${res.composite.presetId === 'scholarship' ? '奖学金评定中占 20%，是拉开差距的关键变量' : '该口径中占 ' + fmt(sens * 100) + '%'}。` +
        (res.composite.incomplete ? ' ⚠️ 部分成绩尚未填写，综合成绩为估算值。' : ''), { cta: 'composite' }));
    }

    /* ---------- 满分空间总览 ---------- */
    if (H.total > 0 && res.total > 0) {
      out.push(mk('info', `理论上限还有 ${fmt(H.total)} 分未拿到`,
        `品行加分项剩 ${fmt(H.pinxingAdd)} 分（集体 ${fmt(H.collective)} / 思政 ${fmt(H.ideology)} / 社会服务 ${fmt(H.service)}），能力拓展剩 ${fmt(H.ability)} 分（学术 ${fmt(H.academic)} / 文体 ${fmt(H.culture)} / 任职 ${fmt(H.position)}），奖励分剩 ${fmt(H.reward)} 分。`, { cta: 'simulate' }));
    }

    /* ---------- 心理测评区分 ---------- */
    out.push(mk('info', '别搞混：推免/复试的"综合素质测试"≠ 综测加分',
      '推免生及部分研究生复试环节的"综合素质测试"实质是心理测评，了解的是稳定态度与习惯化反应模式，答案无对错（yzxlcs.xjtu.edu.cn/psytest）。综测加分依据的是学年学业与表现材料，两者互不相通、不需在本工具中处理。', { tag: '常识', cta: 'rulebook' }));

    const order = { danger: 0, warn: 1, good: 2, info: 3 };
    out.sort((a, b) => (order[a.level] - order[b.level]));
    return out;
  };

  function collectAllItems(res, p) {
    const arr = [];
    const push = (list, cat) => (list || []).forEach(i => arr.push({ label: i.project || i.name || i.org || i.label || cat, points: i._pts || i.points || 0, status: i.status || i._status, cat }));
    push(res.ability.subs.academic.items, '学术成果');
    push(res.ability.subs.culture.items, '文体竞赛');
    push(res.ability.subs.position.items, '任职');
    push(res.reward.items, '奖励分');
    res.pinxing.subs.collective.items.forEach(i => arr.push({ label: i.label, points: i.points || 0, status: i.status, cat: '集体活动' }));
    const vh = +((p.pinxing.service || {}).volunteerHours) || 0;
    if (vh > 0) {
      const got = (res.pinxing.subs.service.items.find(x => String(x.label).indexOf('志愿服务') === 0) || {}).points || 0;
      arr.push({ label: `志愿服务 ${ZC.fmt(vh)} 小时`, points: got, status: (p.pinxing.service.volunteerStatus || 'todo'), cat: '社会服务' });
    }
    (p.pinxing.deductions || []).forEach(i => arr.push({ label: i.label || '扣分', points: 0, status: i.status, cat: '扣分' }));
    return arr;
  }
  ZC.collectAllItems = collectAllItems;

  /* ============================================== ROI 推荐引擎 */
  ZC.recommend = function (profile, R, res, gap) {
    const H = res.headroom;
    const capLeft = {
      collective: H.collective, ideology: H.ideology, service: H.service,
      academic: Math.min(H.academic, H.ability), culture: Math.min(H.culture, H.ability),
      position: Math.min(H.position, H.ability), reward: H.reward
    };
    const list = [];
    ZC.OPPORTUNITIES.forEach(o => {
      let gain = 0, note = '';
      if (o.dyn && o.id === 'vol') {
        const lack = Math.max(0, (parseFloat(R.pinxing.service.volunteerHours) || 0) - (+profile.pinxing.service.volunteerHours || 0));
        if (lack <= 0) return;
        const req = parseFloat(R.pinxing.service.volunteerHours) || 0;
        if (req <= 0) return;
        gain = Math.min(capLeft.service, r2((parseFloat(R.pinxing.service.volunteerPoint) || 0) * lack / req));
        note = `还需 ${fmt(lack)} 小时`;
      } else if (o.dyn && o.id === 'collect') {
        const per = parseFloat(R.pinxing.collective.perTime) || 0;
        if (capLeft.collective <= 0 || per <= 0) return;
        const need = Math.ceil(capLeft.collective / per);
        gain = Math.min(capLeft.collective, r2(per * need));
        note = `约 ${need} 次 × ${fmt(per)} 分`;
      } else {
        gain = Math.min(capLeft[o.cap] || 0, o.points || 0);
      }
      if (gain <= 0.001) return;
      const hours = ZC.EFFORT_HOURS[o.effort] || 30;
      list.push({ id: o.id, label: o.label, gain: r2(gain), effort: o.effort, hours, roi: r2(gain / hours * 100) / 100, cap: o.cap, note });
    });
    list.sort((a, b) => b.roi - a.roi || b.gain - a.gain);

    // 贪心组合，凑够 gap
    if (gap) {
      let acc = 0; const plan = [];
      list.forEach(x => { if (acc < gap - 1e-9) { plan.push(x); acc = r2(acc + x.gain); } });
      return plan;
    }
    return list;
  };

  const r1 = (n) => Math.round(n * 10) / 10;
  const r2 = ZC.r2;
})();

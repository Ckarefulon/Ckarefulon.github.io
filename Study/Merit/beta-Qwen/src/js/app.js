/* =========================================================================
 * app.js —— 应用外壳、路由、事件委托、渲染调度
 * ========================================================================= */
(function () {
  const ZC = window.ZC;
  const ui = ZC.ui, esc = ZC.esc;

  ZC.NAV = [
    { group: '计分', items: [
      { id: 'dashboard', label: '仪表盘', icon: 'dashboard' },
      { id: 'pinxing', label: '品行素质分', icon: 'shield', tag: '80' },
      { id: 'ability', label: '能力拓展分', icon: 'rocket', tag: '20' },
      { id: 'reward', label: '奖励分', icon: 'award', tag: '+5' }
    ]},
    { group: '工具', items: [
      { id: 'composite', label: '综合成绩与资格', icon: 'calc' },
      { id: 'materials', label: '材料清单', icon: 'folder' },
      { id: 'simulate', label: '情景模拟', icon: 'flask' },
      { id: 'class', label: '班级对比', icon: 'users' },
      { id: 'procedure', label: '程序与时效', icon: 'clock' }
    ]},
    { group: '参考', items: [
      { id: 'rulebook', label: '规则手册', icon: 'book' },
      { id: 'settings', label: '设置', icon: 'gear' }
    ]}
  ];

  ZC.views = ZC.views || {};

  /* ------------------------------------------------------- 计算缓存 */
  ZC.ctx = function () {
    const p = ZC.getProfile();
    const R = ZC.getRules(p);
    const res = ZC.compute(p, R);
    const insights = ZC.buildInsights(p, R, res);
    return { p, R, res, insights };
  };

  /* ============================================================ 外壳 */
  function shell() {
    const navHtml = ZC.NAV.map(g => `
      <div class="nav__g">${g.group}</div>
      ${g.items.map(it => `<a class="nav__i" href="#/${it.id}" data-nav="${it.id}">
          <span class="nav__ic">${ui.icon(it.icon, 17)}</span><span class="nav__lb">${it.label}</span>
          ${it.tag ? `<span class="nav__tag">${it.tag}</span>` : ''}
          <span class="nav__sc" data-score-for="${it.id}"></span>
        </a>`).join('')}`).join('');

    return `
    <div class="app">
      <aside class="side" id="side">
        <div class="side__top">
          <div class="brand">
            <span class="brand__m">${ui.icon('calc', 20)}</span>
            <span class="brand__t">综测算分器<em>西安交通大学 · 本科生综合素质测评</em></span>
          </div>
        </div>
        <nav class="nav" id="nav">${navHtml}</nav>
        <div class="side__ft">
          <div class="side__note">纯本地运行 · 数据不上传<br><span id="save-state">未保存</span></div>
        </div>
      </aside>
      <div class="main">
        <header class="top" id="top">
          <button class="ibtn only-m" data-act="menu" title="菜单">${ui.icon('list', 20)}</button>
          <div class="top__prof" data-act="profiles" title="切换 / 管理档案">
            ${ui.icon('user', 15)}
            <span class="top__pname" id="top-pname">—</span>
            <span class="top__pyear" id="top-pyear"></span>
            ${ui.icon('down', 14)}
          </div>
          <div class="top__strip" id="score-strip"></div>
          <div class="top__act">
            <button class="ibtn" data-act="undo" title="撤销 (Ctrl+Z)" id="btn-undo">${ui.icon('undo', 17)}</button>
            <button class="ibtn" data-act="export" title="导出备份 / 报表">${ui.icon('download', 17)}</button>
            <button class="ibtn" data-act="theme" title="切换深浅色">${ui.icon('moon', 17)}</button>
          </div>
        </header>
        <div class="view" id="view"></div>
        <footer class="foot">
          <p>依据《西安交通大学本科生综合素质测评成绩评定办法》（2018年5月印发）及其实施细则构建 · 仅供自评参考</p>
          <p class="foot__w">集体活动单次分值、任职不满一年的酌情幅度等由各书（学）院自行认定，最终以所在书院当年公示细则与班级评议结果为准。</p>
        </footer>
      </div>
      <div class="side-mask" id="side-mask" data-act="menu"></div>
    </div>`;
  }

  /* ============================================================ 计分条 */
  function scoreStrip(ctx) {
    const { res, p } = ctx;
    const R = ctx.R;
    const seg = [
      { k: 'pinxing', l: '品行', v: res.pinxing.final, m: R.frame.pinxing },
      { k: 'ability', l: '能力', v: res.ability.final, m: R.frame.ability },
      { k: 'reward', l: '奖励', v: res.reward.final, m: R.reward.cap }
    ];
    const target = +p.target.score || 0;
    const gap = target ? ZC.r2(target - res.total) : null;
    return `
      <div class="strip">
        ${seg.map(s => `<a class="strip__s" href="#/${s.k === 'pinxing' ? 'pinxing' : s.k === 'ability' ? 'ability' : 'reward'}" title="${s.l}素质分 ${ZC.fmt(s.v)} / ${s.m}">
            <span class="strip__l">${s.l}</span><b>${ZC.fmt(s.v)}</b><i>${s.m}</i>
            ${ui.bar(s.v, s.m, { cls: 'bar--xs' })}
          </a>`).join('')}
        <a class="strip__t" href="#/dashboard" title="综合素质测评成绩">
          <span class="strip__l">总分</span><b class="strip__big">${ZC.fmt(res.total)}</b><i>/ ${res.maxTotal}</i>
        </a>
        ${gap !== null ? `<span class="strip__g ${gap > 0 ? 'is-neg' : 'is-pos'}" title="距离目标 ${ZC.fmt(target)} 分">
            ${ui.icon('target', 13)} ${gap > 0 ? '差 ' + ZC.fmt(gap) : '超 ' + ZC.fmt(-gap)}</span>` : ''}
      </div>`;
  }

  /* ============================================================ 渲染 */
  let pending = false;
  ZC.rerender = function (opts) {
    if (pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; doRender(opts); });
  };
  function doRender() {
    const ctx = ZC.ctx();
    const view = ZC.views[ZC.state.ui.view] || ZC.views.dashboard;

    // 焦点与滚动保持
    const ae = document.activeElement;
    const key = ae && ae.dataset ? ae.dataset.k : null;
    let s1 = 0, s2 = 0;
    try { s1 = ae.selectionStart; s2 = ae.selectionEnd; } catch (e) {}
    const sy = window.scrollY;

    const el = document.getElementById('view');
    el.innerHTML = view.render(ctx);
    document.getElementById('score-strip').innerHTML = scoreStrip(ctx);
    document.getElementById('top-pname').textContent = ctx.p.meta.name;
    document.getElementById('top-pyear').textContent = ctx.p.meta.academicYear + ' · ' + ctx.p.meta.college;

    // 侧栏小分
    const set = (id, txt) => { const n = document.querySelector(`[data-score-for="${id}"]`); if (n) n.textContent = txt; };
    set('pinxing', ZC.fmt(ctx.res.pinxing.final));
    set('ability', ZC.fmt(ctx.res.ability.final));
    set('reward', ZC.fmt(ctx.res.reward.final));
    set('dashboard', ZC.fmt(ctx.res.total));

    document.querySelectorAll('.nav__i').forEach(a => a.classList.toggle('on', a.dataset.nav === ZC.state.ui.view));
    const ub = document.getElementById('btn-undo'); if (ub) ub.disabled = !ZC.canUndo();

    if (key) {
      const t = el.querySelector(`[data-k="${key.replace(/"/g, '\\"')}"]`);
      if (t) { t.focus(); try { t.setSelectionRange(s1, s2); } catch (e) {} }
    }
    window.scrollTo(0, sy);
    if (view.after) view.after(ctx);
  }

  ZC.go = function (id) {
    if (!ZC.views[id]) id = 'dashboard';
    ZC.state.ui.view = id;
    if (location.hash !== '#/' + id) history.replaceState(null, '', '#/' + id);
    window.scrollTo(0, 0);
    ZC.rerender();
    ZC.save(true);
    document.body.classList.remove('side-open');
  };

  /* ============================================================ 事件 */
  function coerce(el, raw) {
    const t = el.dataset.t;
    if (t === 'bool') return el.checked;
    if (t === 'num') return raw === '' ? '' : (isNaN(+raw) ? raw : +raw);
    if (t === 'int') return raw === '' ? '' : parseInt(raw, 10);
    return raw;
  }

  function onField(el) {
    const k = el.dataset.k; if (!k) return;
    const p = ZC.getProfile();
    const val = coerce(el, el.value);
    const cur = ZC.getPath(p, k);
    if (String(cur) === String(val)) return;
    ZC.setPath(p, k, val);
    if (ZC.fixups) ZC.fixups(p, k);      // 级别/类别切换后校正失效的选项
    ZC.save();
    ZC.rerender();
  }

  /* -------------------------------------------------- 新增条目模板 */
  function newItem(cat, arg) {
    const base = { id: ZC.uid(), status: 'todo', evidence: '', date: '' };
    switch (cat) {
      case 'collective': return Object.assign(base, { name: '', times: 1 });
      case 'deduction': return Object.assign(base, { type: arg || 'kuangke', count: 1, note: '' });
      case 'academic-comp': return Object.assign(base, { kind: 'competition', project: '', level: 'school', award: '三等奖', noMerge: false });
      case 'academic-paper': return Object.assign(base, { kind: 'paper', project: '', name: '', pubClass: 'ii', rank: 1, signUnit: '西安交通大学', excellentPaper: false, isEditor: false, noMerge: true });
      case 'academic-patent': return Object.assign(base, { kind: 'patent', project: '', name: '', patentType: '实用新型专利', rank: 1, signUnit: '西安交通大学', noMerge: true });
      case 'academic-book': return Object.assign(base, { kind: 'book', project: '', name: '', pubClass: 'book', rank: 1, signUnit: '西安交通大学', isEditor: false, noMerge: true });
      case 'culture-art': return Object.assign(base, { kind: 'art', name: '', level: 'school', award: '三等奖', record: false });
      case 'culture-sport': return Object.assign(base, { kind: 'sport', name: '', level: 'school', award: '第3名', record: false });
      case 'position': return Object.assign(base, { org: '', role: '', tier: 't4', assessment: '合格', startDate: '', endDate: '' });
      case 'reward': return Object.assign(base, { category: 'honor', level: 'school', name: '' });
      case 'classmate': return { id: ZC.uid(), name: '', composite: '', zongce: '', self: false };
      default: return base;
    }
  }
  const LIST_PATH = {
    collective: 'pinxing.collective.entries', deduction: 'pinxing.deductions',
    academic: 'ability.academic', culture: 'ability.culture', position: 'ability.position',
    reward: 'reward.items', classmate: 'classmates'
  };

  Object.assign(ZC.actions, {
    nav: (arg) => ZC.go(arg),
    menu: () => document.body.classList.toggle('side-open'),
    theme: () => { ZC.toggleTheme(); ZC.rerender(); },
    undo: () => { if (ZC.undo()) ZC.rerender(); },
    export: () => ZC.actions.exportMenu(),
    exportMenu: () => {
      const { p, R, res } = ZC.ctx();
      ui.modal({
        title: '导出与备份', wide: false,
        body: `<div class="exp">
          <button class="exp__i" data-act="exp-json">${ui.icon('download', 20)}<b>数据备份 (JSON)</b><span>含全部档案与设置，可跨设备导入</span></button>
          <button class="exp__i" data-act="exp-md">${ui.icon('list', 20)}<b>自评表 (Markdown)</b><span>可直接粘贴进学年总结 / 发给辅导员</span></button>
          <button class="exp__i" data-act="exp-csv">${ui.icon('calc', 20)}<b>明细表 (CSV)</b><span>Excel 打开，逐项含计算依据</span></button>
          <button class="exp__i" data-act="print">${ui.icon('print', 20)}<b>打印 / 存为 PDF</b><span>排版已针对 A4 优化</span></button>
        </div>`,
        actions: `<button class="btn" data-close="1">关闭</button>`
      });
    },
    'exp-json': () => ZC.exportJSON(),
    'exp-md': () => { const { p, R, res } = ZC.ctx(); ZC.download(`综测自评表_${p.meta.name}_${ZC.today()}.md`, ZC.buildMarkdownReport(p, R, res), 'text/markdown'); ui.toast('已导出 Markdown 自评表', 'ok'); },
    'exp-csv': () => { const { p, R, res } = ZC.ctx(); ZC.download(`综测明细_${p.meta.name}_${ZC.today()}.csv`, ZC.buildCSV(p, R, res), 'text/csv'); ui.toast('已导出 CSV 明细', 'ok'); },
    print: () => window.print(),
    'copy-md': async () => { const { p, R, res } = ZC.ctx(); await ui.copy(ZC.buildMarkdownReport(p, R, res), '自评表已复制'); },

    /* 档案 */
    profiles: () => ZC.views.settings.profileModal(),
    'prof-new': () => ZC.views.settings.newProfile(),
    'prof-switch': (arg) => { ZC.switchProfile(arg); ZC.rerender(); ui.toast('已切换档案', 'ok', 1600); },
    'prof-dup': (arg) => { const src = ZC.state.profiles.find(x => x.id === arg); ZC.addProfile(src.meta.name + ' 副本', src.meta.college, src.meta.academicYear, src); ZC.rerender(); ui.toast('已复制档案', 'ok'); },
    'prof-del': (arg) => {
      const src = ZC.state.profiles.find(x => x.id === arg);
      ui.confirm('删除档案', `确定删除「${esc(src.meta.name)}」？删除后可用顶部撤销按钮恢复。`, () => { ZC.deleteProfile(arg); ZC.rerender(); }, '删除');
    },

    /* 列表增删 */
    add: (arg) => {
      const [listCat, itemCat] = arg.split('|');
      const p = ZC.getProfile();
      const path = LIST_PATH[listCat];
      if (!path) return;
      ZC.snapshot('新增条目');
      if (listCat === 'classmate') {
        p.classmates = p.classmates || [];
        p.classmates.push(newItem('classmate'));
      } else {
        const arr = ZC.getPath(p, path);
        arr.push(newItem(itemCat || listCat, itemCat));
      }
      ZC.save(); ZC.rerender();
    },
    del: (arg) => {
      const [path, idx] = arg.split('|');
      const p = ZC.getProfile();
      ZC.snapshot('删除条目');
      const arr = ZC.getPath(p, path);
      arr.splice(+idx, 1);
      ZC.save(); ZC.rerender(); ui.toast('已删除，可撤销', 'ok', 2200);
    },
    dup: (arg) => {
      const [path, idx] = arg.split('|');
      const p = ZC.getProfile();
      ZC.snapshot('复制条目');
      const arr = ZC.getPath(p, path);
      const c = ZC.clone(arr[+idx]); c.id = ZC.uid(); c.status = 'todo';
      arr.splice(+idx + 1, 0, c);
      ZC.save(); ZC.rerender();
    },
    move: (arg) => {
      const [path, idx, dir] = arg.split('|');
      const p = ZC.getProfile(); const arr = ZC.getPath(p, path);
      const i = +idx, j = i + (+dir);
      if (j < 0 || j >= arr.length) return;
      ZC.snapshot('排序');
      [arr[i], arr[j]] = [arr[j], arr[i]];
      ZC.save(); ZC.rerender();
    },

    /* 规则原文弹窗 */
    rule: (arg) => {
      const txt = ZC.RULE_TEXT[arg] || '';
      const titles = { formula: '总公式', collective: '集体活动分', term: '任职任期规则', sign: '署名单位要求', dedup: '同一项目取最高', psy: '心理测评 ≠ 综测', procedure: '评定程序与异议申诉', volunteer: '志愿服务工时口径' };
      ui.modal({ title: '规则原文 · ' + (titles[arg] || ''), body: `<blockquote class="quote">${esc(txt)}</blockquote>`, actions: `<button class="btn btn--primary" data-close="1">知道了</button>` });
    },

    /* 设置 */
    'reset-rules': () => ui.confirm('恢复校级默认规则', '将清除你对规则参数的全部自定义（不影响已录入的加分条目），确定继续？', () => { ZC.snapshot('重置规则'); ZC.state.globalRules = {}; const p = ZC.getProfile(); p.ruleOverride = {}; ZC.save(); ZC.rerender(); ui.toast('已恢复校级默认规则', 'ok'); }, '恢复默认'),
    'clear-profile': () => ui.confirm('清空当前档案数据', '将删除当前档案内的所有加分/扣分条目，恢复到空白状态。建议先导出备份。确定继续？', () => {
      ZC.snapshot('清空档案'); const p = ZC.getProfile(); const meta = ZC.clone(p.meta); const id = p.id, ca = p.createdAt;
      const fresh = ZC.blankProfile(meta.name, meta.college, meta.academicYear);
      fresh.meta = meta; fresh.id = id; fresh.createdAt = ca;
      const i = ZC.state.profiles.findIndex(x => x.id === id); ZC.state.profiles[i] = fresh;
      ZC.save(); ZC.rerender(); ui.toast('已清空', 'ok');
    }, '清空'),
    'import': () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { if (ZC.importJSON(rd.result)) ZC.rerender(); }; rd.readAsText(f); };
      inp.click();
    },
    'demo': () => { ZC.snapshot('载入示例'); const d = ZC.buildDemoProfile(); ZC.state.profiles.push(d); ZC.state.activeId = d.id; ZC.save(); ZC.rerender(); ui.toast('已载入示例档案', 'ok'); },

    /* 提示筛选 */
    'tips-filter': (arg) => { ZC.state.ui.tipsFilter = arg; ZC.save(true); ZC.rerender(); },

    /* 首启引导 */
    'welcome-blank': () => {
      ZC.snapshot('清空示例数据');
      const old = ZC.getProfile();
      const fresh = ZC.blankProfile('', old.meta.college, old.meta.academicYear);
      fresh.id = old.id; fresh.createdAt = old.createdAt;
      ZC.state.profiles[ZC.state.profiles.findIndex(x => x.id === old.id)] = fresh;
      ZC.save(true); ZC.go('settings');
      ui.toast('已清空，先填一下基本信息吧', 'ok', 3200);
    },
    'welcome-demo': () => { ZC.go('dashboard'); },

    /* 模拟：具体动作在 views-tools.js 中注册 */

    /* 快捷跳转 */
    goto: (arg) => ZC.go(arg)
  });

  /* ============================================================ 启动 */
  function bind() {
    const root = document;   // 文档级委托：弹窗(#modal-root)内的按钮同样生效
    root.addEventListener('input', (e) => { const el = e.target.closest('[data-k]'); if (el) onField(el); });
    root.addEventListener('change', (e) => { const el = e.target.closest('[data-k]'); if (el) onField(el); });
    root.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { e.preventDefault(); ZC.go(nav.dataset.nav); return; }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const fn = ZC.actions[b.dataset.act];
      if (fn) {
        e.preventDefault();
        if (b.closest('#modal-root')) ui.closeModal();   // 弹窗内的动作：先关闭再执行（动作可能打开新弹窗）
        fn(b.dataset.arg, b, e);
      }
    });
    window.addEventListener('hashchange', () => {
      const id = (location.hash || '').replace('#/', '');
      if (id && ZC.views[id] && id !== ZC.state.ui.view) { ZC.state.ui.view = id; ZC.rerender(); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.target.closest('input,textarea,select')) { e.preventDefault(); ZC.actions.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); ZC.save(); ui.toast('数据保存在本机浏览器，建议同时导出 JSON 备份', 'ok', 3200); }
      if (e.key === '/' && !e.target.closest('input,textarea,select')) { const s = document.getElementById('rb-search'); if (s) { e.preventDefault(); s.focus(); } }
    });
    window.addEventListener('beforeunload', () => { if (ZC.state.dirty) ZC.flushSave(); });
    window.addEventListener('pagehide', () => { if (ZC.state.dirty) ZC.flushSave(); });
  }

  ZC.boot = function () {
    ZC.load();
    const h = (location.hash || '').replace('#/', '');
    if (h && ZC.views[h]) ZC.state.ui.view = h;
    document.getElementById('app').innerHTML = shell();
    bind();
    doRender();
    ZC.save(true);
    if (ZC.state.firstRun) {
      ZC.state.firstRun = false;
      ui.modal({
        title: '欢迎使用「综测算分器」',
        body: `<p>这是一个<b>纯本地运行</b>的西安交通大学本科生综合素质测评工具：算分、备材料、想清楚下一步该做什么。<b>不需要注册，数据不会上传</b>，全部保存在你这台设备的浏览器里。</p>
          <div class="callout callout--info callout--sm">当前已经装好一个<b>示例档案</b>（填了各种数据），方便你直接看懂每一项怎么填、分数怎么算、提示怎么来的。</div>
          <div class="callout callout--warn callout--sm">计分依据为《西安交通大学本科生综合素质测评成绩评定办法》(2018) 及实施细则。<b>集体活动单次分值、任职不满一年的折减幅度等由各书院自行认定</b>，请在「设置」里改成你所在书院的口径。</div>`,
        actions: `<button class="btn" data-act="import">${ui.icon('upload', 15)} 导入备份</button>
                  <button class="btn" data-act="welcome-blank">${ui.icon('plus', 15)} 从零开始录入我的</button>
                  <button class="btn btn--primary" data-act="welcome-demo">先看看示例数据</button>`
      });
    }
    setTimeout(() => {
      const el = document.getElementById('save-state');
      if (el) el.textContent = ZC.storageOK ? '已就绪 · 数据存于本机浏览器' : '仅本次会话有效（本地存储被禁用）';
      if (!ZC.storageOK) {
        ZC.ui.modal({
          title: '当前环境禁用了本地存储',
          body: `<p>检测到此浏览器环境不允许写入本地存储（常见于受限的网页预览窗口、无痕模式或站点数据被禁用）。</p>
            <div class="callout callout--warn"><b>影响：</b>你录入的数据只在本次会话内有效，关闭页面后会丢失。</div>
            <div class="callout callout--ok"><b>解决办法：</b>把 <code>index.html</code> 下载到本地，用 Chrome / Edge / Safari 直接双击打开，即可自动保存、离线使用。也可以随时用「导出备份 (JSON)」把数据存成文件，之后在正常环境中导入。</div>`,
          actions: `<button class="btn" data-act="export">导出备份</button><button class="btn btn--primary" data-close="1">我知道了，继续使用</button>`
        });
      }
    }, 400);
  };

  document.addEventListener('DOMContentLoaded', () => { try { ZC.boot(); } catch (e) { console.error(e); document.getElementById('app').innerHTML = '<div style="padding:40px;font:14px/1.8 system-ui">应用初始化失败：' + esc(e.message) + '</div>'; } });
})();

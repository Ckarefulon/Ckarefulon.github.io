(() => {
  'use strict';
  const C=window.CubeAnalyzerCore, I=window.CubeAnalyzerImport, Ch=window.CubeAnalyzerCharts, Cube=window.CubeAnalyzerSmartCube, A=window.CubeAnalyzerSolveAnalysis;
  const Replay=window.CubeAnalyzerReplay;
  const esc=Ch.esc;
  // DNF 只存在于记录中：记录列表与复原次数包含它，所有分析（趋势/AO/分段/TPS/Case 等）一律排除。
  const noDnf=s=>s&&C.normalizeFlag(s.flag)!=='dnf';
  // 数据体检（2026-09-29）：异常记录只打 Flag、绝不修改/删除，分析统计侧与 DNF 同口径排除；
  // 用户可在「数据体检」中确认为误报后恢复纳入（anomalyCleared），原始检测结果保留。
  const Q=window.CubeAnalyzerQuality;
  const noAnomaly=s=>!(Q&&Q.active(s));
  const analyzable=solves=>solves.filter(noDnf).filter(noAnomaly);
  // —— 体验设置（观察秒数 / 语音报点 / 提示音）：独立 localStorage 键，绝不进训练数据与云同步载荷 ——
  const XP_KEY='cubeAnalyzerExperienceV1';
  const xp=Object.assign({inspectionSec:15,soundOn:true,voiceOn:true,caseOrder:'weak',freeScramble:false},(()=>{try{return JSON.parse(localStorage.getItem(XP_KEY)||'{}')}catch(e){return{}}})());
  function saveXp(){try{localStorage.setItem(XP_KEY,JSON.stringify(xp))}catch(e){}}
  const inspectionMs=()=>(Number(xp.inspectionSec)||15)*1000;
  const STORAGE=(window.CubeAnalyzerCloud&&window.CubeAnalyzerCloud.storageKey)||'cubeAnalyzerDataV2', SETTINGS=(window.CubeAnalyzerCloud&&window.CubeAnalyzerCloud.settingsKey)||'cubeAnalyzerSettingsV2';
  const state={solves:[],datasetName:'训练数据',activeTab:'overview',workspaceMode:'training',trendMetric:'single',resolution:'all',tpsMode:'segregated',goal:{CFOP:15,Roux:18,ZZ:18},caseType:'ALL',filters:{method:'all',session:'all',device:'all',start:'',end:''},training:{method:'CFOP',session:'日常训练',inspection:false}};
  let toastTimer=null, cloudHydrated=false, migratedData=false;

  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  function fmtMs(ms,digits=2){if(ms==null||ms==='')return'—';return Number.isFinite(Number(ms))?`${(Number(ms)/1000).toFixed(digits)}s`:'—'}
  function fmtNum(v,d=2){return Number.isFinite(Number(v))?Number(v).toFixed(d):'—'}
  function fmtDate(v,short=false){const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v||'—');return short?d.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
  function solveTime(s){if(!s)return'—';if(C.normalizeFlag(s.flag)==='dnf')return'DNF';const base=fmtMs(C.displayTimeMs(s));return C.normalizeFlag(s.flag)==='plus_two'?`${base} +2`:base}
  function dominantMethod(solves){const m=new Map();solves.forEach(s=>m.set(s.analysisType,(m.get(s.analysisType)||0)+1));return [...m].sort((a,b)=>b[1]-a[1])[0]?.[0]||'CFOP'}
  function notify(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200)}
  function download(name,content,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();URL.revokeObjectURL(a.href);a.remove()}
  /* —— 存储体积治理（2026-10-11）——
   * 落盘格式只做「同一份数据不再存两遍」的去重（见 analyzer-import.exportableSolve），
   * 字段一个不少；localStorage 装不下时由 CubeAnalyzerStore 把较旧的记录无损搬到 IndexedDB，
   * 加载时合并还原。这里不删任何字段，也不丢任何记录。
   */
  const Store=window.CubeAnalyzerStore;
  const payloadOf=()=>({name:'训练数据',solves:state.solves.map(I.exportableSolve)});
  const settingsOf=()=>({goal:state.goal,trendMetric:state.trendMetric,resolution:state.resolution,tpsMode:state.tpsMode,training:state.training});
  let saveQueue=Promise.resolve(), saveFailed=false;

  /**
   * 落盘（只增不删）：Store.persist 内部会先水合、再与完整集合取并集，
   * 因此这里传「此刻内存里的集合」是安全的 —— 既不会因为只是镜像子集就误删较早记录，
   * 也不会把别处已经删掉的记录复活。
   */
  function save(sync=true){
    try{
      const settings=settingsOf();
      const payload=payloadOf();
      if(!Store)return;
      saveQueue=saveQueue.then(()=>Store.persist(payload,settings)).then(result=>{
        if(!result.ok){
          if(!saveFailed){saveFailed=true;console.error('[Analyzer] 本地保存失败：',result.message);notify('本地保存失败：'+result.message+'，请先导出备份')}
          return;
        }
        if(saveFailed){saveFailed=false;notify('本地保存已恢复')}
        if(result.tiered&&!saveTieredNotified){
          saveTieredNotified=true;
          console.warn('[Analyzer]',result.message);
          notify(result.message);
        }
        updateSolveBadge();
        if(!window._siteNavApplyingCloudData&&typeof window._siteNavSetDirty==='function')window._siteNavSetDirty(true);
        if(sync&&window.CubeAnalyzerCloud)window.CubeAnalyzerCloud.scheduleUpload();
      }).catch(e=>{
        console.error('[Analyzer] 保存异常',e);
        if(!saveFailed){saveFailed=true;notify('本地保存失败：'+(e&&e.message||e))}
      });
    }catch(e){console.error('[Analyzer] 保存异常',e);notify('本地保存失败：'+(e&&e.message||e))}
  }
  let saveTieredNotified=false;
  function upgradeSolve(raw,index=0){
    const s=I.normalizeSolve(raw,index);
    const hasSmartTrace=!!(s.startFacelet&&s.moves?.length&&s.moves.length===s.timestamps?.length);
    if(!hasSmartTrace)return s;
    s.captureType='smartcube';
    if(!s.rawSolutionSequence?.length)s.rawSolutionSequence=s.moves.map((move,i)=>({move,logicalMove:move,rawMoves:[move],timestamp:s.timestamps[i]}));
    const analysisVersion=Number(A?.ANALYSIS_VERSION||6);
    const needsAnalysis=!s.steps?.length||Number(s.analysisVersion||s.analysisFrame?.analysisVersion||0)<analysisVersion;
    if(needsAnalysis&&A){
      migratedData=true;
      const snapshots=s.stateSequence?.length?s.stateSequence:s.snapshots;
      let analyzed=null;
      try{
        analyzed=A.analyze({method:s.analysisType,startFacelet:s.startFacelet,moves:s.moves,timestamps:s.timestamps,totalTime:s.totalTime,snapshots,rawSolutionSequence:s.rawSolutionSequence});
      }catch(analyzeErr){
        // 单条记录分析崩溃绝不允许炸穿整个 load()——降级为无分段，记录本体保留
        console.warn('[Analyzer] 单条记录重新分析失败，已降级保留',s.id,analyzeErr);
      }
      if(analyzed?.steps?.length){
        s.steps=analyzed.steps;s.analysisFrame=analyzed.frame||null;s.analysisVersion=analyzed.analysisVersion||analysisVersion;s.colorNeutral=true;
      }else{
        // An older, unreliable split must not survive a failed current-version re-analysis.
        s.steps=[];s.analysisFrame=null;s.analysisVersion=analysisVersion;
      }
    }
    if((!s.stateSequence?.length||s.stateSequence.length!==s.moves.length+1)&&A?.statesFromSnapshots){
      try{
        const rebuilt=A.statesFromSnapshots(s.startFacelet,s.moves,s.snapshots,s.rawSolutionSequence);
        if(rebuilt.length===s.moves.length+1)s.stateSequence=rebuilt.map((cube,i)=>({facelet:typeof cube?.toFaceCube==='function'?cube.toFaceCube():'',timestamp:i===0?0:s.timestamps[i-1],move:i===0?'':s.moves[i-1]}));
      }catch(rebuildErr){console.warn('[Analyzer] 状态序列重建失败，保留原值',s.id,rebuildErr);}
    }
    if(!s.source||/^(手动训练|manual|import)$/i.test(String(s.source)))s.source=`智能魔方训练${s.timingMode==='space'?' · 空格起停':s.timingMode==='state'?' · 状态起停':''}`;
    return s;
  }

  // 把一份 payload 装载进内存（逐条隔离：一条坏记录只降级自己，绝不连坐清空整个列表）
  function adoptPayload(d){
    if(!Array.isArray(d?.solves)||!d.solves.length)return 0;
    const loaded=[];
    d.solves.forEach((raw,i)=>{
      try{loaded.push(upgradeSolve(raw,i));}
      catch(e){
        console.warn('[Analyzer] 记录升级失败，降级保留原始数据',i,e);
        try{loaded.push(I.normalizeSolve(raw,i));}catch(e2){console.warn('[Analyzer] 记录解析失败，已跳过',i,e2);}
      }
    });
    state.solves=loaded.sort((a,b)=>new Date(a.date)-new Date(b.date));
    return loaded.length;
  }
  /* —— 顶部计数徽标：单一出口。数字永远是「内存里的全部记录」，不随筛选、不随镜像子集变动 —— */
  function updateSolveBadge(){
    const el=$('#totalSolveBadge');if(!el)return;
    const n=state.solves.length;
    const info=Store&&Store.mirrorInfo?Store.mirrorInfo():null;
    let text=`${n} solves`;
    let title=`共 ${n} 条记录`;
    if(Store&&Store.isTiered&&Store.isTiered()){
      const idbN=Store.stats().idbCount||0;
      text=`${n} solves`;
      title=`共 ${n} 条记录 · 较早 ${idbN} 条在本机扩展存储`;
      if(info&&info.missing>0)title+=` · 有 ${info.missing} 条缺失（将从云端补齐）`;
    }
    el.textContent=text;
    el.title=title;
    return n;
  }
  function applySettings(settings){
    if(settings&&typeof settings==='object')Object.assign(state,settings);
    if(settings?.training)state.training={...state.training,...settings.training};
  }
  // 同步装载：localStorage 里最新的那批（首屏立刻可见）
  function load(){
    migratedData=false;
    try{
      if(Store){
        const sync=Store.loadSync();
        applySettings(sync.settings);
        adoptPayload(sync.payload);
        // 镜像只装了「最近的若干把」，真实总数写在头部；先把徽标显示成真实数，
        // 免得水合完成前一直显示成镜像条数（这就是「175 显示 105」的一半来源）
        const badge=$('#totalSolveBadge');
        if(badge&&sync.totalCount>state.solves.length)badge.textContent=`${sync.totalCount} solves`;
      }else{
        const settings=window.storageManager?window.storageManager.getJson(SETTINGS,{}):JSON.parse(localStorage.getItem(SETTINGS)||'{}');
        applySettings(settings);
        const d=window.storageManager?window.storageManager.getJson(STORAGE,null):JSON.parse(localStorage.getItem(STORAGE)||'null');
        adoptPayload(d);
      }
      // 迁移（自愈）：旧记录里带着无人读取的陀螺仪采样，单条体积 88% 都耗在这上面，
      // 几十把就会撑满 localStorage 配额并导致此后写入静默失败。检测到即重写瘦身。
      try{
        const raw=localStorage.getItem(STORAGE);
        if(raw&&(/"gyroSamples":\[\{/.test(raw)||raw.length>4*1024*1024))migratedData=true;
      }catch(e){}
      // 注意：这里的「自愈重写」必须等水合完成后再走 save()，否则用镜像子集落盘会误删扩展存储
    }catch(e){console.warn(e)}
    if(Q)Q.ensure(state.solves); // 数据体检：只补检未标注的记录，绝不覆盖已有标记
    state.datasetName='训练数据';
  }
  // 异步水合：把存放在扩展存储的较早记录并回内存（记录数不变时不做任何事）
  async function hydrate(){
    if(!Store)return {total:state.solves.length,missing:0};
    try{
      // 先等落盘队列落地：上一个标签页/上一轮保存可能还在写，直接读会读到中间状态
      try{ if(Store.flush) await Store.flush(); }catch(e){}
      if(Store.syncFromTier){ try{ await Store.syncFromTier(); }catch(e){} }
      const full=await Store.loadAll();
      const incoming=Array.isArray(full?.payload?.solves)?full.payload.solves:[];
      const before=state.solves.length;
      // 用「全量」重建内存：不能只在 incoming 更多时才替换，否则内存里残留的、
      // 已经被删掉的记录会一直留着
      if(incoming.length){
        adoptPayload(full.payload);
        if(Q)Q.ensure(state.solves);
      }
      const changed=state.solves.length!==before||incoming.length>before;
      if(changed){
        refreshFilterOptions();renderTrainerSummary();renderAll();
      }
      updateSolveBadge();
      // 首屏的「自愈重写」放到水合之后，此时落盘的是完整集合，不会误删较早记录
      if(migratedData){migratedData=false;save(false)}
      if(full.missing>0){
        console.warn('[Analyzer] 扩展存储缺少',full.missing,'条记录，等待云端补齐');
        notify(`本机缺少 ${full.missing} 条较早记录，正在尝试从云端补齐`);
        // 自动补齐：只并回「本机确实没有的那几条」，不整份覆盖
        const cloud=window.CubeAnalyzerCloud;
        if(cloud&&typeof cloud.recoverMissingFromCloud==='function'&&cloud.isReady()){
          const rec=await cloud.recoverMissingFromCloud();
          if(rec.success&&rec.recovered>0){
            await reloadFromStorage();
            notify(rec.message);
          }
        }
      }else if(full.idbCount&&incoming.length>before){
        notify(`已载入 ${full.idbCount} 条较早记录（扩展存储）`);
      }
      return {total:state.solves.length,missing:full.missing||0};
    }catch(e){
      console.warn('[Analyzer] 扩展存储载入失败',e);
      updateSolveBadge();
      return {total:state.solves.length,missing:0,error:e};
    }
  }

  function filtered(){
    return state.solves.filter(s=>{
      if(state.filters.method!=='all'&&s.analysisType!==state.filters.method)return false;
      if(state.filters.session!=='all'&&String(s.session)!==state.filters.session)return false;
      if(state.filters.device!=='all'&&String(s.device)!==state.filters.device)return false;
      const t=new Date(s.date).getTime();
      if(state.filters.start&&t<new Date(state.filters.start+'T00:00:00').getTime())return false;
      if(state.filters.end&&t>new Date(state.filters.end+'T23:59:59.999').getTime())return false;
      return true;
    }).sort((a,b)=>new Date(a.date)-new Date(b.date));
  }

  function optionList(select,values,current){
    const firstOpt=select.querySelector('option[value="all"]')?.outerHTML||'<option value="all">全部</option>';
    select.innerHTML=firstOpt+[...new Set(values.filter(Boolean).map(String))].sort().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
    select.value=[...select.options].some(o=>o.value===current)?current:'all';
  }
  function refreshFilterOptions(){optionList($('#sessionFilter'),state.solves.map(s=>s.session),state.filters.session);optionList($('#deviceFilter'),state.solves.map(s=>s.device),state.filters.device)}

  function metricCard(label,value,note='',cls=''){return `<article class="card metric-card ${cls}"><div class="metric-label">${esc(label)}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></article>`}
  function panel(title,sub,body,controls=''){return `<article class="card panel-card"><div class="panel-head"><div><h2>${esc(title)}</h2>${sub?`<div class="panel-sub">${esc(sub)}</div>`:''}</div>${controls?`<div class="panel-controls">${controls}</div>`:''}</div>${body}</article>`}
  function empty(title,text){return `<div class="empty"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`}

  function currentMetricSeries(solves,metric){
    if(metric==='single')return solves.map(s=>C.normalizeFlag(s.flag)==='dnf'?null:C.displayTimeMs(s));
    const n=Number(metric.replace('ao',''));return C.runningAverage(n,solves);
  }

  function renderOverview(solves){
    const el=$('#overviewContent');if(!solves.length){el.innerHTML=empty('没有符合筛选条件的数据','调整筛选器或导入训练记录。');return}
    const S=C.solveSummary(solves),latest=solves[solves.length-1];
    const metrics=`<div class="metric-grid">
      ${metricCard('LATEST',solveTime(latest),`${latest.analysisType} · ${fmtDate(latest.date)}`,'metric-accent')}
      ${metricCard('AO5',S.ao5.isDNF?'DNF':fmtMs(S.ao5.time),S.bestAo5?`Best ${fmtMs(S.bestAo5.time)}`:'不足 5 次','metric-primary')}
      ${metricCard('AO12',S.ao12.isDNF?'DNF':fmtMs(S.ao12.time),S.bestAo12?`Best ${fmtMs(S.bestAo12.time)}`:'不足 12 次')}
      ${metricCard('AO100',S.ao100.isDNF?'DNF':fmtMs(S.ao100.time),S.bestAo100?`Best ${fmtMs(S.bestAo100.time)}`:'不足 100 次')}
      ${metricCard('BEST SINGLE',fmtMs(S.best),`Median ${fmtMs(S.median)}`)}
      ${metricCard('MEDIAN TPS',fmtNum(S.medianTps),S.avgTps?`Avg ${fmtNum(S.avgTps)}`:'需要智能魔方数据')}
    </div>`;
    const base=baselineStats();
    // 「今日 vs 基线」只有一行数字，不必占用一整张面板 —— 做成一条窄条贴在指标卡下面
    const baseHtml=base?`<div class="baseline-strip" title="基线 = 最近 ${base.count} 把有效成绩（DNF 与异常记录排除，+2 已计入）">
      <span class="baseline-kicker">今日 vs 基线</span>
      <span class="kpi-inline"><span class="muted">今日</span><strong>${base.todayCount?`${base.todayCount} 把 · ${fmtMs(base.todayMean)}`:'—'}</strong></span>
      <span class="kpi-inline"><span class="muted">基线均值</span><strong>${fmtMs(base.mean)}</strong></span>
      <span class="kpi-inline"><span class="muted">基线最优</span><strong>${fmtMs(base.best)}</strong></span>
      ${base.todayMean!=null?`<span class="kpi-inline"><span class="muted">相对基线</span><strong class="${base.todayMean<base.mean?'good-text':'bad-text'}">${base.todayMean<base.mean?'快':'慢'} ${Math.abs((base.todayMean-base.mean)/base.mean*100).toFixed(1)}%</strong></span>`:''}
    </div>`:'';
    el.innerHTML=metrics+baseHtml+`<div class="grid-2"><div id="overviewTrend"></div><div id="overviewQuality"></div></div><div id="overviewPlan" style="margin-top:10px"></div>`;
    $('#overviewTrend').outerHTML=panel('近期成绩趋势','最近 80 个有效数据点','<div class="chart-box" id="overviewChart"></div>');
    const series=solves.filter(s=>C.normalizeFlag(s.flag)!=='dnf').slice(-80).map(s=>({x:s.date,y:C.displayTimeMs(s),solve:s}));
    Ch.lineChart($('#overviewChart'),series,{yFormatter:v=>`${(v/1000).toFixed(1)}s`,xFormatter:x=>fmtDate(x,true),tooltip:d=>`${fmtDate(d.x)} · <strong>${fmtMs(d.y)}</strong>`,onPointClick:d=>d.solve&&openSolve(d.solve)});
    const replay=solves.filter(s=>s.timestamps?.length>1).length, method=state.filters.method==='all'?dominantMethod(solves):state.filters.method;
    const methodSolves=solves.filter(noDnf).filter(s=>s.analysisType===method&&s.steps?.length);const avg=C.averageSplits(methodSolves,method);const actual=Object.fromEntries(avg.filter(x=>x.time).map(x=>[x.key,x.time/1000]));const ref=C.referenceSplits(method,state.goal[method]||15);const weakness=C.analyzeSplits(method,actual,ref).weakest;
    $('#overviewQuality').outerHTML=panel('训练质量','从稳定性、动作与阶段分布判断当前状态',`<div class="insight-list">
      <div class="insight-row"><strong>稳定性</strong><div class="progress"><i style="width:${fmtNum(S.consistency,0)}%"></i></div><span class="mono">${fmtNum(S.consistency,0)}%</span><span class="muted">CV ${S.cv?fmtNum(S.cv*100,1):'—'}%</span></div>
      <div class="insight-row"><strong>流畅度</strong><div class="progress accent"><i style="width:${fmtNum(S.avgFluency,0)}%"></i></div><span class="mono">${fmtNum(S.avgFluency,0)}%</span><span class="muted">平均</span></div>
      <div class="insight-row"><strong>转动数</strong><div class="progress"><i style="width:${Math.min(100,(S.avgTurns||0)/80*100)}%"></i></div><span class="mono">${fmtNum(S.avgTurns,1)}</span><span class="muted">moves</span></div>
      <div class="insight-row"><strong>动作记录</strong><div class="progress accent"><i style="width:${solves.length?replay/solves.length*100:0}%"></i></div><span class="mono">${replay}/${solves.length}</span><span class="muted">深度数据</span></div>
    </div>${weakness?`<div class="callout" style="margin-top:14px">当前 ${method} 最明显弱项：<strong class="warn">${esc(weakness.label)}</strong>，平均比 ${state.goal[method]}s 目标参考慢 <strong>${fmtNum(weakness.variation*100,0)}%</strong>。</div>`:`<div class="callout accent-callout" style="margin-top:14px">当前 ${method} 各阶段相对 ${state.goal[method]}s 目标参考，没有超过 20% 的突出弱项。</div>`}`);
    const caseRows=C.caseStatistics(methodSolves).slice().sort((a,b)=>caseWeaknessScore(b)-caseWeaknessScore(a));
    const topCase=caseRows[0];
    const tips=[];
    if(weakness)tips.push(`<div class="plan-item"><span class="badge">阶段</span><div><strong>优先改善 ${esc(weakness.label)}</strong><p>当前平均比 ${state.goal[method]}s 目标参考慢 ${fmtNum(weakness.variation*100,0)}%。下一组训练先把这一阶段作为主要观察指标。</p></div></div>`);
    if(topCase)tips.push(`<div class="plan-item"><span class="badge accent">Case</span><div><strong>${esc(topCase.caseName)}</strong><p>个人中位 ${fmtMs(topCase.median)}，识别 ${fmtMs(topCase.medianRecognition)}，执行 ${fmtMs(topCase.medianExecution)}，样本 ${topCase.count} 次。建议优先做专项重复。</p></div></div>`);
    if(Number(S.consistency)<70)tips.push(`<div class="plan-item"><span class="badge subtle">稳定性</span><div><strong>先收窄成绩波动</strong><p>当前稳定性 ${fmtNum(S.consistency,0)}%。相比继续追单次 PB，更适合用连续 AO12 观察稳定改善。</p></div></div>`);
    if(!tips.length)tips.push(`<div class="plan-item"><span class="badge good">均衡</span><div><strong>保持完整复原训练</strong><p>当前没有明显阶段或 Case 弱项，继续积累深度记录，让建议基于更多样本更新。</p></div></div>`);
    $('#overviewPlan').outerHTML=panel('下一步训练','基于当前筛选数据生成的本地建议；分析结果直接反哺下一轮训练',`<div class="training-plan">${tips.slice(0,3).join('')}</div>`);

  }

  function renderTrend(solves){
    const el=$('#trendContent');if(!solves.length){el.innerHTML=empty('没有趋势数据','调整筛选条件。');return}
    const metricControls=`<div class="segmented" id="metricSeg">${[['single','Single'],['ao5','AO5'],['ao12','AO12'],['ao100','AO100']].map(([v,l])=>`<button data-v="${v}" class="${state.trendMetric===v?'active':''}">${l}</button>`).join('')}</div><div class="segmented" id="resolutionSeg">${[['grouped','Grouped'],['daily','Daily'],['all','All Points']].map(([v,l])=>`<button data-v="${v}" class="${state.resolution===v?'active':''}">${l}</button>`).join('')}</div>`;
    const trendText=weeklyTrendText(solves);
    el.innerHTML=panel('成绩趋势',(trendText?`${trendText} · `:'')+'提供 Single / AO5 / AO12 / AO100，并支持分组、按日和全部数据点','<div class="chart-box" id="trendChart"></div>',metricControls)+`<div style="height:10px"></div>`+panel('成绩明细','点击任意行查看阶段和 TPS 详情','<div id="historyTable"></div>');
    const values=currentMetricSeries(solves,state.trendMetric);const metric=(s,i)=>values[i];const series=C.groupSeries(solves,metric,state.resolution);
    Ch.lineChart($('#trendChart'),series,{yFormatter:v=>`${(v/1000).toFixed(1)}s`,xFormatter:x=>fmtDate(x,true),tooltip:d=>`${fmtDate(d.x)} · <strong>${fmtMs(d.y)}</strong>`});
    const recent=solves.slice(-120).reverse();
    $('#historyTable').innerHTML=`<div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>TPS</th><th>Turns</th><th>Fluency</th><th>Method</th><th>Session</th><th>Date</th></tr></thead><tbody>${recent.map((s,i)=>`<tr data-id="${esc(s.id)}"><td>${solves.length-i}</td><td class="time-cell ${C.normalizeFlag(s.flag)==='dnf'?'bad':''}">${solveTime(s)}</td><td class="mono">${fmtNum(s.tps)}</td><td class="mono">${fmtNum(s.turnCount,0)}</td><td>${fmtNum(s.fluencyPercent,0)}%</td><td><span class="badge subtle">${esc(s.analysisType)}</span></td><td>${esc(s.session)}</td><td class="muted">${fmtDate(s.date)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#metricSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.trendMetric=b.dataset.v;save();renderTrend(solves)}};
    $('#resolutionSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.resolution=b.dataset.v;save();renderTrend(solves)}};
    $('#historyTable').onclick=e=>{const tr=e.target.closest('tr[data-id]');if(tr)openSolve(solves.find(s=>String(s.id)===tr.dataset.id))};
  }

  /**
   * 分段比例条。
   *
   * 每段宽度 = 该段耗时 ÷ 各段总耗时 ×100%。**不再给 5% 下限** ——
   * 以前 `Math.max(5, 占比%)` 配上 `.split-seg` 的 min-width:38px，
   * 短阶段被硬撑大、长阶段被挤扁，PLL 占 78% 却只画出 1/7（issue #12）。
   *
   * 极短阶段（<1.2%）在比例上已经看不见了，但仍要能 hover 出数值：
   * 给一个 1.2% 的下限只是让它的触摸热区不至于消失，视觉误差被
   * `.split-tiny` 的窄边条吸收，长阶段的比例一眼就能读对。
   */
  function splitStack(rows,total){
    const segs=rows.filter(r=>Number(r.time)>0);
    const sum=Number(total)>0?Number(total):C.sum(segs.map(r=>Number(r.time)||0));
    if(!segs.length||!(sum>0))return '';
    const raw=segs.map(r=>(Number(r.time)||0)/sum*100);
    // 只把极短段抬到 MIN_TINY，多出来的份额从最长段扣，保证合计 100%
    const MIN_TINY=1.2;
    const widths=raw.map(p=>p<MIN_TINY?MIN_TINY:p);
    let over=C.sum(widths)-100;
    if(over>0){
      let longest=0;
      for(let i=1;i<widths.length;i++)if(widths[i]>widths[longest])longest=i;
      widths[longest]=Math.max(MIN_TINY,widths[longest]-over);
    }
    return `<div class="split-stack">${segs.map((r,i)=>{
      const recPct=Number(r.time)?Math.min(100,Math.max(0,(Number(r.recognition)||0)/Number(r.time)*100)):0;
      const tiny=widths[i]<6?' split-tiny':'';
      const pctText=Math.round(raw[i]*10)/10;
      return `<div class="split-seg${tiny}" style="width:${widths[i]}%" title="${esc(r.label)} ${fmtMs(r.time)} · ${pctText}%"><i class="split-rec" style="width:${recPct}%"></i><span class="split-label">${escapeLabel(r.label,widths[i])}</span></div>`;
    }).join('')}</div>`;
  }

  /** 段太窄就别硬塞文字（会溢出到隔壁段上），留给 title 提示 */
  function escapeLabel(label,widthPct){
    const text=String(label==null?'':label);
    if(widthPct<11)return '';
    if(widthPct<22&&text.length>2)return esc(text.slice(0,2));
    return esc(text);
  }

  function renderSplits(solves){
    const el=$('#splitsContent');const method=state.filters.method==='all'?dominantMethod(solves):state.filters.method;const ms=solves.filter(noDnf).filter(s=>s.analysisType===method&&s.steps?.length);
    if(ms.length<1){el.innerHTML=empty('缺少分段分析','需要智能魔方自动分段数据，或导入包含 steps 的训练记录。');return}
    const avg=C.averageSplits(ms,method),total=C.sum(avg.map(x=>Number(x.time)||0));const goal=Number(state.goal[method]||15);const ref=C.referenceSplits(method,goal);const actual=Object.fromEntries(avg.map(x=>[x.key,(x.time||0)/1000]));const an=C.analyzeSplits(method,actual,ref);
    const controls=`<div class="inline-form"><label class="field-label">目标总时间（秒）<input class="goal-input" id="goalInput" type="number" min="3" max="120" step="0.1" value="${goal}"></label><button class="btn" id="goalApply">应用</button></div>`;
    const rows=avg.map(x=>{const rr=an.rows.find(r=>r.key===x.key);const delta=rr?.variation;return{label:x.label,value:x.time||0,delta:Number.isFinite(delta)?`${delta>0?'+':''}${(delta*100).toFixed(0)}%`:'—',deltaClass:delta>0.2?'bad':delta<-.08?'good':'muted'}});
    const body=`<div class="kpi-bar"><div class="kpi-inline"><span class="muted">样本</span><strong>${ms.length}</strong></div><div class="kpi-inline"><span class="muted">平均总时</span><strong>${fmtMs(total)}</strong></div><div class="kpi-inline"><span class="muted">目标</span><strong>${goal.toFixed(1)}s</strong></div></div>${splitStack(avg,total)}<div id="splitBars"></div>`;
    const weak=an.weakest?`<article class="card panel-card weak-card"><div class="weak-title">重点弱项 · ${esc(an.weakest.label)}</div><div class="metric-value">+${fmtNum(an.weakest.variation*100,0)}%</div><p class="muted">${esc(an.weakest.label)} 平均 ${fmtNum(an.weakest.actual,2)}s；${goal}s 目标参考 ${fmtNum(an.weakest.reference,2)}s。只有阶段相对目标参考偏慢超过 20% 才标记为突出弱项。</p></article>`:`<article class="card panel-card"><div class="weak-title good">阶段均衡</div><div class="metric-value">≤20%</div><p class="muted">没有单个阶段比目标参考慢超过 20%。</p></article>`;
    el.innerHTML=panel(`${method} 分段洞察`,ms.length<12?`建议至少积累 12 个带分段的 solve；当前 ${ms.length} 个，先展示已有可计算结果。`:`${ms.length} 个已分析 solve · 识别 / 执行 / TPS`,body,controls)+`<div class="grid-2 grid-equal"><div id="splitDetail"></div>${weak}</div>`;
    Ch.barChart($('#splitBars'),rows,{formatter:v=>fmtMs(v)});
    const detail=`<div class="table-wrap"><table><thead><tr><th>阶段</th><th>Time</th><th>Reference</th><th>Recognition</th><th>Execution</th><th>Turns</th><th>Exec TPS</th></tr></thead><tbody>${avg.map(x=>{const rr=an.rows.find(r=>r.key===x.key);return `<tr><td><strong>${esc(x.label)}</strong></td><td class="mono">${fmtMs(x.time)}</td><td class="mono">${rr?fmtNum(rr.reference,2)+'s':'—'}</td><td class="mono">${fmtMs(x.recognition)}</td><td class="mono">${fmtMs(x.execution)}</td><td class="mono">${fmtNum(x.turns,1)}</td><td class="mono">${fmtNum(x.tps)}</td></tr>`}).join('')}</tbody></table></div>`;
    $('#splitDetail').outerHTML=panel('Recognition / Execution','执行 TPS = turns ÷ execution time；识别时间单独拆出',detail);
    $('#goalApply').onclick=()=>{const v=Number($('#goalInput').value);if(v>=3&&v<=120){state.goal[method]=v;save();renderAll()}else notify('目标时间需在 3–120 秒之间')};
  }

  function renderTPS(solves){
    const el=$('#tpsContent');const method=state.filters.method==='all'?dominantMethod(solves):state.filters.method;
    const replay=solves.filter(noDnf).filter(s=>s.analysisType===method&&C.turnTimestamps(s).length>1&&s.moves?.length===s.timestamps?.length);
    const deep=state.tpsMode==='segregated'?replay.filter(s=>s.steps?.length):replay;
    if(deep.length<1){
      if(state.tpsMode==='segregated'&&replay.length){state.tpsMode='linear';renderTPS(solves);return}
      el.innerHTML=empty('暂无可用 TPS 动作数据','Analyzer 的智能魔方训练会自动保存每步动作与时间戳；只有手工计时或缺少动作数据的导入记录无法生成 TPS 曲线。');return
    }
    const stage=state.tpsMode==='segregated'?C.deriveStageBoundaries(deep,method):[], cumulative=stage.slice(0,-1).map(x=>x.end);
    const sets=deep.map(s=>{const ts=C.turnTimestamps(s);return state.tpsMode==='linear'?C.linearTPSIntervals(ts,s.totalTime):C.segregatedTPSIntervals({...s,timestamps:ts},cumulative)});
    const buckets=C.aggregateTPS(sets,500);const tpsVals=buckets.map(x=>x.tps).filter(Number.isFinite),median=C.median(tpsVals),peak=tpsVals.length?Math.max(...tpsVals):null;
    const controls=`<div class="segmented" id="tpsModeSeg"><button data-v="segregated" class="${state.tpsMode==='segregated'?'active':''}">Segregated</button><button data-v="linear" class="${state.tpsMode==='linear'?'active':''}">Linear</button></div>`;
    el.innerHTML=panel(`${method} TPS Insights`,`${deep.length} 个带原始时间戳的 solve · 500 buckets · 每个 bucket 取中位 TPS`,`<div class="kpi-bar"><div class="kpi-inline"><span class="muted">Median curve TPS</span><strong>${fmtNum(median)}</strong></div><div class="kpi-inline"><span class="muted">Peak bucket</span><strong>${fmtNum(peak)}</strong></div><div class="kpi-inline"><span class="muted">TPS cap</span><strong>20.00</strong></div></div><div class="chart-box" id="tpsChart"></div><div class="legend"><span><i class="accent-dot"></i>Median TPS</span><span><i class="muted-dot"></i>阶段平均边界</span></div>`,controls)+`<div style="height:10px"></div>`+panel('算法说明','该曲线不是移动平均',`<div class="callout accent-callout">每两个相邻动作时间戳形成一个 TPS 区间，TPS = min(1000 / Δt, 20)。一个区间跨过哪些横轴 bucket，就把同一个 TPS 值贡献给所有这些 bucket，最后对每个 bucket 取中位数。Segregated 模式会先把每个 solve 的阶段边界映射到全体平均阶段占比，再聚合，因此更适合比较阶段内部的节奏。</div>`);
    Ch.tpsChart($('#tpsChart'),buckets,{boundaries:state.tpsMode==='segregated'?stage:[]});
    $('#tpsModeSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.tpsMode=b.dataset.v;save();renderTPS(solves)}};
  }

  function localBetterThan(caseRow){
    if(!(caseRow.median>0&&caseRow.p20>0&&caseRow.p80>0))return null;
    const recent=caseRow.values[caseRow.values.length-1]?.total||caseRow.median;
    return C.estimateCaseBetterThan(recent,{medianMs:caseRow.median,p20Ms:caseRow.p20,p80Ms:caseRow.p80});
  }
  function caseWeaknessScore(r){
    const rec=Number(r.medianRecognition)||0,exec=Number(r.medianExecution)||0,median=Number(r.median)||rec+exec;
    const scarcity=r.count<3?450:r.count<6?220:0;
    return median + rec*0.75 + scarcity;
  }
  function caseTier(r,scores){
    if(r.count<3)return{key:'few',label:'样本少'};
    const s=caseWeaknessScore(r),sorted=scores.slice().sort((a,b)=>a-b);
    const q=p=>sorted[Math.min(sorted.length-1,Math.floor(sorted.length*p))];
    if(s>=q(.75))return{key:'weak',label:'薄弱'};
    if(s>=q(.4))return{key:'watch',label:'关注'};
    return{key:'good',label:'稳定'};
  }
  function renderCases(solves){
    const el=$('#casesContent'),all=C.caseStatistics(solves.filter(noDnf)),types=['ALL','OLL','PLL','F2L','CMLL'];
    const filteredRows=state.caseType==='ALL'?all:all.filter(x=>x.caseType===state.caseType);
    const rows=filteredRows.slice().sort(state.caseOrder==='index'?(a,b)=>a.caseType.localeCompare(b.caseType)||Number(a.caseIndex)-Number(b.caseIndex):(a,b)=>caseWeaknessScore(b)-caseWeaknessScore(a));
    const scores=rows.map(caseWeaknessScore);
    const controls=`<div class="segmented" id="caseSeg">${types.map(v=>`<button data-v="${v}" class="${state.caseType===v?'active':''}">${v}</button>`).join('')}</div><div class="segmented" id="caseOrderSeg"><button data-v="weak" class="${state.caseOrder!=='index'?'active':''}">薄弱优先</button><button data-v="index" class="${state.caseOrder==='index'?'active':''}">案例序</button></div>`;
    const priority=rows.slice(0,3);
    const priorityPanel=priority.length?panel('优先训练','按照个人中位耗时、识别时间与样本量综合排序，不使用不可验证的云端排名',`<div class="priority-list">${priority.map((r,i)=>`<div class="priority-row"><span class="priority-rank">${i+1}</span><div><strong>${esc(r.caseName)}</strong><span>${r.caseType} · n=${r.count}</span></div><div><span class="mini-label">Recognition</span><strong class="mono">${fmtMs(r.medianRecognition)}</strong></div><div><span class="mini-label">Execution</span><strong class="mono">${fmtMs(r.medianExecution)}</strong></div></div>`).join('')}</div>`):'';
    const body=rows.length?`<div class="case-grid">${rows.map(r=>{const pct=localBetterThan(r),thumb=caseThumb(r.caseType,r.caseName),tier=caseTier(r,scores);return `<article class="card case-card ${thumb?'with-thumb':''}">${thumb?`<div class="case-thumb" aria-hidden="true">${thumb}</div>`:''}<div class="case-body"><div class="case-top"><span class="case-name">${esc(r.caseName)}</span><span class="badge subtle">n=${r.count}</span></div><div class="case-time">${fmtMs(r.median)}</div><div class="case-meta"><span>识别 <strong class="mono">${fmtMs(r.medianRecognition)}</strong></span><span>执行 <strong class="mono">${fmtMs(r.medianExecution)}</strong></span><span>最快 <strong class="mono">${fmtMs(r.fastest)}</strong></span><span>相对表现 <strong class="mono">${pct==null?'—':pct+'%'}</strong></span></div><div class="case-tier tier-${tier.key}">${tier.label}</div></div></article>`}).join('')}</div>`:empty('没有 Case 数据','需要智能魔方训练中可靠识别到标准 Case。中间状态不会被强行标成 Case。');
    el.innerHTML=priorityPanel+(priorityPanel?'<div style="height:10px"></div>':'')+panel('Case Statistics','按当前弱项优先级排序；总时间 = Recognition + Execution；OLL/PLL/CMLL 配图为该案例状态示意图（矢量 SVG，随配色主题自动跟随）',body,controls)+`<div style="height:10px"></div>`+panel('相对表现','使用你的个人历史数据作为基准',`<div class="callout">相对表现使用该 Case 的个人历史 p20 / median / p80 作为参照，只反映你自己的近期变化，不伪造跨用户排名。</div>`);
    $('#caseSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.caseType=b.dataset.v;renderCases(solves)}};
    const orderSeg=$('#caseOrderSeg');
    if(orderSeg)orderSeg.onclick=e=>{const b=e.target.closest('button[data-v]');if(b){xp.caseOrder=b.dataset.v;saveXp();renderCases(solves)}};
  }

  function renderSolves(solves){
    const el=$('#solvesContent');if(!solves.length){el.innerHTML=empty('没有单次数据','调整筛选条件。');return}
    const rows=solves.slice().reverse().slice(0,300);
    // 判罚与删除放在这里（训练页只留看的能力）—— 改记录本来就不该在训练时顺手做
    el.innerHTML=panel('单次复盘',`显示最近 ${rows.length} / ${solves.length} 次；点击查看本次训练详情；▶ 可直接录像回放；⚠ 为异常标记记录（保留在列表，已从统计中排除）`,`<div class="solve-list">${rows.map(s=>`<article class="card solve-row-card" data-id="${esc(s.id)}"><div><div class="solve-time ${C.normalizeFlag(s.flag)==='dnf'?'bad':''}">${solveTime(s)}</div><div class="solve-date">${fmtDate(s.date)}${Q&&Q.active(s)?' <span class="anomaly-flag" title="'+esc(Q.label(s.anomaly))+'">⚠ 异常</span>':''}</div></div><div><strong>${esc(s.analysisType)}</strong><span class="mini-label">${esc(s.session)}</span></div><div class="data-col"><span class="mini-label">TPS</span><span class="mono">${fmtNum(s.tps)}</span></div><div class="data-col"><span class="mini-label">Turns</span><span class="mono">${fmtNum(s.turnCount,0)}</span></div><div class="optional-col data-col"><span class="mini-label">Fluency</span><span class="mono">${fmtNum(s.fluencyPercent,0)}%</span></div><div class="optional-col data-col"><span class="mini-label">Device</span><span>${esc(s.device)}</span></div><div class="row-actions">${Replay&&Replay.available(s)?`<button type="button" class="replay-entry" data-replay="${esc(s.id)}" title="录像回放">▶</button>`:''}<button type="button" class="solve-entry" data-penalty="plus_two" data-id="${esc(s.id)}" title="本把加 2 秒">+2</button><button type="button" class="solve-entry" data-penalty="dnf" data-id="${esc(s.id)}" title="标记为 DNF">DNF</button><button type="button" class="solve-entry danger" data-delete="${esc(s.id)}" title="删除这条记录">删</button><span class="accent">›</span></div></article>`).join('')}</div>`);
    el.onclick=e=>{
      const rp=e.target.closest('[data-replay]');
      if(rp){e.stopPropagation();openReplay(solves.find(s=>String(s.id)===rp.dataset.replay));return}
      const p=e.target.closest('[data-penalty]'),del=e.target.closest('[data-delete]');
      if(p){e.stopPropagation();changePenalty(p.dataset.id,p.dataset.penalty);return}
      if(del){e.stopPropagation();deleteSolve(del.dataset.delete);return}
      const row=e.target.closest('[data-id]');if(row)openSolve(solves.find(s=>String(s.id)===row.dataset.id))
    };
  }

  function detailSteps(s){
    const raw=(s.steps||[]).filter(x=>Number(x.time)>0);
    if(s.analysisType!=='CFOP')return raw;
    const subs=raw.filter(x=>String(x.name||x.key)==='F2L'&&x.slotIndex);
    if(!subs.length)return raw;
    return raw.filter(x=>!(String(x.name||x.key)==='F2L'&&!x.slotIndex));
  }
  function openSolve(s){
    if(!s)return;const modal=$('#solveModal'),body=$('#solveModalBody');$('#solveModalTitle').textContent=`${s.analysisType} · ${solveTime(s)}`;
    const steps=detailSteps(s),total=C.sum(steps.map(x=>Number(x.time)||0));
    const turnTs=C.turnTimestamps(s);const lastTurn=turnTs.length?turnTs[turnTs.length-1]:null;
    const reaction=Number.isFinite(lastTurn)&&Number(s.totalTime)>lastTurn?Number(s.totalTime)-lastTurn:null;
    const rows=steps.map(x=>{const label=x.slotIndex?`F2L ${x.slotIndex}`:(x.label||x.name||x.key||'Stage');const caseText=x.caseName||((x.caseType&&x.caseIndex!=null)?`${x.caseType} ${x.caseIndex}`:'—');const aufText=x.auf&&x.auf.count?`${esc(x.auf.pre.join(' ')||'—')} → ${esc(x.auf.post.join(' ')||'—')}`:'—';return `<tr><td><strong>${esc(label)}</strong></td><td>${esc(caseText)}</td><td>${aufText}</td><td class="mono">${fmtMs(x.time)}</td><td class="mono">${fmtMs(x.recognition)}</td><td class="mono">${fmtMs(x.execution)}</td><td class="mono">${fmtNum(x.turns,0)}</td><td class="mono">${Number(x.execution)>0?fmtNum(Number(x.turns||0)*1000/Number(x.execution)):'—'}</td></tr>`}).join('');
    body.innerHTML=`${Q&&Q.active(s)?`<div class="callout" style="margin-bottom:10px"><strong>异常标记</strong> · ${esc(Q.label(s.anomaly))}；本条已从统计中排除（记录原样保留，可在数据体检中确认为误报后恢复纳入）。</div>`:''}<div class="detail-grid"><div class="detail-item"><span class="mini-label">Time</span><strong>${solveTime(s)}</strong></div><div class="detail-item"><span class="mini-label">TPS</span><strong>${fmtNum(s.tps)}</strong></div><div class="detail-item"><span class="mini-label">Turns</span><strong>${fmtNum(s.turnCount,0)}</strong></div><div class="detail-item"><span class="mini-label">Fluency</span><strong>${fmtNum(s.fluencyPercent,0)}%</strong></div></div>${steps.length?splitStack(steps,total):''}<div class="table-wrap"><table><thead><tr><th>Stage</th><th>Case</th><th>AUF</th><th>Time</th><th>Recognition</th><th>Execution</th><th>Turns</th><th>Exec TPS</th></tr></thead><tbody>${rows||'<tr><td colspan="8">无法可靠分段；保留原始动作与成绩，不生成猜测阶段。</td></tr>'}</tbody></table></div><div style="height:10px"></div><div class="callout"><strong>Scramble</strong><br><span class="mono">${esc(s.scramble||'—')}</span><br><br><strong>动作记录</strong> · ${s.timestamps?.length||0} logical events · ${s.rawSolutionSequence?.reduce((n,x)=>n+(Array.isArray(x.rawMoves)&&x.rawMoves.length?x.rawMoves.length:1),0)||s.timestamps?.length||0} raw moves · ${esc(s.device)}<br><strong>数据源</strong> · ${esc(s.source||'import')}<br><strong>解法方位</strong> · ${s.analysisFrame?.autoDetected?(s.analysisFrame.crossFace?`识别底面 ${esc(s.analysisFrame.crossFace)}`:'六色底 / 任意持握自动识别'):'未可靠识别'}${reaction!=null?`<br><strong>复原后停表反应</strong> · ${fmtMs(reaction)}（不计入最后阶段执行时间）`:''}</div><div class="solve-detail-actions">${Replay&&Replay.available(s)?`<button class="btn btn-primary" id="openReplayBtn" type="button">录像回放</button>`:''}<button class="btn btn-ghost" id="askAiBtn" type="button">问 AI · 分析这把</button></div><div id="askAiHost"></div>`;
    const askBtn=$('#askAiBtn');
    if(askBtn)askBtn.onclick=()=>{if(window.CubeAnalyzerAI)CubeAnalyzerAI.askSolve(s,$('#askAiHost'));else notify('AI 模块未加载')};
    const replayBtn=$('#openReplayBtn');
    if(replayBtn)replayBtn.onclick=()=>{openReplay(s)};
    modal.hidden=false;
  }

  /* —— 录像回放入口（2026-10-12）——
   * 回放是独立的全屏弹窗：从单次详情进入时先把详情弹窗收起，避免两层遮罩叠在一起。
   * 关闭回放后由 window._replayOnClose 决定是否把详情弹窗再放回来。 */
  function openReplay(s){
    if(!s)return;
    if(!Replay||!Replay.available(s)){notify('这条记录没有完整的动作时间戳，无法回放');return}
    const detailWasOpen=!$('#solveModal').hidden;
    if(detailWasOpen)$('#solveModal').hidden=true;
    window._replayOnClose=detailWasOpen?()=>{ if(s)openSolve(s) }:(null);
    if(!Replay.open(s)){
      window._replayOnClose=null;
      if(detailWasOpen)openSolve(s);
    }
  }



  /* —— 数据体检面板：异常记录只展示与标注，绝不修改/删除（2026-09-29）—— */
  function openQuality(){
    if(!Q)return;
    const bad=state.solves.filter(s=>Q.active(s));
    const modal=$('#solveModal'),body=$('#solveModalBody');$('#solveModalTitle').textContent='数据体检';
    body.innerHTML=(bad.length?`<div class="callout" style="margin-bottom:10px">检出 <strong>${bad.length}</strong> 条异常记录。处理原则：<strong>只做标记、绝不修改或删除</strong>——说不定其中就有一次很优秀的解法流复原。分析统计（趋势 / AO / 分段 / Case / AI）已自动排除，记录仍保留在列表与总计数中；确认为误报后可一键恢复纳入。</div><div class="quality-list">${bad.map(s=>`<div class="quality-row card"><div><div class="solve-time ${C.normalizeFlag(s.flag)==='dnf'?'bad':''}">${solveTime(s)}</div><div class="solve-date">${fmtDate(s.date)}</div></div><div><strong>${esc(s.analysisType)}</strong><span class="mini-label">${esc(s.session)} · ${esc(s.device||'')}</span></div><div><span class="anomaly-flag">⚠ ${esc(Q.label(s.anomaly))}</span></div><div><button class="btn btn-ghost" data-unflag="${esc(s.id)}" style="min-height:30px">误报恢复</button></div></div>`).join('')}</div>`:empty('数据体检通过','没有检出异常记录。检测项：用时无效 / 过短（<2s）/ 过长（>10min）/ 动作数据缺失 / 时间戳倒挂。'));
    body.onclick=e=>{const b=e.target.closest('[data-unflag]');if(!b)return;const rec=state.solves.find(x=>String(x.id)===b.dataset.unflag);if(rec){rec.anomalyCleared=true;save(false);renderAll();openQuality();notify('已恢复纳入分析')}};
    modal.hidden=false;
  }

  function renderDatasetMeta(solves){
    $('#datasetName').textContent=state.datasetName;$('#datasetCount').textContent=`${solves.length} solves`;
    const deep=solves.filter(s=>s.timestamps?.length>1).length,split=solves.filter(s=>s.steps?.length).length;
    const b=$('#deepDataBadge');b.textContent=deep?`${deep} 完整动作 · ${split} 已分段`:`${split} 已分段 · 无完整动作`;b.className=`badge ${deep?'accent':'subtle'}`;
    const qb=$('#qualityBtn');
    if(qb){const bad=Q?solves.filter(s=>Q.active(s)).length:0;qb.hidden=!bad;qb.textContent=`体检 ${bad}`;}
  }

  /* —— 基线与周趋势（2026-09-29 融入）—— */
  // 基线：最近 1000 把有效成绩（DNF 与异常记录排除，+2 已计入），照 AI_CFOP 口径。
  function baselineStats(){
    const all=analyzable(state.solves);
    if(all.length<10)return null;
    const slice=all.slice(-1000);
    const bt=slice.map(s=>C.displayTimeMs(s)).filter(Number.isFinite);
    if(bt.length<10)return null;
    const mean=bt.reduce((a,b)=>a+b,0)/bt.length;
    const todayKey=new Date().toDateString();
    const today=slice.filter(s=>new Date(s.date).toDateString()===todayKey);
    const tt=today.map(s=>C.displayTimeMs(s)).filter(Number.isFinite);
    const todayMean=tt.length?tt.reduce((a,b)=>a+b,0)/tt.length:null;
    return {count:bt.length,mean,best:Math.min(...bt),todayCount:tt.length,todayMean};
  }
  // 周趋势：近 7 天 vs 前 7 天均值（本地规则，不耗 AI）。
  function weeklyTrendText(solves){
    const valid=analyzable(solves);
    const now=Date.now(),d7=now-7*86400000,d14=now-14*86400000;
    const cur=valid.filter(s=>{const t=new Date(s.date).getTime();return t>=d7&&t<=now});
    const prev=valid.filter(s=>{const t=new Date(s.date).getTime();return t>=d14&&t<d7});
    if(cur.length<3||prev.length<3)return null;
    const cm=cur.map(s=>C.displayTimeMs(s)).filter(Number.isFinite),pm=prev.map(s=>C.displayTimeMs(s)).filter(Number.isFinite);
    if(!cm.length||!pm.length)return null;
    const c=cm.reduce((a,b)=>a+b,0)/cm.length,p=pm.reduce((a,b)=>a+b,0)/pm.length;
    const diff=(c-p)/p;
    if(!Number.isFinite(diff))return null;
    if(Math.abs(diff)<0.03)return `近 7 天较上周基本持平（${diff>=0?'+':''}${(diff*100).toFixed(1)}%）`;
    return diff<0?`近 7 天较上周快 ${Math.abs(diff*100).toFixed(1)}%`:`近 7 天较上周慢 ${(diff*100).toFixed(1)}%`;
  }
  /**
   * Case 卡配图（2026-11-24 换掉静态 SVG）。
   * 以前是去 assets/cases/ 取 78 张预渲染好的文件；现在 assets/cases/ 已经删了，
   * 改成用 Cube/assets/cube-figure/ 现场出图。
   *
   * 数据源统一到 Cube/Formula/assets/DB.json（与 Formula 页面同一份）：
   *   CubeCaseData.svg() 从 DB 取 faces（PLL 还有 arrows），交给 CubeFigure 画。
   *
   * DB 是异步取的，所以这里分两步：数据没到时先返回 null（卡片退成无图），
   * 同时触发一次加载，到货后自动重绘 Case 面板。
   */
  function caseThumb(type,name){
    const t=String(type||'').toUpperCase();
    if(t!=='OLL'&&t!=='PLL'&&t!=='CMLL')return null; // F2L 暂无配图
    if(!window.CubeCaseData||!window.CubeFigure)return null;
    try{
      return window.CubeCaseData.svg(t,String(name||''),{view:'net',palette:'site',size:75});
    }catch(e){return null}
  }

  function renderAll(){const s=filtered();renderDatasetMeta(s);const st=analyzable(s);renderOverview(st);renderTrend(st);renderSplits(st);renderTPS(st);renderCases(st);renderSolves(s)}

  async function importFiles(files){
    const all=[];for(const file of files){const text=await file.text();const parsed=I.parseAny(text,file.name).map(upgradeSolve);all.push(...parsed)}
    if(!all.length)throw new Error('没有识别到有效 solve');state.solves=all.sort((a,b)=>new Date(a.date)-new Date(b.date));state.datasetName=files.length===1?files[0].name:`${files.length} 个文件`;state.filters={method:'all',session:'all',device:'all',start:'',end:''};syncFilterUI();refreshFilterOptions();save();renderAll();notify(`已导入 ${all.length} 条记录`)
  }
  /**
   * 筛选栏摘要 + 窄屏折叠（2026-11-15）。
   * 窄屏五个控件各占一行会把首屏吃掉一半，所以默认收起，只在标题旁给一行
   * 「当前在筛什么」；点一下才展开完整筛选。宽屏不显示这个开关，行为不变。
   */
  function renderFilterSummary(){
    const sum=$('#filterSummary');if(!sum)return;
    const f=state.filters,parts=[];
    if(f.method&&f.method!=='all')parts.push(f.method);
    if(f.session&&f.session!=='all')parts.push(f.session);
    if(f.device&&f.device!=='all')parts.push(f.device);
    if(f.start)parts.push(`${f.start} 起`);
    if(f.end)parts.push(`${f.end} 止`);
    sum.textContent=parts.length?parts.join(' · '):'全部数据';
    sum.classList.toggle('is-active',parts.length>0);
  }

  function syncFilterUI(){
    $('#methodFilter').value=state.filters.method;$('#sessionFilter').value=state.filters.session;$('#deviceFilter').value=state.filters.device;$('#startDate').value=state.filters.start;$('#endDate').value=state.filters.end;
    renderFilterSummary();
  }

  const trainer={
    phase:'scramble',freeScramble:false,scramble:'',scrambleMoves:[],scrambleObservedMoves:[],scrambleViewStore:null,scrambleTargetFacelet:'',scrambleBaseReady:false,scrambleComplete:false,
    /* 起点未必是复原态（2026-11-19）：非自由打乱时按「当前状态 → WCA 打乱态」反算一段等价公式，
       wcaScramble 只作为占位与落点基准，真正的公式落在 scrambleMoves 上。 */
    scrambleBaseFacelet:'',wcaScramble:[],scrambleDeriving:false,scramblePendingBase:false,freeScrambleTarget:null,
    /* 自由打乱期间的原始转动记录（只攒着，结束时一次性算公式） */
    scrambleFreeMoves:[],
    moves:[],timestamps:[],rawSolutionSequence:[],snapshots:[],gyroSamples:[],startFacelet:'',startedAt:0,startedEpoch:0,
    inspectionStartedAt:0,inspectionPenalty:'ok',raf:0,lastSolved:false,timingMode:'pending'
  };
  const AXIS={U:'UD',D:'UD',R:'RL',L:'RL',F:'FB',B:'FB'};
  const MOVE_RE=/^([URFDLB])(?:([2])|('))?$/;

  function setTheme(theme){
    theme=theme==='light'?'light':'dark';
    document.documentElement.dataset.theme=theme;
    localStorage.setItem('smartCubeTheme',theme);
    const btn=document.getElementById('siteThemeToggle');if(btn)btn.textContent=theme==='dark'?'☀':'☾';
    try{if(window.globalDataManager&&typeof window.globalDataManager.saveThemePreference==='function')window.globalDataManager.saveThemePreference(theme)}catch(e){}
  }

  function updateCloudIndicator(text){
    const el=$('#cloudState');if(!el)return;
    if(text){el.textContent=text;return}
    el.textContent=window.authManager&&window.authManager.isLoggedIn()?'Supabase 已连接':'游客 · 本地保存';
  }

  function switchWorkspace(mode){
    state.workspaceMode=mode==='analysis'?'analysis':'training';
    document.body.dataset.workspace=state.workspaceMode;
    $$('.mode-switch-btn').forEach(b=>{const active=b.dataset.mode===state.workspaceMode;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false')});
    $$('.workspace-panel').forEach(p=>p.classList.toggle('active',p.dataset.workspace===state.workspaceMode));
    if(state.workspaceMode==='analysis'){refreshFilterOptions();syncFilterUI();renderAll();syncFilterCollapse()}
  }

  /**
   * 窄屏筛选栏折叠：默认收起，只留一行摘要。
   * 必须在**每次进入分析页**时按当前宽度重算 —— 原来只在 init 里判断一次，
   * 于是「宽屏进来、缩窄或切到分析页」时筛选栏一直是展开的，把首屏占满。
   */
  function syncFilterCollapse(){
    const fb=$('#filterBar'),ft=$('#filterToggle');
    if(!fb||!ft)return;
    if(window.innerWidth>760){
      // 宽屏：始终展开，折叠按钮由 CSS 隐藏
      fb.dataset.collapsed='false';ft.setAttribute('aria-expanded','true');
      return;
    }
    // 窄屏：保留用户本次会话的手动选择，没选过就默认收起
    const userSet=fb.dataset.userToggled==='true';
    const collapsed=userSet?fb.dataset.collapsed==='true':true;
    fb.dataset.collapsed=collapsed?'true':'false';
    ft.setAttribute('aria-expanded',collapsed?'false':'true');
  }

  function parseMove(move){
    const m=String(move||'').trim().replace(/[’`]/g,"'").match(MOVE_RE);if(!m)return null;
    return {face:m[1],power:m[2]?2:(m[3]?3:1)};
  }
  function moveText(face,power){power=((power%4)+4)%4;return power===1?face:power===2?face+'2':power===3?face+"'":''}
  function simplifyMoves(moves){
    const out=[];
    for(const raw of moves||[]){const m=parseMove(raw);if(!m)continue;const last=out[out.length-1];if(last&&last.face===m.face){last.power=(last.power+m.power)%4;if(!last.power)out.pop()}else out.push({face:m.face,power:m.power})}
    return out.map(m=>moveText(m.face,m.power));
  }
  function sameFacelet(a,b){return !!a&&!!b&&String(a).trim()===String(b).trim()}
  function solvedFacelet(){return window.mathlib&&window.mathlib.SOLVED_FACELET?window.mathlib.SOLVED_FACELET:''}
  function faceletAfterMoves(moves){return faceletFromState('',moves)}
  /** 从任意起点走一段转动得到面位；起点为空按复原态算，解析失败返回空串 */
  function faceletFromState(base,moves){
    try{
      if(!window.mathlib||!window.mathlib.CubieCube||!window.mathlib.SOLVED_FACELET)return'';
      const cube=new window.mathlib.CubieCube();
      const from=String(base||'').trim();
      if(from.length>=54){ if(cube.fromFacelet(from)===-1)return''; }
      else if(cube.fromFacelet(window.mathlib.SOLVED_FACELET)===-1)return'';
      (moves||[]).forEach(m=>cube.selfMoveStr(m));
      return cube.toFaceCube();
    }catch(e){console.warn('Scramble state build failed',e);return''}
  }

  /* ---------- 状态求解与反算（2026-11-19） ----------
   * 一条铁律：**绝不让用户先把魔方拧回复原态**。
   *   cubejs 的 solve(facelet) = 「把这个状态拧回复原」，所以：
   *     · 反算「从复原拧到这个状态」的等价打乱 = solve(facelet) 取逆（≤22 步）。
   *
   * 【为什么走 Worker】求解器首次建表实测 ~1.4s，是同步计算。放在主线程会卡住
   * 计时器的 rAF 循环 —— 而「结束打乱」之后用户随时可能起表，这一卡正好落在
   * 最不该卡的时刻。所以反算一律丢给 scramble-worker.js，主线程不参与；
   * Worker 不可用时才退回主线程同步计算（并接受一次性建表代价）。
   * ---------------------------------------------------------- */
  let solverReady=false, solverBroken=false;
  function warmSolver(){
    if(solverReady)return true;
    if(solverBroken)return false;
    const S=window.Cube;
    if(!S||typeof S.initSolver!=='function'||typeof S.fromString!=='function'){solverBroken=true;return false}
    try{S.initSolver();solverReady=true}catch(e){solverBroken=true;console.warn('Scramble solver init failed',e)}
    return solverReady;
  }
  /** 复原 → facelet 的解法（token 数组）；无法求解返回 null，复原态返回 [] */
  function solveFromSolved(facelet){
    const f=String(facelet||'').trim();
    if(f.length!==54)return null;
    if(sameFacelet(f,solvedFacelet()))return[];
    const S=window.Cube;
    if(!S||typeof S.fromString!=='function')return null;
    if(!warmSolver())return null;
    try{
      const sol=String(S.fromString(f).solve()||'').trim().split(/\s+/).filter(Boolean);
      return sol.length?sol:null;
    }catch(e){console.warn('Scramble solve failed',e);return null}
  }
  /** 单个 token 取逆（X2 不变） */
  function invertTokens(tokens){
    return (tokens||[]).slice().reverse().map(t=>t.endsWith('2')?t:(t.endsWith("'")?t.slice(0,-1):t+"'"));
  }
  /** 状态 → 「从复原拧到这里」的等价打乱（≤22 步）；无法反算返回 null，复原态返回 [] */
  function scrambleFromFacelet(facelet){
    const sol=solveFromSolved(facelet);
    return sol?invertTokens(sol):null;
  }

  /* ---------- Worker 通道 ----------
   * 一次只跑一个请求；结果按 id 回调。Worker 起不来说明环境不支持，
   * 这时才让调用方退回主线程版本，保证功能不丢。
   *
   * 【排队语义】Worker 起手要先建表（~1.4s）。旧实现里这期间的请求会直接
   * 回 null，调用方就退化成「原始转动记录」那条粗公式 —— 明明能算出精确公式却没用上。
   * 现在改成：请求一律发过去，由 Worker 自己排队，建完表按序回答。 */
  const workerState={worker:null,broken:false,seq:0,pending:new Map(),ready:false};
  function ensureWorker(){
    if(workerState.worker)return workerState.worker;
    if(workerState.broken)return null;
    if(typeof Worker!=='function'){workerState.broken=true;return null}
    try{
      // 带版本号，避免旧 Worker 被缓存（与 index.html 里的 ?v= 同口径）
      const w=new Worker('./assets/scramble-worker.js?v=2875');
      w.onmessage=e=>{
        const d=e.data||{};
        if(d.type==='ready'){workerState.ready=true;return}
        const cb=workerState.pending.get(d.id);
        if(cb){workerState.pending.delete(d.id);cb(d.ok?d.moves:null)}
      };
      w.onerror=()=>{workerState.broken=true;workerState.worker=null;
        // 已挂起的请求全部按失败结束，让调用方走兜底
        workerState.pending.forEach(cb=>cb(null));workerState.pending.clear()};
      workerState.worker=w;
      return w;
    }catch(e){workerState.broken=true;return null}
  }
  /**
   * 在 Worker 里反算等价打乱（不阻塞主线程）。
   * 建表期间发来的请求照样排队，不预先回 null —— 交给 Worker 按序答。
   * 只有 Worker 根本起不来（环境不支持）才 done(null)，让调用方兜底。
   */
  function scrambleFromFaceletAsync(facelet,done){
    const w=ensureWorker();
    if(!w){done(null);return}
    const id=++workerState.seq;
    workerState.pending.set(id,done);
    try{w.postMessage({type:'scramble',id,facelet:String(facelet||'')})}
    catch(e){workerState.pending.delete(id);done(null)}
  }

  /** 换打乱时让在途结果作废 */
  let deriveSeq=0;
  function cancelDerive(){deriveSeq++;trainer.scrambleDeriving=false}

  function randomScramble(length=20){
    const faces=['U','R','F','D','L','B'],suffix=['',"'",'2'];let out=[],lastFace='',axisRun=[];
    while(out.length<length){
      const face=faces[Math.floor(Math.random()*faces.length)],axis=AXIS[face];
      if(face===lastFace)continue;
      if(axisRun.length>=2&&axisRun[axisRun.length-1]===axis&&axisRun[axisRun.length-2]===axis)continue;
      out.push(face+suffix[Math.floor(Math.random()*suffix.length)]);lastFace=face;axisRun.push(axis);if(axisRun.length>2)axisRun.shift();
    }
    return out.join(' ');
  }

  /* 打乱公式动态视图：整个功能块（算法 + HTML + 三态配色）在 /Cube/assets/scramble/（与 Cross 共用一份） */
  function computeScrambleView(){
    if(!trainer.scrambleViewStore)trainer.scrambleViewStore={};
    return ScrambleView.compute({
      observed:trainer.scrambleObservedMoves,
      target:trainer.scrambleMoves,
      store:trainer.scrambleViewStore,
      fixMode:'lte'
    });
  }

  /**
   * 自由打乱模式（2026-11-15 收进控制栏复选框）：
   * 开 = 不给出目标公式，自己随便拧；转动记录实时反算出「已拧出的打乱公式」并显示，
   * 拧完按「打乱完成」或空格即落定本把。关 = 常规按公式打乱。
   * 切换只在打乱阶段生效，计时中不动它（避免中途把目标序列换掉）。
   */
  function applyFreeScramble(on){
    on=!!on;
    // 计时中不切：把勾选退回用户原来那一边，别让复选框与真实模式对不上
    if(trainer.phase==='running'||trainer.phase==='inspection'){
      xp.freeScramble=!on;saveXp();syncFreeToggle();notify('计时中不能切换打乱方式');return;
    }
    xp.freeScramble=on;saveXp();syncFreeToggle();
    if(on)startFreeScramble();else nextScramble();
  }

  function syncFreeToggle(){
    // 复选框反映「模式偏好」（跨把保持），而不是本把的临时状态
    const t=$('#freeScrambleToggle');if(t)t.checked=!!xp.freeScramble;
  }

  /**
   * 打乱公式与计时数字的字号自适应（2026-11-16）：
   *
   * 两者抢同一张卡片的高度，所以一起算，按「计时数字必须明显大于打乱公式」来分配：
   *   1. 打乱先按上限尝试 —— 正好铺满三行，且不允许出现第四行；
   *   2. 计时数字吃掉剩下的高度（二分找不溢出、不超宽的最大字号）；
   *   3. 若计时数字还没比打乱公式大到 TIMER_SCRAMBLE_RATIO 倍，就把打乱压小、把高度让给它。
   *
   * 打乱过程中每转一步都会重新渲染，字号不变但会被重算 —— 用「步数 + 可用尺寸 + 上限」
   * 做键缓存，命中就直接套用上次的结果；卡片尺寸变化时由 observeTrainerFit 清键重算。
   */
  const SCRAMBLE_MAX_LINES=3;
  const SCRAMBLE_FONT_MAX=72;      // 上限：超宽屏上也不许再涨
  const SCRAMBLE_FONT_MIN=10;      // 下限：极端长公式时还能再缩一档
  const SCRAMBLE_TAPE_MAX_RATIO=0.42; // 打乱带最多占计时卡高度的这个比例（剩下留给计时）
  /* 计时区（状态行 + 数字 + 说明行 + 按钮）最多用到可用高度的这个比例，剩下的**故意空着**。
     这条不能省 —— 一旦允许"撑满"，内容就会顶到边界、居中后没有余量，
     视觉上永远一样挤，加多少 margin 都会被字号吃掉。 */
  const TIMER_FILL_RATIO=0.88;
  const TIMER_FONT_MAX=320;        // 计时数字上限
  const TIMER_FONT_MIN=40;         // 计时数字下限
  const TIMER_SCRAMBLE_RATIO=1.5;  // 计时数字至少要是打乱公式的 1.5 倍

  function scrambleLineCount(){
    const el=$('#scrambleText');
    if(!el)return 0;
    const tops=[...el.querySelectorAll('.scramble-step')].map(s=>Math.round(s.getBoundingClientRect().top)).sort((a,b)=>a-b);
    if(!tops.length)return el.textContent.trim()?1:0;
    let lines=1;
    for(let i=1;i<tops.length;i++)if(tops[i]-tops[i-1]>2)lines++;
    return lines;
  }

  /** 打乱带当前高度是否还在「允许它吃的上限」之内 */
  function tapeWithinBudget(){
    const tape=$('.scramble-tape'),card=$('.timer-card');
    if(!tape||!card)return true;
    return tape.getBoundingClientRect().height<=card.clientHeight*SCRAMBLE_TAPE_MAX_RATIO;
  }

  /** 打乱公式：在 [MIN, cap] 里找最大的、不出四行也不挤扁计时区的字号 */
  function fitScrambleFont(capPx){
    const el=$('#scrambleText'),card=$('.timer-card'),hero=$('.timer-hero');
    if(!el||!card)return 0;
    const steps=el.querySelectorAll('.scramble-step').length;
    const cardH=card.clientHeight;
    if(!steps){el.style.fontSize='';el.dataset.fitKey='';el.dataset.fitPx='';return 0}
    if(cardH<=0)return 0;                                // 卡片不可见（分析页）先不算，等它显示
    const cap=Math.max(SCRAMBLE_FONT_MIN,Math.min(SCRAMBLE_FONT_MAX,Math.round(capPx||SCRAMBLE_FONT_MAX)));
    const key=`${steps}|${Math.round(el.getBoundingClientRect().width)}|${cardH}|${cap}`;
    if(el.dataset.fitKey===key&&el.dataset.fitPx){el.style.fontSize=`${el.dataset.fitPx}px`;return Number(el.dataset.fitPx)}
    // 一档字号「放得下」判据：公式不出第四行、打乱带不超预算、且计时区没被压扁
    const fits=()=>card.scrollHeight<=card.clientHeight+1
      &&(!hero||hero.scrollHeight<=hero.clientHeight+1)
      &&scrambleLineCount()<=SCRAMBLE_MAX_LINES
      &&tapeWithinBudget();
    el.style.maxHeight='';el.style.overflowY='';
    let lo=SCRAMBLE_FONT_MIN,hi=cap,best=SCRAMBLE_FONT_MIN;
    while(hi-lo>1){
      const px=Math.round((lo+hi)/2);
      el.style.fontSize=`${px}px`;
      if(fits()){best=px;lo=px}else hi=px;
    }
    el.style.fontSize=`${best}px`;
    // 极端情况（自由打乱攒了几十步）：最小字号也压不进三行，就在三行的高度里滚动，
    // 保证计时卡不被撑破、页面上也不出现第四排。
    if(scrambleLineCount()>SCRAMBLE_MAX_LINES){
      const lh=parseFloat(getComputedStyle(el).lineHeight)||best*1.22;
      el.style.maxHeight=`${Math.round(lh*SCRAMBLE_MAX_LINES)}px`;
      el.style.overflowY='auto';
    }
    el.dataset.fitKey=key;el.dataset.fitPx=String(best);
    return best;
  }

  /** 计时数字：在 [MIN, MAX] 里找最大的、不撑破计时区也不超出卡宽的字号 */
  function fitTimerValue(){
    const val=$('#timerValue'),card=$('.timer-card'),hero=$('.timer-hero');
    if(!val||!card||!hero)return 0;
    const cardH=card.clientHeight;
    if(cardH<=0)return 0;
    // 数字是等宽表格数字、位数固定，计时中每帧换文本不会改变布局 —— 键里只放布局尺寸，
    // 免得每一帧都重跑一遍二分（8 次强制重排）。
    const key=`${Math.round(card.clientWidth)}x${cardH}`;
    if(val.dataset.fitKey===key&&val.dataset.fitPx){val.style.fontSize=`${val.dataset.fitPx}px`;return Number(val.dataset.fitPx)}
    // 按「最长的样子」量：计时中可以跑到三位数秒（888.88，六格），
    // 若只按此刻的 0.00 去量，真跑起来就会横向顶出卡片。
    const real=val.textContent;
    val.textContent='888.88';
    // 量的是「计时区整块内容」的高度（状态行 + 数字 + 说明行 + 按钮），
    // 只留 TIMER_FILL_RATIO 那么多，剩下的空着 —— 居中后就是上下各一份真留白。
    const stage=$('.timer-stage'),actions=$('.timer-actions');
    const contentH=()=>{
      const s=stage?stage.getBoundingClientRect().height:0;
      const a=actions?actions.getBoundingClientRect().height+parseFloat(getComputedStyle(actions).marginTop||0):0;
      return s+a;
    };
    const fits=()=>hero.scrollHeight<=hero.clientHeight+1
      &&card.scrollHeight<=card.clientHeight+1
      &&val.getBoundingClientRect().width<=hero.clientWidth
      &&contentH()<=hero.clientHeight*TIMER_FILL_RATIO;
    let lo=TIMER_FONT_MIN,hi=TIMER_FONT_MAX,best=TIMER_FONT_MIN;
    while(hi-lo>1){
      const px=Math.round((lo+hi)/2);
      val.style.fontSize=`${px}px`;
      if(fits()){best=px;lo=px}else hi=px;
    }
    val.textContent=real;
    val.style.fontSize=`${best}px`;
    val.dataset.fitKey=key;val.dataset.fitPx=String(best);
    return best;
  }

  /** 打乱与计时一起排：先给打乱，再把剩下的给计时，最后保证计时数字明显更大 */
  function fitTrainerStage(){
    const val=$('#timerValue'),el=$('#scrambleText'),card=$('.timer-card');
    if(!el||!val||!card||card.clientHeight<=0)return;
    // 整块排一次要跑两轮二分（十几趟强制重排）。打乱阶段每转一步都会重算，
    // 所以先在「公式步数 + 两边宽度 + 卡片高度」上记一笔，没变化就直接返回。
    const steps=el.querySelectorAll('.scramble-step').length;
    const stageKey=`${steps}|${Math.round(el.getBoundingClientRect().width)}|${Math.round(card.clientWidth)}x${card.clientHeight}`;
    if(!steps){el.style.fontSize='';el.dataset.fitKey='';el.dataset.fitPx='';return}
    if(val.dataset.stageKey===stageKey&&val.dataset.fitPx)return;
    // 先把计时数字收到最小 —— 否则它上一次算出来的大字号会压低「计时区还有多少空间」，
    // 让打乱公式被莫名压小，同一块屏幕上里外两次结果不一样。
    val.style.fontSize=`${TIMER_FONT_MIN}px`;
    val.dataset.fitKey='';
    const s0=fitScrambleFont();
    if(!s0)return;
    const t=fitTimerValue();
    if(t<s0*TIMER_SCRAMBLE_RATIO){
      // 计时不够大 ⇒ 压打乱、把高度让回去，再重算一次计时
      const shrunk=fitScrambleFont(Math.floor(t/TIMER_SCRAMBLE_RATIO));
      if(shrunk<s0)fitTimerValue();
    }
    val.dataset.stageKey=stageKey;
  }

  /** 计时卡尺寸变了（切页 / 缩放窗口 / 横竖屏）就重新排一次字号 */
  function observeTrainerFit(){
    const card=$('.timer-card');
    if(!card||typeof ResizeObserver!=='function'||card.__fitObserver)return;
    let last='';
    const ro=new ResizeObserver(()=>{
      const r=card.getBoundingClientRect();
      const key=Math.round(r.width)+'x'+Math.round(r.height);
      if(key===last)return;                              // 只跟着卡片尺寸动，避免自己被自己触发
      last=key;
      const el=$('#scrambleText'),val=$('#timerValue');
      if(el)el.dataset.fitKey='';
      if(val){val.dataset.fitKey='';val.dataset.stageKey=''}
      fitTrainerStage();
    });
    ro.observe(card);
    card.__fitObserver=ro;
  }

  function renderScramble(){
    const el=$('#scrambleText'),meta=$('#scrambleMeta');if(!el)return;
    const freePending=trainer.freeScramble&&!trainer.scrambleComplete;
    const doneBtn=$('#freeScrambleDoneBtn');if(doneBtn)doneBtn.hidden=!freePending;
    // 打乱行右侧提示：自由打乱期间让位给「结束打乱」，其余时候明示双击换下一条
    const hint=$('#scrambleHint');if(hint)hint.hidden=freePending;
    if(freePending){
      /* 自由打乱：打乱期间**不显示、也不累计公式**（不再每拧一步就往上加一步）。
         公式只在「结束打乱」那一刻算一次；这期间打乱区只给一句状态提示。 */
      el.style.fontSize='';el.textContent=trainer.scrambleBaseReady?'随便拧':'等待魔方状态';
      if(meta)meta.textContent=!Cube||!Cube.isConnected()?'自由打乱需要连接智能魔方':'自由打乱 · 拧完点「结束打乱」或按 Space，公式届时自动生成';
      return;
    }
    if(!trainer.scrambleMoves.length){
      el.style.fontSize='';el.textContent='—';if(meta)meta.textContent='';return
    }
    const view=computeScrambleView();
    ScrambleView.render(el,view);
    fitTrainerStage();
    if(!meta)return;
    if(!Cube||!Cube.isConnected()){meta.textContent=xp.freeScramble?'自由打乱需连接魔方 · 当前仍按公式打乱，Space 手动计时':'未连接魔方 · 可按 Space 手动起停';return}
    if(trainer.scrambleComplete){meta.textContent='打乱完成';return}
    if(trainer.scrambleDeriving){meta.textContent='魔方未复原 · 正在反算等价打乱公式…';return}
    meta.textContent=view.correcting?'转动有偏差 · 按青色修正步继续':`打乱 ${view.progress}/${trainer.scrambleMoves.length}`;
  }

  /* ============================================================================
     状态图（飞机图）—— 六面展开图弹窗（2026-11-19）
     ----------------------------------------------------------------------------
     交互与 Cube/Cross 一致：计时器下面那排的「状态图」按钮点一下弹、再点收起；
     点面板外任意处 / 按 Esc 也收起。

     分工：**展开图本体与配色换算全是 Cube 公用件**（/Cube/assets/cube-net/cube-net.js，
     直接喂 54 字符面位串即可）；这里只负责本页独有的两件事 ——
     弹窗外壳（开合 / 定位 / 收起），以及「该显示哪个状态」。
     ============================================================================ */
  const netState={open:false};

  /**
   * 当前该显示哪个状态（本页独有，各页状态机不同，不能塞进公用件）：
   *   · 连着魔方且拿得到面位 —— 用真实状态（打乱中、计时中都是实时值）；
   *   · 没连接 —— 按「打乱目标 + 本把已做转动」现算，没打乱就显示复原态。
   */
  function cubeNetFacelet(){
    const real=Cube&&Cube.isConnected()?String(Cube.getFacelet?.()||'').trim():'';
    if(real.length>=54)return real;
    if(trainer.phase==='running'||trainer.phase==='ready'||trainer.phase==='inspection'){
      const base=trainer.scrambleTargetFacelet||solvedFacelet();
      return trainer.moves.length?faceletFromState(base,trainer.moves):base;
    }
    return trainer.scrambleTargetFacelet||solvedFacelet();
  }

  function cubeNetSubtitle(){
    if(Cube&&Cube.isConnected?.()){
      if(trainer.phase==='running')return '计时中 · 实时状态';
      if(trainer.phase==='scramble')return '打乱中 · 实时状态';
      return '已连接 · 实时状态';
    }
    if(trainer.phase==='ready'||trainer.phase==='running'||trainer.phase==='done')return '按打乱后状态推算';
    return '未连接 · 按公式推算';
  }

  function renderCubeNet(){
    const host=$('#cubeNet');
    if(!host||!window.CubeNet)return;
    /* 直接喂 54 字符面位串：字符串 → 面序 → 配色是公用件内部的事 */
    window.CubeNet.render(host,cubeNetFacelet());
    const title=$('#cubeNetTitle'),hint=$('#cubeNetHint');
    if(title)title.textContent='魔方状态';
    if(hint)hint.textContent=cubeNetSubtitle();
  }

  /* 弹窗定位：fixed 相对视口，默认在按钮右侧弹出；右溢出翻左侧；两边都放不下就居中。
     垂直方向：优先与按钮顶端对齐；下方装不下就**让弹窗底部与按钮底部对齐**（向上长），
     最后才夹进「顶栏下沿 ~ 视口底」之间 —— 这样按钮贴着页面底边时也不会把弹窗压扁到底角。 */
  function positionCubeNetPop(){
    const wrap=$('#cubeNetWrap'),pop=$('#cubeNetPop');
    if(!wrap||!pop)return;
    const r=wrap.getBoundingClientRect();
    const w=pop.offsetWidth||300,h=pop.offsetHeight||240;
    const vw=window.innerWidth,vh=window.innerHeight;
    const navEl=document.querySelector('.siteHeader');
    const minTop=(navEl?Math.round(navEl.getBoundingClientRect().height)||44:44)+8;
    const maxTop=Math.max(minTop,vh-h-8);

    let left=r.right+10;
    if(left+w>vw-8)left=Math.max(8,r.left-w-10);
    if(w>vw-16)left=Math.max(8,(vw-w)/2);

    let top=r.top;
    if(top+h>vh-8)top=r.bottom-h;          // 下方装不下：向上展开，底部与按钮对齐
    top=Math.min(Math.max(top,minTop),maxTop);

    pop.style.left=Math.round(left)+'px';
    pop.style.top=Math.round(top)+'px';
  }

  function setCubeNetOpen(open){
    const wrap=$('#cubeNetWrap'),btn=$('#cubeNetBtn'),pop=$('#cubeNetPop');
    if(!wrap||!btn||!pop)return;
    netState.open=!!open;
    wrap.classList.toggle('isPinned',netState.open);
    btn.setAttribute('aria-expanded',netState.open?'true':'false');
    pop.setAttribute('aria-hidden',netState.open?'false':'true');
    if(netState.open){
      renderCubeNet();
      positionCubeNetPop();
    }else{
      pop.style.left='';pop.style.top='';
    }
  }

  function bindCubeNet(){
    const wrap=$('#cubeNetWrap'),btn=$('#cubeNetBtn'),pop=$('#cubeNetPop'),host=$('#cubeNet');
    if(!wrap||!btn||!pop||!host)return;
    if(window.CubeNet)window.CubeNet.build(host);
    pop.setAttribute('aria-hidden','true');
    btn.addEventListener('click',e=>{
      e.stopPropagation();
      setCubeNetOpen(!netState.open);
    });
    /* 弹窗内点击不冒泡 → 只有点面板外才收起 */
    pop.addEventListener('click',e=>e.stopPropagation());
    document.addEventListener('click',()=>{if(netState.open)setCubeNetOpen(false)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&netState.open){setCubeNetOpen(false);btn.focus()}});
    window.addEventListener('resize',()=>{if(netState.open)positionCubeNetPop()});
    window.addEventListener('scroll',()=>{if(netState.open)positionCubeNetPop()},true);
  }

  function phase(stateName,status,sub){
    trainer.phase=stateName;const stage=$('#timerStage');if(stage)stage.dataset.state=stateName;
    if(status!==undefined)$('#timerStatus').textContent=status;if(sub!==undefined)$('#timerSub').textContent=sub;
    const cancel=$('#cancelTimerBtn');if(cancel)cancel.disabled=stateName!=='running'&&stateName!=='inspection';
    updateTimingControls();
    // 阶段一变，「状态图」的副标题（实时 / 推算）跟着变；弹窗开着才重画
    if(netState.open)renderCubeNet();
  }

  function updateTimingControls(){
    const b=$('#readyBtn'),hint=$('#keyboardHint');
    if(b){
      const canManual=trainer.phase==='ready'||trainer.phase==='inspection'||(trainer.phase==='scramble'&&!Cube?.isConnected());
      b.hidden=!(canManual||(trainer.phase==='running'&&trainer.timingMode==='space'));
      b.disabled=trainer.phase==='scramble'&&Cube?.isConnected()&&!trainer.scrambleComplete;
      b.textContent=trainer.phase==='running'?'停止':'开始';
    }
    if(hint){
      if(trainer.phase==='running')hint.innerHTML=trainer.timingMode==='space'?'<kbd>Space</kbd> 停止 · 本把只认空格起停':'状态计时 · 复原魔方自动停止，本把忽略 Space';
      else hint.innerHTML='<kbd>Space</kbd> 起停；不按 Space 直接转动，则本把由魔方状态自动起停';
    }
  }

  function resetLive(){
    trainer.moves=[];trainer.timestamps=[];trainer.rawSolutionSequence=[];trainer.snapshots=[];trainer.gyroSamples=[];trainer.startFacelet='';trainer.startedAt=0;trainer.startedEpoch=0;
    $('#liveTps').textContent='—';$('#liveTurns').textContent='0';$('#liveFluency').textContent='—';$('#moveStream').innerHTML='<span class="muted">动作会显示在这里</span>';
  }
  function renderMoveStream(){
    const recent=trainer.moves.slice(-28);$('#moveStream').innerHTML=recent.length?recent.map((m,i)=>`<span class="move-chip ${i===recent.length-1?'latest':''}">${esc(m)}</span>`).join(''):'<span class="muted">动作会显示在这里</span>';
  }
  function updateLive(elapsed){
    const turnTs=C.turnTimestamps(trainer.moves,trainer.timestamps);
    const turns=C.extractTurnCount(trainer.moves)||0,tps=elapsed>0?turns*1000/elapsed:null;
    const fluency=C.fluencyFromTimestamps(turnTs,elapsed,400);
    $('#liveTurns').textContent=turns;$('#liveTps').textContent=tps?fmtNum(tps):'—';
    $('#liveFluency').textContent=fluency==null?'—':`${fmtNum(fluency,0)}%`;
    renderMoveStream();
  }

  function tick(){
    cancelAnimationFrame(trainer.raf);
    const loop=()=>{
      const now=performance.now();
      if(trainer.phase==='running'){
        const elapsed=now-trainer.startedAt;$('#timerValue').textContent=(elapsed/1000).toFixed(2);updateLive(elapsed);
      }else if(trainer.phase==='inspection'){
        // 观察阶段：可配置总时长（默认 15s 不变）；跨「剩 12s / 剩 8s」阈值语音报点（WCA 官方 8s/12s 提醒）。
        const total=inspectionMs(),elapsed=now-trainer.inspectionStartedAt,remain=Math.max(0,total-elapsed);
        if(window.CubeAudio){
          if(!trainer.voiceMark12&&total>12000&&elapsed>=total-12000){trainer.voiceMark12=true;CubeAudio.voice('12')}
          if(!trainer.voiceMark8&&total>8000&&elapsed>=total-8000){trainer.voiceMark8=true;CubeAudio.voice('8')}
        }
        $('#timerValue').textContent=(remain/1000).toFixed(1);
        $('#timerStatus').textContent=elapsed>total+2000?'观察超时 · DNF':elapsed>total?'观察超时 · +2':'观察中';
      }else{return}
      trainer.raf=requestAnimationFrame(loop);
    };trainer.raf=requestAnimationFrame(loop);
  }

  function enterReadyAfterScramble(){
    trainer.scrambleComplete=true;trainer.scrambleObservedMoves=trainer.scrambleMoves.slice();renderScramble();resetLive();syncFreeToggle();trainer.inspectionPenalty='ok';trainer.voiceMark12=false;trainer.voiceMark8=false;
    if($('#inspectionToggle').checked){trainer.inspectionStartedAt=performance.now();trainer.timingMode='pending';phase('inspection','观察中','按 Space 开始，或直接转动启用状态自动计时');$('#timerValue').textContent=(inspectionMs()/1000).toFixed(1);tick()}
    else{trainer.timingMode='pending';phase('ready','已打乱','按 Space 开始，或直接转动启用状态自动计时');$('#timerValue').textContent='0.00'}
  }

  /**
   * 打乱起点（2026-11-19 定稿）：**不要求先复原，也不拼「先复原再打乱」两段**。
   *   · 复原态 → 直接用 WCA 打乱本体；
   *   · 未复原 → 反算一串「从当前状态走完即落到 WCA 打乱态」的等价公式（≤22 步）；
   *   · **状态未知**（刚 connect、面位还没上报）→ 不能当成复原态，公式先标记「待定」，
   *     等第一次上报拿到真实面位再反算，期间不放行按公式打乱。
   * 反算异步进行（首次要建表 ~1.4s），期间显示占位，不卡界面。
   */
  function prepareScrambleBase(facelet){
    if(!Cube||!Cube.isConnected())return;
    cancelDerive();
    const f=facelet||Cube.getFacelet?.()||'';
    trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;trainer.scrambleComplete=false;
    trainer.scrambleBaseFacelet=f;
    const wca=trainer.wcaScramble.slice();
    /* 关键：面位为空 = 还不知道状态，绝不能按「已复原」处理 —— 否则公式原样保留，
       从非复原态走完必然到不了 WCA 打乱态。 */
    if(!f){
      trainer.scrambleBaseReady=false;trainer.scramblePendingBase=true;
      trainer.scrambleMoves=wca;trainer.scramble=trainer.scrambleMoves.join(' ');
      trainer.scrambleTargetFacelet=faceletAfterMoves(wca);
      phase('scramble','等待魔方状态','正在读取魔方面位，拿到后立即生成等价打乱公式…');
      renderScramble();return;
    }
    trainer.scramblePendingBase=false;
    if(Cube.isSolved(f)){
      trainer.scrambleBaseReady=true;
      trainer.scrambleMoves=wca;
      trainer.scramble=trainer.scrambleMoves.join(' ');
      trainer.scrambleTargetFacelet=faceletAfterMoves(wca);
      phase('scramble',trainer.freeScramble?'自由打乱 · 开始拧':'按公式打乱','完成后即可开始计时');
      renderScramble();return;
    }
    // 未复原：先挂上 WCA 本体当占位，异步换成一段等价公式
    trainer.scrambleBaseReady=false;
    trainer.scrambleMoves=wca;
    trainer.scramble=trainer.scrambleMoves.join(' ');
    phase('scramble','正在生成等价打乱','魔方未复原，正在反算一串等价公式…');
    renderScramble();
    buildEquivScramble(f,wca,0);
  }

  /**
   * 反算「从当前状态落到 WCA 打乱态」的单段公式；期间状态又变了就按最新状态重算。
   * 落在打乱阶段，不会与计时抢时间，但仍放进 Worker，避免首次建表把页面顶住。
   */
  function buildEquivScramble(facelet,wca,attempt){
    const seq=++deriveSeq;
    trainer.scrambleDeriving=true;renderScramble();
    const wcaNow=simplifyMoves(wca);
    const finish=tokens=>{
      if(seq!==deriveSeq)return;                         // 期间换了打乱：这次结果作废
      trainer.scrambleDeriving=false;
      if(trainer.phase!=='scramble'||trainer.freeScramble)return;
      const now=Cube&&Cube.isConnected()?(Cube.getFacelet?.()||''):'';
      if(now&&!sameFacelet(now,facelet)&&attempt<2){buildEquivScramble(now,wca,attempt+1);return}
      const equiv=Array.isArray(tokens)&&tokens.length?tokens:wcaNow;
      trainer.scrambleMoves=equiv.slice();
      trainer.scramble=trainer.scrambleMoves.join(' ');
      trainer.scrambleViewStore=null;
      trainer.scrambleBaseReady=true;
      // 落点固定是 WCA 打乱态（WCA 本体从复原态出发的结果），与起点无关
      trainer.scrambleTargetFacelet=faceletAfterMoves(wcaNow)||faceletAfterMoves(equiv);
      phase('scramble','按公式打乱','完成后即可开始计时');
      renderScramble();
    };
    // 先要 cur → 复原 的那一段，再求 P = cur⁻¹·wca 的等价公式；两个重活都在 Worker 里
    scrambleFromFaceletAsync(facelet,backInv=>{
      if(seq!==deriveSeq)return;
      if(!backInv||!backInv.length){finish(null);return}
      if(sameFacelet(facelet,solvedFacelet())){finish(wcaNow);return}
      const back=invertTokens(backInv);                  // cur → 复原
      const p=faceletAfterMoves([...back,...wcaNow]);
      if(!p){finish(null);return}
      scrambleFromFaceletAsync(p,single=>finish(single&&single.length?single:simplifyMoves([...back,...wcaNow])));
    });
  }

  /**
   * 自由打乱（2026-11-19）：起点就是当前魔方状态，**不要求先复原**。
   * 不预设目标公式，拧的过程实时反算成公式；拧完点「打乱完成」或按 Space 落定本把。
   */
  function startFreeScramble(){
    if(!Cube||!Cube.isConnected()){xp.freeScramble=false;saveXp();syncFreeToggle();notify('自由打乱需要连接智能魔方，否则无法记录转动');nextScramble();return}
    if(trainer.phase==='running'||trainer.phase==='inspection'){notify('计时中不能切换打乱方式');syncFreeToggle();return}
    cancelAnimationFrame(trainer.raf);cancelDerive();resetLive();
    trainer.freeScramble=true;trainer.scramble='';trainer.scrambleMoves=[];trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;trainer.scrambleTargetFacelet='';trainer.scrambleComplete=false;trainer.timingMode='pending';
    trainer.wcaScramble=[];trainer.freeScrambleTarget=null;trainer.scrambleFreeMoves=[];
    $('#timerValue').textContent='0.00';
    const f=Cube.getFacelet?.()||'';
    // 起点不必是复原态；打乱过程中只攒原始转动，不显示也不累计公式
    trainer.scrambleBaseFacelet=f;trainer.scrambleBaseReady=true;
    phase('scramble','自由打乱 · 随便拧','随便拧，公式等结束打乱后再算；拧完点「结束打乱」或按 Space');
    renderScramble();syncFreeToggle();
  }

  /**
   * 结束打乱（自由打乱）：**这一刻才计算公式**，并且先放行计时再做运算。
   * 顺序很关键：先把阶段切到可计时（观察 / ready），把计时器交给用户；
   * 运算放到后面的任务里做，算多久都不影响随时起表。
   */
  function finishFreeScramble(){
    if(!trainer.freeScramble||trainer.phase!=='scramble'||trainer.scrambleComplete)return;
    const facelet=Cube&&Cube.isConnected()?Cube.getFacelet?.()||'':'';
    if(!facelet){notify('无法读取魔方状态，稍后再试');return}
    if(Cube.isSolved(facelet)){notify('魔方还是复原状态，先拧乱再结束打乱');return}
    const recorded=(trainer.scrambleObservedMoves.length?trainer.scrambleObservedMoves:trainer.scrambleFreeMoves).filter(Boolean);
    if(!recorded.length){notify('没有记录到本次转动，先拧几下再结束打乱');return}
    // 1) 先放行计时：公式位置先留空，落盘前会补上（绝不落一条空公式）
    trainer.freeScramble=xp.freeScramble;
    trainer.scramble='';trainer.scrambleMoves=[];trainer.scrambleViewStore=null;
    trainer.scrambleTargetFacelet=facelet;trainer.scrambleBaseReady=true;
    trainer.freeScrambleTarget={facelet,observed:recorded.slice()};
    enterReadyAfterScramble();syncFreeToggle();
    notify('打乱已结束 · 可立即开始计时');
    // 2) 再算公式：放到下一轮事件循环，绝不占用这次点击/按键之后的任何一帧
    scheduleFreeScrambleCompute();
  }

  /**
   * 自由打乱的公式计算：结束打乱之后才算一次。
   * 用 setTimeout 而非当前帧，且整个过程不读计时器、不改阶段、不阻塞输入 ——
   * 用户点完立刻起表也完全不受影响。算完只补这一把的 scramble 文本。
   */
  function scheduleFreeScrambleCompute(){
    const target=trainer.freeScrambleTarget;
    if(!target)return;
    // 反算丢给 Worker：主线程一帧都不占，用户随时起表都不受影响
    scrambleFromFaceletAsync(target.facelet,derived=>{
      const rough=simplifyMoves(target.observed);
      const cands=[];
      if(derived&&derived.length)cands.push(derived);
      if(rough.length)cands.push(rough);
      // 取「重放能精确回到打乱落点」的那条；都不行就用实际转动记录（一定能重放，只要没丢包）
      const tokens=cands.find(t=>t&&t.length&&sameFacelet(faceletAfterMoves(t),target.facelet))||cands.find(t=>t&&t.length);
      if(!tokens||!tokens.length)return;
      const text=tokens.join(' ');
      // 1) 这一把还没结算：挂在 trainer 上，落盘时自动带上
      trainer.scramble=text;trainer.scrambleMoves=tokens.slice();
      /* 2) 已经结算（用户起表很快）：把最新那条的 scramble 换成精确公式。
            只有「重放落点 == 这一把的打乱落点」时才替换 —— 成绩/时间/动作一个都不动。 */
      const last=state.solves[state.solves.length-1];
      if(last){
        const cur=String(last.scramble||'');
        const same=cur&&sameFacelet(faceletAfterMoves(cur.split(/\s+/).filter(Boolean)),target.facelet);
        if(!same){last.scramble=text;try{save(true)}catch(e){}}
      }
    });
  }

  /**
   * 下一条打乱（2026-11-19 定稿）：**魔方不必先复原**。
   *   自由打乱（模式保持）⇒ 从当前状态接着拧，不预设目标；
   *   非自由打乱 ⇒ 抽一条 WCA 打乱定下落点；魔方未复原时反算一串
   *     「从复原态重放即落到该落点」的等价公式（≤22 步），只有一段，不拼「先复原再打乱」。
   *   没连魔方 ⇒ 随机公式，Space 手动计时。
   */
  function nextScramble(){
    cancelAnimationFrame(trainer.raf);cancelDerive();resetLive();
    const connected=!!(Cube&&Cube.isConnected());
    const facelet=connected?(Cube.getFacelet?.()||''):'';
    // 自由打乱是可保持的模式：上一把结束后自动继续自由打乱，不必每把重开
    if(xp.freeScramble&&connected){startFreeScramble();return}
    trainer.freeScramble=false;trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;trainer.scrambleComplete=false;trainer.timingMode='pending';$('#timerValue').textContent='0.00';
    trainer.scrambleBaseFacelet=facelet;
    // WCA 打乱本体：落点先定死，等价公式只是同一落点的另一种写法
    trainer.wcaScramble=randomScramble().split(/\s+/).filter(Boolean);
    trainer.scrambleMoves=trainer.wcaScramble.slice();
    trainer.scramble=trainer.scrambleMoves.join(' ');
    trainer.scrambleTargetFacelet=faceletAfterMoves(trainer.wcaScramble);
    trainer.scrambleBaseReady=connected&&!!facelet&&Cube.isSolved(facelet);
    if(connected)prepareScrambleBase(facelet);
    else phase('scramble','按公式打乱','完成后按 Space 手动起停；连接魔方后也可状态自动起停');
    renderScramble();syncFreeToggle();if(netState.open)renderCubeNet();
  }

  function markScrambleComplete(){if(trainer.scrambleComplete)return;enterReadyAfterScramble()}

  function handleScrambleMove(detail){
    if(trainer.phase!=='scramble')return false;
    if(trainer.freeScramble){
      /* 自由打乱：转动只进「原始记录」，**不记账、不渲染、不累计公式**。
         公式统一在「结束打乱」时算一次 —— 边拧边算是多余的活，也让人以为每拧一步公式就在变长。 */
      const raw=Array.isArray(detail.rawMoves)&&detail.rawMoves.length?detail.rawMoves:[detail.move];
      trainer.scrambleFreeMoves.push(...raw.filter(Boolean));
      return true;
    }
    // 非自由打乱且等价公式还没算好：这段期间的转动不记账，
    // 等公式就绪后按「当前状态」重新对齐，避免进度与公式对不上。
    if(!trainer.scrambleBaseReady){
      const now=detail.facelet||Cube.getFacelet?.()||'';
      if(now&&!trainer.scrambleDeriving)buildEquivScramble(now,trainer.wcaScramble.slice(),1);
      return true;
    }
    const observed=Array.isArray(detail.rawMoves)&&detail.rawMoves.length?detail.rawMoves:[detail.move];trainer.scrambleObservedMoves.push(...observed.filter(Boolean));renderScramble();
    const current=detail.facelet||Cube.getFacelet?.()||'';
    if(detail.batchFinal!==false){if(trainer.scrambleTargetFacelet&&current){if(sameFacelet(current,trainer.scrambleTargetFacelet))markScrambleComplete()}else if(computeScrambleView().done)markScrambleComplete();}
    return true;
  }

  function handleCubeState(detail){
    if(trainer.phase!=='scramble')return;
    const f=detail.facelet||'';
    if(!trainer.freeScramble&&f){
      /* 待定起点（刚 connect 时面位还没上报）：拿到真实面位立即补齐。
         这是「连接前后公式必须不同」的关键 —— 之前把空面位当复原态，
         公式原样保留，从非复原态走完到不了 WCA 打乱态。 */
      if(trainer.scramblePendingBase){trainer.scramblePendingBase=false;prepareScrambleBase(f);return}
      if(!trainer.scrambleBaseReady&&!trainer.scrambleDeriving){buildEquivScramble(f,trainer.wcaScramble.slice(),1);return}
    }
    if(trainer.scrambleBaseReady&&!trainer.scrambleComplete&&!trainer.freeScramble&&trainer.scrambleTargetFacelet&&sameFacelet(f,trainer.scrambleTargetFacelet))markScrambleComplete();
  }

  function beginSolve(mode,firstDetail=null){
    if(trainer.phase!=='ready'&&trainer.phase!=='inspection'&&!(trainer.phase==='scramble'&&mode==='space'&&!Cube?.isConnected()))return false;
    if(trainer.phase==='scramble'&&mode==='space'&&!Cube?.isConnected()){
      // 无魔方的手动计时：没有转动记录可算，随机打乱直接认作已完成
      trainer.scrambleComplete=true;
    }
    if(trainer.phase==='inspection'){
      const total=inspectionMs(),inspect=performance.now()-trainer.inspectionStartedAt;trainer.inspectionPenalty=inspect>total+2000?'dnf':inspect>total?'plus_two':'ok';
      if(trainer.inspectionPenalty!=='ok'&&window.CubeAudio)CubeAudio.effect('alert');
    }else trainer.inspectionPenalty='ok';
    resetLive();
    trainer.timingMode=mode;
    const eventTs=Number(firstDetail?.startTimestamp ?? firstDetail?.timestamp);
    trainer.startedEpoch=mode==='state'&&Number.isFinite(eventTs)?eventTs:Date.now();
    trainer.startedAt=performance.now();
    trainer.startFacelet=(firstDetail?.previousFacelet)||(Cube&&Cube.getFacelet?Cube.getFacelet():'')||trainer.scrambleTargetFacelet||'';
    if(trainer.startFacelet)trainer.snapshots.push({facelet:trainer.startFacelet,timestamp:0});
    phase('running','计时中',mode==='space'?'按 Space 停止':'复原后自动停止');$('#timerValue').textContent='0.00';tick();syncFreeToggle();
    if(window.CubeAudio)CubeAudio.effect('click');
    return true;
  }

  function detailElapsed(detail){
    const abs=Number(detail?.timestamp);let elapsed=Number.isFinite(abs)&&trainer.startedEpoch?abs-trainer.startedEpoch:performance.now()-trainer.startedAt;
    if(!Number.isFinite(elapsed))elapsed=performance.now()-trainer.startedAt;
    elapsed=Math.max(0,elapsed);
    const last=trainer.timestamps[trainer.timestamps.length-1];if(Number.isFinite(last)&&elapsed<last)elapsed=last;
    return elapsed;
  }

  function captureSolveMove(detail){
    const elapsed=detailElapsed(detail),move=detail.logicalMove||detail.move;if(!move)return;
    trainer.moves.push(move);trainer.timestamps.push(elapsed);
    trainer.rawSolutionSequence.push({
      move,logicalMove:move,rawMoves:Array.isArray(detail.rawMoves)?detail.rawMoves.slice():[],timestamp:elapsed,
      startTimestamp:Number.isFinite(Number(detail.startTimestamp))?Number(detail.startTimestamp):null,
      absoluteTimestamp:Number.isFinite(Number(detail.timestamp))?Number(detail.timestamp):null,
      hardwareTimestamp:Number.isFinite(Number(detail.hardwareTimestamp))?Number(detail.hardwareTimestamp):null,
      localTimestamp:Number.isFinite(Number(detail.localTimestamp))?Number(detail.localTimestamp):null,
      facelet:detail.facelet||null,isSlice:!!detail.isSlice,isRotation:!!detail.isRotation
    });
    if(detail.facelet)trainer.snapshots.push({facelet:detail.facelet,timestamp:elapsed,move});updateLive(elapsed);
  }

  function recordCubeMove(detail){
    if(handleScrambleMove(detail))return;
    if((trainer.phase==='ready'||trainer.phase==='inspection')&&trainer.timingMode==='pending'){
      if(detail.isRotation)return; // turning the whole cube is not the first solve turn
      if(!beginSolve('state',detail))return;captureSolveMove(detail);if(detail.solved)finishSolve('state',detail.timestamp);return;
    }
    if(trainer.phase!=='running')return;
    captureSolveMove(detail);
    if(trainer.timingMode==='state'&&detail.solved)finishSolve('state',detail.timestamp);
  }

  function finishSolve(stopMode='space',stopTimestamp=null){
    if(trainer.phase!=='running')return;
    let elapsed=performance.now()-trainer.startedAt;
    const stopTs=stopTimestamp==null?NaN:Number(stopTimestamp);if(Number.isFinite(stopTs)&&trainer.startedEpoch)elapsed=Math.max(1,stopTs-trainer.startedEpoch);else elapsed=Math.max(1,elapsed);
    cancelAnimationFrame(trainer.raf);
    const turnCount=C.extractTurnCount(trainer.moves)||null,tps=turnCount?turnCount*1000/elapsed:null;const method=$('#trainingMethod').value;
    const smartData=!!(Cube&&Cube.isConnected()&&trainer.startFacelet&&trainer.moves.length&&trainer.moves.length===trainer.timestamps.length);
    const autoAnalysis=smartData&&A?A.analyze({method,startFacelet:trainer.startFacelet,moves:trainer.moves,timestamps:trainer.timestamps,totalTime:elapsed,snapshots:trainer.snapshots,rawSolutionSequence:trainer.rawSolutionSequence}):null;
    let stateSequence=trainer.snapshots.slice();
    if(smartData&&A?.statesFromSnapshots){
      const rebuilt=A.statesFromSnapshots(trainer.startFacelet,trainer.moves,trainer.snapshots,trainer.rawSolutionSequence);
      if(rebuilt.length===trainer.moves.length+1){
        stateSequence=rebuilt.map((cube,i)=>({facelet:typeof cube?.toFaceCube==='function'?cube.toFaceCube():'',timestamp:i===0?0:trainer.timestamps[i-1],move:i===0?'':trainer.moves[i-1]}));
      }
    }
    const device=smartData?(Cube.getDeviceName()||'智能魔方'):'手动计时';
    const record=I.normalizeSolve({
      id:`solve-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      date:new Date().toISOString(),totalTime:elapsed,flag:trainer.inspectionPenalty,analysisType:method,session:($('#trainingSession').value||'日常训练').trim(),
      device,scramble:trainer.scramble,turnCount,tps,fluencyPercent:C.fluencyFromTimestamps(C.turnTimestamps(trainer.moves,trainer.timestamps),elapsed,400),
      timestamps:trainer.timestamps.slice(),moveTimestamps:trainer.timestamps.slice(),moves:trainer.moves.slice(),rawSolutionSequence:trainer.rawSolutionSequence.slice(),
      snapshots:trainer.snapshots.slice(),stateSequence,gyroSamples:trainer.gyroSamples.slice(),startFacelet:trainer.startFacelet,steps:autoAnalysis?.steps||[],analysisFrame:autoAnalysis?.frame||null,analysisVersion:autoAnalysis?.analysisVersion||A?.ANALYSIS_VERSION||0,colorNeutral:!!autoAnalysis,
      timingMode:stopMode,captureType:smartData?'smartcube':'manual',source:smartData?`智能魔方训练 · ${stopMode==='space'?'空格起停':'状态起停'}`:'手动训练'
    });
    state.solves.push(record);state.solves.sort((a,b)=>new Date(a.date)-new Date(b.date));state.datasetName='训练数据';
    if(Q)record.anomaly=Q.assess(record); // 新记录立即体检，异常只标记不改动
    $('#timerValue').textContent=(elapsed/1000).toFixed(2);
    const solvedNow=Cube&&Cube.isConnected()?Cube.isSolved(Cube.getFacelet?.()||''):true;
    const sub=smartData?(autoAnalysis?'已保存完整轨迹 · 已自动识别解法方位并分段':(solvedNow?'已保存完整动作与时间戳 · 分段识别未命中':'已保存完整动作与时间戳 · 最终状态未复原')):'已保存手工计时记录';
    phase('done',record.flag==='dnf'?'DNF':record.flag==='plus_two'?'完成 · +2':'完成',sub);
    if(window.CubeAudio)CubeAudio.effect('click');
    refreshFilterOptions();save(true);renderTrainerSummary();renderAll();updateSolveBadge();notify('成绩已保存');
    window.setTimeout(()=>nextScramble(),450);
  }

  function handleSpaceTimer(){
    if(state.workspaceMode!=='training')return;
    if(trainer.phase==='running'){
      if(trainer.timingMode==='space'){Cube?.flushPending?.();finishSolve('space');}
      return;
    }
    if(trainer.phase==='scramble'&&trainer.freeScramble&&Cube?.isConnected()){finishFreeScramble();return}
    // 状态还未知时不许放行：否则会拿一条还没对齐当前状态的公式开始计时
    if(trainer.phase==='scramble'&&Cube?.isConnected()&&trainer.scramblePendingBase){notify('正在读取魔方状态，稍等一下就绪');return}
    if(trainer.phase==='scramble'&&Cube?.isConnected()&&!trainer.scrambleComplete){notify('请先按打乱公式完成打乱');return}
    beginSolve('space');
  }

  function cancelTraining(){cancelAnimationFrame(trainer.raf);cancelDerive();nextScramble()}
  function sessionSolves(){const name=($('#trainingSession').value||'日常训练').trim();return state.solves.filter(s=>String(s.session)===name)}
  /**
   * 右侧「成绩」区：两栏网格 —— 最新一把（加粗）→ 早几把（淡，可点）→ AO5（加粗，前面挂 AO 前缀）。
   * 最省的时候是「前 5 把 + AO」共 6 格 = 3 行，正好和左边四宫格一般高；
   * 空间更大就成对往下补更早的成绩，AO 始终停在第 6 个位置不动。
   */
  const SCORE_MIN_SOLVES = 5;    // 最少：最近 5 把
  const SCORE_MAX_SOLVES = 61;   // 上限：防止一次渲染太多

  /** 一次网格「行」的高度：两列时一行放两条，行高按最高的那条（加粗行）算 */
  function scoreGridRowHeight(){
    const rows=[...document.querySelectorAll('#trainingRecent .score-row')];
    const grid=$('#trainingRecent');
    const gap=grid?(parseFloat(getComputedStyle(grid).rowGap)||2):2;
    if(!rows.length)return 30+gap;
    return Math.max(...rows.map(e=>e.getBoundingClientRect().height))+gap;
  }

  let scoreSolveCount = SCORE_MIN_SOLVES;   // 当前实际渲染了几把

  /**
   * 成绩行。**两支都是按钮**：加粗的「本次」也要能点开单次详情
   * （以前是 <div>，点上去没反应 —— issue #15）。
   * 差别只在样式类：score-row-strong 字大加粗，score-row-plain 小字淡色。
   */
  function scoreRowHTML(s,strong){
    const cls=strong?'score-row score-row-strong':'score-row score-row-plain';
    const title=`${esc(fmtDate(s.date))} · ${esc(s.session)}`;
    return `<button type="button" class="${cls}" data-open="${esc(s.id)}" title="${title}"><span class="score-time">${solveTime(s)}</span></button>`;
  }

  /**
   * 四宫格下方的修正按钮（2026-11-19 加回）：只作用于「本 Session 最新一把」。
   *   DNF / +2 —— 再点一次即还原（与单次列表里的切换口径一致）；
   *   删除 —— 需确认一次，删的就是最新那一把。
   * 按 flag 反显 aria-pressed，让「这条已经是 DNF 了」一眼看得见。
   */
  function renderLiveActions(){
    const wrap=$('#liveActions');if(!wrap)return;
    const solves=sessionSolves();
    const last=solves[solves.length-1]||null;
    const flag=last?C.normalizeFlag(last.flag):'';
    const dnf=$('#liveDnfBtn'),p2=$('#livePlusTwoBtn'),del=$('#liveDeleteBtn');
    if(dnf)dnf.setAttribute('aria-pressed',flag==='dnf'?'true':'false');
    if(p2)p2.setAttribute('aria-pressed',flag==='plus_two'?'true':'false');
    [dnf,p2,del].forEach(b=>{if(b)b.disabled=!last});
  }

  /** 最新一把的判定：与本 Session 当前筛选一致，取时间最晚的一条 */
  function latestSessionSolve(){
    const solves=sessionSolves();
    return solves.length?solves[solves.length-1]:null;
  }

  function applyLivePenalty(flag){
    const s=latestSessionSolve();
    if(!s){notify('本 Session 还没有成绩');return}
    changePenalty(s.id,flag);
    notify(C.normalizeFlag(s.flag)===flag?`最新一把已标记 ${flag==='dnf'?'DNF':'+2'}`:'已还原这条记录');
  }

  function applyLiveDelete(){
    const s=latestSessionSolve();
    if(!s){notify('本 Session 还没有成绩');return}
    if(!confirm(`确认删除本 Session 最新一把？\n${solveTime(s)} · ${fmtDate(s.date)}`))return;
    deleteSolve(s.id);
    notify('已删除这一把');
  }

  function renderTrainerSummary(solveCount){
    const solves=sessionSolves(),S=solves.length?C.solveSummary(solves):null;
    $('#sessionSummary').textContent=solves.length?`${solves.length} 次 · ${$('#trainingMethod').value}`:'暂无成绩';
    $('#sessionMetrics').innerHTML=S?`<div><span>Latest</span><strong>${solveTime(solves[solves.length-1])}</strong></div><div><span>AO5</span><strong>${S.ao5?.isDNF?'DNF':fmtMs(S.ao5?.time)}</strong></div><div><span>AO12</span><strong>${S.ao12?.isDNF?'DNF':fmtMs(S.ao12?.time)}</strong></div><div><span>Best</span><strong>${fmtMs(S.best)}</strong></div>`:`<div class="muted">完成第一把后显示统计</div>`;
    // PB：全部记录里的个人最好成绩（与 S.best 同一套口径）
    const pb=$('#liveBest');
    if(pb)pb.textContent=state.solves.length?fmtMs(C.solveSummary(state.solves).best):'—';

    // 要显示几把：显式传入就照办；否则沿用上一次拟合出的条数（新成绩进来不必重新长一遍）。
    // 把数保持奇数 —— 加上 AO 是偶数格，两栏网格不会剩半行；增删都按 2 走（整行）。
    const have=solves.length;
    let want=Number.isFinite(solveCount)?solveCount:scoreSolveCount;
    want=Math.max(SCORE_MIN_SOLVES,Math.min(SCORE_MAX_SOLVES,Math.round(want)));
    if(want%2===0)want--;
    if(want>have)want=have;
    const recent=solves.slice(-Math.max(1,want)).reverse();   // 最新的在前
    scoreSolveCount=recent.length;
    const ao5=S&&S.ao5?(S.ao5.isDNF?'DNF':fmtMs(S.ao5.time)):'';

    // AO 固定排在第 6 格：前面满 5 把，后面才是更早的成绩
    const head=recent.slice(0,SCORE_MIN_SOLVES),tail=recent.slice(SCORE_MIN_SOLVES);
    const rows=head.map((s,i)=>scoreRowHTML(s,i===0));
    if(ao5)rows.push(`<div class="score-row score-row-strong score-row-ao"><span class="score-label">AO</span><span class="score-time">${ao5}</span></div>`);
    tail.forEach(s=>rows.push(scoreRowHTML(s,false)));
    $('#trainingRecent').innerHTML=rows.length?rows.join(''):`<div class="score-empty">还没有训练记录</div>`;
    // 四宫格下方的修正按钮跟着「本 Session 最新一把」走
    renderLiveActions();
    // 渲染完再看一眼能不能多放一行（下一帧量，避免读到旧布局）
    requestAnimationFrame(fitTrainerRecent);
  }

  /** 给成绩列表挂 ResizeObserver：容器高度变化就重新拟合条数 */
  function observeTrainerRecent(){
    const list=$('#trainingRecent');
    if(!list||typeof ResizeObserver!=='function')return;
    if(list.__fitObserver)return;               // 只挂一次
    const ro=new ResizeObserver(()=>fitTrainerRecent());
    ro.observe(list);
    list.__fitObserver=ro;
  }

  /**
   * 条数拟合：先按剩余高度一次估出还能放几行（两栏网格 = +2 把），
   * 卡片变矮（窗口缩小 / 横屏转竖屏）放不下时反过来收掉一行，最少回到 5 把 + AO。
   * 上界是 SCORE_MAX_SOLVES 与本 Session 的实际把数，避免无限补。
   */
  let fitBusy=false;
  function fitTrainerRecent(){
    if(fitBusy)return;
    const list=$('#trainingRecent');
    if(!list||!state.solves.length)return;
    fitBusy=true;
    try{
      const rows=[...list.querySelectorAll('.score-row')];
      if(!rows.length)return;
      const rowH=scoreGridRowHeight();
      if(rowH<=0)return;
      // 放不下了：收一行（最少留 5 把 + AO 这三行）
      if(list.scrollHeight-list.clientHeight>0){
        if(scoreSolveCount>SCORE_MIN_SOLVES)renderTrainerSummary(Math.max(SCORE_MIN_SOLVES,scoreSolveCount-2));
        return;
      }
      const room=list.getBoundingClientRect().bottom-Math.max(...rows.map(e=>e.getBoundingClientRect().bottom));
      if(room<rowH)return;                                 // 再放一行就溢出，停
      let next=scoreSolveCount+Math.floor(room/rowH)*2;    // 按空间一次补足
      next=Math.min(next,SCORE_MAX_SOLVES,sessionSolves().length);
      if(next<=scoreSolveCount)return;
      renderTrainerSummary(next);
    }finally{fitBusy=false}
  }

  function changePenalty(id,flag){const s=state.solves.find(x=>String(x.id)===String(id));if(!s)return;s.flag=C.normalizeFlag(s.flag)===flag?'ok':flag;save(true);renderTrainerSummary();renderAll()}
  function deleteSolve(id){
    // 显式删除走 Store.remove：只有这条路径允许让记录真的消失（绝不靠「落盘时集合变小」去推断删除）
    state.solves=state.solves.filter(x=>String(x.id)!==String(id));
    if(Store&&Store.remove)Store.remove([id]);
    save(true);renderTrainerSummary();renderAll();updateSolveBadge();
  }

  async function toggleCube(){
    const btn=$('#connectCubeBtn');btn.disabled=true;
    try{
      if(Cube.isConnected()){await Cube.disconnect();return}
      $('#connectCubeLabel').textContent='选择设备…';$('#cubeStatus').textContent='正在连接';await Cube.connect();
    }catch(e){notify(e.message||String(e));$('#cubeStatus').textContent='连接失败'}finally{btn.disabled=false;if(!Cube.isConnected())$('#connectCubeLabel').textContent='连接魔方'}
  }

  function bindCube(){
    Cube.on('connecting',()=>{$('#cubeStatus').textContent='等待选择设备';$('#connectCubeBtn').classList.remove('connected')});
    Cube.on('connect',async d=>{const battery=await Cube.battery(),batteryLevel=Array.isArray(battery)?battery[0]:battery;$('#connectCubeBtn').classList.add('connected');$('#connectCubeLabel').textContent=d.deviceName||'已连接';$('#cubeStatus').textContent=batteryLevel==null?'已连接':`已连接 · ${batteryLevel}%`;$('#liveDevice').textContent=d.deviceName||'智能魔方';
      // 勾着「自由打乱」就连上后直接进入该模式；否则按公式打乱
      if(xp.freeScramble)startFreeScramble();else prepareScrambleBase(Cube.getFacelet?.())});
    Cube.on('disconnect',()=>{$('#connectCubeBtn').classList.remove('connected');$('#connectCubeLabel').textContent='连接魔方';$('#cubeStatus').textContent='未连接';$('#liveDevice').textContent='等待训练';nextScramble()});
    Cube.on('state',handleCubeState);
    Cube.on('move',recordCubeMove);
    Cube.on('gyro',detail=>{if(trainer.phase==='running'||trainer.phase==='ready'||trainer.phase==='inspection')trainer.gyroSamples.push(detail)});
  }

  async function mergeImportFiles(files){
    const imported=[];for(const file of files){const text=await file.text();imported.push(...I.parseAny(text,file.name).map(upgradeSolve))}
    if(!imported.length)throw new Error('没有识别到有效 solve');
    if(Q)Q.ensure(state.solves); // 导入合并后体检（只补检，不改既有标记）
    const key=s=>`${s.id}|${s.date}`;const map=new Map(state.solves.map(s=>[key(s),s]));imported.forEach(s=>map.set(key(s),s));state.solves=[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));state.datasetName='训练数据';
    state.filters={method:'all',session:'all',device:'all',start:'',end:''};refreshFilterOptions();syncFilterUI();save(true);renderTrainerSummary();renderAll();updateSolveBadge();notify(`已导入 ${imported.length} 条记录`)
  }

  /**
   * 重载本地数据。必须先等落盘队列清空（云端恢复 / 导入覆盖刚排进来的写入），
   * 再去读镜像 + 扩展存储，否则会读到上一次的旧值。
   */
  async function reloadFromStorage(){
    try{ if(Store&&Store.flush) await Store.flush(); }catch(e){ console.warn('[Analyzer] 等待落盘失败',e) }
    load();
    refreshFilterOptions();syncFilterUI();renderTrainerSummary();renderAll();updateSolveBadge();updateCloudIndicator();
    return hydrate();
  }


  async function handleAuthState(user){
    updateCloudIndicator();
    if(!user||cloudHydrated||!window.CubeAnalyzerCloud)return;
    // 先水合，拿到本机真实记录数（镜像 + 扩展存储），再判断要不要从云端补
    let localCount=state.solves.length;
    try{
      if(Store&&Store.loadAll){
        const full=await Store.loadAll();
        localCount=Array.isArray(full?.payload?.solves)?full.payload.solves.length:localCount;
        if(!localCount)localCount=Number(full?.claimedTotal)||0;
      }
    }catch(e){}
    if(localCount>0)return; // 本机有数据：交给常规的冲突检测，绝不自动覆盖
    cloudHydrated=true;
    try{
      const status=await window.CubeAnalyzerCloud.getCloudStatus();
      if(!status?.success){ cloudHydrated=false; return; } // 查询失败不烧掉水合机会，下次 auth 事件重试
      const block=status?.cloudData?.data;
      const cd=block?.cubeAnalyzerData;
      if(status.hasData&&cd&&Array.isArray(cd.solves)&&cd.solves.length){
        // 覆盖本地前先留快照，可从头像菜单回滚
        if(typeof window._siteNavPrepareOverwrite==='function'){
          const guard=window._siteNavPrepareOverwrite('云端数据自动载入',block);
          if(!guard.success)return;
        }
        await window.CubeAnalyzerCloud.applyDataToLocalStorage(block);
        await reloadFromStorage();
        notify('已载入 Supabase 训练数据');
      }
    }catch(e){ cloudHydrated=false; console.warn('Cloud hydration skipped',e) }
  }

  /**
   * 训练设置抽屉（2026-11-15）：自由打乱 / 观察 / 声音 / 状态重置这些「偶尔改一次」的操作
   * 不再平铺在控制栏上跟计时器抢高度，收进控制栏齿轮后面的一片浮层。
   */
  function bindSettingsPop(bindControls){
    const btn=$('#settingsBtn'),panel=$('#settingsPanel');
    if(!btn||!panel)return;
    bindControls&&bindControls(panel);
    const isOpen=()=>!panel.hidden;
    const setOpen=open=>{
      panel.hidden=!open;
      btn.setAttribute('aria-expanded',open?'true':'false');
    };
    btn.onclick=e=>{e.stopPropagation();setOpen(!isOpen())};
    const close=$('#closeSettingsBtn');if(close)close.onclick=()=>{setOpen(false);btn.focus()};
    // 浮层内点击不冒泡到 document，点面板外任意处收起；Esc 也收起
    panel.onclick=e=>e.stopPropagation();
    document.addEventListener('click',()=>{if(isOpen())setOpen(false)});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&isOpen()){setOpen(false);btn.focus()}});
    return {setOpen,isOpen};
  }

  /** 抽屉里的控件绑定（原来都平铺在控制栏，逻辑不变，只是搬了位置） */
  function bindSettingsControls(){
    $('#inspectionToggle').onchange=e=>{state.training.inspection=e.target.checked;save(false)};
    const secSel=$('#inspectionSec');
    if(secSel){secSel.value=String(xp.inspectionSec);secSel.onchange=e=>{xp.inspectionSec=Number(e.target.value)||15;saveXp();notify(`观察时长 ${xp.inspectionSec}s（判罚窗口随之调整）`)}}
    const vT=$('#voiceToggle');
    if(vT){vT.checked=!!xp.voiceOn;vT.onchange=e=>{xp.voiceOn=e.target.checked;saveXp();if(window.CubeAudio)CubeAudio.setPrefs({voiceOn:xp.voiceOn})}}
    const sT=$('#soundToggle');
    if(sT){sT.checked=!!xp.soundOn;sT.onchange=e=>{xp.soundOn=e.target.checked;saveXp();if(window.CubeAudio)CubeAudio.setPrefs({soundOn:xp.soundOn})}}
  }

  function bind(){
    // 状态重置（Cube 公用功能块）：给已连接的 GAN 魔方发 REQUEST_RESET，
    // 把当前物理姿态认作复原态；反馈写入连接状态行 cubeStatus
    if (window.CubeStateReset && $('#stateResetMount')) {
      CubeStateReset.mount($('#stateResetMount'), { onStatus: t => { $('#cubeStatus').textContent = t; } });
    }
    $('#workspaceMode').onclick=e=>{const b=e.target.closest('[data-mode]');if(b)switchWorkspace(b.dataset.mode)};
    $('#goAnalysisBtn').onclick=()=>switchWorkspace('analysis');
    $('#connectCubeBtn').onclick=toggleCube;
    bindCubeNet();
    bindSettingsPop(bindSettingsControls);
    // 打乱公式双击 = 换下一条（自由打乱模式直接重开，不给目标公式）
    const st=$('#scrambleText');
    if(st)st.addEventListener('dblclick',()=>{if(trainer.phase==='running'||trainer.phase==='inspection'){notify('计时中不能换打乱');return}nextScramble()});
    const freeT=$('#freeScrambleToggle');
    if(freeT){freeT.checked=!!xp.freeScramble;freeT.onchange=e=>applyFreeScramble(e.target.checked)}
    $('#freeScrambleDoneBtn').onclick=finishFreeScramble;$('#readyBtn').onclick=handleSpaceTimer;$('#cancelTimerBtn').onclick=cancelTraining;
    // 四宫格下方：修正本 Session 最新一把（DNF / +2 / 删除）
    const liveActions=$('#liveActions');
    if(liveActions)liveActions.onclick=e=>{
      const p=e.target.closest('[data-live-penalty]'),del=e.target.closest('[data-live-delete]');
      if(p){e.stopPropagation();applyLivePenalty(p.dataset.livePenalty);p.blur();return}
      if(del){e.stopPropagation();applyLiveDelete();del.blur();return}
    };
    $('#trainingMethod').onchange=e=>{state.training.method=e.target.value;save(false);renderTrainerSummary()};
    $('#trainingSession').onchange=e=>{state.training.session=e.target.value.trim()||'日常训练';e.target.value=state.training.session;save(false);renderTrainerSummary()};
    const qBtn=$('#qualityBtn');if(qBtn)qBtn.onclick=openQuality;
    const sAi=$('#sessionAiBtn');
    if(sAi)sAi.onclick=()=>{if(!sessionSolves().length){notify('本 Session 还没有成绩');return}switchWorkspace('analysis');state.activeTab='ai';$$('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab==='ai'));$$('.tab-panel').forEach(x=>x.classList.toggle('active',x.dataset.panel==='ai'));if(window.CubeAnalyzerAI)CubeAnalyzerAI.renderTabShell();};
    $('#trainingRecent').onclick=e=>{const row=e.target.closest('[data-open]');if(row)openSolve(state.solves.find(s=>String(s.id)===row.dataset.open))};
    document.addEventListener('keydown',e=>{if(e.code!=='Space'||e.repeat||/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName||''))return;if(state.workspaceMode!=='training')return;if(Replay&&Replay.isOpen())return;e.preventDefault();handleSpaceTimer()});

    $('#importBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=async e=>{try{await mergeImportFiles([...e.target.files])}catch(err){console.error(err);notify(`导入失败：${err.message}`)}finally{e.target.value=''}};
    $('#exportBtn').onclick=async()=>{
      // 导出必须是完整记录集：等扩展存储水合完成，否则会把较早的记录漏在备份之外
      try{ if(Store&&Store.ready) await Store.ready(); }catch(e){ console.warn('[Analyzer] 导出前等待水合失败',e) }
      const payload=window.CubeAnalyzerCloud?window.CubeAnalyzerCloud.buildLocalPayload():{version:2,data:{cubeAnalyzerData:{name:'训练数据',solves:state.solves.map(I.exportableSolve)}}};
      const n=payload?.data?.cubeAnalyzerData?.solves?.length||0;
      download(`cube-analyzer-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(payload,null,2));
      notify(`已导出 ${n} 条记录`);
    };
    $('#clearBtn').onclick=async()=>{
      if(!state.solves.length)return;
      if(!confirm('确认清空 Analyzer 的全部训练记录？'))return;
      state.solves=[];state.datasetName='训练数据';
      // 清空是用户显式操作：放行这一次覆盖，同时把「已确认条数下限」清零，
      // 之后重新开始的少量记录仍会走二次确认，不会被这次清空永久放行。
      if(window.CubeAnalyzerCloud){
        window.CubeAnalyzerCloud.allowEmptyUploadOnce=true;
        window.CubeAnalyzerCloud.allowCountRegressionOnce=true;
        if(typeof window.CubeAnalyzerCloud.confirmOverwrite==='function')window.CubeAnalyzerCloud.confirmOverwrite(0);
      }
      // 清空是唯一允许整份覆盖的显式操作：走 replaceAll，连扩展存储一起清
      if(Store){Store.replaceAll({name:'训练数据',solves:[]},settingsOf())}
      renderTrainerSummary();renderAll();updateSolveBadge();
      if(window.CubeAnalyzerCloud)window.CubeAnalyzerCloud.scheduleUpload();
      notify('已清空训练数据');
    };
    ['method','session','device'].forEach(k=>{$(`#${k}Filter`).onchange=e=>{state.filters[k]=e.target.value;renderFilterSummary();renderAll()}});$('#startDate').onchange=e=>{state.filters.start=e.target.value;renderFilterSummary();renderAll()};$('#endDate').onchange=e=>{state.filters.end=e.target.value;renderFilterSummary();renderAll()};
    $('#resetFilterBtn').onclick=()=>{state.filters={method:'all',session:'all',device:'all',start:'',end:''};syncFilterUI();renderAll()};
    // 窄屏筛选栏折叠开关（宽屏时按钮被 CSS 隐藏，不显示也不影响筛选）
    const fToggle=$('#filterToggle'),fBar=$('#filterBar');
    if(fToggle&&fBar){
      fToggle.onclick=()=>{
        const open=fToggle.getAttribute('aria-expanded')==='true';
        fToggle.setAttribute('aria-expanded',open?'false':'true');
        fBar.dataset.collapsed=open?'true':'false';
        // 记下这是用户主动选的：之后切页签回来不再强行收起
        fBar.dataset.userToggled='true';
      };
      window.addEventListener('resize',()=>{syncFilterCollapse()});
    }
    $('#tabs').onclick=e=>{const b=e.target.closest('.tab[data-tab]');if(!b)return;state.activeTab=b.dataset.tab;$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.tab-panel').forEach(x=>x.classList.toggle('active',x.dataset.panel===state.activeTab))};
    $('#closeSolveModal').onclick=()=>$('#solveModal').hidden=true;$('#solveModal').onclick=e=>{if(e.target===$('#solveModal'))$('#solveModal').hidden=true};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!(Replay&&Replay.isOpen()))$('#solveModal').hidden=true});
    window.addEventListener('cube-analyzer-cloud-sync',e=>{
      const r=e.detail||{};
      // 覆盖闸门判为「需二次确认」时不是失败：本机数据一条没动，云端也没被覆盖，
      // 状态文案要说清楚等的是用户确认，别让用户以为坏了。
      if(r.needsConfirm)updateCloudIndicator('覆盖云端需确认');
      else updateCloudIndicator(r.success?'已保存到 Supabase':'云保存失败');
    });
  }

  function init(){
    load();
    // Case 示意图的数据源（Cube/Formula/assets/DB.json）先拉起来；
    // 它是异步的，到货后把 Case 面板重画一遍即可（没数据时卡片本来就不带图）。
    if(window.CubeCaseData&&typeof window.CubeCaseData.ready==='function'){
      Promise.resolve(window.CubeCaseData.ready()).then(()=>{if(state.workspaceMode==='analysis')renderCases(filtered())}).catch(()=>{});
    }
    $('#trainingMethod').value=state.training?.method||'CFOP';$('#trainingSession').value=state.training?.session||'日常训练';$('#inspectionToggle').checked=!!state.training?.inspection;trainer.timingMode='pending';
    if(window.siteNav&&typeof window.siteNav.init==='function')window.siteNav.init({setTheme});
    window._siteNavReloadData=reloadFromStorage;
    bindCube();bind();nextScramble();refreshFilterOptions();syncFilterUI();renderTrainerSummary();renderAll();switchWorkspace('training');updateSolveBadge();updateCloudIndicator();
    observeTrainerRecent();
    observeTrainerFit();
    // 窄屏进来默认收起筛选栏，先让首屏看到数据本身（每次切页签都会重算，见 syncFilterCollapse）
    syncFilterCollapse();
    // —— 融入启动（2026-09-29）：体验偏好同步到音频模块；AI 报告桥接站点数据（DNF/异常由 AI 模块内二次排除）——
    if(window.CubeAudio){CubeAudio.setPrefs({voiceOn:!!xp.voiceOn,soundOn:!!xp.soundOn});CubeAudio.preload();}
    if(window.CubeAnalyzerAI)CubeAnalyzerAI.init({getFiltered:()=>filtered(),getBaseline:baselineStats});
    if(window.authManager&&typeof window.authManager.onAuthStateChange==='function')window.authManager.onAuthStateChange(handleAuthState);
    // 分层存储：首屏已用 localStorage 同步渲染，这里再把扩展存储里的较早记录并回来
    hydrate();
    // 打乱反算全部在 scramble-worker.js 里做（建表 ~1.4s 也只占 Worker 线程）。
    // 这里只把 Worker 提前拉起来，让它自己在后台建表，主线程一点都不用等。
    try{ ensureWorker() }catch(e){}
  }

  document.addEventListener('DOMContentLoaded',init);

})();

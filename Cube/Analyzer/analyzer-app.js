(() => {
  'use strict';
  const C=window.CubeAnalyzerCore, I=window.CubeAnalyzerImport, Ch=window.CubeAnalyzerCharts, Cube=window.CubeAnalyzerSmartCube, A=window.CubeAnalyzerSolveAnalysis;
  const esc=Ch.esc;
  // DNF 只存在于记录中：记录列表与复原次数包含它，所有分析（趋势/AO/分段/TPS/Case 等）一律排除。
  const noDnf=s=>s&&C.normalizeFlag(s.flag)!=='dnf';
  const STORAGE=(window.CubeAnalyzerCloud&&window.CubeAnalyzerCloud.storageKey)||'cubeAnalyzerDataV2', SETTINGS=(window.CubeAnalyzerCloud&&window.CubeAnalyzerCloud.settingsKey)||'cubeAnalyzerSettingsV2';
  const state={solves:[],datasetName:'训练数据',activeTab:'overview',workspaceMode:'training',trendMetric:'single',resolution:'all',tpsMode:'segregated',goal:{CFOP:15,Roux:18,ZZ:18},caseType:'ALL',filters:{method:'all',session:'all',device:'all',start:'',end:''},training:{method:'CFOP',session:'日常训练',inspection:false}};
  let toastTimer=null, cloudHydrated=false, migratedData=false;

  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  function fmtMs(ms,digits=2){return Number.isFinite(Number(ms))?`${(Number(ms)/1000).toFixed(digits)}s`:'—'}
  function fmtNum(v,d=2){return Number.isFinite(Number(v))?Number(v).toFixed(d):'—'}
  function fmtDate(v,short=false){const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v||'—');return short?d.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'}):d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}
  function solveTime(s){if(!s)return'—';if(C.normalizeFlag(s.flag)==='dnf')return'DNF';const base=fmtMs(C.displayTimeMs(s));return C.normalizeFlag(s.flag)==='plus_two'?`${base} +2`:base}
  function dominantMethod(solves){const m=new Map();solves.forEach(s=>m.set(s.analysisType,(m.get(s.analysisType)||0)+1));return [...m].sort((a,b)=>b[1]-a[1])[0]?.[0]||'CFOP'}
  function notify(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2200)}
  function download(name,content,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;document.body.appendChild(a);a.click();URL.revokeObjectURL(a.href);a.remove()}
  // 本地写入：返回是否真的落盘（storageManager 现在会如实返回 false，不再静默吞掉）
  function writeLocal(payload,settings){
    if(window.storageManager){
      const ok=window.storageManager.setJson(STORAGE,payload)!==false;
      window.storageManager.setJson(SETTINGS,settings);
      return ok;
    }
    try{localStorage.setItem(STORAGE,JSON.stringify(payload));localStorage.setItem(SETTINGS,JSON.stringify(settings));return true}
    catch(e){console.error('[Analyzer] 本地写入失败',e);return false}
  }
  // 写不下时逐级瘦身：只压缩轨迹字段（snapshots / stateSequence），记录条数永不减少。
  // 最新 keepDetailed 条保留完整轨迹，其余按级降级；这是最后兜底，正常永远用不到。
  function slimStage(payload,keepDetailed,dropSeq){
    const solves=payload.solves.map(s=>({...s}));
    const n=solves.length;
    for(let i=0;i<n;i++){
      const rank=n-1-i; // 0 = 最新
      if(rank>=keepDetailed){
        if(solves[i].snapshots&&solves[i].snapshots.length)solves[i].snapshots=[];
        if(dropSeq&&solves[i].stateSequence&&solves[i].stateSequence.length)solves[i].stateSequence=[];
      }
    }
    return {...payload,solves};
  }
  function save(sync=true){
    try{
      const settings={goal:state.goal,trendMetric:state.trendMetric,resolution:state.resolution,tpsMode:state.tpsMode,training:state.training};
      let payload={name:'训练数据',solves:state.solves.map(I.exportableSolve)};
      let ok=writeLocal(payload,settings);
      let slimmed=0;
      if(!ok){
        // 存储满：按级压缩历史轨迹后再写（PB/次数/时间不受影响）
        const stages=[slimStage(payload,20,false),slimStage(payload,20,true),slimStage(payload,0,true)];
        for(const v of stages){
          payload=v;slimmed++;
          ok=writeLocal(payload,settings);
          if(ok){console.warn('[Analyzer] 本地存储接近上限，已压缩历史轨迹数据（记录条数不变）');break}
        }
      }
      if(!ok){
        // 绝不静默失败：明确告诉用户，数据还在当前页面内存里，千万别直接关
        console.error('[Analyzer] 本地保存失败：浏览器存储已满');
        notify('本地保存失败：浏览器存储已满，请先导出备份');
        return;
      }
      if(!window._siteNavApplyingCloudData&&typeof window._siteNavSetDirty==='function')window._siteNavSetDirty(true);
      if(sync&&window.CubeAnalyzerCloud)window.CubeAnalyzerCloud.scheduleUpload();
    }catch(e){console.error('[Analyzer] 保存异常',e);notify('本地保存失败：'+(e&&e.message||e))}
  }
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

  function load(){
    migratedData=false;
    try{
      const settings=window.storageManager?window.storageManager.getJson(SETTINGS,{}):JSON.parse(localStorage.getItem(SETTINGS)||'{}');
      if(settings&&typeof settings==='object')Object.assign(state,settings);
      if(settings?.training)state.training={...state.training,...settings.training};
      const d=window.storageManager?window.storageManager.getJson(STORAGE,null):JSON.parse(localStorage.getItem(STORAGE)||'null');
      if(Array.isArray(d?.solves)&&d.solves.length){
        // 逐条隔离：一条坏记录只降级自己，绝不连坐清空整个列表
        const loaded=[];
        d.solves.forEach((raw,i)=>{
          try{loaded.push(upgradeSolve(raw,i));}
          catch(e){
            console.warn('[Analyzer] 记录升级失败，降级保留原始数据',i,e);
            try{loaded.push(I.normalizeSolve(raw,i));}catch(e2){console.warn('[Analyzer] 记录解析失败，已跳过',i,e2);}
          }
        });
        state.solves=loaded;
      }
      // 迁移（自愈）：旧记录里带着无人读取的陀螺仪采样，单条体积 88% 都耗在这上面，
      // 几十把就会撑满 localStorage 配额并导致此后写入静默失败。检测到即重写瘦身。
      try{
        const raw=localStorage.getItem(STORAGE);
        if(raw&&(/"gyroSamples":\[\{/.test(raw)||raw.length>4*1024*1024))migratedData=true;
      }catch(e){}
      if(migratedData)save(false);
    }catch(e){console.warn(e)}
    state.datasetName='训练数据';
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
    el.innerHTML=metrics+`<div class="grid-2"><div id="overviewTrend"></div><div id="overviewQuality"></div></div><div id="overviewPlan" style="margin-top:10px"></div>`;
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
    el.innerHTML=panel('成绩趋势','提供 Single / AO5 / AO12 / AO100，并支持分组、按日和全部数据点','<div class="chart-box" id="trendChart"></div>',metricControls)+`<div style="height:10px"></div>`+panel('成绩明细','点击任意行查看阶段和 TPS 详情','<div id="historyTable"></div>');
    const values=currentMetricSeries(solves,state.trendMetric);const metric=(s,i)=>values[i];const series=C.groupSeries(solves,metric,state.resolution);
    Ch.lineChart($('#trendChart'),series,{yFormatter:v=>`${(v/1000).toFixed(1)}s`,xFormatter:x=>fmtDate(x,true),tooltip:d=>`${fmtDate(d.x)} · <strong>${fmtMs(d.y)}</strong>`});
    const recent=solves.slice(-120).reverse();
    $('#historyTable').innerHTML=`<div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>TPS</th><th>Turns</th><th>Fluency</th><th>Method</th><th>Session</th><th>Date</th></tr></thead><tbody>${recent.map((s,i)=>`<tr data-id="${esc(s.id)}"><td>${solves.length-i}</td><td class="time-cell ${C.normalizeFlag(s.flag)==='dnf'?'bad':''}">${solveTime(s)}</td><td class="mono">${fmtNum(s.tps)}</td><td class="mono">${fmtNum(s.turnCount,0)}</td><td>${fmtNum(s.fluencyPercent,0)}%</td><td><span class="badge subtle">${esc(s.analysisType)}</span></td><td>${esc(s.session)}</td><td class="muted">${fmtDate(s.date)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#metricSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.trendMetric=b.dataset.v;save();renderTrend(solves)}};
    $('#resolutionSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.resolution=b.dataset.v;save();renderTrend(solves)}};
    $('#historyTable').onclick=e=>{const tr=e.target.closest('tr[data-id]');if(tr)openSolve(solves.find(s=>String(s.id)===tr.dataset.id))};
  }

  function splitStack(rows,total){return `<div class="split-stack">${rows.filter(r=>r.time>0).map((r,i)=>{const pct=total?Math.max(5,r.time/total*100):25;const recPct=r.time?Math.min(100,(r.recognition||0)/r.time*100):0;return `<div class="split-seg" style="width:${pct}%" title="${esc(r.label)} ${fmtMs(r.time)}"><i class="split-rec" style="width:${recPct}%"></i><span class="split-label">${esc(r.label)}</span></div>`}).join('')}</div>`}

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
  function renderCases(solves){
    const el=$('#casesContent'),all=C.caseStatistics(solves.filter(noDnf)),types=['ALL','OLL','PLL','F2L','CMLL'];
    const filteredRows=state.caseType==='ALL'?all:all.filter(x=>x.caseType===state.caseType);
    const rows=filteredRows.slice().sort((a,b)=>caseWeaknessScore(b)-caseWeaknessScore(a));
    const controls=`<div class="segmented" id="caseSeg">${types.map(v=>`<button data-v="${v}" class="${state.caseType===v?'active':''}">${v}</button>`).join('')}</div>`;
    const priority=rows.slice(0,3);
    const priorityPanel=priority.length?panel('优先训练','按照个人中位耗时、识别时间与样本量综合排序，不使用不可验证的云端排名',`<div class="priority-list">${priority.map((r,i)=>`<div class="priority-row"><span class="priority-rank">${i+1}</span><div><strong>${esc(r.caseName)}</strong><span>${r.caseType} · n=${r.count}</span></div><div><span class="mini-label">Recognition</span><strong class="mono">${fmtMs(r.medianRecognition)}</strong></div><div><span class="mini-label">Execution</span><strong class="mono">${fmtMs(r.medianExecution)}</strong></div></div>`).join('')}</div>`):'';
    const body=rows.length?`<div class="case-grid">${rows.map(r=>{const pct=localBetterThan(r);return `<article class="card case-card"><div class="case-top"><span class="case-name">${esc(r.caseName)}</span><span class="badge subtle">n=${r.count}</span></div><div class="case-time">${fmtMs(r.median)}</div><div class="case-meta"><span>识别 <strong class="mono">${fmtMs(r.medianRecognition)}</strong></span><span>执行 <strong class="mono">${fmtMs(r.medianExecution)}</strong></span><span>最快 <strong class="mono">${fmtMs(r.fastest)}</strong></span><span>相对表现 <strong class="mono">${pct==null?'—':pct+'%'}</strong></span></div></article>`}).join('')}</div>`:empty('没有 Case 数据','需要智能魔方训练中可靠识别到标准 Case。中间状态不会被强行标成 Case。');
    el.innerHTML=priorityPanel+(priorityPanel?'<div style="height:10px"></div>':'')+panel('Case Statistics','按当前弱项优先级排序；总时间 = Recognition + Execution',body,controls)+`<div style="height:10px"></div>`+panel('相对表现','使用你的个人历史数据作为基准',`<div class="callout">相对表现使用该 Case 的个人历史 p20 / median / p80 作为参照，只反映你自己的近期变化，不伪造跨用户排名。</div>`);
    $('#caseSeg').onclick=e=>{const b=e.target.closest('button[data-v]');if(b){state.caseType=b.dataset.v;renderCases(solves)}};
  }

  function renderSolves(solves){
    const el=$('#solvesContent');if(!solves.length){el.innerHTML=empty('没有单次数据','调整筛选条件。');return}
    const rows=solves.slice().reverse().slice(0,300);
    el.innerHTML=panel('单次复盘',`显示最近 ${rows.length} / ${solves.length} 次；点击查看本次训练详情`,`<div class="solve-list">${rows.map(s=>`<article class="card solve-row-card" data-id="${esc(s.id)}"><div><div class="solve-time ${C.normalizeFlag(s.flag)==='dnf'?'bad':''}">${solveTime(s)}</div><div class="solve-date">${fmtDate(s.date)}</div></div><div><strong>${esc(s.analysisType)}</strong><span class="mini-label">${esc(s.session)}</span></div><div class="data-col"><span class="mini-label">TPS</span><span class="mono">${fmtNum(s.tps)}</span></div><div class="data-col"><span class="mini-label">Turns</span><span class="mono">${fmtNum(s.turnCount,0)}</span></div><div class="optional-col data-col"><span class="mini-label">Fluency</span><span class="mono">${fmtNum(s.fluencyPercent,0)}%</span></div><div class="optional-col data-col"><span class="mini-label">Device</span><span>${esc(s.device)}</span></div><div class="accent">›</div></article>`).join('')}</div>`);
    el.onclick=e=>{const row=e.target.closest('[data-id]');if(row)openSolve(solves.find(s=>String(s.id)===row.dataset.id))};
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
    body.innerHTML=`<div class="detail-grid"><div class="detail-item"><span class="mini-label">Time</span><strong>${solveTime(s)}</strong></div><div class="detail-item"><span class="mini-label">TPS</span><strong>${fmtNum(s.tps)}</strong></div><div class="detail-item"><span class="mini-label">Turns</span><strong>${fmtNum(s.turnCount,0)}</strong></div><div class="detail-item"><span class="mini-label">Fluency</span><strong>${fmtNum(s.fluencyPercent,0)}%</strong></div></div>${steps.length?splitStack(steps,total):''}<div class="table-wrap"><table><thead><tr><th>Stage</th><th>Case</th><th>AUF</th><th>Time</th><th>Recognition</th><th>Execution</th><th>Turns</th><th>Exec TPS</th></tr></thead><tbody>${rows||'<tr><td colspan="8">无法可靠分段；保留原始动作与成绩，不生成猜测阶段。</td></tr>'}</tbody></table></div><div style="height:10px"></div><div class="callout"><strong>Scramble</strong><br><span class="mono">${esc(s.scramble||'—')}</span><br><br><strong>动作记录</strong> · ${s.timestamps?.length||0} logical events · ${s.rawSolutionSequence?.reduce((n,x)=>n+(Array.isArray(x.rawMoves)&&x.rawMoves.length?x.rawMoves.length:1),0)||s.timestamps?.length||0} raw moves · ${esc(s.device)}<br><strong>数据源</strong> · ${esc(s.source||'import')}<br><strong>解法方位</strong> · ${s.analysisFrame?.autoDetected?(s.analysisFrame.crossFace?`识别底面 ${esc(s.analysisFrame.crossFace)}`:'六色底 / 任意持握自动识别'):'未可靠识别'}${reaction!=null?`<br><strong>复原后停表反应</strong> · ${fmtMs(reaction)}（不计入最后阶段执行时间）`:''}</div>`;
    modal.hidden=false;
  }



  function renderDatasetMeta(solves){
    $('#datasetName').textContent=state.datasetName;$('#datasetCount').textContent=`${solves.length} solves`;
    const deep=solves.filter(s=>s.timestamps?.length>1).length,split=solves.filter(s=>s.steps?.length).length;
    const b=$('#deepDataBadge');b.textContent=deep?`${deep} 完整动作 · ${split} 已分段`:`${split} 已分段 · 无完整动作`;b.className=`badge ${deep?'accent':'subtle'}`;
  }

  function renderAll(){const s=filtered();renderDatasetMeta(s);renderOverview(s);renderTrend(s);renderSplits(s);renderTPS(s);renderCases(s);renderSolves(s)}

  async function importFiles(files){
    const all=[];for(const file of files){const text=await file.text();const parsed=I.parseAny(text,file.name).map(upgradeSolve);all.push(...parsed)}
    if(!all.length)throw new Error('没有识别到有效 solve');state.solves=all.sort((a,b)=>new Date(a.date)-new Date(b.date));state.datasetName=files.length===1?files[0].name:`${files.length} 个文件`;state.filters={method:'all',session:'all',device:'all',start:'',end:''};syncFilterUI();refreshFilterOptions();save();renderAll();notify(`已导入 ${all.length} 条记录`)
  }
  function syncFilterUI(){ $('#methodFilter').value=state.filters.method;$('#sessionFilter').value=state.filters.session;$('#deviceFilter').value=state.filters.device;$('#startDate').value=state.filters.start;$('#endDate').value=state.filters.end }

  const trainer={
    phase:'scramble',scramble:'',scrambleMoves:[],scrambleObservedMoves:[],scrambleViewStore:null,scrambleTargetFacelet:'',scrambleBaseReady:false,scrambleComplete:false,
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
    if(state.workspaceMode==='analysis'){refreshFilterOptions();syncFilterUI();renderAll()}
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
  function invertMoves(moves){return (moves||[]).slice().reverse().map(raw=>{const m=parseMove(raw);return m?moveText(m.face,4-m.power):''}).filter(Boolean)}
  function sameFacelet(a,b){return !!a&&!!b&&String(a).trim()===String(b).trim()}
  function solvedFacelet(){return window.mathlib&&window.mathlib.SOLVED_FACELET?window.mathlib.SOLVED_FACELET:''}
  function faceletAfterMoves(moves){
    try{
      if(!window.mathlib||!window.mathlib.CubieCube||!window.mathlib.SOLVED_FACELET)return'';
      const cube=new window.mathlib.CubieCube();cube.fromFacelet(window.mathlib.SOLVED_FACELET);
      (moves||[]).forEach(m=>cube.selfMoveStr(m));return cube.toFaceCube();
    }catch(e){console.warn('Scramble state build failed',e);return''}
  }

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

  function renderScramble(){
    const el=$('#scrambleText'),meta=$('#scrambleMeta');if(!el)return;
    if(!trainer.scrambleMoves.length){el.textContent='—';if(meta)meta.textContent='';return}
    const view=computeScrambleView();
    ScrambleView.render(el,view);
    if(!meta)return;
    if(!Cube||!Cube.isConnected()){meta.textContent='未连接魔方 · 可按 Space 手动起停';return}
    if(!trainer.scrambleBaseReady){meta.textContent='请先把智能魔方复原，再按公式打乱';return}
    if(trainer.scrambleComplete){meta.textContent='打乱完成';return}
    meta.textContent=view.correcting?'转动有偏差 · 按青色修正步继续':`打乱 ${view.progress}/${trainer.scrambleMoves.length}`;
  }

  function phase(stateName,status,sub){
    trainer.phase=stateName;const stage=$('#timerStage');if(stage)stage.dataset.state=stateName;
    if(status!==undefined)$('#timerStatus').textContent=status;if(sub!==undefined)$('#timerSub').textContent=sub;
    const cancel=$('#cancelTimerBtn');if(cancel)cancel.disabled=stateName!=='running'&&stateName!=='inspection';
    updateTimingControls();
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
    const turns=C.extractTurnCount(trainer.moves)||0,tps=elapsed>0?turns*1000/elapsed:null,fluency=C.fluencyFromTimestamps(C.turnTimestamps(trainer.moves,trainer.timestamps),elapsed,400);
    $('#liveTurns').textContent=turns;$('#liveTps').textContent=tps?fmtNum(tps):'—';$('#liveFluency').textContent=fluency==null?'—':`${fmtNum(fluency,0)}%`;renderMoveStream();
  }

  function tick(){
    cancelAnimationFrame(trainer.raf);
    const loop=()=>{
      const now=performance.now();
      if(trainer.phase==='running'){
        const elapsed=now-trainer.startedAt;$('#timerValue').textContent=(elapsed/1000).toFixed(2);updateLive(elapsed);
      }else if(trainer.phase==='inspection'){
        const elapsed=now-trainer.inspectionStartedAt,remain=Math.max(0,15000-elapsed);
        $('#timerValue').textContent=(remain/1000).toFixed(1);
        $('#timerStatus').textContent=elapsed>17000?'观察超时 · DNF':elapsed>15000?'观察超时 · +2':'观察中';
      }else{return}
      trainer.raf=requestAnimationFrame(loop);
    };trainer.raf=requestAnimationFrame(loop);
  }

  function enterReadyAfterScramble(){
    trainer.scrambleComplete=true;trainer.scrambleObservedMoves=trainer.scrambleMoves.slice();renderScramble();resetLive();trainer.inspectionPenalty='ok';
    if($('#inspectionToggle').checked){trainer.inspectionStartedAt=performance.now();trainer.timingMode='pending';phase('inspection','观察中','按 Space 开始，或直接转动启用状态自动计时');$('#timerValue').textContent='15.0';tick()}
    else{trainer.timingMode='pending';phase('ready','已打乱','按 Space 开始，或直接转动启用状态自动计时');$('#timerValue').textContent='0.00'}
  }

  function prepareScrambleBase(facelet){
    if(!Cube||!Cube.isConnected())return;
    const f=facelet||Cube.getFacelet?.()||'';
    if(Cube.isSolved(f)){
      trainer.scrambleBaseReady=true;trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;trainer.scrambleComplete=false;
      phase('scramble','按公式打乱','完成后即可开始计时');renderScramble();
    }else{
      trainer.scrambleBaseReady=false;trainer.scrambleComplete=false;
      phase('scramble','请先复原魔方','复原后自动进入打乱跟踪');renderScramble();
    }
  }

  function nextScramble(){
    cancelAnimationFrame(trainer.raf);resetLive();trainer.scramble=randomScramble();trainer.scrambleMoves=trainer.scramble.split(/\s+/).filter(Boolean);trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;
    trainer.scrambleTargetFacelet=faceletAfterMoves(trainer.scrambleMoves);trainer.scrambleBaseReady=false;trainer.scrambleComplete=false;trainer.timingMode='pending';$('#timerValue').textContent='0.00';
    if(Cube&&Cube.isConnected())prepareScrambleBase(Cube.getFacelet?.());
    else phase('scramble','按公式打乱','完成后按 Space 手动起停；连接魔方后也可状态自动起停');
    renderScramble();
  }

  function markScrambleComplete(){if(trainer.scrambleComplete)return;enterReadyAfterScramble()}

  function handleScrambleMove(detail){
    if(trainer.phase!=='scramble')return false;
    if(!trainer.scrambleBaseReady){
      if(detail.previousFacelet&&Cube.isSolved(detail.previousFacelet))trainer.scrambleBaseReady=true;
      else if(detail.solved){trainer.scrambleBaseReady=true;trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;renderScramble();phase('scramble','按公式打乱','完成后即可开始计时');return true}
      else{renderScramble();return true}
    }
    const observed=Array.isArray(detail.rawMoves)&&detail.rawMoves.length?detail.rawMoves:[detail.move];trainer.scrambleObservedMoves.push(...observed.filter(Boolean));renderScramble();
    const current=detail.facelet||Cube.getFacelet?.()||'';
    if(detail.batchFinal!==false){if(trainer.scrambleTargetFacelet&&current){if(sameFacelet(current,trainer.scrambleTargetFacelet))markScrambleComplete()}else if(computeScrambleView().done)markScrambleComplete();}
    return true;
  }

  function handleCubeState(detail){
    if(trainer.phase==='scramble'){
      if(!trainer.scrambleBaseReady&&detail.solved){trainer.scrambleBaseReady=true;trainer.scrambleObservedMoves=[];trainer.scrambleViewStore=null;phase('scramble','按公式打乱','完成后即可开始计时');renderScramble();return}
      if(trainer.scrambleBaseReady&&!trainer.scrambleComplete&&trainer.scrambleTargetFacelet&&sameFacelet(detail.facelet,trainer.scrambleTargetFacelet))markScrambleComplete();
    }
  }

  function beginSolve(mode,firstDetail=null){
    if(trainer.phase!=='ready'&&trainer.phase!=='inspection'&&!(trainer.phase==='scramble'&&mode==='space'&&!Cube?.isConnected()))return false;
    if(trainer.phase==='scramble'&&mode==='space'&&!Cube?.isConnected())trainer.scrambleComplete=true;
    if(trainer.phase==='inspection'){
      const inspect=performance.now()-trainer.inspectionStartedAt;trainer.inspectionPenalty=inspect>17000?'dnf':inspect>15000?'plus_two':'ok';
    }else trainer.inspectionPenalty='ok';
    resetLive();
    trainer.timingMode=mode;
    const eventTs=Number(firstDetail?.startTimestamp ?? firstDetail?.timestamp);
    trainer.startedEpoch=mode==='state'&&Number.isFinite(eventTs)?eventTs:Date.now();
    trainer.startedAt=performance.now();
    trainer.startFacelet=(firstDetail?.previousFacelet)||(Cube&&Cube.getFacelet?Cube.getFacelet():'')||trainer.scrambleTargetFacelet||'';
    if(trainer.startFacelet)trainer.snapshots.push({facelet:trainer.startFacelet,timestamp:0});
    phase('running','计时中',mode==='space'?'按 Space 停止':'复原后自动停止');$('#timerValue').textContent='0.00';tick();
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
    $('#timerValue').textContent=(elapsed/1000).toFixed(2);
    const solvedNow=Cube&&Cube.isConnected()?Cube.isSolved(Cube.getFacelet?.()||''):true;
    const sub=smartData?(autoAnalysis?'已保存完整轨迹 · 已自动识别解法方位并分段':(solvedNow?'已保存完整动作与时间戳 · 分段识别未命中':'已保存完整动作与时间戳 · 最终状态未复原')):'已保存手工计时记录';
    phase('done',record.flag==='dnf'?'DNF':record.flag==='plus_two'?'完成 · +2':'完成',sub);
    refreshFilterOptions();save(true);renderTrainerSummary();renderAll();$('#totalSolveBadge').textContent=`${state.solves.length} solves`;notify('成绩已保存');
    window.setTimeout(()=>nextScramble(),450);
  }

  function handleSpaceTimer(){
    if(state.workspaceMode!=='training')return;
    if(trainer.phase==='running'){
      if(trainer.timingMode==='space'){Cube?.flushPending?.();finishSolve('space');}
      return;
    }
    if(trainer.phase==='scramble'&&Cube?.isConnected()&&!trainer.scrambleComplete){notify('请先按打乱公式完成打乱');return}
    beginSolve('space');
  }

  function cancelTraining(){cancelAnimationFrame(trainer.raf);nextScramble()}
  function sessionSolves(){const name=($('#trainingSession').value||'日常训练').trim();return state.solves.filter(s=>String(s.session)===name)}
  function renderTrainerSummary(){
    const solves=sessionSolves(),S=solves.length?C.solveSummary(solves):null;
    $('#sessionSummary').textContent=solves.length?`${solves.length} 次 · ${$('#trainingMethod').value}`:'暂无成绩';
    $('#sessionMetrics').innerHTML=S?`<div><span>Latest</span><strong>${solveTime(solves[solves.length-1])}</strong></div><div><span>AO5</span><strong>${S.ao5?.isDNF?'DNF':fmtMs(S.ao5?.time)}</strong></div><div><span>AO12</span><strong>${S.ao12?.isDNF?'DNF':fmtMs(S.ao12?.time)}</strong></div><div><span>Best</span><strong>${fmtMs(S.best)}</strong></div>`:`<div class="muted">完成第一把后显示统计</div>`;
    const rows=state.solves.slice(-8).reverse();
    $('#trainingRecent').innerHTML=rows.length?`<div class="training-solve-list">${rows.map(s=>`<div class="training-solve-row" data-open="${esc(s.id)}"><div><strong class="mono">${solveTime(s)}</strong><span>${fmtDate(s.date)}</span></div><div><strong>${esc(s.session)}</strong><span>${esc(s.device)}</span></div><div class="recent-stats"><span>TPS ${fmtNum(s.tps)}</span><span>${fmtNum(s.turnCount,0)} turns</span></div><div class="recent-actions"><button type="button" data-penalty="plus_two" data-id="${esc(s.id)}">+2</button><button type="button" data-penalty="dnf" data-id="${esc(s.id)}">DNF</button><button type="button" data-delete="${esc(s.id)}">删除</button></div></div>`).join('')}</div>`:empty('还没有训练记录','连接智能魔方开始训练，或使用空格进行手动计时。');
  }

  function changePenalty(id,flag){const s=state.solves.find(x=>String(x.id)===String(id));if(!s)return;s.flag=C.normalizeFlag(s.flag)===flag?'ok':flag;save(true);renderTrainerSummary();renderAll()}
  function deleteSolve(id){state.solves=state.solves.filter(x=>String(x.id)!==String(id));save(true);renderTrainerSummary();renderAll();$('#totalSolveBadge').textContent=`${state.solves.length} solves`}

  async function toggleCube(){
    const btn=$('#connectCubeBtn');btn.disabled=true;
    try{
      if(Cube.isConnected()){await Cube.disconnect();return}
      $('#connectCubeLabel').textContent='选择设备…';$('#cubeStatus').textContent='正在连接';await Cube.connect();
    }catch(e){notify(e.message||String(e));$('#cubeStatus').textContent='连接失败'}finally{btn.disabled=false;if(!Cube.isConnected())$('#connectCubeLabel').textContent='连接魔方'}
  }

  function bindCube(){
    Cube.on('connecting',()=>{$('#cubeStatus').textContent='等待选择设备';$('#connectCubeBtn').classList.remove('connected')});
    Cube.on('connect',async d=>{const battery=await Cube.battery(),batteryLevel=Array.isArray(battery)?battery[0]:battery;$('#connectCubeBtn').classList.add('connected');$('#connectCubeLabel').textContent=d.deviceName||'已连接';$('#cubeStatus').textContent=batteryLevel==null?'已连接':`已连接 · ${batteryLevel}%`;$('#liveDevice').textContent=d.deviceName||'智能魔方';prepareScrambleBase(Cube.getFacelet?.())});
    Cube.on('disconnect',()=>{$('#connectCubeBtn').classList.remove('connected');$('#connectCubeLabel').textContent='连接魔方';$('#cubeStatus').textContent='未连接';$('#liveDevice').textContent='等待训练';nextScramble()});
    Cube.on('state',handleCubeState);
    Cube.on('move',recordCubeMove);
    Cube.on('gyro',detail=>{if(trainer.phase==='running'||trainer.phase==='ready'||trainer.phase==='inspection')trainer.gyroSamples.push(detail)});
  }

  async function mergeImportFiles(files){
    const imported=[];for(const file of files){const text=await file.text();imported.push(...I.parseAny(text,file.name).map(upgradeSolve))}
    if(!imported.length)throw new Error('没有识别到有效 solve');
    const key=s=>`${s.id}|${s.date}`;const map=new Map(state.solves.map(s=>[key(s),s]));imported.forEach(s=>map.set(key(s),s));state.solves=[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date));state.datasetName='训练数据';
    state.filters={method:'all',session:'all',device:'all',start:'',end:''};refreshFilterOptions();syncFilterUI();save(true);renderTrainerSummary();renderAll();$('#totalSolveBadge').textContent=`${state.solves.length} solves`;notify(`已导入 ${imported.length} 条记录`)
  }

  function reloadFromStorage(){load();refreshFilterOptions();syncFilterUI();renderTrainerSummary();renderAll();$('#totalSolveBadge').textContent=`${state.solves.length} solves`;updateCloudIndicator()}


  async function handleAuthState(user){
    updateCloudIndicator();
    if(!user||cloudHydrated||state.solves.length||!window.CubeAnalyzerCloud)return;
    // 内存为空 ≠ 磁盘为空：load() 一旦失败内存会清零，但本机备份还在，绝不能被云端覆写
    try{
      const disk=JSON.parse(localStorage.getItem(window.CubeAnalyzerCloud.storageKey)||'null');
      if(disk&&Array.isArray(disk.solves)&&disk.solves.length)return;
    }catch(e){}
    cloudHydrated=true;
    try{
      const status=await window.CubeAnalyzerCloud.getCloudStatus();
      if(!status?.success){ cloudHydrated=false; return; } // 查询失败不烧掉水合机会，下次 auth 事件重试
      const block=status?.cloudData?.data;
      const cd=block?.cubeAnalyzerData;
      if(status.hasData&&cd&&Array.isArray(cd.solves)){
        // 覆盖本地前先留快照，可从头像菜单回滚
        if(typeof window._siteNavPrepareOverwrite==='function'){
          const guard=window._siteNavPrepareOverwrite('云端数据自动载入',block);
          if(!guard.success)return;
        }
        window.CubeAnalyzerCloud.applyDataToLocalStorage(block);
        reloadFromStorage();
        notify('已载入 Supabase 训练数据');
      }
    }catch(e){ cloudHydrated=false; console.warn('Cloud hydration skipped',e) }
  }

  function bind(){
    $('#workspaceMode').onclick=e=>{const b=e.target.closest('[data-mode]');if(b)switchWorkspace(b.dataset.mode)};
    $('#goAnalysisBtn').onclick=()=>switchWorkspace('analysis');
    $('#connectCubeBtn').onclick=toggleCube;$('#newScrambleBtn').onclick=nextScramble;$('#readyBtn').onclick=handleSpaceTimer;$('#cancelTimerBtn').onclick=cancelTraining;
    $('#trainingMethod').onchange=e=>{state.training.method=e.target.value;save(false);renderTrainerSummary()};
    $('#trainingSession').onchange=e=>{state.training.session=e.target.value.trim()||'日常训练';e.target.value=state.training.session;save(false);renderTrainerSummary()};
    $('#inspectionToggle').onchange=e=>{state.training.inspection=e.target.checked;save(false)};
    $('#trainingRecent').onclick=e=>{const p=e.target.closest('[data-penalty]'),del=e.target.closest('[data-delete]');if(p){e.stopPropagation();changePenalty(p.dataset.id,p.dataset.penalty);return}if(del){e.stopPropagation();deleteSolve(del.dataset.delete);return}const row=e.target.closest('[data-open]');if(row)openSolve(state.solves.find(s=>String(s.id)===row.dataset.open))};
    document.addEventListener('keydown',e=>{if(e.code!=='Space'||e.repeat||/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName||''))return;if(state.workspaceMode!=='training')return;e.preventDefault();handleSpaceTimer()});

    $('#importBtn').onclick=()=>$('#fileInput').click();$('#fileInput').onchange=async e=>{try{await mergeImportFiles([...e.target.files])}catch(err){console.error(err);notify(`导入失败：${err.message}`)}finally{e.target.value=''}};
    $('#exportBtn').onclick=()=>download(`cube-analyzer-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(window.CubeAnalyzerCloud?window.CubeAnalyzerCloud.buildLocalPayload():{version:2,data:{cubeAnalyzerData:{name:'训练数据',solves:state.solves.map(I.exportableSolve)}}},null,2));
    $('#clearBtn').onclick=()=>{if(!state.solves.length)return;if(!confirm('确认清空 Analyzer 的全部训练记录？'))return;state.solves=[];state.datasetName='训练数据';if(window.CubeAnalyzerCloud){window.CubeAnalyzerCloud.allowEmptyUploadOnce=true;window.CubeAnalyzerCloud.allowCountRegressionOnce=true;}save(true);renderTrainerSummary();renderAll();$('#totalSolveBadge').textContent='0 solves';notify('已清空训练数据')};
    ['method','session','device'].forEach(k=>{$(`#${k}Filter`).onchange=e=>{state.filters[k]=e.target.value;renderAll()}});$('#startDate').onchange=e=>{state.filters.start=e.target.value;renderAll()};$('#endDate').onchange=e=>{state.filters.end=e.target.value;renderAll()};
    $('#resetFilterBtn').onclick=()=>{state.filters={method:'all',session:'all',device:'all',start:'',end:''};syncFilterUI();renderAll()};
    $('#tabs').onclick=e=>{const b=e.target.closest('.tab[data-tab]');if(!b)return;state.activeTab=b.dataset.tab;$$('.tab').forEach(x=>x.classList.toggle('active',x===b));$$('.tab-panel').forEach(x=>x.classList.toggle('active',x.dataset.panel===state.activeTab))};
    $('#closeSolveModal').onclick=()=>$('#solveModal').hidden=true;$('#solveModal').onclick=e=>{if(e.target===$('#solveModal'))$('#solveModal').hidden=true};document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#solveModal').hidden=true});
    window.addEventListener('cube-analyzer-cloud-sync',e=>updateCloudIndicator(e.detail?.success?'已保存到 Supabase':'云保存失败'));
  }

  function init(){
    load();
    $('#trainingMethod').value=state.training?.method||'CFOP';$('#trainingSession').value=state.training?.session||'日常训练';$('#inspectionToggle').checked=!!state.training?.inspection;trainer.timingMode='pending';
    if(window.siteNav&&typeof window.siteNav.init==='function')window.siteNav.init({setTheme});
    window._siteNavReloadData=reloadFromStorage;
    bindCube();bind();nextScramble();refreshFilterOptions();syncFilterUI();renderTrainerSummary();renderAll();switchWorkspace('training');$('#totalSolveBadge').textContent=`${state.solves.length} solves`;updateCloudIndicator();
    if(window.authManager&&typeof window.authManager.onAuthStateChange==='function')window.authManager.onAuthStateChange(handleAuthState);
  }

  document.addEventListener('DOMContentLoaded',init);

})();

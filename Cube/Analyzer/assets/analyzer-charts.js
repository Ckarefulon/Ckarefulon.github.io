(() => {
  'use strict';
  const SVG = 'http://www.w3.org/2000/svg';

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function fmt(v, digits=2) { return Number.isFinite(v) ? Number(v).toFixed(digits) : '—'; }

  function empty(el, title='暂无可绘制数据', text='导入更多包含该指标的数据后，这里会自动出现图表。') {
    el.innerHTML = `<div class="empty"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
  }

  function lineChart(el, series, opts={}) {
    if (!el) return;
    const clean = (series || []).filter(d => Number.isFinite(Number(d.y)));
    if (!clean.length) return empty(el, opts.emptyTitle, opts.emptyText);
    const W = 900, H = opts.height || 300, P = {l:54,r:18,t:18,b:34};
    const ys = clean.map(d => Number(d.y));
    let ymin = opts.yMin ?? Math.min(...ys), ymax = opts.yMax ?? Math.max(...ys);
    if (ymin === ymax) { ymin -= 1; ymax += 1; }
    const pad = (ymax-ymin) * .08; ymin -= pad; ymax += pad;
    const x = i => P.l + (i / Math.max(1, clean.length-1)) * (W-P.l-P.r);
    const y = v => P.t + (1-(v-ymin)/(ymax-ymin))*(H-P.t-P.b);
    const path = clean.map((d,i) => `${i?'L':'M'}${x(i).toFixed(1)},${y(Number(d.y)).toFixed(1)}`).join(' ');
    const area = `${path} L${x(clean.length-1)},${H-P.b} L${x(0)},${H-P.b} Z`;
    const ticks = 5;
    let grid = '';
    for (let i=0;i<ticks;i++) {
      const v = ymax-(ymax-ymin)*i/(ticks-1), yy=y(v);
      grid += `<line class="chart-grid" x1="${P.l}" y1="${yy}" x2="${W-P.r}" y2="${yy}"/><text class="chart-axis" x="${P.l-9}" y="${yy+3}" text-anchor="end">${esc(opts.yFormatter ? opts.yFormatter(v) : fmt(v,1))}</text>`;
    }
    let ref = '';
    if (Number.isFinite(opts.reference)) {
      const yy=y(opts.reference); ref=`<line class="chart-ref" x1="${P.l}" y1="${yy}" x2="${W-P.r}" y2="${yy}"/><text class="chart-axis" x="${W-P.r}" y="${yy-5}" text-anchor="end">目标 ${esc(opts.yFormatter?opts.yFormatter(opts.reference):fmt(opts.reference,1))}</text>`;
    }
    const pointEvery = clean.length > 80 ? Math.ceil(clean.length/80) : 1;
    const dots = clean.map((d,i) => i%pointEvery===0 || i===clean.length-1 ? `<circle class="chart-dot" cx="${x(i)}" cy="${y(Number(d.y))}" r="3.1" data-i="${i}"/>` : '').join('');
    const xLabels = [0,Math.floor((clean.length-1)/2),clean.length-1].filter((v,i,a)=>a.indexOf(v)===i).map(i=>`<text class="chart-axis" x="${x(i)}" y="${H-8}" text-anchor="${i===0?'start':i===clean.length-1?'end':'middle'}">${esc(opts.xFormatter?opts.xFormatter(clean[i].x,clean[i],i):String(clean[i].x ?? i+1).slice(0,10))}</text>`).join('');
    el.innerHTML = `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(opts.label||'line chart')}">${grid}${ref}<path class="chart-area" d="${area}" opacity=".28"/><path class="chart-line ${opts.accent?'chart-line-accent':''}" d="${path}"/>${dots}${xLabels}</svg><div class="chart-tooltip" hidden></div>`;
    const tooltip=el.querySelector('.chart-tooltip'), svg=el.querySelector('svg');
    el.querySelectorAll('.chart-dot').forEach(dot=>{
      dot.addEventListener('mouseenter', e=>{
        const i=Number(dot.dataset.i), d=clean[i];
        tooltip.hidden=false;
        tooltip.innerHTML = opts.tooltip ? opts.tooltip(d,i) : `${esc(d.x)} · ${esc(opts.yFormatter?opts.yFormatter(d.y):fmt(d.y,2))}`;
        const er=el.getBoundingClientRect(), sr=svg.getBoundingClientRect();
        tooltip.style.left=`${(Number(dot.getAttribute('cx'))/W)*sr.width + sr.left-er.left}px`;
        tooltip.style.top=`${(Number(dot.getAttribute('cy'))/H)*sr.height + sr.top-er.top}px`;
      });
      dot.addEventListener('mouseleave',()=>tooltip.hidden=true);
      if (opts.onPointClick) dot.addEventListener('click',()=>opts.onPointClick(clean[Number(dot.dataset.i)]));
    });
  }

  function tpsChart(el, buckets, opts={}) {
    if (!el) return;
    const clean=(buckets||[]).filter(d=>Number.isFinite(d.tps));
    if (!clean.length) return empty(el,'缺少动作时间戳','需要智能魔方原始 move timestamps 才能重建 TPS 曲线。');
    const W=900,H=320,P={l:48,r:18,t:20,b:34};
    const ymax=Math.max(12,Math.ceil(Math.max(...clean.map(d=>d.tps))+1));
    const x=v=>P.l+v*(W-P.l-P.r), y=v=>P.t+(1-v/ymax)*(H-P.t-P.b);
    let grid=''; for(let v=0;v<=ymax;v+=Math.max(2,Math.ceil(ymax/6))){const yy=y(v);grid+=`<line class="chart-grid" x1="${P.l}" y1="${yy}" x2="${W-P.r}" y2="${yy}"/><text class="chart-axis" x="${P.l-8}" y="${yy+3}" text-anchor="end">${v}</text>`}
    const path=clean.map((d,i)=>`${i?'L':'M'}${x(d.x).toFixed(1)},${y(d.tps).toFixed(1)}`).join(' ');
    const boundaries=(opts.boundaries||[]).map(b=>{const p=typeof b==='number'?b:b.end; if(!(p>0&&p<1))return '';return `<line class="chart-ref" x1="${x(p)}" y1="${P.t}" x2="${x(p)}" y2="${H-P.b}"/><text class="chart-axis" x="${x(p)+4}" y="${P.t+10}">${esc(b.label||'')}</text>`}).join('');
    const labels=[0,.25,.5,.75,1].map(p=>`<text class="chart-axis" x="${x(p)}" y="${H-8}" text-anchor="middle">${Math.round(p*100)}%</text>`).join('');
    el.innerHTML=`<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${boundaries}<path class="chart-line chart-line-accent" d="${path}"/>${labels}</svg>`;
  }

  function barChart(el, rows, opts={}) {
    if (!el) return;
    const clean=(rows||[]).filter(r=>Number.isFinite(Number(r.value)));
    if(!clean.length)return empty(el);
    const max=Math.max(...clean.map(r=>Number(r.value)),1);
    el.innerHTML=`<div class="bar-list">${clean.map(r=>{
      const pct=Math.max(1,Number(r.value)/max*100);
      return `<div class="insight-row"><strong>${esc(r.label)}</strong><div class="progress ${r.accent?'accent':''}"><i style="width:${pct}%"></i></div><span class="mono">${esc(opts.formatter?opts.formatter(r.value):fmt(r.value,2))}</span><span class="${r.deltaClass||'muted'}">${esc(r.delta||'')}</span></div>`;
    }).join('')}</div>`;
  }

  window.CubeAnalyzerCharts={lineChart,tpsChart,barChart,empty,esc,fmt};
})();

(() => {
  'use strict';

  const A = {};
  const MAX_REALISTIC_TPS = 20;
  const METHOD_STEPS = {
    CFOP: [
      { key: 'Cross', label: 'Cross' },
      { key: 'F2L', label: 'F2L' },
      { key: 'OLL', label: 'OLL' },
      { key: 'PLL', label: 'PLL' },
    ],
    Roux: [
      { key: 'FB', label: 'First Block' },
      { key: 'SB', label: 'Second Block' },
      { key: 'CMLL', label: 'CMLL' },
      { key: 'LSE', label: 'LSE' },
    ],
    ZZ: [
      { key: 'EOCross', label: 'EO Cross' },
      { key: 'F2L', label: 'F2L' },
      { key: 'ZBLL', label: 'ZBLL' },
    ],
  };

  const CFOP_REFERENCE = [
    { total: 60, Cross: 7, OLL: 8, PLL: 10, F2L: 35 },
    { total: 50, Cross: 6, OLL: 7, PLL: 9, F2L: 28 },
    { total: 40, Cross: 5, OLL: 6, PLL: 8, F2L: 21 },
    { total: 30, Cross: 4, OLL: 4.5, PLL: 6, F2L: 15.5 },
    { total: 25, Cross: 3.5, OLL: 3.8, PLL: 5, F2L: 12.7 },
    { total: 20, Cross: 2.8, OLL: 3, PLL: 4, F2L: 10.2 },
    { total: 15, Cross: 2, OLL: 2.3, PLL: 3.2, F2L: 7.5 },
    { total: 12, Cross: 1.5, OLL: 1.9, PLL: 2.6, F2L: 6 },
    { total: 10, Cross: 1.2, OLL: 1.65, PLL: 2.15, F2L: 5 },
    { total: 8, Cross: 0.95, OLL: 1.3, PLL: 1.7, F2L: 4.05 },
  ];

  const ROUX_PERCENT = { FB: 0.22, SB: 0.28, CMLL: 0.15, LSE: 0.35 };
  const ZZ_PERCENT = { EOCross: 0.33, F2L: 0.34, ZBLL: 0.33 };

  function finite(v) { return Number.isFinite(Number(v)); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
  function mean(xs) { return xs.length ? sum(xs) / xs.length : null; }
  function median(xs) {
    if (!xs.length) return null;
    const a = xs.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function percentile(xs, p) {
    const a = xs.filter(Number.isFinite).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const idx = (a.length - 1) * clamp(p, 0, 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    if (lo === hi) return a[lo];
    const t = idx - lo;
    return a[lo] * (1 - t) + a[hi] * t;
  }
  function stddev(xs) {
    const a = xs.filter(Number.isFinite);
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(mean(a.map(x => (x - m) ** 2)));
  }

  function normalizeFlag(flag) {
    const f = String(flag ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
    if (f === 'dnf') return 'dnf';
    if (['+2', 'plus2', 'plustwo', '2'].includes(f)) return 'plus_two';
    return 'ok';
  }
  function displayTimeMs(solve) {
    if (!solve) return null;
    const t = Number(solve.totalTime);
    if (!Number.isFinite(t)) return null;
    return normalizeFlag(solve.flag) === 'plus_two' ? t + 2000 : t;
  }
  function effectiveTimeMs(solve) {
    if (normalizeFlag(solve?.flag) === 'dnf') return Infinity;
    return displayTimeMs(solve);
  }
  function getSolvesToDrop(n) { return Math.ceil(0.05 * n); }

  function averageWithFlags(solves) {
    // DNF 不参与平均：先把 DNF（以及没有有效用时的）成绩当作不存在剔除，
    // 剩余成绩再按原有去头去尾规则计算，避免一个 DNF 把整个 AO 报废或算成 0。
    if (!Array.isArray(solves) || !solves.length) return { time: null, isDNF: false, droppedIds: [] };
    const valid = solves.filter(s => normalizeFlag(s.flag) !== 'dnf' && finite(displayTimeMs(s)));
    const n = valid.length;
    const drop = getSolvesToDrop(n);
    if (n <= drop * 2) return { time: null, isDNF: false, droppedIds: [] };
    const sorted = valid.map((s, i) => ({ s, i, e: displayTimeMs(s) }))
      .sort((a, b) => a.e - b.e || a.i - b.i);
    const dropped = [...sorted.slice(0, drop), ...sorted.slice(n - drop)].map(x => x.s.id);
    const kept = sorted.slice(drop, n - drop);
    return { time: mean(kept.map(x => displayTimeMs(x.s))), isDNF: false, droppedIds: dropped };
  }

  function averageOf(n, solves) {
    if (!Array.isArray(solves) || solves.length < n) return { time: null, isDNF: false, droppedIds: [] };
    return averageWithFlags(solves.slice(-n));
  }

  function bestAverage(n, solves) {
    if (!Array.isArray(solves) || solves.length < n) return null;
    let best = null;
    for (let i = 0; i <= solves.length - n; i++) {
      const r = averageWithFlags(solves.slice(i, i + n));
      if (!r.isDNF && finite(r.time) && (best === null || r.time < best.time)) best = { ...r, start: i, end: i + n - 1 };
    }
    return best;
  }

  function runningAverage(n, solves) {
    return solves.map((s, i) => {
      if (i + 1 < n) return null;
      const r = averageWithFlags(solves.slice(i + 1 - n, i + 1));
      return r.isDNF ? null : r.time;
    });
  }

  function placementOfCurrentTime(solves) {
    if (!solves?.length) return null;
    const current = effectiveTimeMs(solves[solves.length - 1]);
    return 1 + solves.slice(0, -1).filter(s => effectiveTimeMs(s) <= current).length;
  }

  function extractTurnCount(sequence) {
    if (!Array.isArray(sequence)) return null;
    return sequence.filter(m => {
      const move = typeof m === 'string' ? m : (m.move || m.notation || '');
      return move && !/^[xyz](2|'|)?$/i.test(move);
    }).length;
  }
  function extractTPS(turns, timeMs) {
    turns = Number(turns); timeMs = Number(timeMs);
    return turns >= 0 && timeMs > 0 ? (1000 * turns) / timeMs : null;
  }

  function isRotationMove(move) {
    const m = typeof move === 'string' ? move : (move?.logicalMove || move?.move || move?.notation || '');
    return /^[xyz](2|'|)?$/i.test(String(m).trim());
  }

  // Return timestamps aligned to logical turns. Whole-cube x/y/z rotations are preserved in replay data
  // but excluded from TPS/fluency statistics so orientation changes do not look like extra turns.
  function turnTimestamps(solveOrMoves, timestamps) {
    const solve = Array.isArray(solveOrMoves) ? null : solveOrMoves;
    const moves = Array.isArray(solveOrMoves) ? solveOrMoves : (solve?.moves || []);
    const ts = Array.isArray(timestamps) ? timestamps : (solve?.timestamps || []);
    if (!moves.length || moves.length !== ts.length) return (ts || []).map(Number).filter(Number.isFinite);
    const out = [];
    for (let i = 0; i < moves.length; i++) {
      const t = Number(ts[i]);
      if (Number.isFinite(t) && !isRotationMove(moves[i])) out.push(t);
    }
    return out;
  }

  function fluencyFromTimestamps(timestamps, totalTime, gapThresholdMs = 400) {
    const ts = (timestamps || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (ts.length < 2 || totalTime <= 0) return null;
    const start = ts[0];
    const activeDuration = ts[ts.length - 1] - start;
    if (activeDuration <= 0) return 100;
    let gap = 0;
    for (let i = 1; i < ts.length; i++) {
      const d = ts[i] - ts[i - 1];
      if (d > gapThresholdMs) gap += d;
    }
    return clamp(100 - Math.round((gap / activeDuration) * 100), 0, 100);
  }

  function interpolateCFOP(totalSec) {
    const t = Number(totalSec);
    if (!(t > 0)) return null;
    const desc = CFOP_REFERENCE;
    if (t >= desc[0].total) {
      const r = t / desc[0].total;
      return Object.fromEntries(Object.entries(desc[0]).map(([k, v]) => [k, k === 'total' ? t : v * r]));
    }
    const last = desc[desc.length - 1];
    if (t <= last.total) {
      const r = t / last.total;
      return Object.fromEntries(Object.entries(last).map(([k, v]) => [k, k === 'total' ? t : v * r]));
    }
    for (let i = 0; i < desc.length - 1; i++) {
      const hi = desc[i], lo = desc[i + 1];
      if (t <= hi.total && t >= lo.total) {
        const p = (t - lo.total) / (hi.total - lo.total);
        const out = { total: t };
        for (const k of ['Cross', 'F2L', 'OLL', 'PLL']) out[k] = lo[k] + (hi[k] - lo[k]) * p;
        return out;
      }
    }
    return null;
  }

  function referenceSplits(method, totalSec) {
    method = String(method || 'CFOP');
    if (method === 'CFOP') return interpolateCFOP(totalSec);
    const pct = method === 'Roux' ? ROUX_PERCENT : ZZ_PERCENT;
    const out = { total: totalSec };
    Object.entries(pct).forEach(([k, v]) => out[k] = totalSec * v);
    return out;
  }

  function analyzeSplits(method, actualMap, referenceMap) {
    const steps = METHOD_STEPS[method] || METHOD_STEPS.CFOP;
    const rows = steps.map(({ key, label }) => {
      const actual = Number(actualMap?.[key]);
      const reference = Number(referenceMap?.[key]);
      const variation = actual > 0 && reference > 0 ? (actual - reference) / reference : null;
      return { key, label, actual, reference, variation };
    });
    const candidates = rows.filter(r => finite(r.variation)).sort((a, b) => b.variation - a.variation);
    const weakest = candidates[0] && candidates[0].variation > 0.20 ? candidates[0] : null;
    return { rows, weakest };
  }

  function methodSteps(method) { return METHOD_STEPS[method] || METHOD_STEPS.CFOP; }

  function normalizeStepName(name, method) {
    const raw = String(name || '').replace(/[\s_-]+/g, '').toLowerCase();
    const maps = {
      CFOP: { cross:'Cross', f2l:'F2L', oll:'OLL', pll:'PLL' },
      Roux: { fb:'FB', firstblock:'FB', sb:'SB', secondblock:'SB', cmll:'CMLL', lse:'LSE' },
      ZZ: { eocross:'EOCross', eo:'EOCross', f2l:'F2L', zbll:'ZBLL' },
    };
    return maps[method]?.[raw] || name;
  }

  function getStepMap(solve) {
    const method = solve.analysisType || 'CFOP';
    const groups = {};
    (solve.steps || []).forEach(step => {
      const key = normalizeStepName(step.name || step.key || step.label, method);
      if (!key) return;
      if (!groups[key]) groups[key] = { aggregate: [], sub: [] };
      (step.slotIndex ? groups[key].sub : groups[key].aggregate).push(step);
    });
    const map = {};
    Object.entries(groups).forEach(([key, group]) => {
      const src = group.aggregate.length ? group.aggregate : group.sub;
      const m = { time: 0, turns: 0, recognition: 0, execution: 0, count: 0 };
      src.forEach(step => {
        const time = Number(step.time ?? step.duration ?? 0);
        const rec = Number(step.recognition ?? step.recognitionTime ?? 0);
        const exec = Number(step.execution ?? step.executionTime ?? Math.max(0, time - rec));
        m.time += finite(time) ? time : 0;
        m.turns += finite(step.turns) ? Number(step.turns) : 0;
        m.recognition += finite(rec) ? rec : 0;
        m.execution += finite(exec) ? exec : 0;
        m.count++;
      });
      map[key] = m;
    });
    return map;
  }

  function averageSplits(solves, method) {
    const steps = methodSteps(method);
    return steps.map(meta => {
      const vals = [];
      for (const solve of solves) {
        const s = getStepMap(solve)[meta.key];
        if (s && s.time > 0) vals.push(s);
      }
      if (!vals.length) return { ...meta, time: null, turns: null, recognition: null, execution: null, tps: null, percentage: null, count: 0 };
      const time = mean(vals.map(x => x.time));
      const turns = mean(vals.map(x => x.turns).filter(x => x > 0));
      const recognition = mean(vals.map(x => x.recognition).filter(x => x >= 0));
      const execution = mean(vals.map(x => x.execution).filter(x => x >= 0));
      return { ...meta, time, turns, recognition, execution, tps: turns && execution > 0 ? turns * 1000 / execution : null, count: vals.length };
    });
  }

  function linearTPSIntervals(timestamps, totalTime) {
    const ts = (timestamps || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (ts.length < 2 || !(totalTime > 0)) return [];
    const out = [];
    for (let i = 1; i < ts.length; i++) {
      const startMs = ts[i - 1], endMs = ts[i], delta = endMs - startMs;
      if (delta <= 0) continue;
      out.push({
        start: startMs / totalTime,
        end: endMs / totalTime,
        tps: Math.min(1000 / delta, MAX_REALISTIC_TPS),
      });
    }
    return out;
  }

  function segregatedTPSIntervals(solve, stageBoundaries) {
    const ts = (solve.timestamps || []).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    if (ts.length < 2) return [];
    const metas = methodSteps(solve.analysisType);
    const stepMap = getStepMap(solve);
    const stepTimes = metas.map(m => Number(stepMap[m.key]?.time) || 0);
    const total = sum(stepTimes);
    if (!(total > 0)) return linearTPSIntervals(ts, solve.totalTime);
    let bounds = (stageBoundaries || []).map(b => typeof b === 'number' ? b : Number(b.end)).filter(Number.isFinite);
    if (bounds.length === metas.length) bounds = bounds.slice(0, -1);
    if (bounds.length !== Math.max(0, metas.length - 1)) {
      let acc=0; bounds=[];
      for (let i=0;i<stepTimes.length-1;i++){ acc+=stepTimes[i]; bounds.push(acc/total); }
    }
    const timeBounds=[]; let acc=0;
    for(let i=0;i<stepTimes.length-1;i++){acc+=stepTimes[i];timeBounds.push(acc)}
    const percentBounds=[0,...bounds,1];
    function warp(timestamp){
      const t=clamp(timestamp,0,total);
      let idx=0;
      for(let i=0;i<timeBounds.length;i++) if(t>timeBounds[i]) idx=i+1;
      const stageStart=idx===0?0:timeBounds[idx-1];
      const duration=stepTimes[idx]||0;
      const progress=duration>0?clamp((t-stageStart)/duration,0,1):1;
      return percentBounds[idx] + progress*(percentBounds[idx+1]-percentBounds[idx]);
    }
    const out=[];
    for(let i=1;i<ts.length;i++){
      const delta=ts[i]-ts[i-1]; if(delta<=0) continue;
      const a=warp(ts[i-1]), b=warp(ts[i]);
      if(a<b) out.push({start:a,end:b,tps:Math.min(1000/delta,MAX_REALISTIC_TPS)});
    }
    return out;
  }

  function aggregateTPS(intervalSets, bucketCount = 500) {
    const buckets = Array.from({ length: bucketCount }, () => []);
    for (const intervals of intervalSets) {
      for (const it of intervals) {
        const a = clamp(Math.floor(it.start * bucketCount), 0, bucketCount - 1);
        const b = clamp(Math.floor(it.end * bucketCount), 0, bucketCount - 1);
        for (let i = a; i <= b; i++) buckets[i].push(it.tps);
      }
    }
    return buckets.map((xs, i) => ({ x: (i + 0.5) / bucketCount, tps: xs.length ? median(xs) : null, samples: xs.length }));
  }

  function deriveStageBoundaries(solves, method) {
    const avg = averageSplits(solves, method);
    const total = sum(avg.map(x => Number(x.time) || 0));
    let acc = 0;
    return avg.map(x => {
      const start = total ? acc / total : 0;
      acc += Number(x.time) || 0;
      return { key: x.key, label: x.label, start, end: total ? acc / total : 1, percentage: total ? (Number(x.time) || 0) / total : 0 };
    });
  }

  // Personal case-performance interpolation anchors.
  function estimateCaseBetterThan(timeMs, stats) {
    const t = Number(timeMs);
    const med = Number(stats?.medianMs), p20 = Number(stats?.p20Ms), p80 = Number(stats?.p80Ms);
    if (!Number.isFinite(t) || ![med, p20, p80].every(v => Number.isFinite(v) && v > 0)) return null;
    const fast = Math.max(1, Math.min(p20, med) * 0.6);
    const slow = p80 + Math.max(p80 - med, med - p20, 100) * 1.4;
    const points = [[0,99],[fast,90],[p20,80],[med,50],[p80,20],[slow,5]];
    if (t <= points[0][0]) return 99;
    for (let i = 1; i < points.length; i++) {
      const [x1,y1] = points[i-1], [x2,y2] = points[i];
      if (t <= x2) return Math.round(clamp(y1 + (y2-y1) * ((t-x1)/(x2-x1 || 1)), 0, 99));
    }
    const tailEnd = slow + Math.max(slow - p80, 250);
    const tail = 5 + (1 - 5) * ((t - slow) / (tailEnd - slow || 1));
    return Math.round(clamp(tail, 0, 99));
  }

  function caseStatistics(solves) {
    const groups = new Map();
    for (const solve of solves) {
      for (const st of solve.steps || []) {
        const type = String(st.caseType || '').toUpperCase();
        const idx = st.caseIndex ?? st.caseId;
        if (!type || idx === undefined || idx === null) continue;
        const key = `${type}:${idx}`;
        if (!groups.has(key)) groups.set(key, { key, caseType: type, caseIndex: idx, caseName: st.caseName || `${type} ${idx}`, values: [] });
        const time = Number(st.time ?? 0), rec = Number(st.recognition ?? 0), exec = Number(st.execution ?? Math.max(0, time - rec));
        groups.get(key).values.push({ total: time || rec + exec, recognition: rec, execution: exec });
      }
    }
    return [...groups.values()].map(g => {
      const totals = g.values.map(x => x.total).filter(x => x > 0);
      const rec = g.values.map(x => x.recognition).filter(x => x >= 0);
      const exec = g.values.map(x => x.execution).filter(x => x >= 0);
      return {
        ...g,
        count: g.values.length,
        fastest: totals.length ? Math.min(...totals) : null,
        median: median(totals),
        medianRecognition: median(rec),
        medianExecution: median(exec),
        p20: percentile(totals, .2),
        p80: percentile(totals, .8),
      };
    }).sort((a,b) => a.caseType.localeCompare(b.caseType) || Number(a.caseIndex) - Number(b.caseIndex));
  }

  function solveSummary(solves) {
    const valid = solves.filter(s => normalizeFlag(s.flag) !== 'dnf' && finite(displayTimeMs(s)));
    const times = valid.map(displayTimeMs);
    const tps = valid.map(s => Number(s.tps)).filter(Number.isFinite);
    const turns = valid.map(s => Number(s.turnCount)).filter(Number.isFinite);
    const fluency = valid.map(s => Number(s.fluencyPercent)).filter(Number.isFinite);
    const m = mean(times);
    const sd = stddev(times);
    return {
      count: solves.length,
      validCount: valid.length,
      dnfCount: solves.length - valid.length,
      best: times.length ? Math.min(...times) : null,
      mean: m,
      median: median(times),
      stddev: sd,
      cv: m ? sd / m : null,
      consistency: m ? clamp(100 - (sd / m) * 180, 0, 100) : null,
      avgTps: mean(tps),
      medianTps: median(tps),
      avgTurns: mean(turns),
      avgFluency: mean(fluency),
      ao5: averageOf(5, solves),
      ao12: averageOf(12, solves),
      ao100: averageOf(100, solves),
      bestAo5: bestAverage(5, solves),
      bestAo12: bestAverage(12, solves),
      bestAo100: bestAverage(100, solves),
      placement: placementOfCurrentTime(solves),
    };
  }

  function groupSeries(solves, metric, resolution = 'all') {
    // 注意 finite(null)===true（Number(null)===0），必须先排除 null，否则 DNF/无效窗口会被当成 0 画进图里。
    const rows = solves.map((s, i) => ({ solve: s, i, value: metric(s, i) })).filter(x => x.value != null && finite(x.value));
    if (resolution === 'all') return rows.map(x => ({ x: x.solve.date, y: x.value, solve: x.solve }));
    if (resolution === 'daily') {
      const map = new Map();
      rows.forEach(x => {
        const d = new Date(x.solve.date);
        const k = Number.isNaN(d.getTime()) ? 'Unknown' : d.toISOString().slice(0,10);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(x.value);
      });
      return [...map].map(([k, vals]) => ({ x:k, y:mean(vals), count:vals.length }));
    }
    // Adaptive grouped resolution, capped around 60 points.
    const size = Math.max(2, Math.ceil(rows.length / 60));
    const out = [];
    for (let i = 0; i < rows.length; i += size) {
      const c = rows.slice(i, i + size);
      out.push({ x: c[c.length - 1].solve.date, y: mean(c.map(v => v.value)), count:c.length });
    }
    return out;
  }

  function stepPerformance(step) {
    const time = Number(step.time) || 0;
    const recognition = Number(step.recognition) || 0;
    const execution = Number(step.execution ?? Math.max(0, time - recognition)) || 0;
    const turns = Number(step.turns) || 0;
    return { time, recognition, execution, turns, tps: execution > 0 && turns > 0 ? turns * 1000 / execution : null };
  }

  Object.assign(A, {
    MAX_REALISTIC_TPS, METHOD_STEPS, CFOP_REFERENCE, ROUX_PERCENT, ZZ_PERCENT,
    clamp, sum, mean, median, percentile, stddev, normalizeFlag, displayTimeMs, effectiveTimeMs,
    getSolvesToDrop, averageWithFlags, averageOf, bestAverage, runningAverage, placementOfCurrentTime,
    extractTurnCount, extractTPS, isRotationMove, turnTimestamps, fluencyFromTimestamps, referenceSplits, analyzeSplits, methodSteps,
    normalizeStepName, getStepMap, averageSplits, linearTPSIntervals, segregatedTPSIntervals,
    aggregateTPS, deriveStageBoundaries, estimateCaseBetterThan, caseStatistics, solveSummary,
    groupSeries, stepPerformance,
  });

  window.CubeAnalyzerCore = A;
})();

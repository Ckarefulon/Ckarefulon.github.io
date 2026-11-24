(() => {
  'use strict';
  const C = window.CubeAnalyzerCore;

  const first = (...xs) => xs.find(v => v !== undefined && v !== null && v !== '');
  const num = (...xs) => {
    const v = first(...xs);
    if (v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? n : null;
  };

  function timeToMs(v, hint = '') {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      if (/sec|second|_s$/i.test(hint)) return v * 1000;
      return v < 120 && !/ms/i.test(hint) ? v * 1000 : v;
    }
    let s = String(v).trim();
    if (!s) return null;
    if (/dnf/i.test(s)) return null;
    s = s.replace(/^\+/, '').replace(/\+2$/i, '').trim();
    if (/^\d{1,2}:\d{1,2}(\.\d+)?$/.test(s)) {
      const [m, rest] = s.split(':');
      return (Number(m) * 60 + Number(rest)) * 1000;
    }
    const n = Number(s.replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n)) return null;
    if (/ms/i.test(String(v)) || /ms/i.test(hint)) return n;
    return n < 120 ? n * 1000 : n;
  }

  function normalizeMethod(v) {
    const s = String(v || 'CFOP').trim().toLowerCase();
    if (s === 'roux') return 'Roux';
    if (s === 'zz') return 'ZZ';
    return 'CFOP';
  }

  function normalizeDate(v, fallbackIndex = 0) {
    if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
    if (typeof v === 'number') {
      const d = new Date(v < 1e12 ? v * 1000 : v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    if (v) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return new Date(Date.now() - fallbackIndex * 60000).toISOString();
  }

  function extractTimestamp(move) {
    if (typeof move === 'number') return move;
    if (!move || typeof move !== 'object') return null;
    return num(move.timestamp, move.time, move.timeMs, move.offset, move.elapsed, move.ms, move.t);
  }

  function extractTimestamps(raw) {
    const direct = first(raw.timestamps, raw.moveTimestamps, raw.rawTimestamps);
    if (Array.isArray(direct)) return direct.map(extractTimestamp).filter(Number.isFinite);
    const replay = raw.replay || raw.solveReplay || {};
    const seq = first(replay.rawSolutionSequence, replay.solutionSequence, raw.rawSolutionSequence, raw.solutionSequence, raw.moves);
    if (Array.isArray(seq)) return seq.map(extractTimestamp).filter(Number.isFinite);
    return [];
  }


  function extractMoves(raw) {
    const replay = raw.replay || raw.solveReplay || {};
    const seq = first(raw.moves, replay.rawSolutionSequence, replay.solutionSequence, raw.rawSolutionSequence, raw.solutionSequence);
    if (!Array.isArray(seq)) return [];
    return seq.map(m => {
      if (typeof m === 'string') return m.trim();
      if (!m || typeof m !== 'object') return '';
      return String(first(m.move, m.text, m.notation, m.name, '')).trim();
    }).filter(Boolean);
  }

  function extractRawSolutionSequence(raw) {
    const replay = raw.replay || raw.solveReplay || {};
    const seq = first(raw.rawSolutionSequence, replay.rawSolutionSequence, replay.solutionSequence, raw.solutionSequence);
    if (!Array.isArray(seq)) return [];
    return seq.map((m, i) => {
      if (typeof m === 'string') return { move:m.trim(), timestamp:null };
      if (!m || typeof m !== 'object') return null;
      const move = String(first(m.move, m.text, m.notation, m.name, '')).trim();
      if (!move) return null;
      return {
        move,
        logicalMove: String(first(m.logicalMove, move, '')).trim() || move,
        rawMoves: Array.isArray(m.rawMoves) ? m.rawMoves.map(r => typeof r === 'string' ? r : (r && typeof r === 'object' ? {...r} : String(r))) : [],
        timestamp: extractTimestamp(m),
        startTimestamp: num(m.startTimestamp),
        absoluteTimestamp: num(m.absoluteTimestamp),
        hardwareTimestamp: num(m.hardwareTimestamp),
        localTimestamp: num(m.localTimestamp),
        facelet: first(m.facelet, m.state, null),
        isSlice: Boolean(m.isSlice),
        isRotation: Boolean(m.isRotation)
      };
    }).filter(Boolean);
  }

  function extractSnapshots(raw) {
    const replay = raw.replay || raw.solveReplay || {};
    const seq = first(raw.snapshots, replay.snapshots, raw.facelets);
    if (!Array.isArray(seq)) return [];
    return seq.map(x => {
      if (typeof x === 'string') return { facelet:x };
      if (!x || typeof x !== 'object') return null;
      const facelet = first(x.facelet, x.state, x.facelets);
      if (!facelet) return null;
      return { facelet:String(facelet), timestamp:num(x.timestamp, x.time, x.timeMs, x.elapsed) };
    }).filter(Boolean);
  }

  function moveCount(raw) {
    const replay = raw.replay || {};
    const seq = first(replay.solutionSequence, replay.rawSolutionSequence, raw.solutionSequence, raw.rawSolutionSequence, raw.moves);
    if (!Array.isArray(seq)) return null;
    return C.extractTurnCount(seq);
  }

  function step(name, label, obj, opts = {}) {
    if (!obj) return null;
    const time = timeToMs(first(obj.time, obj.totalTime, obj.duration, obj.timeMs), 'ms');
    if (!(time >= 0)) return null;
    let recognition = timeToMs(first(obj.recognition, obj.recognitionTime, obj.recognitionMs), 'ms');
    let execution = timeToMs(first(obj.execution, obj.executionTime, obj.executionMs), 'ms');
    if (recognition == null) recognition = 0;
    if (execution == null) execution = Math.max(0, time - recognition);
    const turns = num(obj.turns, obj.turnCount) ?? moveCount(obj);
    return {
      name, label,
      time,
      turns: turns ?? 0,
      recognition,
      execution,
      caseType: opts.caseType || obj.caseType || null,
      caseIndex: first(opts.caseIndex, obj.caseIndex, obj.caseId, obj.case),
      caseName: first(opts.caseName, obj.caseName, obj.algorithmName),
      slotIndex: first(opts.slotIndex, obj.slotIndex),
      physicalSlot: first(opts.physicalSlot, obj.physicalSlot),
      caseGroup: first(opts.caseGroup, obj.caseGroup, null),
      caseRank: first(opts.caseRank, obj.caseRank, null),
      startIndex: num(obj.startIndex, obj.moveStart),
      endIndex: num(obj.endIndex, obj.moveEnd),
      moves: Array.isArray(obj.moves) ? obj.moves.slice() : [],
      skipped: Boolean(obj.skipped),
    };
  }

  // Best-effort adapter for common smart-cube analysis structures.
  function stepsFromAnalysis(analysis, method) {
    if (!analysis || typeof analysis !== 'object') return [];
    const out = [];
    if (method === 'CFOP' && analysis.cross) {
      const cross = step('Cross', 'Cross', analysis.cross); if (cross) out.push(cross);
      const slots = analysis.f2l?.slots || [];
      if (analysis.f2l) {
        const f2l = step('F2L', 'F2L', { ...analysis.f2l, time: analysis.f2l.totalTime });
        if (f2l) out.push(f2l);
        slots.forEach((s, i) => {
          const ss = step('F2L', `F2L ${i + 1}`, s, { caseType:'F2L', caseIndex:first(s.case, s.caseIndex, i), slotIndex:i + 1 });
          if (ss) out.push(ss);
        });
      }
      const oll = step('OLL', 'OLL', analysis.oll, { caseType:'OLL', caseIndex:analysis.oll?.case }); if (oll) out.push(oll);
      const pll = step('PLL', 'PLL', analysis.pll, { caseType:'PLL', caseIndex:analysis.pll?.case }); if (pll) out.push(pll);
      return out;
    }
    if (method === 'Roux') {
      const pairs = [['FB','First Block','fb'],['SB','Second Block','sb'],['CMLL','CMLL','cmll'],['LSE','LSE','lse']];
      for (const [name,label,key] of pairs) {
        const s = step(name,label,analysis[key] || analysis[name], name === 'CMLL' ? {caseType:'CMLL',caseIndex:first(analysis[key]?.case, analysis[name]?.case)} : {});
        if (s) out.push(s);
      }
      return out;
    }
    if (method === 'ZZ') {
      const pairs = [['EOCross','EO Cross','eoCross'],['F2L','F2L','f2l'],['ZBLL','ZBLL','zbll']];
      for (const [name,label,key] of pairs) { const s = step(name,label,analysis[key] || analysis[name]); if (s) out.push(s); }
      return out;
    }
    return [];
  }

  function stepsFromFlat(raw, method) {
    if (Array.isArray(raw.steps)) {
      return raw.steps.map((s, i) => {
        const name = C.normalizeStepName(first(s.name, s.key, s.label, `Step${i+1}`), method);
        return step(name, first(s.label, name), s, {caseType:s.caseType,caseIndex:first(s.caseIndex,s.caseId),slotIndex:s.slotIndex,physicalSlot:s.physicalSlot});
      }).filter(Boolean);
    }
    const keys = C.methodSteps(method);
    const out = [];
    for (const meta of keys) {
      const lower = meta.key.toLowerCase();
      const t = first(raw[`split_${lower}`], raw[`${lower}Time`], raw[`${meta.key}Time`], raw[lower]);
      if (t === undefined) continue;
      const time = timeToMs(t, String(Object.keys(raw).find(k => raw[k] === t) || ''));
      if (!(time >= 0)) continue;
      out.push({
        name:meta.key,label:meta.label,time,
        turns:num(raw[`turns_${lower}`], raw[`${lower}Turns`]) ?? 0,
        recognition:timeToMs(first(raw[`recognition_${lower}`], raw[`${lower}Recognition`]),'ms') ?? 0,
        execution:timeToMs(first(raw[`execution_${lower}`], raw[`${lower}Execution`]),'ms') ?? 0,
      });
    }
    return out;
  }

  function normalizeSolve(raw, index = 0) {
    raw = raw || {};
    const method = normalizeMethod(first(raw.analysisType, raw.method, raw.solveMethod, raw.analysis?.type));
    // Records produced by this trainer always store totalTime in milliseconds,
    // including short test/aborted solves under 120 ms. Imported numeric seconds
    // without trainer metadata retain the documented auto-inference path.
    const ownMs = typeof raw.totalTime === 'number' && (
      /^solve-/.test(String(raw.id||'')) || ['smartcube','manual'].includes(raw.captureType)
    );
    let totalTime = ownMs ? raw.totalTime : timeToMs(first(raw.totalTime, raw.timeMs, raw.time, raw.solveTime, raw.duration), 'totalTime');
    let flag = C.normalizeFlag(first(raw.flag, raw.penalty, raw.status, /dnf/i.test(String(raw.time)) ? 'dnf' : /\+2/.test(String(raw.time)) ? '+2' : 'ok'));
    const timestamps = extractTimestamps(raw);
    const moves = extractMoves(raw);
    const rawSolutionSequence = extractRawSolutionSequence(raw);
    let snapshots = extractSnapshots(raw);
    const stateSequence = Array.isArray(raw.stateSequence) ? raw.stateSequence : snapshots;
    // 落盘去重的还原（见 exportableSolve）：两份数组在保存时已证明完全相同，这里还原成两个独立数组
    if (raw.snapshotsDup === true && !snapshots.length && Array.isArray(stateSequence)) {
      snapshots = stateSequence.map(x => (x && typeof x === 'object') ? { ...x } : x);
    }
    let steps = stepsFromFlat(raw, method);
    if (!steps.length) steps = stepsFromAnalysis(raw.analysis, method);
    if (totalTime == null && steps.length) totalTime = C.sum(steps.filter(s => !s.slotIndex).map(s => s.time));
    const derivedTurnCount = moves.length ? C.extractTurnCount(moves) : null;
    const turnCount = num(raw.turnCount, raw.turns, raw.moveCount) ?? derivedTurnCount ?? moveCount(raw) ?? (timestamps.length ? timestamps.length : null);
    const tps = num(raw.tps, raw.TPS) ?? C.extractTPS(turnCount, totalTime);
    const fluencyTs = moves.length === timestamps.length ? C.turnTimestamps(moves, timestamps) : timestamps;
    const fluency = num(raw.fluencyPercent, raw.fluency) ?? C.fluencyFromTimestamps(fluencyTs, totalTime);
    const session = first(raw.session?.name, typeof raw.session === 'string' && raw.session.trim() ? raw.session.trim() : undefined, raw.sessionName, raw.session?.id, raw.sessionId, '默认训练');
    const device = first(raw.usedDevice?.name, raw.device?.name, raw.deviceName, raw.usedDevice?.id, raw.deviceId, raw.device, '未知设备');
    return {
      id: first(raw.id, raw.solveId, `import-${index+1}`),
      date: normalizeDate(first(raw.date, raw.createdAt, raw.timestamp, raw.solveDate), index),
      totalTime: totalTime ?? 0,
      flag,
      tps: tps ?? null,
      turnCount: turnCount ?? null,
      fluencyPercent: fluency ?? null,
      analysisType: method,
      session: String(session),
      device: String(device),
      scramble: typeof raw.scramble === 'string' ? raw.scramble : first(raw.scramble?.notation, raw.scramble?.algorithm, ''),
      timestamps,
      moves,
      rawSolutionSequence: rawSolutionSequence.length ? rawSolutionSequence : moves.map((move,i)=>({move,timestamp:Number.isFinite(timestamps[i])?timestamps[i]:null})),
      moveTimestamps: timestamps.slice(),
      snapshots,
      stateSequence,
      startFacelet: first(raw.startFacelet, raw.initialFacelet, raw.startState, ''),
      steps,
      timingMode: first(raw.timingMode, raw.timerMode, ''),
      captureType: first(raw.captureType, raw.hasReplay ? 'smartcube' : (moves.length && timestamps.length ? 'smartcube' : 'import')),
      analysisFrame: raw.analysisFrame || raw.frame || null,
      analysisVersion: num(raw.analysisVersion, raw.analysisFrame?.analysisVersion) || 0,
      colorNeutral: raw.colorNeutral !== false,
      gyroSamples: Array.isArray(raw.gyroSamples) ? raw.gyroSamples : [],
      // 陀螺仪采样本体不落盘（体积原因），计数是唯一幸存记录，加载时必须还原
      // （目前无人读取，但按「字段一个都不少」的口径绝不丢）
      gyroSampleCount: num(raw.gyroSampleCount) ?? (Array.isArray(raw.gyroSamples) ? raw.gyroSamples.length : 0),
      source: first(raw.source, raw.hasReplay ? '智能魔方导入' : 'import'),
      raw,
      // 异常标记透传（2026-09-29）：体检标注与误报恢复状态必须随记录进入内存，load 后不得被重检覆盖
      anomaly: Array.isArray(raw.anomaly) ? raw.anomaly : undefined,
      anomalyCleared: raw.anomalyCleared === true ? true : undefined,
    };
  }

  function unwrapJSON(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    const candidates = [
      value.solves, value.records, value.items, value.export?.solves,
      value.data?.cubeAnalyzerData?.solves, value.data?.solves,
      value.data?.data?.cubeAnalyzerData?.solves
    ];
    for (const c of candidates) if (Array.isArray(c)) return c;
    return [value];
  }

  function parseJSON(text) {
    const data = JSON.parse(text);
    return unwrapJSON(data).map(normalizeSolve).filter(s => s.totalTime > 0 || s.flag === 'dnf');
  }

  function parseCSVLine(line) {
    const out = []; let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i+1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out;
  }

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(x => x.trim());
    if (lines.length < 2) return [];
    const headers = parseCSVLine(lines[0]).map(h => h.trim());
    return lines.slice(1).map((line, i) => {
      const vals = parseCSVLine(line); const obj = {};
      headers.forEach((h, j) => obj[h] = vals[j]);
      return normalizeSolve(obj, i);
    }).filter(s => s.totalTime > 0 || s.flag === 'dnf');
  }

  function parseAny(text, name='') {
    if (/\.csv$/i.test(name)) return parseCSV(text);
    try { return parseJSON(text); }
    catch (jsonErr) {
      try { return parseCSV(text); }
      catch { throw jsonErr; }
    }
  }

  /* ---------- 落盘去重（2026-10-11）----------
   * 只删「在保存这一刻可证完全相同」的字段，加载时原样还原；任何一处无法证明相同就原样保留。
   * 因此这不是压缩、更不是丢弃：字段一个不少，值一个不变，只是不再把同一份数据存两遍。
   *
   * 目前仅两处成立：
   *   1. moveTimestamps —— 所有写入方都直接等于 timestamps 的副本；
   *   2. snapshots —— 当它与 stateSequence 逐项完全相同时（此时保留 stateSequence 即可还原两者）。
   * 其余字段（含 4 个墙钟时间戳、isSlice / isRotation、gyroSampleCount 等目前无人读取的字段）
   * 一律原样落盘，不做任何推断性删除。
   */

  function sameNumberArray(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (Number(a[i]) !== Number(b[i])) return false;
    return true;
  }

  function sameObjectArray(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i], y = b[i];
      if (x === y) continue;
      if (!x || !y || typeof x !== 'object' || typeof y !== 'object') return false;
      const kx = Object.keys(x), ky = Object.keys(y);
      if (kx.length !== ky.length) return false;
      for (const k of kx) if (x[k] !== y[k]) return false;
    }
    return true;
  }

  function exportableSolve(s) {
    const out = {
      id:s.id,date:s.date,totalTime:s.totalTime,flag:s.flag,tps:s.tps,turnCount:s.turnCount,
      fluencyPercent:s.fluencyPercent,analysisType:s.analysisType,session:s.session,device:s.device,
      scramble:s.scramble,timestamps:s.timestamps,moves:s.moves,startFacelet:s.startFacelet,
      snapshots:s.snapshots,stateSequence:s.stateSequence||s.snapshots||[],
      rawSolutionSequence:s.rawSolutionSequence||[],
      steps:s.steps,analysisFrame:s.analysisFrame||null,analysisVersion:s.analysisVersion||s.analysisFrame?.analysisVersion||0,
      colorNeutral:s.colorNeutral!==false,timingMode:s.timingMode||'',captureType:s.captureType||'',source:s.source,
      // 陀螺仪采样本体不落盘（体积原因），计数是唯一幸存记录，必须原样保留。
      // 取「数组长度」与「显式计数」的较大值：加载后 gyroSamples 会还原为空数组，
      // 只看 length 会把计数清零（二次保存即丢失）。
      gyroSampleCount:Math.max(Array.isArray(s.gyroSamples)?s.gyroSamples.length:0,Number(s.gyroSampleCount)||0),
      // 异常标记透传（2026-09-29）：记录永不删除，体检标注与误报恢复状态必须随记录落盘
      anomaly:Array.isArray(s.anomaly)?s.anomaly:undefined, anomalyCleared:s.anomalyCleared===true?true:undefined,
    };
    // 与 timestamps 完全相同的副本不再落盘（加载时还原为独立数组，语义不变）
    if (sameNumberArray(s.moveTimestamps, s.timestamps)) out.moveTimestampsDup = true;
    else out.moveTimestamps = s.moveTimestamps;
    // snapshots 与 stateSequence 完全相同时只存一份（加载时还原为两个独立数组）
    if (sameObjectArray(s.snapshots, out.stateSequence)) out.snapshotsDup = true;
    return out;
  }

  window.CubeAnalyzerImport = { normalizeSolve, parseJSON, parseCSV, parseAny, exportableSolve, timeToMs, stepsFromAnalysis };
})();

(() => {
  'use strict';

  const PAUSE_MS = 400;

  function available() {
    return !!(window.mathlib && window.mathlib.CubieCube);
  }

  function cloneCube(cube) {
    return new window.mathlib.CubieCube().init(cube.ca, cube.ea);
  }

  function parseFacelet(facelet) {
    if (!available()) return null;
    const text = String(facelet || '').trim();
    if (text.length !== 54) return null;
    try {
      const cube = new window.mathlib.CubieCube();
      if (cube.fromFacelet(text) === -1 || cube.verify() !== 0) return null;
      return cube;
    } catch (e) {
      return null;
    }
  }

  function rebuildStates(startFacelet, moves) {
    const start = parseFacelet(startFacelet);
    if (!start) return [];
    const states = [start];
    let cube = cloneCube(start);
    for (const move of (moves || [])) {
      try {
        const before = cube.hashCode();
        cube.selfMoveStr(String(move || '').trim());
        // Unknown move strings leave the cube unchanged; still keep timing alignment.
        if (cube.hashCode() === before && !/^[URFDLB](?:2|')?$/.test(String(move || '').trim())) continue;
        states.push(cloneCube(cube));
      } catch (e) {
        return [];
      }
    }
    return states;
  }

  function rotatedStates(states, rotation) {
    return states.map(src => {
      const cube = cloneCube(src);
      if (rotation) cube.selfConj(rotation);
      return cube;
    });
  }

  const edgeSolved = (c, i) => c.ea[i] === i * 2;
  const cornerSolved = (c, i) => c.ca[i] === i;
  const edgeOriented = (c, i) => (c.ea[i] & 1) === 0;
  const cornerOriented = (c, i) => (c.ca[i] >> 3) === 0;
  const all = (ids, fn) => ids.every(fn);

  function isSolved(c) {
    for (let i = 0; i < 8; i++) if (!cornerSolved(c, i)) return false;
    for (let i = 0; i < 12; i++) if (!edgeSolved(c, i)) return false;
    return true;
  }

  function cross(c) {
    return all([4,5,6,7], i => edgeSolved(c, i));
  }

  function f2l(c) {
    return cross(c) &&
      all([4,5,6,7], i => cornerSolved(c, i)) &&
      all([8,9,10,11], i => edgeSolved(c, i));
  }

  function oll(c) {
    return f2l(c) &&
      all([0,1,2,3], i => cornerOriented(c, i)) &&
      all([0,1,2,3], i => edgeOriented(c, i));
  }

  function allEdgesOriented(c) {
    for (let i = 0; i < 12; i++) if (!edgeOriented(c, i)) return false;
    return true;
  }

  function eoCross(c) {
    return cross(c) && allEdgesOriented(c);
  }

  // Roux block pieces in the canonical D/L/R frame. Twenty-four cube rotations
  // are tested, so the user's actual block color/orientation does not need a setting.
  function firstBlock(c) {
    return all([5,6], i => cornerSolved(c, i)) && all([6,9,10], i => edgeSolved(c, i));
  }

  function secondBlock(c) {
    return all([4,5,6,7], i => cornerSolved(c, i)) && all([4,6,8,9,10,11], i => edgeSolved(c, i));
  }

  function topCornersSolvedUpToAUF(c) {
    if (!all([0,1,2,3], i => cornerOriented(c, i))) return false;
    const ids = [0,1,2,3].map(i => c.ca[i] & 7);
    const rotations = [[0,1,2,3],[1,2,3,0],[2,3,0,1],[3,0,1,2]];
    return rotations.some(r => r.every((v, i) => ids[i] === v));
  }

  function cmll(c) {
    return secondBlock(c) && topCornersSolvedUpToAUF(c);
  }

  function stableIndex(states, predicate, from = 0) {
    let stable = true;
    let earliest = states.length - 1;
    for (let i = states.length - 1; i >= from; i--) {
      stable = stable && !!predicate(states[i]);
      if (stable) earliest = i;
    }
    return earliest;
  }

  function detectForRotation(method, states) {
    const n = states.length - 1;
    if (n < 1 || !isSolved(states[n])) return null;
    let marks;
    if (method === 'Roux') {
      const fb = stableIndex(states, firstBlock);
      const sb = stableIndex(states, secondBlock, fb);
      const cm = stableIndex(states, cmll, sb);
      marks = [fb, sb, cm, n];
    } else if (method === 'ZZ') {
      const eo = stableIndex(states, eoCross);
      const f = stableIndex(states, f2l, eo);
      marks = [eo, f, n];
    } else {
      const cr = stableIndex(states, cross);
      const f = stableIndex(states, f2l, cr);
      const o = stableIndex(states, oll, f);
      marks = [cr, f, o, n];
    }
    for (let i = 1; i < marks.length; i++) if (marks[i] < marks[i - 1]) return null;
    return marks;
  }

  function orientationScore(method, marks, n) {
    if (!marks || !n) return Number.POSITIVE_INFINITY;
    if (method === 'Roux') return marks[0] * 10000 + marks[1] * 100 + marks[2];
    if (method === 'ZZ') return marks[0] * 1000 + marks[1] * 10;
    return marks[0] * 10000 + marks[1] * 100 + marks[2];
  }

  function detect(method, baseStates) {
    // Color-neutral / orientation-neutral detection. We never assume white cross,
    // yellow cross, a fixed Roux block side, or a fixed ZZ holding direction.
    // Every one of the 24 whole-cube orientations is normalized into the same
    // canonical frame, then the method stages are detected there.
    const candidates = [];
    for (let rotation = 0; rotation < 24; rotation++) {
      const states = rotatedStates(baseStates, rotation);
      const marks = detectForRotation(method, states);
      if (!marks) continue;
      candidates.push({
        rotation, marks, states,
        score: orientationScore(method, marks, states.length - 1)
      });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score || a.rotation - b.rotation);
    const best = candidates[0];
    best.candidateCount = candidates.length;
    return best;
  }

  function timeAtMove(moveIndex, timestamps, totalTime) {
    if (moveIndex <= 0) return 0;
    const t = Number(timestamps[moveIndex - 1]);
    if (Number.isFinite(t)) return Math.max(0, Math.min(Number(totalTime) || t, t));
    const n = Math.max(1, timestamps.length);
    return (Number(totalTime) || 0) * moveIndex / n;
  }

  function stageTiming(startIndex, endIndex, timestamps, totalTime) {
    const start = timeAtMove(startIndex, timestamps, totalTime);
    const end = endIndex >= timestamps.length ? Number(totalTime) || timeAtMove(endIndex, timestamps, totalTime) : timeAtMove(endIndex, timestamps, totalTime);
    const time = Math.max(0, end - start);
    let recognition = 0;
    let previous = start;
    for (let move = startIndex + 1; move <= endIndex; move++) {
      const current = move === timestamps.length ? Math.min(end, Number(timestamps[move - 1]) || end) : timeAtMove(move, timestamps, totalTime);
      const gap = Math.max(0, current - previous);
      if (gap >= PAUSE_MS) recognition += gap;
      previous = current;
    }
    recognition = Math.min(time, recognition);
    return {
      time,
      turns: Math.max(0, endIndex - startIndex),
      recognition,
      execution: Math.max(0, time - recognition)
    };
  }

  function encodeOLL(c) {
    let code = 0;
    for (let i = 0; i < 4; i++) code = code * 3 + (c.ca[i] >> 3);
    for (let i = 0; i < 4; i++) code = code * 2 + (c.ea[i] & 1);
    return code;
  }

  function encodePLL(c) {
    let code = 0;
    for (let i = 0; i < 4; i++) {
      const id = c.ca[i] & 7;
      if (id > 3) return null;
      code = code * 4 + id;
    }
    for (let i = 0; i < 4; i++) {
      const id = c.ea[i] >> 1;
      if (id > 3) return null;
      code = code * 4 + id;
    }
    return code;
  }

  function encodeCMLL(c) {
    let code = 0;
    for (let i = 0; i < 4; i++) {
      const id = c.ca[i] & 7;
      if (id > 3) return null;
      code = code * 24 + id + 8 * (c.ca[i] >> 3);
    }
    return code;
  }

  function canonicalCaseCode(cube, encoder) {
    let best = null;
    // Rotations 0..3 are y-axis cube rotations in Formula's mathlib.
    for (const y of [0,1,2,3]) {
      const base = cloneCube(cube);
      if (y) base.selfConj(y);
      base.ori = 0;
      for (let auf = 0; auf < 4; auf++) {
        const value = encoder(base);
        if (value !== null && (best === null || value < best)) best = value;
        base.selfMoveStr('U');
      }
    }
    return best;
  }

  function addCaseMeta(step, type, cube, encoder) {
    if (!step || !(step.time > 0) || !cube) return;
    const code = canonicalCaseCode(cube, encoder);
    if (code === null) return;
    step.caseType = type;
    step.caseIndex = code;
    step.caseName = `${type} · 模式 ${code.toString(36).toUpperCase()}`;
  }

  function makeSteps(method, marks, timestamps, totalTime, states) {
    const meta = method === 'Roux'
      ? [['FB','First Block'],['SB','Second Block'],['CMLL','CMLL'],['LSE','LSE']]
      : method === 'ZZ'
        ? [['EOCross','EO Cross'],['F2L','F2L'],['ZBLL','ZBLL']]
        : [['Cross','Cross'],['F2L','F2L'],['OLL','OLL'],['PLL','PLL']];
    const steps = [];
    let start = 0;
    for (let i = 0; i < meta.length; i++) {
      const end = marks[i];
      const timing = stageTiming(start, end, timestamps, totalTime);
      steps.push({ name:meta[i][0], label:meta[i][1], ...timing });
      start = end;
    }
    if (states && states.length) {
      if (method === 'CFOP') {
        addCaseMeta(steps[2], 'OLL', states[marks[1]], encodeOLL);
        addCaseMeta(steps[3], 'PLL', states[marks[2]], encodePLL);
      } else if (method === 'Roux') {
        addCaseMeta(steps[2], 'CMLL', states[marks[1]], encodeCMLL);
      }
    }
    return steps;
  }

  function analyze({ method = 'CFOP', startFacelet, moves = [], timestamps = [], totalTime = 0 } = {}) {
    if (!available() || !startFacelet || !moves.length) return null;
    const cleanMoves = moves.map(String).filter(Boolean);
    const cleanTs = timestamps.map(Number).filter(Number.isFinite);
    if (cleanMoves.length !== cleanTs.length) return null;
    const states = rebuildStates(startFacelet, cleanMoves);
    if (states.length !== cleanMoves.length + 1) return null;
    const normalizedMethod = method === 'Roux' || method === 'ZZ' ? method : 'CFOP';
    const found = detect(normalizedMethod, states);
    if (!found) return null;
    return {
      method: normalizedMethod,
      rotation: found.rotation,
      frame: {
        autoDetected: true,
        colorNeutral: true,
        searchedOrientations: 24,
        validCandidates: found.candidateCount || 1,
        rotation: found.rotation
      },
      steps: makeSteps(normalizedMethod, found.marks, cleanTs, totalTime, found.states),
      boundaries: found.marks.slice(),
      confidence: found.marks.slice(0, -1).every((v, i, a) => i === 0 || v >= a[i - 1]) ? 'detected' : 'low'
    };
  }

  window.CubeAnalyzerSolveAnalysis = { analyze, parseFacelet, rebuildStates };
})();

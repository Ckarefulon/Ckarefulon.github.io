(() => {
  'use strict';

  const listeners = new Map();
  let connected = false;
  let connecting = false;
  let deviceName = '';
  let lastHistory = [];
  let lastStamp = null;
  let ignoreInitialState = true;
  let latestFacelet = '';

  function emit(type, detail = {}) {
    const set = listeners.get(type);
    if (set) set.forEach(fn => { try { fn(detail); } catch (e) { console.error(e); } });
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }

  function normalizeMove(raw) {
    if (raw == null) return null;
    let text = typeof raw === 'string' ? raw : (raw.move || raw.text || raw.notation || '');
    text = String(text).trim().replace(/[’`]/g, "'");
    const m = text.match(/^([URFDLB])([23]?)(\'?)$/i);
    if (!m) return null;
    const face = m[1].toUpperCase();
    const amount = m[2] === '2' ? '2' : (m[2] === '3' ? "'" : '');
    const prime = m[3] ? "'" : '';
    return face + (amount || prime);
  }

  function normalizeHistory(prevMoves) {
    const out = [];
    for (let i = 0; prevMoves && i < prevMoves.length; i++) {
      const move = normalizeMove(prevMoves[i]);
      if (move) out.push(move);
    }
    return out;
  }

  function timestampInfo(lastTs) {
    const now = Date.now();
    if (Array.isArray(lastTs)) {
      const hardware = Number(lastTs[0]);
      const local = Number(lastTs[1]);
      const hardwareTimestamp = Number.isFinite(hardware) ? hardware : null;
      const localTimestamp = Number.isFinite(local) ? local : now;
      // Different Formula drivers expose different hardware clock domains.
      // Use hardware time only when it is already aligned to the local epoch; otherwise
      // keep it as raw metadata and use the callback's local timestamp for timing.
      const hardwareLooksLocal = hardwareTimestamp != null && Math.abs(hardwareTimestamp - localTimestamp) <= 10000;
      return { hardwareTimestamp, localTimestamp, timestamp: hardwareLooksLocal ? hardwareTimestamp : localTimestamp };
    }
    const n = Number(lastTs);
    const hardwareTimestamp = Number.isFinite(n) ? n : null;
    const hardwareLooksLocal = hardwareTimestamp != null && Math.abs(hardwareTimestamp - now) <= 10000;
    return { hardwareTimestamp, localTimestamp: now, timestamp: hardwareLooksLocal ? hardwareTimestamp : now };
  }

  function historyStamp(lastTs) {
    return timestampInfo(lastTs).timestamp;
  }

  function historiesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function findHistoryOverlap(current, previous) {
    let bestOffset = 0;
    let bestMatch = 0;
    for (let offset = 1; offset < current.length; offset++) {
      let match = 0;
      while (match < previous.length && offset + match < current.length && current[offset + match] === previous[match]) match++;
      if (match > bestMatch) {
        bestMatch = match;
        bestOffset = offset;
      }
    }
    return bestMatch > 0 ? bestOffset : 0;
  }

  function getNewMoves(prevMoves, lastTs) {
    const current = normalizeHistory(prevMoves);
    const stamp = historyStamp(lastTs);
    if (!current.length) {
      lastStamp = stamp;
      return [];
    }
    if (lastHistory.length && historiesEqual(current, lastHistory) && stamp !== null && stamp === lastStamp) return [];
    let newCount = 1;
    if (lastHistory.length) {
      const overlap = findHistoryOverlap(current, lastHistory);
      if (overlap > 0) newCount = overlap;
    }
    lastHistory = current.slice(0, 12);
    lastStamp = stamp;
    return current.slice(0, Math.min(newCount, current.length)).reverse();
  }

  function saveHistory(prevMoves, lastTs) {
    const current = normalizeHistory(prevMoves);
    if (current.length) lastHistory = current.slice(0, 12);
    lastStamp = historyStamp(lastTs);
  }

  function isSolved(facelet) {
    const s = String(facelet || '').trim().toUpperCase();
    if (s.length < 54) return false;
    const faces = [];
    for (let i = 0; i < 54; i += 9) {
      const part = s.slice(i, i + 9);
      if (part.length !== 9 || [...part].some(ch => ch !== part[0])) return false;
      faces.push(part[0]);
    }
    return new Set(faces).size === 6;
  }

  function callback(facelet, prevMoves, lastTs, hardware) {
    if (hardware) deviceName = String(hardware);
    const previousFacelet = latestFacelet;
    if (typeof facelet === 'string' && facelet.length >= 54) latestFacelet = facelet;
    if (ignoreInitialState) {
      saveHistory(prevMoves, lastTs);
      ignoreInitialState = false;
      emit('state', { facelet, solved: isSolved(facelet), deviceName });
      return;
    }
    const moves = getNewMoves(prevMoves, lastTs);
    const timing = timestampInfo(lastTs);
    if (moves.length) {
      moves.forEach((move, index) => {
        // 正常情况下硬件层每个转动都会单独回调。若一次补回多步，只做最小的单调偏移，
        // 保证动作不丢失；rawSolutionSequence 仍同时保留硬件时间与本地接收时间。
        const backfill = moves.length - 1 - index;
        emit('move', {
          move,
          timestamp: timing.timestamp - backfill,
          hardwareTimestamp: timing.hardwareTimestamp == null ? null : timing.hardwareTimestamp - backfill,
          localTimestamp: timing.localTimestamp,
          previousFacelet: index === 0 ? previousFacelet : null,
          facelet: index === moves.length - 1 ? facelet : null,
          solved: index === moves.length - 1 && isSolved(facelet),
          deviceName: deviceName || '智能魔方'
        });
      });
    }
    emit('state', { facelet, solved: isSolved(facelet), deviceName });
  }

  async function connect() {
    if (connecting) return;
    if (connected) return disconnect();
    if (!window.GiikerCube) throw new Error('智能魔方适配层未加载');
    if (!navigator.bluetooth) throw new Error('当前浏览器不支持 Web Bluetooth，请使用 Chrome / Edge 并通过 HTTPS 打开页面');
    connecting = true;
    ignoreInitialState = true;
    lastHistory = [];
    lastStamp = null;
    emit('connecting');
    window.GiikerCube.setCallback(callback);
    window.GiikerCube.setEventCallback(info => {
      if (info === 'disconnect') {
        connected = false;
        connecting = false;
        lastHistory = [];
        lastStamp = null;
        emit('disconnect');
      }
    });
    try {
      await window.GiikerCube.init();
      connected = true;
      connecting = false;
      emit('connect', { deviceName: deviceName || '智能魔方' });
    } catch (e) {
      connected = false;
      connecting = false;
      const raw = String(e && (e.message || e) || '连接失败');
      if (/cancel|chooser|User cancelled|NotFoundError/i.test(raw)) throw new Error('已取消选择设备');
      throw new Error(raw);
    }
  }

  async function disconnect() {
    if (!window.GiikerCube) return;
    try { await window.GiikerCube.stop(); } catch (e) { console.warn(e); }
    connected = false;
    connecting = false;
    lastHistory = [];
    lastStamp = null;
    emit('disconnect');
  }

  async function battery() {
    try {
      const cube = window.GiikerCube && window.GiikerCube.getCube && window.GiikerCube.getCube();
      if (cube && typeof cube.getBatteryLevel === 'function') return await cube.getBatteryLevel();
    } catch (e) {}
    return null;
  }

  window.CubeAnalyzerSmartCube = {
    on,
    connect,
    disconnect,
    battery,
    isConnected: () => connected,
    isConnecting: () => connecting,
    getDeviceName: () => deviceName || '智能魔方',
    getFacelet: () => latestFacelet,
    isSolved,
    normalizeMove,
    _getNewMoves: getNewMoves
  };
})();

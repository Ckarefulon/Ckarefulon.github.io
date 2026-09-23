(() => {
  'use strict';

  const SLICE_WINDOW_MS = 90;
  const listeners = new Map();
  let connected = false;
  let connecting = false;
  let deviceName = '';
  let lastHistory = [];
  let lastStamp = null;
  let lastDeliveredTs = null;
  let ignoreInitialState = true;
  let latestFacelet = '';
  let pending = null;
  let pendingTimer = null;

  function emit(type, detail = {}) {
    const set = listeners.get(type);
    if (set) set.forEach(fn => { try { fn(detail); } catch (e) { console.error(e); } });
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }

  function normalizeFaceMove(raw) {
    if (raw == null) return null;
    let text = typeof raw === 'string' ? raw : (raw.move || raw.text || raw.notation || '');
    text = String(text).trim().replace(/[’`]/g, "'");
    const m = text.match(/^([URFDLB])([23]?)(\'?)$/i);
    if (!m) return null;
    const face = m[1].toUpperCase();
    if (m[2] === '2') return face + '2';
    if (m[2] === '3' || m[3]) return face + "'";
    return face;
  }

  function normalizeLogicalMove(raw) {
    if (raw == null) return null;
    let text = typeof raw === 'string' ? raw : (raw.move || raw.text || raw.notation || '');
    text = String(text).trim().replace(/[’`]/g, "'");
    const m = text.match(/^([URFDLBMESxyz])([23]?)(\'?)$/i);
    if (!m) return null;
    const base = /[xyz]/i.test(m[1]) ? m[1].toLowerCase() : m[1].toUpperCase();
    if (m[2] === '2') return base + '2';
    if (m[2] === '3' || m[3]) return base + "'";
    return base;
  }

  function normalizeHistory(prevMoves) {
    const out = [];
    for (let i = 0; prevMoves && i < prevMoves.length; i++) {
      const move = normalizeFaceMove(prevMoves[i]);
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
      const hardwareLooksLocal = hardwareTimestamp != null && Math.abs(hardwareTimestamp - localTimestamp) <= 10000;
      return { hardwareTimestamp, localTimestamp, timestamp: hardwareLooksLocal ? hardwareTimestamp : localTimestamp };
    }
    const n = Number(lastTs);
    const hardwareTimestamp = Number.isFinite(n) ? n : null;
    const hardwareLooksLocal = hardwareTimestamp != null && Math.abs(hardwareTimestamp - now) <= 10000;
    return { hardwareTimestamp, localTimestamp: now, timestamp: hardwareLooksLocal ? hardwareTimestamp : now };
  }

  function historiesEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function findHistoryOverlap(current, previous) {
    // Hardware history is newest-first. If N moves arrived since the previous callback,
    // the old history begins at current[N].
    for (let offset = 0; offset < current.length; offset++) {
      let match = 0;
      while (match < previous.length && offset + match < current.length && current[offset + match] === previous[match]) match++;
      if (previous.length && match === Math.min(previous.length, current.length - offset)) return offset;
    }
    return -1;
  }

  function getNewMoves(prevMoves, lastTs) {
    const current = normalizeHistory(prevMoves);
    const stamp = timestampInfo(lastTs).timestamp;
    if (!current.length) { lastStamp = stamp; return []; }

    // Same history with a refreshed driver timestamp is still the same history.
    if (lastHistory.length && historiesEqual(current, lastHistory)) {
      lastStamp = stamp;
      return [];
    }

    let newCount = 1;
    if (lastHistory.length) {
      const offset = findHistoryOverlap(current, lastHistory);
      if (offset >= 0) newCount = offset;
    }
    lastHistory = current.slice(0, 12);
    lastStamp = stamp;
    if (newCount <= 0) return [];
    return current.slice(0, Math.min(newCount, current.length)).reverse();
  }

  function saveHistory(prevMoves, lastTs) {
    const current = normalizeHistory(prevMoves);
    if (current.length) lastHistory = current.slice(0, 12);
    lastStamp = timestampInfo(lastTs).timestamp;
  }

  function isSolved(facelet) {
    const s = String(facelet || '').trim().toUpperCase();
    if (s.length !== 54) return false;
    const centers = [];
    for (let i = 0; i < 54; i += 9) {
      const part = s.slice(i, i + 9);
      if ([...part].some(ch => ch !== part[0])) return false;
      centers.push(part[0]);
    }
    return new Set(centers).size === 6;
  }

  function clearPendingTimer() {
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = null;
  }

  function emitLogical(detail) {
    const move = normalizeLogicalMove(detail.move);
    if (!move) return;
    const rawMoves = Array.isArray(detail.rawMoves) ? detail.rawMoves.map(normalizeFaceMove).filter(Boolean) : [];
    emit('move', {
      ...detail,
      move,
      logicalMove: move,
      rawMoves,
      isSlice: /^[MES]/.test(move),
      isRotation: /^[xyz]/.test(move),
      solved: !!detail.facelet && isSolved(detail.facelet),
      deviceName: deviceName || '智能魔方'
    });
    if (Number.isFinite(Number(detail.timestamp))) lastDeliveredTs = Number(detail.timestamp);
  }

  function flushPending() {
    if (!pending) return;
    const p = pending;
    pending = null;
    clearPendingTimer();
    emitLogical({
      move: p.move,
      rawMoves: [p.move],
      timestamp: p.timestamp,
      hardwareTimestamp: p.hardwareTimestamp,
      localTimestamp: p.localTimestamp,
      previousFacelet: p.previousFacelet,
      facelet: p.facelet,
      batchFinal: p.batchFinal
    });
  }

  function inversePower(move) {
    if (move.endsWith('2')) return 2;
    return move.endsWith("'") ? 3 : 1;
  }

  function sliceFromPair(a, b) {
    const pair = new Set([a, b]);
    const same = (x, y) => pair.size === 2 && pair.has(x) && pair.has(y);
    if (same('R', "L'")) return 'M';
    if (same("R'", 'L')) return "M'";
    if (same('U', "D'")) return 'E';
    if (same("U'", 'D')) return "E'";
    if (same("F'", 'B')) return 'S';
    if (same('F', "B'")) return "S'";
    if (same('R2', 'L2')) return 'M2';
    if (same('U2', 'D2')) return 'E2';
    if (same('F2', 'B2')) return 'S2';
    return null;
  }

  function canStartSlice(move) {
    return /^[URFDLB](?:2|')?$/.test(move);
  }

  function processRawMove(event) {
    const move = normalizeFaceMove(event.move);
    if (!move) return;

    if (pending && Math.abs(Number(event.timestamp) - Number(pending.timestamp)) <= SLICE_WINDOW_MS) {
      const slice = sliceFromPair(pending.move, move);
      if (slice) {
        const first = pending;
        pending = null;
        clearPendingTimer();
        emitLogical({
          move: slice,
          rawMoves: [first.move, move],
          timestamp: event.timestamp,
          startTimestamp: first.timestamp,
          hardwareTimestamp: event.hardwareTimestamp,
          localTimestamp: event.localTimestamp,
          previousFacelet: first.previousFacelet,
          facelet: event.facelet || first.facelet,
          batchFinal: event.batchFinal
        });
        return;
      }
    }

    flushPending();
    if (canStartSlice(move)) {
      pending = { ...event, move };
      pendingTimer = setTimeout(flushPending, SLICE_WINDOW_MS);
      return;
    }
    emitLogical({ ...event, move, rawMoves: [move] });
  }

  function interpolatedTimes(count, endTs) {
    if (count <= 1) return [endTs];
    let start = Number(lastDeliveredTs);
    if (!Number.isFinite(start) || start >= endTs) start = endTs - Math.max(count - 1, 1) * 35;
    const available = Math.max(count, endTs - start);
    const step = Math.max(1, Math.min(120, available / count));
    const first = endTs - step * (count - 1);
    return Array.from({ length: count }, (_, i) => first + step * i);
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
    if (!moves.length) {
      // BLE often repeats the same newest-first history with a refreshed timestamp.
      // Do not flush a pending first half of M/E/S prematurely; the 90 ms timer
      // will deliver it if no matching second half arrives.
      if (pending) {
        if (typeof facelet === 'string' && facelet.length === 54) pending.facelet = facelet;
        return;
      }
      emit('state', { facelet, solved: isSolved(facelet), deviceName });
      return;
    }

    const times = interpolatedTimes(moves.length, timing.timestamp);
    moves.forEach((move, index) => {
      const isLast = index === moves.length - 1;
      processRawMove({
        move,
        timestamp: times[index],
        hardwareTimestamp: timing.hardwareTimestamp,
        localTimestamp: timing.localTimestamp,
        previousFacelet: index === 0 ? previousFacelet : null,
        facelet: isLast ? facelet : null,
        batchFinal: isLast
      });
    });

    // Do not emit state while a face turn is still waiting for the 90 ms slice window.
    if (!pending) emit('state', { facelet, solved: isSolved(facelet), deviceName });
  }

  function gyroCallback(x, y, z, w, hardware) {
    if (hardware) deviceName = String(hardware);
    emit('gyro', { x: Number(x), y: Number(y), z: Number(z), w: Number(w), timestamp: Date.now(), deviceName: deviceName || '智能魔方' });
  }

  // Future Formula rotation detector can feed x/y/z here without changing Analyzer's
  // training or persistence format.
  function ingestLogicalMove(move, meta = {}) {
    const logical = normalizeLogicalMove(move);
    if (!logical) return false;
    flushPending();
    emitLogical({
      move: logical,
      rawMoves: meta.rawMoves || [],
      timestamp: Number.isFinite(Number(meta.timestamp)) ? Number(meta.timestamp) : Date.now(),
      hardwareTimestamp: meta.hardwareTimestamp ?? null,
      localTimestamp: meta.localTimestamp ?? Date.now(),
      previousFacelet: meta.previousFacelet || latestFacelet || null,
      facelet: meta.facelet || latestFacelet || null,
      source: meta.source || 'logical'
    });
    return true;
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
    lastDeliveredTs = null;
    latestFacelet = '';
    pending = null;
    clearPendingTimer();
    emit('connecting');
    window.GiikerCube.setCallback(callback);
    if (typeof window.GiikerCube.setGyroCallback === 'function') window.GiikerCube.setGyroCallback(gyroCallback);
    window.GiikerCube.setEventCallback(info => {
      if (info === 'disconnect') {
        connected = false;
        connecting = false;
        lastHistory = [];
        lastStamp = null;
        pending = null;
        clearPendingTimer();
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
    flushPending();
    try { await window.GiikerCube.stop(); } catch (e) { console.warn(e); }
    connected = false;
    connecting = false;
    lastHistory = [];
    lastStamp = null;
    lastDeliveredTs = null;
    pending = null;
    clearPendingTimer();
    emit('disconnect');
  }

  async function battery() {
    try {
      const cube = window.GiikerCube && window.GiikerCube.getCube && window.GiikerCube.getCube();
      if (cube && typeof cube.getBatteryLevel === 'function') return await cube.getBatteryLevel();
    } catch (_) {}
    return null;
  }

  window.CubeAnalyzerSmartCube = {
    on,
    connect,
    disconnect,
    battery,
    ingestLogicalMove,
    isConnected: () => connected,
    isConnecting: () => connecting,
    getDeviceName: () => deviceName || '智能魔方',
    getFacelet: () => latestFacelet,
    isSolved,
    normalizeMove: normalizeLogicalMove,
    _getNewMoves: getNewMoves,
    _sliceFromPair: sliceFromPair,
    flushPending,
    _flushPending: flushPending
  };
})();

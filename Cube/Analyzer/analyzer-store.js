(() => {
  'use strict';

  /**
   * CubeAnalyzerStore —— Analyzer 训练记录的分层存储（2026-10-17 重写）
   *
   * 事实：localStorage 配额实测约 5MB，一条智能魔方记录约 25~35KB（逐步状态轨迹占绝大部分），
   * 一两百把就会写满。所以记录按容量分两层放：
   *   · localStorage 镜像层 —— 最近的若干把，供首屏同步渲染；
   *   · IndexedDB 主存储层 —— 更早的记录。
   * 加载时两层按 id 合并还原成完整记录集，字段一个不少。
   *
   * 旧实现把机制做成了「每次落盘都按传入集合反向对齐 IndexedDB」，于是只要落盘时
   * 调用方手里的集合不是全量（首屏 loadSync 只有镜像子集，这是必然的），
   * 就会把扩展存储里的较早记录（连同 index 与数据）整批删掉 —— 「175 把只剩 105 把」的根因。
   * 下面的三条硬规则就是为此立的：
   *
   *   1. 只增不删：persist() 只做 upsert，绝不因为「这次传进来的集合更小」去删 IndexedDB。
   *      删除只能显式走 remove(ids) / replaceAll()。
   *   2. 全量才落盘：persist() 内部先 await 水合，基于「已合并的完整集合」落盘，
   *      不再把调用方当时手里的局部集合当成真相。
   *   3. 总数可读：镜像头部写 totalCount，首屏不等水合就能显示真实条数；
   *      水合后发现实到条数少于记录值 ⇒ 扩展存储被清掉了，据此可从云端自愈。
   */

  const STORAGE_KEY = 'cubeAnalyzerDataV2';
  const SETTINGS_KEY = 'cubeAnalyzerSettingsV2';
  const IDB_NAME = 'cubeAnalyzerStore';
  const IDB_VERSION = 1;
  const RECORDS = 'records';
  // localStorage 预算：留出其它站点数据与「覆盖前快照」的余量
  const BUDGET = 3.6 * 1024 * 1024;

  let dbPromise = null;
  let idbIds = new Set();     // 当前 IndexedDB 里实际存在的 id
  let idbBroken = false;
  let queue = Promise.resolve();  // 所有写操作串行化
  let hydratePromise = null;
  let hydrated = false;
  let cache = null;           // 水合后的完整记录集（唯一真相）

  /* ---------------- IndexedDB 基础操作 ---------------- */

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB 不可用')); return; }
      const rq = indexedDB.open(IDB_NAME, IDB_VERSION);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error || new Error('IndexedDB 打开失败'));
      rq.onblocked = () => reject(new Error('IndexedDB 被其它标签页占用'));
    }).catch(e => { dbPromise = null; idbBroken = true; throw e; });
    return dbPromise;
  }

  async function idbGetAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readonly');
      const rq = tx.objectStore(RECORDS).getAll();
      rq.onsuccess = () => resolve(rq.result || []);
      rq.onerror = () => reject(rq.error);
    });
  }

  async function idbPut(records) {
    if (!records.length) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      const st = tx.objectStore(RECORDS);
      records.forEach(r => st.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 写入中止'));
    });
  }

  async function idbDelete(ids) {
    if (!ids.length) return;
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      const st = tx.objectStore(RECORDS);
      ids.forEach(id => st.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB 删除中止'));
    });
  }

  async function idbClear() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECORDS, 'readwrite');
      tx.objectStore(RECORDS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ---------------- localStorage 镜像层 ---------------- */

  function readMirror() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null;
    } catch (e) { return null; }
  }

  /** 镜像头部声明的「应有条数」：新格式读 totalCount，旧格式用 solves + overflowCount 推算 */
  function claimedTotal(mirror) {
    if (!mirror) return 0;
    const solved = Array.isArray(mirror.solves) ? mirror.solves.length : 0;
    const tc = Number(mirror.totalCount);
    if (Number.isFinite(tc) && tc > 0) return Math.max(tc, solved);
    const overflow = Number(mirror.overflowCount) || 0;
    return Math.max(solved + (overflow > 0 ? overflow : 0), solved);
  }

  function readSettings() {
    try {
      if (window.storageManager) return window.storageManager.getJson(SETTINGS_KEY, {}) || {};
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (e) { return {}; }
  }

  function writeSettings(settings) {
    try {
      if (settings == null) return;
      if (window.storageManager) window.storageManager.setJson(SETTINGS_KEY, settings);
      else localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* 设置写不进去不影响训练记录 */ }
  }

  function sortSolves(list) {
    return list.slice().sort((a, b) => {
      const ta = new Date(a && a.date).getTime(), tb = new Date(b && b.date).getTime();
      if (ta !== tb) return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
      return String(a && a.id).localeCompare(String(b && b.id));
    });
  }

  /**
   * 生成镜像 JSON：从最新往回装，装到预算为止。
   * 头部的 totalCount 是真实总数（水合前也能显示对的数目），writtenAt 用于和云端比较新旧。
   */
  function mirrorJson(name, parts, total, k, writtenAt) {
    const head = '{"name":' + JSON.stringify(name) + ',"totalCount":' + total
      + ',"writtenAt":' + (Number(writtenAt) || 0) + ',"solves":[';
    const body = parts.slice(total - k).join(',');
    return head + body + '],"overflowCount":' + (total - k) + '}';
  }

  function planMirror(name, solves) {
    const total = solves.length;
    const parts = new Array(total);
    for (let i = 0; i < total; i++) {
      try { parts[i] = JSON.stringify(solves[i]); } catch (e) { parts[i] = 'null'; }
    }
    // 先按估算装填，再用真实长度校正（尾块里 overflowCount / totalCount 的位数会变）
    let k = 0, acc = 0;
    for (let i = total - 1; i >= 0; i--) {
      const add = parts[i].length + (k ? 1 : 0);
      if (acc + add + 64 > BUDGET) break;
      acc += add; k++;
    }
    while (k > 0 && mirrorJson(name, parts, total, k, 0).length > BUDGET) k--;
    return { parts, total, keep: k };
  }

  /* ---------------- 水合：把两层合并成完整集合 ---------------- */

  function ensureHydrated() {
    if (hydrated) return Promise.resolve(cache);
    if (hydratePromise) return hydratePromise;
    hydratePromise = (async () => {
      const mirror = readMirror();
      let idbRecords = [];
      try {
        idbRecords = await idbGetAll();
        idbIds = new Set(idbRecords.filter(r => r && r.id != null).map(r => String(r.id)));
      } catch (e) {
        idbBroken = true;
        console.warn('[AnalyzerStore] IndexedDB 读取失败，仅使用本机镜像数据', e);
        idbIds = new Set();
      }
      const byId = new Map();
      idbRecords.forEach(s => { if (s && s.id != null) byId.set(String(s.id), s); });
      (Array.isArray(mirror && mirror.solves) ? mirror.solves : []).forEach(s => {
        if (s && s.id != null) byId.set(String(s.id), s);
      });
      cache = { name: (mirror && mirror.name) || '训练数据', solves: sortSolves([...byId.values()]) };
      hydrated = true;
      const missing = missingCount();
      if (missing > 0) {
        console.warn('[AnalyzerStore] 本机扩展存储缺少 ' + missing + ' 条记录（镜像声明 '
          + claimedTotal(mirror) + ' 条，实到 ' + cache.solves.length + ' 条）');
      }
      return cache;
    })().then(v => { hydratePromise = null; return v; }, e => { hydratePromise = null; hydrated = true; cache = cache || { name: '训练数据', solves: [] }; throw e; });
    return hydratePromise;
  }

  /** 镜像声明了 N 条、实到 M 条 ⇒ 少的那些大概率被浏览器清掉了 */
  function missingCount() {
    if (!hydrated || !cache) return 0;
    const claimed = claimedTotal(readMirror());
    return Math.max(0, claimed - cache.solves.length);
  }

  /* ---------------- 落盘 ---------------- */

  /**
   * 把「完整集合」摊到两层里。返回 {ok, tiered, localCount, idbCount, message}
   * 关键顺序：先写镜像（最新的一批，最小的风险窗口），再写扩展存储，最后才回收多余的 IDB 记录。
   */
  async function placeDown(name, solves) {
    const { parts, total, keep: planned } = planMirror(name, solves);
    let k = planned;
    let written = null;
    const writtenAt = Date.now();
    while (k >= 0) {
      try {
        const json = mirrorJson(name, parts, total, k, writtenAt);
        localStorage.setItem(STORAGE_KEY, json);
        written = { keep: k, bytes: json.length, writtenAt };
        break;
      } catch (e) {
        if (k === 0) return { ok: false, localCount: 0, idbCount: 0, message: '浏览器本地存储不可用' };
        k = Math.floor(k / 2);
      }
    }
    if (!written) return { ok: false, localCount: 0, idbCount: 0, message: '浏览器本地存储不可用' };

    const keep = written.keep;
    const overflow = solves.slice(0, total - keep);
    const overflowIds = new Set(overflow.map(s => String(s.id)));

    if (overflow.length) {
      try {
        await idbPut(overflow);
        idbBroken = false;
      } catch (e) {
        idbBroken = true;
        console.error('[AnalyzerStore] IndexedDB 写入失败', e);
        // 旧记录没能搬进扩展存储 ⇒ 如实告知，绝不能让用户以为已经保存
        return {
          ok: false, localCount: keep, idbCount: 0,
          message: `本地空间不足，且有 ${overflow.length} 条较早记录无法写入扩展存储，请先导出备份`
        };
      }
      // 只回收「曾经在 IDB、现在已经挪进镜像」的那部分；其它一律保留
      const stale = [...idbIds].filter(id => !overflowIds.has(id));
      if (stale.length) {
        try { await idbDelete(stale); } catch (e) { console.warn('[AnalyzerStore] 回收旧副本失败', e); }
      }
    } else if (idbIds.size) {
      // 全部记录都装进了镜像 ⇒ 扩展存储里的副本已经冗余，清掉避免两份不一致
      try { await idbClear(); } catch (e) { console.warn('[AnalyzerStore] 清理扩展存储失败', e); }
    }
    idbIds = overflowIds;
    return {
      ok: true,
      tiered: overflow.length > 0,
      localCount: keep,
      idbCount: overflow.length,
      total,
      message: overflow.length
        ? `已保存：最近 ${keep} 把在本机，较早 ${overflow.length} 把存放在扩展存储`
        : ''
    };
  }

  /**
   * 落盘（只增不删）。
   * 传入的是「调用方此刻手里的记录集」——可能是全量，也可能只是镜像子集。
   * 无论哪种，都先并入已水合的完整集合并取并集，绝不因此删除任何已有记录。
   */
  function persist(payload, settings) {
    writeSettings(settings);
    const incoming = Array.isArray(payload && payload.solves) ? payload.solves : [];
    const name = (payload && payload.name) || '训练数据';
    queue = queue.then(async () => {
      try { await ensureHydrated(); }
      catch (e) { cache = cache || { name, solves: [] }; }
      const base = (cache && Array.isArray(cache.solves)) ? cache.solves : [];
      const byId = new Map(base.map(s => [String(s && s.id), s]));
      incoming.forEach(s => { if (s && s.id != null) byId.set(String(s.id), s); });
      const merged = sortSolves([...byId.values()]);
      cache = { name: (cache && cache.name) || name, solves: merged };
      hydrated = true;
      return placeDown(cache.name, merged);
    }).catch(e => {
      console.error('[AnalyzerStore] 保存异常', e);
      return { ok: false, tiered: false, localCount: 0, idbCount: 0, message: (e && e.message) || String(e) };
    });
    return queue;
  }

  /** 显式删除（唯一会减记录的入口之一） */
  function remove(ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(x => x != null).map(String);
    if (!list.length) return queue;
    const set = new Set(list);
    queue = queue.then(async () => {
      try { await ensureHydrated(); } catch (e) { /* 用现有 cache */ }
      const base = (cache && Array.isArray(cache.solves)) ? cache.solves : [];
      const kept = base.filter(s => !set.has(String(s && s.id)));
      cache = { name: (cache && cache.name) || '训练数据', solves: kept };
      hydrated = true;
      return placeDown(cache.name, kept);
    }).catch(e => {
      console.error('[AnalyzerStore] 删除异常', e);
      return { ok: false, message: (e && e.message) || String(e) };
    });
    return queue;
  }

  /** 整份替换（云端恢复 / 导入覆盖 / 清空）：唯一会主动清空扩展存储的入口 */
  function replaceAll(payload, settings) {
    writeSettings(settings);
    const solves = Array.isArray(payload && payload.solves) ? payload.solves : [];
    const name = (payload && payload.name) || '训练数据';
    queue = queue.then(async () => {
      const clean = sortSolves(solves.filter(s => s && s.id != null));
      cache = { name, solves: clean };
      hydrated = true;
      idbIds = new Set();
      try { await idbClear(); } catch (e) { console.warn('[AnalyzerStore] 清空扩展存储失败', e); }
      return placeDown(name, clean);
    }).catch(e => {
      console.error('[AnalyzerStore] 整份替换异常', e);
      return { ok: false, message: (e && e.message) || String(e) };
    });
    return queue;
  }

  /* ---------------- 读取 ---------------- */

  /** 首屏同步读：只有镜像层，但带上真实总数，界面不必显示错的数目 */
  function loadSync() {
    const mirror = readMirror();
    const solves = Array.isArray(mirror && mirror.solves) ? mirror.solves : [];
    const claimed = claimedTotal(mirror);
    return {
      payload: { name: (mirror && mirror.name) || '训练数据', solves },
      settings: readSettings(),
      localCount: solves.length,
      totalCount: Math.max(claimed, solves.length),
      overflowCount: Math.max(0, claimed - solves.length),
      partial: claimed > solves.length
    };
  }

  /** 完整加载：localStorage 镜像 + IndexedDB 合并还原 */
  async function loadAll() {
    const sync = loadSync();
    let full;
    try { full = await ensureHydrated(); }
    catch (e) { full = { name: sync.payload.name, solves: sortSolves(sync.payload.solves) }; }
    return {
      payload: { name: full.name, solves: full.solves.slice() },
      settings: sync.settings,
      localCount: sync.localCount,
      idbCount: idbIds.size,
      totalCount: full.solves.length,
      missing: missingCount(),
      partial: false
    };
  }

  /** 云同步 / 导出用：必须是完整记录集；未水合完成时返回 null，让调用方先 await ready() */
  function getFullPayload() {
    if (!hydrated || !cache) return null;
    return { name: cache.name, solves: cache.solves.slice() };
  }

  function ready() { return ensureHydrated().then(() => undefined); }
  /** 等待所有排队的写操作落地（重载数据前必须调用，否则会读到上一轮的旧值） */
  function flush() { return queue.then(() => undefined, () => undefined); }
  function isHydrated() { return hydrated; }
  function isTiered() { return idbIds.size > 0; }
  function idbUnavailable() { return idbBroken; }

  /** 镜像元信息（不解析记录体）：总数、写入时间、是否有 IndexedDB 层 */
  function mirrorInfo() {
    const mirror = readMirror();
    const mirrorSolves = Array.isArray(mirror && mirror.solves) ? mirror.solves : [];
    return {
      name: (mirror && mirror.name) || '训练数据',
      claimedTotal: claimedTotal(mirror),
      localCount: mirrorSolves.length,
      writtenAt: Number((mirror && mirror.writtenAt) || 0) || 0,
      totalCount: cache ? cache.solves.length : claimedTotal(mirror),
      missing: missingCount(),
      tiered: idbIds.size > 0,
      bytes: (() => { try { return localStorage.getItem(STORAGE_KEY)?.length || 0; } catch (e) { return 0; } })()
    };
  }

  function stats() {
    const info = mirrorInfo();
    return Object.assign(info, { hydrated, idbBroken, idbCount: idbIds.size });
  }

  /** 兼容旧调用：清空全部 */
  function clearAll() { return replaceAll({ name: '训练数据', solves: [] }, {}); }

  // 尽力申请持久化存储：降低浏览器在磁盘紧张时回收 IndexedDB 的概率（失败无副作用）
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persisted()
        .then(already => { if (!already) return navigator.storage.persist(); })
        .catch(() => {});
    }
  } catch (e) { /* 忽略 */ }

  window.CubeAnalyzerStore = {
    STORAGE_KEY, SETTINGS_KEY,
    persist, remove, replaceAll, loadSync, loadAll, getFullPayload, clearAll,
    ready, flush, isHydrated, isTiered, idbUnavailable, stats, missingCount, mirrorInfo,
    readSettings
  };
})();

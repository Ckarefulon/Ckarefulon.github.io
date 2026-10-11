(() => {
  'use strict';

  /**
   * CubeAnalyzerStore —— Analyzer 训练记录的本地存储分层（2026-10-11）
   *
   * 问题：localStorage 配额实测 5MB。一条智能魔方记录约 35KB（逐步状态轨迹占绝大部分），
   * 约 170 把就会写满，此后所有保存静默失败。
   *
   * 策略（记录一条都不丢、字段一个都不少）：
   *   1. 放得下 ⇒ 整份记录仍写 localStorage，行为与过去完全一致，IndexedDB 不参与；
   *   2. 放不下 ⇒ 只有「较旧的记录」搬到 IndexedDB，localStorage 只保留最新的若干把；
   *      两部分在加载时合并还原成完整记录集，顺序、字段与搬动前完全相同。
   *
   * 因此这是「换地方存」，不是「丢数据」：分析所需字段全程完整，
   * 且最新一把永远落在 localStorage（同步写入），不存在丢失窗口。
   */

  const STORAGE_KEY = 'cubeAnalyzerDataV2';
  const SETTINGS_KEY = 'cubeAnalyzerSettingsV2';
  const IDB_NAME = 'cubeAnalyzerStore';
  const IDB_VERSION = 1;
  const RECORDS = 'records';
  // localStorage 预算：留出其它站点数据与「覆盖前快照」的余量
  const BUDGET = 3.6 * 1024 * 1024;

  let dbPromise = null;
  let idbIds = new Set();
  let idbQueue = Promise.resolve();
  let hydrated = false;
  let cache = null;
  let idbBroken = false;

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

  function readLocal() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return (d && typeof d === 'object' && !Array.isArray(d)) ? d : null;
    } catch (e) { return null; }
  }

  function readSettings() {
    try {
      if (window.storageManager) return window.storageManager.getJson(SETTINGS_KEY, {}) || {};
      return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (e) { return {}; }
  }

  function writeSettings(settings) {
    try {
      if (window.storageManager) window.storageManager.setJson(SETTINGS_KEY, settings);
      else localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) { /* 设置写不进去不影响训练记录 */ }
  }

  /**
   * 落盘：先尝试整份写 localStorage；放不下则把较旧的记录搬到 IndexedDB。
   * 记录只序列化一次（parts），按后缀累加算能放下多少把。
   * 返回 {ok, tiered, localCount, idbCount, message}
   */
  async function persist(payload, settings) {
    const solves = Array.isArray(payload && payload.solves) ? payload.solves : [];
    const name = (payload && payload.name) || '训练数据';
    writeSettings(settings || {});

    const n = solves.length;
    const parts = new Array(n);
    for (let i = 0; i < n; i++) parts[i] = JSON.stringify(solves[i]);
    const head = '{"name":' + JSON.stringify(name) + ',"solves":[';
    const tail = ']}';

    // 从最新往回累加，尽量多留在 localStorage
    let acc = head.length + tail.length, keep = 0;
    for (let i = n - 1; i >= 0; i--) {
      const add = parts[i].length + (keep ? 1 : 0);
      if (acc + add > BUDGET) break;
      acc += add; keep++;
    }
    if (keep === n) acc = head.length + parts.reduce((a, p, i) => a + p.length + (i ? 1 : 0), 0) + tail.length;

    function writeLocal(k) {
      const slice = parts.slice(n - k);
      const body = slice.join(',');
      const json = k
        ? head + body + (k < n ? '],"overflowCount":' + (n - k) + '}' : tail)
        : '{"name":' + JSON.stringify(name) + ',"overflowCount":' + n + ',"solves":[]}';
      try { localStorage.setItem(STORAGE_KEY, json); return { ok: true, bytes: json.length }; }
      catch (e) { return { ok: false, bytes: 0 }; }
    }

    let written = writeLocal(keep);
    // 其它站点数据挤占导致仍写不下：继续缩小本地窗口重试
    while (!written.ok && keep > 0) {
      keep = Math.floor(keep / 2);
      written = writeLocal(keep);
    }
    if (!written.ok) {
      return { ok: false, tiered: false, localCount: 0, idbCount: 0, message: '浏览器本地存储不可用' };
    }

    const overflow = solves.slice(0, n - keep);
    const overflowIds = new Set(overflow.map(s => String(s.id)));
    let idbCount = 0;
    try {
      // IDB 同步串行化：避免并发 persist 互相覆盖 idbIds 集合
      idbQueue = idbQueue.then(async () => {
        if (overflow.length) {
          const toAdd = overflow.filter(s => !idbIds.has(String(s.id)));
          const toDel = [...idbIds].filter(id => !overflowIds.has(id));
          await idbPut(toAdd);
          await idbDelete(toDel);
        } else if (idbIds.size) {
          // 数据缩回到放得下：清掉 IndexedDB 副本，避免两份不一致
          await idbClear();
        }
        idbIds = overflowIds;
      });
      await idbQueue;
      idbCount = overflow.length;
    } catch (e) {
      idbBroken = true;
      console.error('[AnalyzerStore] IndexedDB 写入失败', e);
      idbQueue = Promise.resolve();
      // 旧记录没能搬进去 ⇒ 如实告知，绝不能让用户以为已经保存
      if (overflow.length) {
        return {
          ok: false, tiered: false, localCount: keep, idbCount: 0,
          message: `本地空间不足，且有 ${overflow.length} 条较早记录无法写入扩展存储`
        };
      }
    }

    cache = { name, solves };
    hydrated = true;
    return {
      ok: true,
      tiered: overflow.length > 0,
      localCount: keep,
      idbCount,
      message: overflow.length
        ? `已保存：最近 ${keep} 把在本机，较早 ${overflow.length} 把存放在扩展存储`
        : ''
    };
  }

  /** 只读 localStorage（同步、必定可用）：用于首屏立即渲染 */
  function loadSync() {
    const local = readLocal();
    const solves = Array.isArray(local && local.solves) ? local.solves : [];
    return {
      payload: { name: (local && local.name) || '训练数据', solves },
      settings: readSettings(),
      partial: !!(local && local.overflowCount)
    };
  }

  /** 完整加载：localStorage + IndexedDB 合并还原 */
  async function loadAll() {
    const sync = loadSync();
    let idbSolves = [];
    try {
      idbSolves = await idbGetAll();
      idbIds = new Set(idbSolves.map(s => String(s.id)));
    } catch (e) {
      idbBroken = true;
      console.warn('[AnalyzerStore] IndexedDB 读取失败，仅使用本机数据', e);
    }
    const byId = new Map();
    idbSolves.forEach(s => { if (s && s.id != null) byId.set(String(s.id), s); });
    sync.payload.solves.forEach(s => { if (s && s.id != null) byId.set(String(s.id), s); });
    const solves = [...byId.values()].sort((a, b) => new Date(a.date) - new Date(b.date));
    cache = { name: sync.payload.name, solves };
    hydrated = true;
    return {
      payload: cache,
      settings: sync.settings,
      localCount: sync.payload.solves.length,
      idbCount: idbSolves.length,
      partial: false
    };
  }

  /** 云同步 / 导出用：必须是完整记录集，未水合完成时返回 null 让调用方等待 */
  function getFullPayload() {
    if (!hydrated || !cache) return null;
    return { name: cache.name, solves: cache.solves };
  }

  function isHydrated() { return hydrated; }
  function isTiered() { return idbIds.size > 0; }
  function idbUnavailable() { return idbBroken; }
  function stats() {
    const local = readLocal();
    return {
      localCount: Array.isArray(local && local.solves) ? local.solves.length : 0,
      idbCount: idbIds.size,
      hydrated,
      tiered: idbIds.size > 0,
      idbBroken
    };
  }

  async function clearAll() {
    try { await idbClear(); } catch (e) { /* 忽略：下面还会覆盖 localStorage */ }
    idbIds = new Set();
    cache = { name: '训练数据', solves: [] };
    hydrated = true;
  }

  // 尽力申请持久化存储：降低浏览器在磁盘紧张时回收 IndexedDB 的概率（失败无副作用，不影响功能）
  try {
    if (navigator.storage && typeof navigator.storage.persist === 'function') {
      navigator.storage.persisted()
        .then(already => { if (!already) return navigator.storage.persist(); })
        .catch(() => {});
    }
  } catch (e) { /* 忽略 */ }

  window.CubeAnalyzerStore = {
    STORAGE_KEY, SETTINGS_KEY,
    persist, loadSync, loadAll, getFullPayload, clearAll,
    isHydrated, isTiered, idbUnavailable, stats,
    readSettings
  };
})();

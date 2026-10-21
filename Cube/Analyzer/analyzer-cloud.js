(() => {
  'use strict';

  const STORAGE_KEY = 'cubeAnalyzerDataV2';
  const SETTINGS_KEY = 'cubeAnalyzerSettingsV2';
  let syncTimer = null;

  function scope() {
    return window.getCurrentSiteScope ? window.getCurrentSiteScope() : 'Cube-Analyzer';
  }
  function basePath() {
    return window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : '/Cube/Analyzer';
  }
  function getLocal(key, fallback) {
    try {
      // 训练记录可能被分层存放在 IndexedDB，Store 持有完整记录集缓存；
      // 云同步/导出必须拿到「全部记录」，否则云端备份会缺掉较早的那部分。
      // 未水合完成时 getFullPayload() 返回 null ⇒ 退到同步镜像（不是全量），
      // 调用方必须用 isFullyHydrated() 判一下再决定能不能上传。
      if (key === STORAGE_KEY && window.CubeAnalyzerStore) {
        const full = window.CubeAnalyzerStore.getFullPayload();
        if (full) return full;
        const sync = window.CubeAnalyzerStore.loadSync();
        return { name: sync.payload.name, solves: sync.payload.solves };
      }
      if (window.storageManager && typeof window.storageManager.getJson === 'function') return window.storageManager.getJson(key, fallback);
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  /** 本地记录集是否为「完整集合」（镜像 + 扩展存储都已合并） */
  function isFullyHydrated() {
    if (!window.CubeAnalyzerStore) return true;
    return !!window.CubeAnalyzerStore.getFullPayload();
  }
  function setLocal(key, value) {
    // 训练记录统一由 CubeAnalyzerStore 分层落盘，这里不再直接覆盖，避免绕过分层把完整数据挤爆
    if (key === STORAGE_KEY && window.CubeAnalyzerStore) return;
    if (window.storageManager && typeof window.storageManager.setJson === 'function') window.storageManager.setJson(key, value);
    else localStorage.setItem(key, JSON.stringify(value));
  }

  /** 业务字段的非空计数（meta 自身不参与） */
  function countDataFields(data) {
    let n = 0;
    Object.keys(data || {}).forEach(k => {
      if (k === 'meta') return;
      const v = data[k];
      if (v == null) return;
      if (Array.isArray(v)) { if (v.length) n++; return; }
      if (typeof v === 'object') { if (Object.keys(v).length) n++; return; }
      if (v !== '') n++;
    });
    return n;
  }

  /**
   * 指纹块：随 payload 一起上传，云端只需 select data->meta 几百字节
   * 就能判断「数据变没变」「有多少条记录」，不必下载整份数据
   */
  function buildMeta(data, solveCount) {
    let bytes = 0;
    try { bytes = JSON.stringify(data).length; } catch (e) { bytes = 0; }
    return {
      bytes,
      items: countDataFields(data),
      solves: Number(solveCount) || 0,
      hash: typeof window._siteNavPayloadHash === 'function' ? window._siteNavPayloadHash(data) : ''
    };
  }

  /** 云端 data 块统一解包：压缩壳解回明文，旧明文原样返回；缺 codec 时退回原样 */
  function unpackCloudData(data) {
    if (window.SitePayloadCodec && typeof window.SitePayloadCodec.unpackPayloadData === 'function') {
      return window.SitePayloadCodec.unpackPayloadData(data);
    }
    return Promise.resolve(data);
  }
  /**
   * getCloudStatus full 的解包：row['data'] 是 payload 层（cloudData 语义），
   * 壳在 payload.data —— 只对壳解包并放回 data 位，其它结构原样
   */
  function unpackCloudStatusPayload(cloudPayload) {
    if (window.SitePayloadCodec && typeof window.SitePayloadCodec.isCompressedPayloadData === 'function' &&
        window.SitePayloadCodec.isCompressedPayloadData(cloudPayload && cloudPayload.data)) {
      return window.SitePayloadCodec.unpackPayloadData(cloudPayload.data).then(plain =>
        Object.assign({}, cloudPayload, { data: plain }));
    }
    return Promise.resolve(cloudPayload);
  }
  /** 上传前打包：压缩 payload.data（meta 保持壳顶层明文）；不支持压缩时原样返回 */
  function packLocalPayload(payload) {
    if (window.SitePayloadCodec && typeof window.SitePayloadCodec.packPayload === 'function') {
      return window.SitePayloadCodec.packPayload(payload);
    }
    return Promise.resolve(payload);
  }

  const manager = {
    isReady() {
      return !!(scope() && window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
    },
    buildLocalPayload() {
      const data = {
        cubeAnalyzerData: getLocal(STORAGE_KEY, { name: '训练数据', solves: [] }),
        cubeAnalyzerSettings: getLocal(SETTINGS_KEY, {})
      };
      const solves = Array.isArray(data.cubeAnalyzerData && data.cubeAnalyzerData.solves) ? data.cubeAnalyzerData.solves.length : 0;
      data.meta = buildMeta(data, solves);
      return {
        exportedAt: new Date().toISOString(),
        source: 'Ckarefulon',
        siteScope: scope(),
        siteBasePath: basePath(),
        version: 7,
        data
      };
    },
    async getCloudStatus(opts) {
      const light = !!(opts && opts.light);
      if (!manager.isReady()) return { success:false, message:'请先登录', hasData:false, cloudData:null };
      try {
        const user = window.authManager.getUser();
        const query = cols => window.supabaseClient.from('user_data').select(cols).eq('user_id', user.id).eq('site_scope', scope()).maybeSingle();
        let result = await query(light ? 'updated_at,top_meta:data->meta,inner_meta:data->data->meta' : 'data, updated_at');
        if (light && result.error) {
          // 轻量投影不被支持 ⇒ 退回完整查询，宁可这次多传点，也不能让状态检查直接失败
          console.warn('[AnalyzerCloud] 轻量投影不可用，回退完整查询', result.error.message || result.error);
          result = await query('data, updated_at');
          if (result.error) return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
          if (!result.data) return { success:true, message:'云端暂无数据', hasData:false, cloudData:null };
          return unpackCloudStatusPayload(result.data.data).then(plain =>
            ({ success:true, message:'云端已有数据', hasData:true, cloudData:plain, updatedAt:result.data.updated_at }));
        }
        if (result.error) return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
        if (!result.data) return { success:true, message:'云端暂无数据', hasData:false, cloudData:null };
        if (light) {
          const row = result.data || {};
          // 双投影兼容：压缩格式 meta 在 payload 顶层（top_meta）；旧明文格式在 payload.data.meta（inner_meta）
          const meta = (row.top_meta !== undefined && row.top_meta !== null) ? row.top_meta
            : (row.inner_meta !== undefined && row.inner_meta !== null) ? row.inner_meta
            : ((row.meta !== undefined ? row.meta : (row.data && row.data.meta)) || null);
          return { success:true, message:'云端已有数据', hasData:true, light:true, cloudMeta:meta, updatedAt:row.updated_at, cloudData:null };
        }
        return unpackCloudStatusPayload(result.data.data).then(plain =>
          ({ success:true, message:'云端已有数据', hasData:true, cloudData:plain, updatedAt:result.data.updated_at }));
      } catch (e) {
        console.error('[AnalyzerCloud] get status failed', e);
        return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
      }
    },
    // 从状态结果里取云端记录条数（轻量模式走指纹块，回退模式才解析整份数据）
    cloudSolveCount(status) {
      if (status && status.cloudMeta && typeof status.cloudMeta.solves === 'number') return status.cloudMeta.solves;
      const d = status && status.cloudData && status.cloudData.data && status.cloudData.data.cubeAnalyzerData;
      return Array.isArray(d && d.solves) ? d.solves.length : 0;
    },
    // 云端是否存有有意义的训练数据（solves 非空数组）
    cloudHasMeaningfulData(cloudData) {
      const d = cloudData && cloudData.data && cloudData.data.cubeAnalyzerData;
      return !!(d && Array.isArray(d.solves) && d.solves.length > 0);
    },
    /**
     * 本机记录缺失时的补齐：扩展存储被浏览器回收、或换设备后只带回来一部分时，
     * 只把「本机确实没有的那几条」从云端并回来，绝不整份覆盖本机。
     * 返回 {success, recovered, message}
     */
    async recoverMissingFromCloud() {
      if (!manager.isReady()) return { success:false, recovered:0, message:'请先登录' };
      if (!window.CubeAnalyzerStore) return { success:false, recovered:0, message:'本机存储模块不可用' };
      try {
        await window.CubeAnalyzerStore.ready();
        const localPayload = window.CubeAnalyzerStore.getFullPayload();
        if (!localPayload) return { success:false, recovered:0, message:'本机数据尚未加载完成' };
        const have = new Set(localPayload.solves.map(s => String(s && s.id)));
        const status = await manager.getCloudStatus();
        if (!status.success || !status.hasData) return { success:false, recovered:0, message:'云端暂无可补齐的数据' };
        const cd = status.cloudData && status.cloudData.data && status.cloudData.data.cubeAnalyzerData;
        const cloudSolves = Array.isArray(cd && cd.solves) ? cd.solves : [];
        const missing = cloudSolves.filter(s => s && s.id != null && !have.has(String(s.id)));
        if (!missing.length) return { success:true, recovered:0, message:'' };
        // 只 upsert 缺的那几条（persist 不删任何已有记录）
        await window.CubeAnalyzerStore.persist({ name: localPayload.name || '训练数据', solves: missing }, {});
        await window.CubeAnalyzerStore.flush();
        console.warn('[AnalyzerCloud] 已从云端补齐', missing.length, '条本机缺失记录');
        return { success:true, recovered:missing.length, message:`已从云端补齐 ${missing.length} 条本机缺失记录` };
      } catch (e) {
        console.error('[AnalyzerCloud] 补齐失败', e);
        return { success:false, recovered:0, message:'从云端补齐失败' };
      }
    },
    async uploadLocalToCloud() {
      if (!manager.isReady()) return { success:false, message:'请先登录' };
      try {
        const user = window.authManager.getUser();
        // 没有完整本地记录集就绝不上传：镜像只是「最近的若干把」，
        // 拿它覆盖云端等于把较早的记录从备份里删掉（这正是计数变少的一半来源）。
        if (window.CubeAnalyzerStore && !isFullyHydrated()) {
          try { await window.CubeAnalyzerStore.ready(); } catch (e) { /* 下面还会再判一次 */ }
          if (!isFullyHydrated()) return { success:false, message:'本机数据尚未加载完成，已暂缓上传' };
        }
        // 覆盖闸门（唯一咽喉，scheduleUpload 与 nav 手动/卸载上传都从这里过）：
        // 本地记录数少于云端 ⇒ 拒绝上传（过期/损坏的本地状态不得覆盖云端备份）。
        // 显式场景（清空按钮）用 allowCountRegressionOnce 放行一次。
        const local = getLocal(STORAGE_KEY, null);
        const localSolves = local && Array.isArray(local.solves) ? local.solves.length : 0;
        let countWarning = '';
        if (!manager.allowCountRegressionOnce) {
          // 只取 updated_at + 指纹（几百字节）就能拿到云端条数，不再为「数条数」下载整份数据
          let status = await manager.getCloudStatus({ light: true });
          if (status.success && status.hasData && !status.cloudMeta) {
            // 云端是旧的、还没有指纹块的数据 ⇒ 退回完整查询
            status = await manager.getCloudStatus();
          }
          if (status.success && status.hasData) {
            const cloudSolves = manager.cloudSolveCount(status);
            if (cloudSolves > localSolves) {
              // 警示但不阻止：本地少于云端可能是有意删除，覆盖权在用户。
              // 注意：自动上传不产生云端历史版本，覆盖后旧备份不可恢复，只做提醒不做拦截。
              countWarning = localSolves === 0
                ? `本地暂无训练记录，已按本地上传并覆盖云端 ${cloudSolves} 条备份（若非有意清空请留意）`
                : `本地 ${localSolves} 条少于云端 ${cloudSolves} 条，已按本地上传（若非有意删除请留意）`;
              console.warn('[AnalyzerCloud]', countWarning);
            }
          } else if (!status.success && localSolves === 0) {
            // 云端状态查不到且本地为空：无法证明覆盖是安全的，宁可不上
            return { success:false, message:'无法确认云端状态，已阻止空数据上传', blocked:true };
          }
        }
        manager.allowCountRegressionOnce = false;
        const packed = await packLocalPayload(manager.buildLocalPayload());
        const result = await window.supabaseClient.from('user_data').upsert({
          user_id:user.id,
          site_scope:scope(),
          data:packed,
          updated_at:new Date().toISOString()
        }, { onConflict:'user_id,site_scope' });
        if (result.error) return { success:false, message:'上传失败，请稍后重试' };
        if (typeof window._siteNavMarkAsSynced === 'function') window._siteNavMarkAsSynced();
        return countWarning
          ? { success:true, message:'已同步到云端 · ' + countWarning, warning:true }
          : { success:true, message:'已同步到云端' };
      } catch (e) {
        console.error('[AnalyzerCloud] upload failed', e);
        return { success:false, message:'上传失败，请稍后重试' };
      }
    },
    /**
     * 把云端 data 块写回本机。
     * 走 Store.replaceAll：这是一次「整份覆盖」（云端恢复 / 本地备份导入 / 回滚），
     * 允许连同扩展存储一起重置；完成后必须 await，调用方才能立刻重载到新数据。
     */
    async applyDataToLocalStorage(dataBlock) {
      if (!dataBlock || typeof dataBlock !== 'object') return {};
      window._siteNavApplyingCloudData = true;
      const applied = {};
      try {
        if (dataBlock.cubeAnalyzerData !== undefined) {
          const cd = dataBlock.cubeAnalyzerData || {};
          const solves = Array.isArray(cd.solves) ? cd.solves : [];
          if (window.CubeAnalyzerStore && Array.isArray(cd.solves)) {
            await window.CubeAnalyzerStore.replaceAll(
              { name: cd.name || '训练数据', solves },
              dataBlock.cubeAnalyzerSettings || {}
            );
          } else {
            setLocal(STORAGE_KEY, dataBlock.cubeAnalyzerData);
          }
          applied.cubeAnalyzerData = true;
        }
        if (dataBlock.cubeAnalyzerSettings !== undefined) { setLocal(SETTINGS_KEY, dataBlock.cubeAnalyzerSettings); applied.cubeAnalyzerSettings = true; }
        return applied;
      } finally {
        setTimeout(() => { window._siteNavApplyingCloudData = false; }, 0);
      }
    },
    async downloadCloudToLocal() {
      if (!manager.isReady()) return { success:false, message:'请先登录', data:null };
      try {
        const user = window.authManager.getUser();
        const result = await window.supabaseClient.from('user_data').select('data').eq('user_id', user.id).eq('site_scope', scope()).maybeSingle();
        if (result.error) return { success:false, message:'读取云端数据失败', data:null };
        if (!result.data || !result.data.data || !result.data.data.data) return { success:false, message:'云端暂无数据', data:null };
        const dataBlock = await unpackCloudData(result.data.data.data);
        if (!dataBlock || typeof dataBlock !== 'object') return { success:false, message:'云端数据格式不正确', data:null };
        if (typeof window._siteNavPrepareOverwrite === 'function') {
          const guard = window._siteNavPrepareOverwrite('云端数据恢复', dataBlock);
          if (!guard.success) return { success:false, message:guard.message, data:null };
        }
        await manager.applyDataToLocalStorage(dataBlock);
        // 恢复后必须让 Store 的完整集合缓存被重建，否则紧接着的导出/上传仍拿旧缓存
        if (window.CubeAnalyzerStore && window.CubeAnalyzerStore.flush) { try { await window.CubeAnalyzerStore.flush(); } catch (e) {} }
        return { success:true, message:'恢复成功', data:dataBlock };
      } catch (e) {
        console.error('[AnalyzerCloud] download failed', e);
        return { success:false, message:'恢复失败，请稍后重试', data:null };
      }
    },
    scheduleUpload(delay = 900) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(async () => {
        if (!manager.isReady()) return;
        // 空数据/条数回退的防护已下沉到 uploadLocalToCloud（唯一咽喉，nav 手动/卸载路径同样受保护）
        if (typeof window._siteNavSetCloudStatus === 'function') window._siteNavSetCloudStatus('正在自动保存...', '');
        const result = await manager.uploadLocalToCloud();
        if (typeof window._siteNavSetCloudStatus === 'function') {
          const style = result.success ? (result.warning ? 'Warning' : 'Success') : 'Error';
          window._siteNavSetCloudStatus(result.success ? (result.warning ? result.message : '已自动保存到云端') : result.message, style);
        }
        window.dispatchEvent(new CustomEvent('cube-analyzer-cloud-sync', { detail:result }));
      }, delay);
    },
    allowEmptyUploadOnce: false,
    allowCountRegressionOnce: false,
    storageKey: STORAGE_KEY,
    settingsKey: SETTINGS_KEY
  };

  window.cloudSyncManager = manager;
  window.CubeAnalyzerCloud = manager;
})();

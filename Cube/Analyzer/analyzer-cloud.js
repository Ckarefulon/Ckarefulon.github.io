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
      if (window.storageManager && typeof window.storageManager.getJson === 'function') return window.storageManager.getJson(key, fallback);
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function setLocal(key, value) {
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
        let result = await query(light ? 'updated_at,data->meta' : 'data, updated_at');
        if (light && result.error) {
          // 轻量投影不被支持 ⇒ 退回完整查询，宁可这次多传点，也不能让状态检查直接失败
          console.warn('[AnalyzerCloud] 轻量投影不可用，回退完整查询', result.error.message || result.error);
          result = await query('data, updated_at');
          if (result.error) return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
          if (!result.data) return { success:true, message:'云端暂无数据', hasData:false, cloudData:null };
          return { success:true, message:'云端已有数据', hasData:true, cloudData:result.data.data, updatedAt:result.data.updated_at };
        }
        if (result.error) return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
        if (!result.data) return { success:true, message:'云端暂无数据', hasData:false, cloudData:null };
        if (light) {
          const row = result.data || {};
          const meta = row.meta !== undefined ? row.meta : ((row.data && row.data.meta) || null);
          return { success:true, message:'云端已有数据', hasData:true, light:true, cloudMeta:meta, updatedAt:row.updated_at, cloudData:null };
        }
        return { success:true, message:'云端已有数据', hasData:true, cloudData:result.data.data, updatedAt:result.data.updated_at };
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
    async uploadLocalToCloud() {
      if (!manager.isReady()) return { success:false, message:'请先登录' };
      try {
        const user = window.authManager.getUser();
        // 覆盖闸门（唯一咽喉，scheduleUpload 与 nav 手动/卸载上传都从这里过）：
        // 本地记录数少于云端 ⇒ 拒绝上传（过期/损坏的本地状态不得覆盖云端备份）。
        // 显式场景（清空按钮）用 allowCountRegressionOnce 放行一次。
        const local = getLocal(STORAGE_KEY, null);
        const localSolves = local && Array.isArray(local.solves) ? local.solves.length : 0;
        if (!manager.allowCountRegressionOnce) {
          // 只取 updated_at + data->meta（几百字节）就能拿到云端条数，不再为「数条数」下载整份数据
          let status = await manager.getCloudStatus({ light: true });
          if (status.success && status.hasData && !status.cloudMeta) {
            // 云端是旧的、还没有指纹块的数据 ⇒ 退回完整查询，保证闸门语义不弱化
            status = await manager.getCloudStatus();
          }
          if (status.success && status.hasData) {
            const cloudSolves = manager.cloudSolveCount(status);
            if (cloudSolves > localSolves) {
              const msg = localSolves === 0
                ? '本地暂无训练记录，已阻止上传（保护云端备份）'
                : `本地 ${localSolves} 条少于云端 ${cloudSolves} 条，已阻止自动覆盖（保护云端备份）`;
              console.warn('[AnalyzerCloud]', msg);
              return { success:false, message:msg, blocked:true };
            }
          } else if (!status.success && localSolves === 0) {
            // 云端状态查不到且本地为空：无法证明覆盖是安全的，宁可不上
            return { success:false, message:'无法确认云端状态，已阻止空数据上传', blocked:true };
          }
        }
        manager.allowCountRegressionOnce = false;
        const result = await window.supabaseClient.from('user_data').upsert({
          user_id:user.id,
          site_scope:scope(),
          data:manager.buildLocalPayload(),
          updated_at:new Date().toISOString()
        }, { onConflict:'user_id,site_scope' });
        if (result.error) return { success:false, message:'上传失败，请稍后重试' };
        if (typeof window._siteNavMarkAsSynced === 'function') window._siteNavMarkAsSynced();
        return { success:true, message:'已同步到云端' };
      } catch (e) {
        console.error('[AnalyzerCloud] upload failed', e);
        return { success:false, message:'上传失败，请稍后重试' };
      }
    },
    applyDataToLocalStorage(dataBlock) {
      if (!dataBlock || typeof dataBlock !== 'object') return {};
      window._siteNavApplyingCloudData = true;
      const applied = {};
      try {
        if (dataBlock.cubeAnalyzerData !== undefined) { setLocal(STORAGE_KEY, dataBlock.cubeAnalyzerData); applied.cubeAnalyzerData = true; }
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
        const dataBlock = result.data.data.data;
        if (typeof window._siteNavPrepareOverwrite === 'function') {
          const guard = window._siteNavPrepareOverwrite('云端数据恢复', dataBlock);
          if (!guard.success) return { success:false, message:guard.message, data:null };
        }
        manager.applyDataToLocalStorage(dataBlock);
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
        if (typeof window._siteNavSetCloudStatus === 'function') window._siteNavSetCloudStatus(result.success ? '已自动保存到云端' : result.message, result.success ? 'Success' : 'Error');
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

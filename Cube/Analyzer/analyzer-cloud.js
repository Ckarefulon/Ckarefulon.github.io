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

  const manager = {
    isReady() {
      return !!(scope() && window.supabaseClient && window.authManager && window.authManager.isLoggedIn());
    },
    buildLocalPayload() {
      return {
        exportedAt: new Date().toISOString(),
        source: 'Ckarefulon',
        siteScope: scope(),
        siteBasePath: basePath(),
        version: 7,
        data: {
          cubeAnalyzerData: getLocal(STORAGE_KEY, { name: '训练数据', solves: [] }),
          cubeAnalyzerSettings: getLocal(SETTINGS_KEY, {})
        }
      };
    },
    async getCloudStatus() {
      if (!manager.isReady()) return { success:false, message:'请先登录', hasData:false, cloudData:null };
      try {
        const user = window.authManager.getUser();
        const result = await window.supabaseClient.from('user_data').select('data, updated_at').eq('user_id', user.id).eq('site_scope', scope()).maybeSingle();
        if (result.error) return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
        if (!result.data) return { success:true, message:'云端暂无数据', hasData:false, cloudData:null };
        return { success:true, message:'云端已有数据', hasData:true, cloudData:result.data.data, updatedAt:result.data.updated_at };
      } catch (e) {
        console.error('[AnalyzerCloud] get status failed', e);
        return { success:false, message:'查询云端状态失败', hasData:false, cloudData:null };
      }
    },
    async uploadLocalToCloud() {
      if (!manager.isReady()) return { success:false, message:'请先登录' };
      try {
        const user = window.authManager.getUser();
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
        if (typeof window._siteNavSetCloudStatus === 'function') window._siteNavSetCloudStatus('正在自动保存...', '');
        const result = await manager.uploadLocalToCloud();
        if (typeof window._siteNavSetCloudStatus === 'function') window._siteNavSetCloudStatus(result.success ? '已自动保存到云端' : result.message, result.success ? 'Success' : 'Error');
        window.dispatchEvent(new CustomEvent('cube-analyzer-cloud-sync', { detail:result }));
      }, delay);
    },
    storageKey: STORAGE_KEY,
    settingsKey: SETTINGS_KEY
  };

  window.cloudSyncManager = manager;
  window.CubeAnalyzerCloud = manager;
})();

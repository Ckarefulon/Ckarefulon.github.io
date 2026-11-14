(() => {
  'use strict';

  const STORAGE_KEY = 'cubeAnalyzerDataV2';
  const SETTINGS_KEY = 'cubeAnalyzerSettingsV2';
  // 「本地少于云端」与「本地不足 10 条」这两类覆盖必须由用户二次确认；
  // 确认过的最小条数记在本机（按站点作用域分开存），避免每加一把就重复弹窗，
  // 只有记录继续变少才再问一次。
  const OVERWRITE_CONFIRM_PREFIX = 'cubeAnalyzerOverwriteConfirmV1:';
  const SMALL_DATASET = 10;
  let syncTimer = null;

  function confirmKey() {
    return OVERWRITE_CONFIRM_PREFIX + encodeURIComponent(scope());
  }
  function getConfirmedFloor() {
    try {
      const raw = JSON.parse(localStorage.getItem(confirmKey()) || 'null');
      const n = Number(raw && raw.count);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch (e) { return 0; }
  }
  function setConfirmedFloor(n) {
    try {
      const count = Number(n) || 0;
      if (count > 0) localStorage.setItem(confirmKey(), JSON.stringify({ count, at: Date.now() }));
      else localStorage.removeItem(confirmKey());
    } catch (e) { /* 记不住就下次再问，不影响正确性 */ }
  }

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
     *
     * 2026-11-14 补一条：补齐只该发生在「本机是真的丢了」，不该发生在「用户明确删过」。
     * 两层的判据都不够，所以并回之后**不写回云端**：云端仍是用户删过之后的版本，
     * 下次上传时这些被删的记录才真正离开备份（而不是被本机自愈逻辑复活）。
     */
    async recoverMissingFromCloud() {
      if (!manager.isReady()) return { success:false, recovered:0, message:'请先登录' };
      if (!window.CubeAnalyzerStore) return { success:false, recovered:0, message:'本机存储模块不可用' };
      try {
        await window.CubeAnalyzerStore.ready();
        const localPayload = window.CubeAnalyzerStore.getFullPayload();
        if (!localPayload) return { success:false, recovered:0, message:'本机数据尚未加载完成' };
        // 补齐前先把扩展存储里本进程不认识的记录并进来，别把「其实还在」的记录当成缺失再补一遍
        if (typeof window.CubeAnalyzerStore.syncFromTier === 'function') {
          try { await window.CubeAnalyzerStore.syncFromTier(); } catch (e) {}
        }
        const current = window.CubeAnalyzerStore.getFullPayload() || localPayload;
        const have = new Set(current.solves.map(s => String(s && s.id)));
        const status = await manager.getCloudStatus();
        if (!status.success || !status.hasData) return { success:false, recovered:0, message:'云端暂无可补齐的数据' };
        const cd = status.cloudData && status.cloudData.data && status.cloudData.data.cubeAnalyzerData;
        const cloudSolves = Array.isArray(cd && cd.solves) ? cd.solves : [];
        const missing = cloudSolves.filter(s => s && s.id != null && !have.has(String(s.id)));
        if (!missing.length) return { success:true, recovered:0, message:'' };
        // 只 upsert 缺的那几条（persist 不删任何已有记录）
        await window.CubeAnalyzerStore.persist({ name: current.name || '训练数据', solves: missing }, {});
        await window.CubeAnalyzerStore.flush();
        console.warn('[AnalyzerCloud] 已从云端补齐', missing.length, '条本机缺失记录');
        return { success:true, recovered:missing.length, message:`已从云端补齐 ${missing.length} 条本机缺失记录` };
      } catch (e) {
        console.error('[AnalyzerCloud] 补齐失败', e);
        return { success:false, recovered:0, message:'从云端补齐失败' };
      }
    },
    /**
     * 覆盖闸门（唯一咽喉，scheduleUpload 与 nav 手动/卸载上传都从这里过）。
     *
     * 2026-11-14 收紧：以下三种「本地覆盖云端」一律**不再自动执行**，改为要求用户二次确认：
     *   a) 本地条数少于云端（覆盖后云端备份里那些记录就没了，且云端无历史版本可退）；
     *   b) 本机记录不足 10 条（小样本覆盖大备份风险最高，也最容易是「扩展存储被清掉」的症状）；
     *   c) 云端状态查不到且本地为空（无法证明覆盖是安全的）。
     * 返回 needsConfirm 时调用方必须以 force:true 再调一次（= 用户点过确认）。
     * 清空按钮这类显式操作走 allowEmptyUploadOnce / allowCountRegressionOnce 直接放行一次。
     */
    async overwriteGate(localSolves) {
      const confirmedFloor = getConfirmedFloor();
      if (manager.allowCountRegressionOnce) return { blocked: false, warning: '' };
      let status = await manager.getCloudStatus({ light: true });
      if (status.success && status.hasData && !status.cloudMeta) {
        // 云端是旧的、还没有指纹块的数据 ⇒ 退回完整查询
        status = await manager.getCloudStatus();
      }
      if (!status.success) {
        // 云端状态查不到：无法证明覆盖是安全的
        if (localSolves === 0) {
          return { blocked: true, needsConfirm: false, message: '无法确认云端状态，已阻止空数据上传' };
        }
        if (localSolves < SMALL_DATASET && !(confirmedFloor > 0 && localSolves >= confirmedFloor)) {
          return {
            blocked: true, needsConfirm: true,
            localSolves, cloudSolves: null,
            reason: `云端状态暂时查不到，本机只有 ${localSolves} 条记录`,
            message: `云端状态暂时查不到，无法确认这次上传会不会覆盖掉更大的备份（本机 ${localSolves} 条）`
          };
        }
        return { blocked: false, warning: '' };
      }
      if (!status.hasData) {
        // 云端本来就没有备份 ⇒ 首次上传，不构成覆盖
        return { blocked: false, warning: '' };
      }
      const cloudSolves = manager.cloudSolveCount(status);
      const reasons = [];
      if (cloudSolves > localSolves) {
        reasons.push(`本地 ${localSolves} 条少于云端 ${cloudSolves} 条`);
      }
      if (localSolves < SMALL_DATASET && cloudSolves > 0) {
        // 云端有训练记录、本机却不足 10 条：最像「扩展存储被清掉」的症状，必须问一次
        reasons.push(`本机只有 ${localSolves} 条记录（不足 ${SMALL_DATASET} 条）`);
      }
      if (!reasons.length) return { blocked: false, warning: '' };
      // 已经在同样的条数上确认过（同一份小数据集继续训练），不再反复打扰；
      // 只有记录继续变少（又丢了）才重新问一次
      if (confirmedFloor > 0 && localSolves >= confirmedFloor) {
        return { blocked: false, warning: reasons.join('，') + '，已按本机上传' };
      }
      return {
        blocked: true,
        needsConfirm: true,
        localSolves,
        cloudSolves,
        reason: reasons.join('，'),
        message: `即将用本机 ${localSolves} 条记录覆盖云端的 ${cloudSolves} 条备份（${reasons.join('，')}）`
      };
    },
    /** 只问「这次上传要不要用户二次确认」，不写任何东西（给 nav 的主动上传按钮用） */
    async peekOverwriteGate() {
      if (!manager.isReady()) return { needsConfirm: false };
      try {
        if (window.CubeAnalyzerStore && !isFullyHydrated()) {
          try { await window.CubeAnalyzerStore.ready(); } catch (e) { /* 下面再判 */ }
          if (!isFullyHydrated()) return { needsConfirm: false, pending: true };
        }
        if (window.CubeAnalyzerStore && typeof window.CubeAnalyzerStore.syncFromTier === 'function') {
          try { await window.CubeAnalyzerStore.syncFromTier(); } catch (e) {}
        }
        const local = getLocal(STORAGE_KEY, null);
        const localSolves = local && Array.isArray(local.solves) ? local.solves.length : 0;
        const gate = await manager.overwriteGate(localSolves);
        if (!gate.blocked) return { needsConfirm: false };
        return {
          needsConfirm: !!gate.needsConfirm,
          reason: gate.reason,
          localSolves: gate.localSolves !== undefined ? gate.localSolves : localSolves,
          cloudSolves: gate.cloudSolves !== undefined ? gate.cloudSolves : null,
          message: gate.message
        };
      } catch (e) {
        return { needsConfirm: false };
      }
    },
    async uploadLocalToCloud(opts) {
      const force = !!(opts && opts.force);
      if (!manager.isReady()) return { success:false, message:'请先登录' };
      try {
        const user = window.authManager.getUser();
        // 没有完整本地记录集就绝不上传：镜像只是「最近的若干把」，
        // 拿它覆盖云端等于把较早的记录从备份里删掉（这正是计数变少的一半来源）。
        if (window.CubeAnalyzerStore && !isFullyHydrated()) {
          try { await window.CubeAnalyzerStore.ready(); } catch (e) { /* 下面还会再判一次 */ }
          if (!isFullyHydrated()) {
            return { success:false, needsConfirm:false, message:'本机数据尚未加载完成，已暂缓上传' };
          }
        }
        // 扩展存储里可能还有别的标签页刚写进来、本进程缓存没见过的记录：
        // 并进来再数条数、再上传，否则这一批会被云端备份漏掉。
        if (window.CubeAnalyzerStore && typeof window.CubeAnalyzerStore.syncFromTier === 'function') {
          try { await window.CubeAnalyzerStore.syncFromTier(); } catch (e) { /* 拿现有集合继续 */ }
        }
        const local = getLocal(STORAGE_KEY, null);
        const localSolves = local && Array.isArray(local.solves) ? local.solves.length : 0;
        let countWarning = '';
        if (!force) {
          const gate = await manager.overwriteGate(localSolves);
          if (gate.blocked) {
            if (!gate.needsConfirm) return { success:false, blocked:true, message:gate.message };
            console.warn('[AnalyzerCloud] 已暂缓覆盖上传，等待用户确认：', gate.reason);
            return {
              success: false,
              needsConfirm: true,
              reason: gate.reason,
              // localSolves / cloudSolves 只用于弹窗展示，确认时必须重新取一次真实条数
              localSolves: gate.localSolves,
              cloudSolves: gate.cloudSolves,
              message: gate.message
            };
          }
          countWarning = gate.warning || '';
        }
        // 注意：force 分支不在这里记条数 —— 用户确认的是「那一刻的这份数据」，
        // 而打包前还有 await，期间可能又完成了几把；条数要等真正上路之后再取。
        manager.allowCountRegressionOnce = false;
        const packed = await packLocalPayload(manager.buildLocalPayload());
        const result = await window.supabaseClient.from('user_data').upsert({
          user_id:user.id,
          site_scope:scope(),
          data:packed,
          updated_at:new Date().toISOString()
        }, { onConflict:'user_id,site_scope' });
        if (result.error) return { success:false, message:'上传失败，请稍后重试' };
        // 这次上传已被允许（要么数据量正常、要么用户点过确认）⇒ 记下条数，
        // 之后在同一个量级上继续训练时不再反复弹窗，只有继续变少才再问一次
        setConfirmedFloor(localSolves);
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
        // 空数据/条数回退/小样本覆盖的防护已下沉到 uploadLocalToCloud（唯一咽喉，
        // nav 手动/卸载路径同样受保护）。返回 needsConfirm 时这里**不重试、不绕过**，
        // 只把「需要用户确认」摆到界面上，等用户自己点。
        if (typeof window._siteNavSetCloudStatus === 'function') window._siteNavSetCloudStatus('正在自动保存...', '');
        const result = await manager.uploadLocalToCloud();
        if (result.needsConfirm) {
          console.warn('[AnalyzerCloud] 自动上传已暂停：', result.reason);
          if (typeof window._siteNavSetCloudStatus === 'function') {
            window._siteNavSetCloudStatus(result.message + '，需确认后才上传', 'Warning');
          }
        } else if (typeof window._siteNavSetCloudStatus === 'function') {
          const style = result.success ? (result.warning ? 'Warning' : 'Success') : 'Error';
          window._siteNavSetCloudStatus(result.success ? (result.warning ? result.message : '已自动保存到云端') : result.message, style);
        }
        window.dispatchEvent(new CustomEvent('cube-analyzer-cloud-sync', { detail:result }));
      }, delay);
    },
    allowEmptyUploadOnce: false,
    allowCountRegressionOnce: false,
    // 用户确认「就用本机这份覆盖云端」后调一次：显式授权 + 记下条数下限
    confirmOverwrite(count) {
      manager.allowCountRegressionOnce = true;
      setConfirmedFloor(count);
    },
    getConfirmedFloor,
    smallDatasetThreshold: SMALL_DATASET,
    storageKey: STORAGE_KEY,
    settingsKey: SETTINGS_KEY
  };

  window.cloudSyncManager = manager;
  window.CubeAnalyzerCloud = manager;
})();

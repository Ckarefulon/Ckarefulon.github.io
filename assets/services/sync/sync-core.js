(function() {
	"use strict";

	/**
	 * SyncCore — 全站唯一的云同步内核
	 *
	 * ════════════════════════════════════════════════════════════
	 * 为什么要有这个文件（旧结构的致命伤，逐条对应）
	 * ════════════════════════════════════════════════════════════
	 *
	 * 【致命伤 1】window.cloudSyncManager 是「最后加载者赢」的全局变量
	 *   cloud-sync-manager.js / analyzer-cloud.js / merit-store.js / relay-app.js
	 *   四份实现都往 window.cloudSyncManager 上赋值。nav.js 的手动上传/下载按钮
	 *   只认这一个全局。于是：在 /Study/Focus/ 页面上点「上传」，实际跑的是
	 *   Cube 那份实现（读 cube_memory_progress / smartCubePracticeStats），
	 *   它按当前 scope（Study-Focus）上传 ⇒ 把 Cube 的表单结构写进 Study 的作用域。
	 *   → 本文件：内核只此一份，各站点通过 SyncCore.registerProfile 声明
	 *     「自己读写哪些 key」，不再互相顶掉。
	 *
	 * 【致命伤 2】整份盲写，无版本号
	 *   所有站点都是 upsert(onConflict:'user_id,site_scope') 全量覆盖。
	 *   两个标签页/两台设备同时写，后写的赢，先写的整份消失，且云端无历史。
	 *   → 本文件：走服务端 user_data_save RPC 的 CAS（expected_rev），
	 *     冲突就合并重试，且服务端 AFTER 触发器自动留历史。
	 *
	 * 【致命伤 3】updated_at 用客户端时钟
	 *   new Date().toISOString() 直接进 DB。设备时间不准 ⇒ 先后关系错乱。
	 *   → 本文件：不再写 updated_at，服务端 now() 说了算。
	 *
	 * 【致命伤 4】「本地为空就上传空」把云端备份清掉
	 *   旧逻辑先查云端，本地空且云端有 ⇒ 只弹 Warning 照传。首页/未水合时
	 *   触发一次 scheduleUpload 就能抹掉备份。
	 *   → 本文件：空闸门默认硬拦截。要清空必须显式 allowEmpty / 手动上传确认。
	 *
	 * 【致命伤 5】本地覆盖前快照只存 localStorage，且是单份
	 *   localStorage 配额满就放弃覆盖（还行），但单份快照会被下一次覆盖顶掉，
	 *   跨设备完全无效，云端更是没有任何历史。
	 *   → 本文件：写前强快照（内存环形 + localStorage 兜底）+ 云端自动历史，
	 *     并提供 SyncCore.history() / restoreHistory() 统一入口。
	 *
	 * 【致命伤 6】四套不同的「脏标记 / 自动上传」时序
	 *   各站点自己包 storageManager.setJson、自己防抖，没有任何跨标签页互斥。
	 *   → 本文件：统一 dirty 计数 + 串行化写入队列 + 跨标签页 Web Lock，
	 *     同一时刻只有一个标签页能写同一 scope。
	 *
	 * ════════════════════════════════════════════════════════════
	 * 对外 API（老站点改造只需实现 profile，不改调用方）
	 * ════════════════════════════════════════════════════════════
	 *
	 *   SyncCore.registerProfile(scope, {
	 *     buildPayload()        → { data: {...} }   必需，读本地数据
	 *     applyPayload(data)    → {}                必需，写回本地
	 *     isEmpty(data)         → boolean           可选，空闸门判定
	 *     merge(local, cloud)   → {data, changed}   可选，冲突合并（强烈建议）
	 *     storageKeys           → ['key1', ...]     可选，用于自动监听 dirty
	 *   })
	 *
	 *   await SyncCore.save({ reason, force, allowEmpty })
	 *   await SyncCore.pull({ force })
	 *   await SyncCore.status({ light })
	 *   await SyncCore.history(limit)
	 *   await SyncCore.restoreHistory(id)
	 *   SyncCore.markDirty()
	 *
	 * 兼容：本文件末尾提供 window.cloudSyncManager 门面，转发到 SyncCore，
	 * 让尚未改造的 nav.js 手动按钮在「有 profile」的页面上行为正确。
	 * 没有注册 profile 的页面，门面返回 null —— nav 的按钮会显示「未就绪」，
	 * 而不是像现在这样跑一份错站点的实现。
	 */

	var VERSION = 1;
	var LS_PREFIX = "__syncCore_v1:";
	var SNAPSHOT_RING_MAX = 3;   // 内存环形快照份数
	var AUTO_DEBOUNCE_MS = 1200;

	/* ---------------------------------------------------------------
	 * 运行时状态
	 * ------------------------------------------------------------- */
	var state = {
		profiles: {},          // scope -> profile
		ready: false,
		deviceId: null,
		busy: false,
		dirtyScopes: {},
		autoTimers: {},
		inFlight: null,        // 串行化写入队列
		lastError: null,
		snapshots: {},         // scope -> [snapshot, ...]（内存环形）
		lockWarned: false
	};

	/* ---------------------------------------------------------------
	 * 工具
	 * ------------------------------------------------------------- */
	function nowIso() {
		return new Date().toISOString();
	}

	function isPlainObject(v) {
		return !!v && typeof v === "object" && !Array.isArray(v);
	}

	function cloneJson(v) {
		try {
			return JSON.parse(JSON.stringify(v));
		} catch (e) {
			return v;
		}
	}

	/**
	 * 稳定序列化 + 双 FNV 指纹。
	 * 与 nav.js 的 _siteNavPayloadHash 口径一致（对象键排序、跳过顶层 meta），
	 * 这样旧逻辑算出来的 hash 与新内核算的能对上，不需要迁移已有 lastSyncedHash。
	 */
	function stableStringify(value) {
		if (value === null || typeof value !== "object") return JSON.stringify(value);
		if (Array.isArray(value)) {
			var arr = [];
			for (var i = 0; i < value.length; i++) arr.push(stableStringify(value[i]));
			return "[" + arr.join(",") + "]";
		}
		var keys = Object.keys(value).sort();
		var parts = [];
		for (var j = 0; j < keys.length; j++) {
			parts.push(JSON.stringify(keys[j]) + ":" + stableStringify(value[keys[j]]));
		}
		return "{" + parts.join(",") + "}";
	}

	function payloadHash(data) {
		try {
			var target = data;
			if (isPlainObject(target) && Object.prototype.hasOwnProperty.call(target, "meta")) {
				target = {};
				Object.keys(data).forEach(function(k) {
					if (k !== "meta") target[k] = data[k];
				});
			}
			var str = stableStringify(target);
			var h1 = 0x811c9dc5, h2 = 0x01000193;
			for (var i = 0; i < str.length; i++) {
				var c = str.charCodeAt(i);
				h1 = ((h1 ^ c) * 16777619) >>> 0;
				h2 = ((h2 ^ c) * 2246822519) >>> 0;
			}
			return ("0000000" + h1.toString(16)).slice(-8) + ("0000000" + h2.toString(16)).slice(-8);
		} catch (e) {
			return "";
		}
	}

	/** 字节数（UTF-8 近似，用于体积判定，不要求精确） */
	function jsonBytes(v) {
		try {
			return JSON.stringify(v).length;
		} catch (e) {
			return 0;
		}
	}

	/**
	 * 设备指纹：同一浏览器同一设备稳定，用于辨别「谁写的」。
	 * 优先 localStorage（跨标签页一致），拿不到则退到会话级随机值。
	 */
	function getDeviceId() {
		if (state.deviceId) return state.deviceId;
		var key = LS_PREFIX + "deviceId";
		var id = null;
		try {
			id = localStorage.getItem(key);
		} catch (e) { /* 存储被禁用 */ }
		if (!id) {
			id = "d-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

			try {
				localStorage.setItem(key, id);
			} catch (e) { /* 存不进去也无妨，本次会话内稳定即可 */ }
		}
		state.deviceId = id;
		return id;
	}

	function scopedKey(scope, suffix) {
		return LS_PREFIX + suffix + ":" + encodeURIComponent(scope || "");
	}

	function readLocalJson(scope, suffix, fallback) {
		try {
			var raw = localStorage.getItem(scopedKey(scope, suffix));
			if (!raw) return fallback;
			return JSON.parse(raw);
		} catch (e) {
			return fallback;
		}
	}

	function writeLocalJson(scope, suffix, value) {
		try {
			localStorage.setItem(scopedKey(scope, suffix), JSON.stringify(value));
			return true;
		} catch (e) {
			// 配额满：不阻断主流程（云端有历史，本地快照只是加速层）
			console.warn("[SyncCore] 本地快照写入失败（可能是配额满）:", e && e.name);
			return false;
		}
	}

	/* ---------------------------------------------------------------
	 * 底层：与 Supabase 通信
	 * ------------------------------------------------------------- */
	function client() {
		return window.supabaseClient || null;
	}

	function currentScope(scope) {
		if (scope) return String(scope);
		var s = window.getCurrentSiteScope ? window.getCurrentSiteScope() : "";
		return s || "";
	}

	function currentUser() {
		if (!window.authManager) return null;
		if (typeof window.authManager.isLoggedIn === "function" && !window.authManager.isLoggedIn()) return null;
		return typeof window.authManager.getUser === "function" ? window.authManager.getUser() : null;
	}

	function isReady(scope) {
		return !!(client() && currentUser() && currentScope(scope));
	}

	/**
	 * RPC 调用统一出口。
	 * 优先走 user_data_save 等 RPC（有 CAS + 历史）；
	 * RPC 不存在（迁移未执行）时返回 { unsupported: true }，由上层退回直连 upsert，
	 * 保证「迁移还没跑」的过渡期站点仍然能用，不会整站同步瘫痪。
	 */
	function callRpc(name, params) {
		var c = client();
		if (!c) return Promise.resolve({ ok: false, error: "no_client", unsupported: false });

		return c.rpc(name, params).then(function(res) {
			if (res.error) {
				var msg = String((res.error && res.error.message) || "");
				var code = String((res.error && res.error.code) || "");
				// PGRST202 = 函数不存在；42883 = undefined_function
				var missing = code === "PGRST202" || code === "42883" ||
					/find the function|does not exist|not found/i.test(msg);
				if (missing) {
					return { ok: false, unsupported: true, error: msg };
				}
				return { ok: false, error: msg };
			}
			var payload = res.data;
			if (typeof payload === "string") {
				try { payload = JSON.parse(payload); } catch (e) { /* 保持原样 */ }
			}
			if (!isPlainObject(payload)) {
				return { ok: false, error: "bad_rpc_payload" };
			}
			return payload;
		}).catch(function(err) {
			return { ok: false, error: String((err && err.message) || err) };
		});
	}

	/* ---------------------------------------------------------------
	 * 跨标签页互斥：同一 scope 同一时刻只允许一个标签页写入
	 * 没有 Web Locks 的环境（老 Safari）退化为「不互斥但仍走 CAS」，不会更糟
	 * ------------------------------------------------------------- */
	function withScopeLock(scope, task) {
		var locks = typeof navigator !== "undefined" && navigator.locks;
		if (!locks || typeof locks.request !== "function") {
			if (!state.lockWarned) {
				state.lockWarned = true;
				console.info("[SyncCore] 当前浏览器不支持 Web Locks，将仅依赖服务端 CAS 保证一致性");
			}
			return Promise.resolve().then(task);
		}
		return locks.request("synccore:" + scope, { mode: "exclusive" }, function() {
			return Promise.resolve().then(task);
		});
	}

	/* ---------------------------------------------------------------
	 * 写前快照（本地层）
	 * 云端历史是权威，本地快照只负责「离线/网络失败时也能回滚」
	 * ------------------------------------------------------------- */
	function pushLocalSnapshot(scope, data, reason) {
		var snap = {
			savedAt: nowIso(),
			reason: reason || "覆盖前备份",
			hash: payloadHash(data),
			bytes: jsonBytes(data),
			data: cloneJson(data)
		};
		var ring = state.snapshots[scope] || (state.snapshots[scope] = []);
		ring.unshift(snap);
		if (ring.length > SNAPSHOT_RING_MAX) ring.length = SNAPSHOT_RING_MAX;

		// 落盘：一份环形的「次新」副本，防刷新丢失；配额失败静默降级
		var persisted = (state.snapshots[scope] || []).slice(0, SNAPSHOT_RING_MAX);
		writeLocalJson(scope, "snapshots", persisted);
		return snap;
	}

	function readLocalSnapshots(scope) {
		if (state.snapshots[scope] && state.snapshots[scope].length) {
			return state.snapshots[scope];
		}
		var persisted = readLocalJson(scope, "snapshots", null);
		if (Array.isArray(persisted)) {
			state.snapshots[scope] = persisted;
			return persisted;
		}
		return [];
	}

	/* ---------------------------------------------------------------
	 * profile：各站点声明「自己怎么读写」
	 * ------------------------------------------------------------- */
	function registerProfile(scope, profile) {
		var s = currentScope(scope);
		if (!s) {
			console.warn("[SyncCore] registerProfile 缺少 scope，已忽略");
			return null;
		}
		if (!profile || typeof profile.buildPayload !== "function" || typeof profile.applyPayload !== "function") {
			console.warn("[SyncCore] registerProfile 需要 buildPayload 与 applyPayload，已忽略:", s);
			return null;
		}
		state.profiles[s] = profile;
		return profile;
	}

	function getProfile(scope) {
		return state.profiles[currentScope(scope)] || null;
	}

	/** 对外暴露「这份 payload 有没有业务数据」的统一判据 */
	function defaultIsEmpty(data) {
		if (!data || typeof data !== "object") return true;
		var keys = Object.keys(data);
		for (var i = 0; i < keys.length; i++) {
			if (keys[i] === "meta") continue;
			var v = data[keys[i]];
			if (v == null) continue;
			if (Array.isArray(v)) { if (v.length) return false; continue; }
			if (typeof v === "object") { if (Object.keys(v).length) return false; continue; }
			if (v !== "" && v !== 0 && v !== false) return false;
		}
		return true;
	}

	function payloadIsEmpty(scope, data) {
		var p = getProfile(scope);
		if (p && typeof p.isEmpty === "function") {
			try { return !!p.isEmpty(data); } catch (e) { /* 退化到默认判据 */ }
		}
		return defaultIsEmpty(data);
	}

	/* ---------------------------------------------------------------
	 * 读：status / pull
	 * ------------------------------------------------------------- */
	/**
	 * 取云端现状。
	 * light=true 时只要 rev + hash + bytes（几百字节），不下载整份数据。
	 * 有 RPC 走 RPC；没有就退回直连 select（旧库结构也能工作）。
	 */
	function status(scope, opts) {
		var s = currentScope(scope);
		var light = !!(opts && opts.light);
		if (!s) return Promise.resolve({ success: false, message: "当前路径没有站点作用域", hasData: false, scope: "" });
		if (!isReady(s)) return Promise.resolve({ success: false, message: "请先登录", hasData: false, scope: s });

		return callRpc("user_data_get", { p_scope: s, p_with_data: !light }).then(function(rpc) {
			if (!rpc.unsupported) {
				if (!rpc.ok) {
					return { success: false, message: "查询云端状态失败", hasData: false, scope: s, error: rpc.error };
				}
				if (!rpc.exists) {
					return { success: true, message: "云端暂无数据", hasData: false, scope: s, rev: 0 };
				}
				return {
					success: true,
					message: "云端已有数据",
					hasData: true,
					scope: s,
					rev: Number(rpc.rev) || 0,
					hash: rpc.hash || "",
					bytes: Number(rpc.bytes) || 0,
					updatedAt: rpc.updated_at || null,
					deviceId: rpc.device_id || null,
					cloudData: light ? null : rpc.data,
					legacy: false
				};
			}
			return statusLegacy(s, light);
		});
	}

	/** 过渡期：迁移尚未执行时，用直连 select 兜底 */
	function statusLegacy(s, light) {
		var c = client();
		var user = currentUser();
		if (!c || !user) return Promise.resolve({ success: false, message: "请先登录", hasData: false, scope: s });

		var cols = light ? "updated_at" : "data, updated_at";
		return c.from("user_data").select(cols)
			.eq("user_id", user.id).eq("site_scope", s).maybeSingle()
			.then(function(res) {
				if (res.error) {
					return { success: false, message: "查询云端状态失败", hasData: false, scope: s, error: res.error.message };
				}
				if (!res.data) {
					return { success: true, message: "云端暂无数据", hasData: false, scope: s, rev: 0, legacy: true };
				}
				if (light) {
					// 旧结构没有 rev/hash，只能证明「有数据」，内容差异要等 pull
					return {
						success: true, message: "云端已有数据", hasData: true, scope: s,
						rev: null, hash: "", updatedAt: res.data.updated_at, cloudData: null, legacy: true
					};
				}
				return {
					success: true, message: "云端已有数据", hasData: true, scope: s,
					rev: null, hash: "", updatedAt: res.data.updated_at,
					cloudData: res.data.data, legacy: true
				};
			})
			.catch(function(err) {
				return { success: false, message: "查询云端状态失败", hasData: false, scope: s, error: String(err && err.message || err) };
			});
	}

	/**
	 * 从云端拉取并写回本地。
	 * 有 merge 就合并（默认策略），没有 merge 才整份替换 —— 且整份替换前必须快照。
	 */
	function pull(scope, opts) {
		var s = currentScope(scope);
		opts = opts || {};
		if (!s) return Promise.resolve({ success: false, message: "当前路径没有站点作用域", scope: "" });
		if (!isReady(s)) return Promise.resolve({ success: false, message: "请先登录", scope: s });

		var profile = getProfile(s);
		if (!profile) {
			return Promise.resolve({ success: false, message: "当前站点未注册同步配置", scope: s, unregistered: true });
		}

		return status(s, { light: false }).then(function(st) {
			if (!st.success) return { success: false, message: st.message, scope: s };
			if (!st.hasData) return { success: false, message: "云端暂无数据", scope: s, empty: true };

			// 压缩壳必须异步解包（gzip 是异步 API），不能走同步的 unwrapCloudData
			return unwrapCloudDataAsync(st.cloudData).then(function(rawBlock) {
				return applyPullResult(s, profile, opts, st, rawBlock);
			});
		}).catch(function(err) {
			return { success: false, message: "恢复失败，请稍后重试", scope: s, error: String(err && err.message || err) };
		});
	}

	/** pull 的后半段：校验 → 快照 → 合并 → 写回 → 刷新基线 */
	function applyPullResult(s, profile, opts, st, cloudBlock) {
		if (!isPlainObject(cloudBlock)) {
			return { success: false, message: "云端数据格式不正确", scope: s };
		}

		var localBlock;
		try {
			localBlock = profile.buildPayload();
		} catch (e) {
			return { success: false, message: "读取本地数据失败", scope: s, error: String(e && e.message || e) };
		}
		localBlock = localBlock && localBlock.data ? localBlock.data : localBlock;

		// 整份替换前无条件留快照（合并路径不会丢数据，可以省这份开销）
		if (typeof profile.merge !== "function") {
			pushLocalSnapshot(s, localBlock, "云端恢复前（" + (opts.reason || "手动下载") + "）");
		}

		var changed = true;
		if (typeof profile.merge === "function") {
			var merged;
			try {
				merged = profile.merge(cloneJson(localBlock), cloneJson(cloudBlock));
			} catch (e) {
				return { success: false, message: "数据合并失败", scope: s, error: String(e && e.message || e) };
			}
			if (merged && isPlainObject(merged.data)) {
				cloudBlock = merged.data;
				changed = merged.changed !== false;
			}
		}

		var applied = {};
		try {
			window._siteNavApplyingCloudData = true;
			applied = profile.applyPayload(cloneJson(cloudBlock)) || {};
		} catch (e) {
			return { success: false, message: "写入本地数据失败", scope: s, error: String(e && e.message || e) };
		} finally {
			setTimeout(function() { window._siteNavApplyingCloudData = false; }, 0);
		}

		// 记下「已与云端对齐」的基线，避免下一次自动上传把刚拉下来的当成脏数据又推回去
		setBase(s, {
			rev: st.rev === null ? null : st.rev,
			hash: payloadHash(cloudBlock),
			syncedAt: nowIso()
		});

		return {
			success: true,
			message: changed ? "已从云端恢复" : "本机已是最新",
			scope: s,
			changed: changed,
			applied: applied,
			data: cloudBlock,
			rev: st.rev
		};
	}

	/**
	 * 云端 payload 解包（异步，兼容压缩壳 payload.data = {enc:'gzip+b64', blob}）。
	 * gzip 只能用异步 API，所以这里必须是 Promise；缺 codec 时原样返回。
	 */
	function unwrapCloudDataAsync(cloudPayload) {
		if (!cloudPayload) return Promise.resolve(null);
		var inner = cloudPayload.data !== undefined ? cloudPayload.data : cloudPayload;
		if (window.SitePayloadCodec && typeof window.SitePayloadCodec.unpackPayloadData === "function") {
			return window.SitePayloadCodec.unpackPayloadData(inner).catch(function() { return null; });
		}
		return Promise.resolve(inner);
	}

	/* ---------------------------------------------------------------
	 * 基线：记录「上一次确认与云端一致」的 rev/hash
	 * ------------------------------------------------------------- */
	function getBase(scope) {
		var s = currentScope(scope);
		return readLocalJson(s, "base", null) || { rev: null, hash: "", syncedAt: null };
	}

	function setBase(scope, base) {
		var s = currentScope(scope);
		writeLocalJson(s, "base", base);
	}

	/* ---------------------------------------------------------------
	 * 写：save
	 * ------------------------------------------------------------- */
	/**
	 * 保存到云端。
	 *
	 * @param {object} opts
	 * @param {string}  opts.scope       作用域（默认当前路径）
	 * @param {string}  opts.reason      写入原因（会进云端历史，便于事后追溯）
	 * @param {boolean} opts.force       true = 跳过 CAS，强制覆盖（手动上传/恢复历史）
	 * @param {boolean} opts.allowEmpty  true = 允许把空数据写上去（用户显式清空）
	 * @param {number}  opts.retries     冲突重试次数（默认 3）
	 */
	function save(opts) {
		opts = opts || {};
		var s = currentScope(opts.scope);
		if (!s) return Promise.resolve({ success: false, message: "当前路径没有站点作用域", scope: "" });
		if (!isReady(s)) return Promise.resolve({ success: false, message: "请先登录", scope: s });

		var profile = getProfile(s);
		if (!profile) {
			return Promise.resolve({ success: false, message: "当前站点未注册同步配置", scope: s, unregistered: true });
		}

		// 串行化：同一页面内的并发 save 排队，不并发发包
		var run = function() {
			return withScopeLock(s, function() {
				return saveOnce(s, profile, opts, 0);
			});
		};

		state.inFlight = (state.inFlight || Promise.resolve()).then(run, run);
		return state.inFlight;
	}

	function saveOnce(s, profile, opts, attempt, preBuiltBlock) {
		var maxRetries = typeof opts.retries === "number" ? opts.retries : 3;

		// preBuiltBlock：冲突合并后的结果。重试时必须用它，不能重新 buildPayload，
		// 否则 merge 的成果会被「重新读一遍本地」冲掉 —— 那样合并等于白做（这就是旧的丢数据路径）。
		var localBlock;
		var localPayload = null;
		if (preBuiltBlock) {
			localBlock = preBuiltBlock;
		} else {
			try {
				localPayload = profile.buildPayload();
			} catch (e) {
				return Promise.resolve({ success: false, message: "读取本地数据失败", scope: s, error: String(e && e.message || e) });
			}
			localBlock = localPayload && localPayload.data ? localPayload.data : localPayload;
		}
		if (!isPlainObject(localBlock)) {
			return Promise.resolve({ success: false, message: "本地数据格式不正确，已取消上传", scope: s });
		}

		// ── 空闸门：默认硬拦截 ──
		if (!opts.allowEmpty && payloadIsEmpty(s, localBlock)) {
			return status(s, { light: true }).then(function(st) {
				// 判据是「云端这一行确实存着东西」，不能用字节阈值蒙：
				// 空对象是 "{}"（2 字节），null 是 "null"（4 字节），小数据备份可能只有几十字节。
				// 只要有内容就值得保护 —— 旧的 bytes>200 阈值的做法，会放过「云端只有几条记录」的场景。
				var cloudHasContent = st.success && st.hasData && Number(st.bytes || 0) > 8;
				if (cloudHasContent) {
					console.warn("[SyncCore] 拒绝上传空数据：云端有 " + st.bytes + " 字节备份，本地为空");
					return {
						success: false,
						blocked: true,
						scope: s,
						message: "本机暂无数据，云端已有备份。已阻止上传以免清空云端（如确实要清空，请用「强制上传」）"
					};
				}
				// 云端本来就没东西 ⇒ 传空无意义，直接算成功
				return { success: true, message: "云端与本机均为空", scope: s, noop: true };
			});
		}

		// ── 压包 ──
		// payload 外壳（exportedAt/siteScope/version）只在首次构建时有；合并重试时用最小外壳，
		// 因为压缩编解码只关心 payload.data，外壳字段会随数据一起存进云端。
		var payloadShell = localPayload || {
			exportedAt: nowIso(),
			source: "Ckarefulon",
			siteScope: s,
			siteBasePath: (window.getCurrentSiteBasePath ? window.getCurrentSiteBasePath() : ""),
			version: 1
		};
		var packP = (window.SitePayloadCodec && typeof window.SitePayloadCodec.packPayload === "function")
			? window.SitePayloadCodec.packPayload(Object.assign({}, payloadShell, { data: localBlock }))
			: Promise.resolve(Object.assign({}, payloadShell, { data: localBlock }));

		return packP.then(function(packed) {
			var expectedRev = null;
			if (!opts.force) {
				var base = getBase(s);
				// base.rev 为 null（旧库/首次）⇒ 传 null 表示「不做 CAS」，但会带 force=false 语义
				expectedRev = (base.rev === null || base.rev === undefined) ? null : Number(base.rev);
			}
			return callRpc("user_data_save", {
				p_scope: s,
				p_data: packed,
				p_expected_rev: expectedRev,
				p_device_id: getDeviceId(),
				p_reason: opts.reason || (opts.auto ? "自动保存" : "手动上传")
			}).then(function(rpc) {
				// ── 过渡期：RPC 不存在 ⇒ 直连 upsert（仍是整份覆盖，但没有历史可用） ──
				if (rpc.unsupported) {
					console.warn("[SyncCore] user_data_save 不存在（迁移未执行），退回直连 upsert");
					return saveLegacy(s, packed, opts);
				}

				// ── 冲突：合并后重试 ──
				if (rpc.conflict) {
					if (attempt >= maxRetries) {
						return {
							success: false,
							scope: s,
							message: "云端数据在同步过程中被其他设备更新，已停止上传以免覆盖（请稍后重试）",
							conflict: true
						};
					}
					return resolveConflictAndRetry(s, profile, localBlock, rpc, opts, attempt);
				}

				if (!rpc.ok) {
					state.lastError = rpc.error || "unknown";
					return { success: false, message: "上传失败，请稍后重试", scope: s, error: rpc.error };
				}

				// ── 成功：刷新基线 ──
				setBase(s, {
					rev: Number(rpc.rev) || 0,
					hash: payloadHash(localBlock),
					syncedAt: nowIso()
				});
				state.dirtyScopes[s] = false;

				if (typeof window._siteNavMarkAsSynced === "function") {
					try { window._siteNavMarkAsSynced(); } catch (e) { /* ignore */ }
				}
				if (typeof window._siteNavSetDirty === "function") {
					try { window._siteNavSetDirty(false); } catch (e) { /* ignore */ }
				}

				return {
					success: true,
					message: "已同步到云端",
					scope: s,
					rev: Number(rpc.rev) || 0,
					bytes: Number(rpc.bytes) || 0,
					retried: attempt
				};
			});
		}).catch(function(err) {
			return { success: false, message: "上传失败，请稍后重试", scope: s, error: String(err && err.message || err) };
		});
	}

	/**
	 * 冲突处理：把云端那份解包、与本地合并、再用云端最新 rev 重试。
	 *
	 * 这是「绝不丢数据」的核心 —— 旧代码在这里是直接把本地盖上去。
	 */
	function resolveConflictAndRetry(s, profile, localBlock, rpc, opts, attempt) {
		console.warn("[SyncCore] 检测到版本冲突 rev=" + rpc.rev + "，按合并策略重试第 " + (attempt + 1) + " 次");

		var cloudShell = rpc.data || null;
		return unwrapCloudDataAsync(cloudShell).then(function(cloudBlock) {
			if (!isPlainObject(cloudBlock)) {
				return {
					success: false,
					scope: s,
					conflict: true,
					message: "云端数据被其他设备更新且无法合并，已停止上传以免覆盖"
				};
			}

			// 合并前给「本地这份」留快照：万一合并策略有 bug，还能回滚
			pushLocalSnapshot(s, localBlock, "版本冲突合并前");

			var finalBlock = localBlock;
			if (typeof profile.merge === "function") {
				try {
					var merged = profile.merge(cloneJson(localBlock), cloneJson(cloudBlock));
					if (merged && isPlainObject(merged.data)) finalBlock = merged.data;
				} catch (e) {
					console.error("[SyncCore] 合并失败，保留云端版本不覆盖:", e);
					return {
						success: false,
						scope: s,
						conflict: true,
						message: "数据合并失败，已保留云端版本（本机数据未被上传）"
					};
				}
			} else {
				// 没有 merge：拒绝覆盖，交由用户决定。这是「宁可不同步也不丢数据」
				return {
					success: false,
					scope: s,
					conflict: true,
					needsUser: true,
					message: "云端已被其他设备更新，本站点未提供合并策略，已停止上传以免覆盖对方数据"
				};
			}

			// 用云端最新 rev 作为基线重试；把合并结果作为 preBuiltBlock 传下去，
			// 否则下一轮会重新 buildPayload 把合并成果丢掉（旧代码正是这样丢数据的）
			setBase(s, { rev: Number(rpc.rev) || 0, hash: payloadHash(cloudBlock), syncedAt: getBase(s).syncedAt });

			var nextOpts = Object.assign({}, opts, { force: false });
			return saveOnce(s, profile, nextOpts, attempt + 1, finalBlock);
		});
	}

	/** 过渡期直连 upsert：迁移未执行时保可用，但仍然拒绝空覆盖 */
	function saveLegacy(s, packed, opts) {
		var c = client();
		var user = currentUser();
		if (!c || !user) return Promise.resolve({ success: false, message: "请先登录", scope: s });

		var row = { user_id: user.id, site_scope: s, data: packed };
		if (!opts.noTimestamp) row.updated_at = nowIso(); // 旧库若没有触发器，仍需一个时间戳

		return c.from("user_data").upsert(row, { onConflict: "user_id,site_scope" })
			.then(function(res) {
				if (res.error) {
					return { success: false, message: "上传失败，请稍后重试", scope: s, error: res.error.message };
				}
				state.dirtyScopes[s] = false;
				return { success: true, message: "已同步到云端（兼容模式，无版本保护）", scope: s, legacy: true };
			})
			.catch(function(err) {
				return { success: false, message: "上传失败，请稍后重试", scope: s, error: String(err && err.message || err) };
			});
	}

	/* ---------------------------------------------------------------
	 * 自动同步
	 * ------------------------------------------------------------- */
	function markDirty(scope) {
		var s = currentScope(scope);
		if (!s) return;
		state.dirtyScopes[s] = true;
	}

	function scheduleUpload(scope, delay) {
		var s = currentScope(scope);
		if (!s) return;
		state.dirtyScopes[s] = true;
		if (state.autoTimers[s]) clearTimeout(state.autoTimers[s]);

		state.autoTimers[s] = setTimeout(function() {
			state.autoTimers[s] = null;
			if (!isReady(s)) return;
			if (state.dirtyScopes[s] !== true) return;

			if (typeof window._siteNavSetCloudStatus === "function") {
				try { window._siteNavSetCloudStatus("正在自动保存...", ""); } catch (e) { /* ignore */ }
			}

			save({ scope: s, auto: true, reason: "自动保存" }).then(function(r) {
				if (typeof window._siteNavSetCloudStatus === "function") {
					try {
						window._siteNavSetCloudStatus(
							r.success ? "已自动保存到云端" : r.message,
							r.success ? "Success" : (r.blocked ? "Warning" : "Error")
						);
					} catch (e) { /* ignore */ }
				}
			});
		}, typeof delay === "number" ? delay : AUTO_DEBOUNCE_MS);
	}

	/* ---------------------------------------------------------------
	 * 历史：列表 / 内容 / 恢复
	 * ------------------------------------------------------------- */
	function history(scope, limit) {
		var s = currentScope(scope);
		if (!isReady(s)) return Promise.resolve({ success: false, message: "请先登录", items: [] });

		return callRpc("user_data_history_list", { p_scope: s, p_limit: limit || 20 })
			.then(function(rpc) {
				if (rpc.unsupported) {
					// 没有云端历史 ⇒ 退回本机快照，至少不会「完全没得救」
					var localSnaps = readLocalSnapshots(s);
					return {
						success: true,
						message: "云端历史未启用（迁移未执行），以下为本机快照",
						items: localSnaps.map(function(sn, i) {
							return {
								id: "local-" + i, rev: null, bytes: sn.bytes,
								hash: sn.hash, created_at: sn.savedAt, reason: sn.reason,
								local: true
							};
						}),
						localOnly: true
					};
				}
				if (!rpc.ok) return { success: false, message: "读取历史失败", items: [] };
				var items = Array.isArray(rpc.items) ? rpc.items : [];
				return { success: true, message: "OK", items: items };
			});
	}

	function restoreHistory(scope, historyId) {
		var s = currentScope(scope);
		if (!isReady(s)) return Promise.resolve({ success: false, message: "请先登录" });

		var profile = getProfile(s);
		if (!profile) return Promise.resolve({ success: false, message: "当前站点未注册同步配置" });

		// 本机快照恢复（无云端历史时的兜底）
		if (typeof historyId === "string" && historyId.indexOf("local-") === 0) {
			var idx = parseInt(historyId.slice(6), 10);
			var snaps = readLocalSnapshots(s);
			var snap = snaps[idx];
			if (!snap || !snap.data) return Promise.resolve({ success: false, message: "本机快照已不存在" });

			pushLocalSnapshot(s, profile.buildPayload().data, "恢复本机快照前");
			try {
				window._siteNavApplyingCloudData = true;
				profile.applyPayload(cloneJson(snap.data));
			} catch (e) {
				return Promise.resolve({ success: false, message: "恢复失败", error: String(e && e.message || e) });
			} finally {
				setTimeout(function() { window._siteNavApplyingCloudData = false; }, 0);
			}
			markDirty(s);
			return Promise.resolve({ success: true, message: "已恢复本机快照", needsUpload: true });
		}

		return callRpc("user_data_history_restore", {
			p_history_id: historyId,
			p_expected_rev: null,     // 显式恢复即强制落库，服务端会先给当前值留痕
			p_device_id: getDeviceId()
		}).then(function(rpc) {
			if (rpc.unsupported) return { success: false, message: "云端历史未启用" };
			if (!rpc.ok) return { success: false, message: "恢复失败", error: rpc.error };

			// 云端已回退 ⇒ 把本地也拉成那一份，否则下一次自动上传又把它盖回去
			return pull(s, { reason: "恢复历史 #" + historyId }).then(function(p) {
				return {
					success: p.success,
					message: p.success ? "已恢复到所选历史版本" : ("云端已回退，但本机刷新失败：" + p.message),
					rev: rpc.rev
				};
			});
		});
	}

	/* ---------------------------------------------------------------
	 * 初始化：把散落各处的默认能力接上
	 * ------------------------------------------------------------- */
	function init() {
		if (state.ready) return;
		state.ready = true;
		getDeviceId();

		// 跨标签页：别的标签页写了同一 scope，本页基线要失效，避免用旧 rev 去写
		if (typeof window.addEventListener === "function") {
			window.addEventListener("storage", function(e) {
				if (!e || !e.key || e.key.indexOf(LS_PREFIX) !== 0) return;
				// 基线被别处改过 ⇒ 清掉内存里的脏标记，让下一次写重新读取基线
				var match = /^__syncCore_v1:base:(.+)$/.exec(e.key);
				if (match) {
					var scope = decodeURIComponent(match[1]);
					state.dirtyScopes[scope] = true;
				}
			});
		}
	}

	/* ---------------------------------------------------------------
	 * 导出
	 * ------------------------------------------------------------- */
	var SyncCore = {
		version: VERSION,

		init: init,
		registerProfile: registerProfile,
		getProfile: function(scope) { return getProfile(scope); },
		hasProfile: function(scope) { return !!getProfile(scope); },

		isReady: function(scope) { return isReady(scope); },
		hasScope: function(scope) { return !!currentScope(scope); },
		deviceId: getDeviceId,
		payloadHash: payloadHash,
		stableStringify: stableStringify,

		status: function(opts) {
			opts = opts || {};
			return status(opts.scope, opts);
		},
		pull: function(opts) {
			opts = opts || {};
			return pull(opts.scope, opts);
		},
		save: save,
		markDirty: markDirty,
		scheduleUpload: function(delay, scope) { scheduleUpload(scope, delay); },

		history: function(limit, scope) { return history(scope, limit); },
		restoreHistory: function(id, scope) { return restoreHistory(scope, id); },

		localSnapshots: function(scope) { return readLocalSnapshots(currentScope(scope)); },

		/** 供调试/自检：暴露内部基线读取 */
		getBase: function(scope) { return getBase(scope); }
	};

	init();
	window.SyncCore = SyncCore;

	/* ---------------------------------------------------------------
	 * 兼容门面：window.cloudSyncManager
	 *
	 * 关键修正：只在「当前页面确实注册了 profile」时才对外暴露。
	 * 没注册就留空 —— nav 的手动按钮会显示「未就绪」，
	 * 而不是像过去那样跑一份读别的站点 key 的实现、把错数据结构写进当前 scope。
	 * ------------------------------------------------------------- */
	function makeFacade() {
		var scope = currentScope();
		if (!getProfile(scope)) return null;

		return {
			/** 新内核标记，便于运行时判断当前跑的是哪一套 */
			__syncCore: true,

			isReady: function() { return isReady(currentScope()); },
			hasScope: function() { return !!currentScope(); },

			buildLocalPayload: function() {
				var p = getProfile(currentScope());
				if (!p) return { data: {} };
				var payload = p.buildPayload();
				if (payload && payload.data) return payload;
				return { data: payload };
			},

			getCloudStatus: function(opts) { return status(currentScope(), opts); },
			uploadLocalToCloud: function(opts) {
				return save(Object.assign({ force: false }, opts || {}, { scope: currentScope() }));
			},
			/** 用户在 UI 上确认过的手动上传 ⇒ 允许强制覆盖（但仍不许空覆盖） */
			forceUpload: function(opts) {
				return save(Object.assign({ force: true }, opts || {}, { scope: currentScope() }));
			},
			downloadCloudToLocal: function(opts) {
				return pull(currentScope(), opts || {});
			},
			applyDataToLocalStorage: function(dataBlock) {
				var p = getProfile(currentScope());
				if (!p) return {};
				window._siteNavApplyingCloudData = true;
				try {
					return p.applyPayload(dataBlock) || {};
				} finally {
					setTimeout(function() { window._siteNavApplyingCloudData = false; }, 0);
				}
			},
			scheduleUpload: function(delay) { scheduleUpload(currentScope(), delay); },
			history: function(limit) { return history(currentScope(), limit); },
			restoreHistory: function(id) { return restoreHistory(currentScope(), id); }
		};
	}

	/**
	 * 用 defineProperty 守住 window.cloudSyncManager：
	 * 站点脚本若抢先赋值（旧代码 window.cloudSyncManager = manager），
	 * 我们只在「它注册了 profile」时允许覆盖；否则保持 SyncCore 门面。
	 * 这样逐步改造期间不会又退回到「最后加载者赢」。
	 */
	try {
		var facade = makeFacade();
		Object.defineProperty(window, "cloudSyncManager", {
			configurable: true,
			enumerable: true,
			get: function() {
				var s = currentScope();
				if (!getProfile(s)) return window.__cloudSyncManagerLegacy || null;
				// 门面按 scope 缓存，避免 SPA 内切换站点后拿到上一个 scope 的门面
				state._facadeCache = state._facadeCache || {};
				if (!state._facadeCache[s]) state._facadeCache[s] = makeFacade();
				return state._facadeCache[s];
			},
			set: function(v) {
				// 旧站点自己赋的值：一律存成 legacy，永不覆盖门面。
				// 旧实现在「已注册 profile」的站点上会被彻底绕开（那正是串数据事故的源头）；
				// 未注册的站点仍能用 legacy 实现，保证改造可以一站一站来。
				if (v && v.__syncCore) return;
				if (getProfile(currentScope())) {
					console.info("[SyncCore] 已忽略旧实现的 cloudSyncManager 赋值（当前站点已接入 SyncCore）");
					window.__cloudSyncManagerLegacy = v;
					return;
				}
				window.__cloudSyncManagerLegacy = v;
			}
		});
	} catch (e) {
		// 极端环境（属性已被不可配置地定义）⇒ 直接赋值降级
		console.warn("[SyncCore] 无法守护 window.cloudSyncManager，降级为普通赋值:", e && e.message);
		if (!window.cloudSyncManager) window.cloudSyncManager = facade;
	}
})();

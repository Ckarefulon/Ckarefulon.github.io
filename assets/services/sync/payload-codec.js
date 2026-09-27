(function() {
	"use strict";

	/**
	 * SitePayloadCodec — 云同步 payload 压缩编解码器
	 *
	 * 背景：user_data 的 payload 是整份 JSON（可达数 MB），走国际出口只有几十 KB/s，
	 * 一次全量水合要几十秒。JSON 的 gzip 压缩率通常在 8~10 倍，
	 * 在应用层先压缩再传输，能把传输量压到原来的十分之一左右。
	 *
	 * 格式约定（v2 压缩壳）：
	 *   payload.data = {
	 *     enc:  "gzip+b64",              // 压缩标记
	 *     blob: "<base64(gzip(JSON))>",  // 原始 data（含 meta）的压缩体
	 *     meta: { bytes, items, hash }   // 指纹块保持顶层明文 ——
	 *   }                                // 轻量查询 select('data->meta') 不受影响
	 *
	 * 兼容语义：
	 *   - 浏览器不支持 CompressionStream ⇒ packPayload 原样返回（仍是旧明文格式，功能不降级）
	 *   - unpackPayloadData 遇到旧明文数据 ⇒ 原样返回，旧云端数据无需迁移即可读
	 *   - 所有「读云端」出口解包成明文后再交给下游（指纹/闸门/apply 语义完全不变）
	 */

	function supported() {
		return typeof CompressionStream === "function" && typeof DecompressionStream === "function";
	}

	/** 压缩壳判定：enc 标记 + blob 字符串 */
	function isCompressedPayloadData(data) {
		return !!(data && typeof data === "object" && !Array.isArray(data) &&
			data.enc === "gzip+b64" && typeof data.blob === "string" && data.blob.length > 0);
	}

	/** 字节 → base64（分块，避免 String.fromCharCode 爆栈） */
	function bytesToB64(bytes) {
		var CHUNK = 0x8000;
		var out = [];
		for (var i = 0; i < bytes.length; i += CHUNK) {
			out.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
		}
		return btoa(out.join(""));
	}

	/** base64 → Uint8Array */
	function b64ToBytes(b64) {
		var bin = atob(b64);
		var bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
		return bytes;
	}

	/** 字符串 → gzip → base64 */
	function compressToB64(text) {
		var stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
		return new Response(stream).arrayBuffer().then(function(buf) {
			return bytesToB64(new Uint8Array(buf));
		});
	}

	/** base64 → gunzip → 字符串 */
	function decompressFromB64(b64) {
		var stream = new Blob([b64ToBytes(b64)]).stream().pipeThrough(new DecompressionStream("gzip"));
		return new Response(stream).arrayBuffer().then(function(buf) {
			return new TextDecoder().decode(buf);
		});
	}

	/**
	 * 上传前打包：压缩 payload.data（meta 保留壳顶层明文）
	 * @param {object} payload - 完整 payload（exportedAt/siteScope/data...）
	 * @returns {Promise<object>} 压缩后的 payload（不支持压缩时原样返回）
	 */
	function packPayload(payload) {
		if (!payload || !payload.data || typeof payload.data !== "object") { return Promise.resolve(payload); }
		if (isCompressedPayloadData(payload.data) || !supported()) { return Promise.resolve(payload); }
	var meta = payload.data.meta || null;
	return compressToB64(JSON.stringify(payload.data)).then(function(b64) {
		// meta 同时提到 payload 顶层：轻量投影 data->meta 取的就是 payload 顶层键，
		// 埋在 data.meta 里会取到 null，导致状态检查静默回退整份下载
		return Object.assign({}, payload, {
			meta: meta,
			data: { enc: "gzip+b64", blob: b64, meta: meta }
		});
	});
	}

	/**
	 * 下载后解包：压缩壳 → 原始明文 data（旧明文数据原样返回）
	 * @param {object} data - 云端 payload.data
	 * @returns {Promise<object>} 明文 data
	 */
	function unpackPayloadData(data) {
		if (!isCompressedPayloadData(data)) { return Promise.resolve(data); }
		return decompressFromB64(data.blob).then(function(json) {
			var parsed = JSON.parse(json);
			if (!parsed || typeof parsed !== "object") {
				throw new Error("解压后的数据不是对象");
			}
			if (!parsed.meta && data.meta) { parsed.meta = data.meta; }
			return parsed;
		});
	}

	window.SitePayloadCodec = {
		supported: supported,
		isCompressedPayloadData: isCompressedPayloadData,
		packPayload: packPayload,
		unpackPayloadData: unpackPayloadData
	};
})();

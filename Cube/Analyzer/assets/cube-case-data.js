/*
 * 案例数据读取（Analyzer 公用）
 * ---------------------------------------------------------------------------
 * 数据源：Cube/Formula/assets/algs/（与 Formula 页面同一份）
 *   index.json   库清单
 *   <库名>.json  该库的案例：{ name, alg, faces }
 *
 * 本文件只负责「取出来 + 交给 CubeFigure 画」，不存数据、不自带拷贝。
 *
 * 用法：
 *   await CubeCaseData.ready();                        // 取一次，自动缓存
 *   CubeCaseData.svg('OLL', 'OLL 24');                 // 直接出 SVG 字符串
 *   CubeCaseData.get('PLL', 'Aa');                     // { name, alg, faces }
 *   CubeCaseData.names('CMLL');                        // 该类型下所有案例名
 *
 * 任何一步失败都返回 null，调用页按「没有配图」处理即可。
 */
(function (root) {
	'use strict';

	// algs/ 相对 Analyzer 页面的位置（Analyzer 在 Cube/Analyzer/）
	var ALGS_BASE = '../algs/';

	// Analyzer 只用到这三个库，直接按名字读，不走索引
	var TYPES = { OLL: 'oll.json', PLL: 'pll.json', CMLL: 'cmll.json' };

	// DB 里 faces 是 45 字符串，按此顺序切面
	var FACE_ORDER = ['U', 'B', 'F', 'L', 'R'];

	var libs = null;        // { OLL: { name -> case }, ... }
	var loading = null;     // Promise

	/** 45 字符串 → { U:'9格', B:'9格', ... } */
	function splitFaces(packed) {
		if (typeof packed !== 'string' || packed.length !== FACE_ORDER.length * 9) { return null; }
		var out = {};
		for (var i = 0; i < FACE_ORDER.length; i++) { out[FACE_ORDER[i]] = packed.slice(i * 9, i * 9 + 9); }
		return out;
	}

	/**
	 * 载入并索引；重复调用共用同一个 Promise。
	 * 直接读 OLL / PLL / CMLL 三个库，其余库跟 Analyzer 无关，一个字节都不拉。
	 */
	function ready() {
		if (libs) { return Promise.resolve(libs); }
		if (loading) { return loading; }
		var names = Object.keys(TYPES);
		loading = Promise.all(names.map(function (type) {
			return fetch(ALGS_BASE + TYPES[type], { cache: 'no-store' })
				.then(function (r) { return r.ok ? r.json() : null; })
				.catch(function () { return null; })
				.then(function (data) { return { type: type, data: data }; });
		})).then(function (bundles) {
			var out = {};
			for (var i = 0; i < bundles.length; i++) {
				var type = bundles[i].type;
				var data = bundles[i].data;
				if (!data || !data.cases) { continue; }
				var map = {};
				for (var k = 0; k < data.cases.length; k++) {
					var c = data.cases[k];
					if (!c || !c.name) { continue; }
					var entry = { name: c.name, alg: c.alg || null };
					var faces = splitFaces(c.faces);
					if (faces) { entry.faces = faces; }
					if (c.arrows && c.arrows.length) { entry.arrows = c.arrows; }
					map[String(c.name)] = entry;
				}
				out[type] = map;
			}
			libs = out;
			return libs;
		}).catch(function (e) {
			loading = null;
			if (root.console && console.warn) { console.warn('[CubeCaseData] 读取失败：' + (e && e.message)); }
			return null;
		});
		return loading;
	}

	/** 取某案例：{ name, alg, faces, arrows }；没有就 null */
	function get(type, name) {
		if (!libs) { return null; }
		var m = libs[String(type || '').toUpperCase()];
		if (!m) { return null; }
		return m[String(name || '')] || null;
	}

	function names(type) {
		if (!libs) { return []; }
		var m = libs[String(type || '').toUpperCase()];
		return m ? Object.keys(m) : [];
	}

	/** 直接出图：faces 交给 CubeFigure */
	function svg(type, name, opts) {
		var c = get(type, name);
		if (!c || !c.faces || !root.CubeFigure) { return null; }
		var o = { view: 'net', palette: 'site', state: c.faces, size: 75 };
		for (var k in (opts || {})) { o[k] = opts[k]; }
		if (!o.arrows && c.arrows && c.arrows.length) { o.arrows = c.arrows; }
		try { return root.CubeFigure.svg(o); } catch (e) { return null; }
	}

	root.CubeCaseData = {
		ALGS_BASE: ALGS_BASE,
		ready: ready,
		get: get,
		names: names,
		svg: svg
	};
})(typeof globalThis !== 'undefined' ? globalThis : this);

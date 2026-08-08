(function() {
	"use strict";

	var DOMAINS = [
		"https://Ckarefulon.github.io",
		"https://Ckarefulon.pages.dev",
		"https://Ckarefulon.ifree.page",
		"https://Ckarefulon.vercel.app"
	];

	var PING_COUNT = 5;
	var PING_INTERVAL = 200;
	var DOWNLOAD_BYTES = 500000;
	var UPLOAD_BYTES  = 200000;

	var grid = document.getElementById("grid");
	var startBtn = document.getElementById("startBtn");
	var loadingEl = document.getElementById("pivotLoading");
	var appEl = document.getElementById("pivotApp");

	var cardEls = {};
	var running = false;

	DOMAINS.forEach(function(d, i) {
		var domain = d.replace("https://", "").replace("http://", "");
		var card = document.createElement("div");
		card.className = "pivotCard";
		card.innerHTML =
			'<div class="pivotCardHeader">' +
				'<span class="pivotCardDomain">' + escapeHtml(domain) + '</span>' +
				'<span class="pivotCardStatus waiting" id="status-' + i + '">等待中</span>' +
			'</div>' +
			'<div class="pivotProgressWrap">' +
				'<div class="pivotProgressBar"><div class="pivotProgressFill" id="prog-' + i + '"></div></div>' +
				'<div class="pivotPhaseLabel" id="phase-' + i + '">—</div>' +
			'</div>' +
			'<div class="pivotCardBody">' +
			metricRow(i, "ping", "Ping (ms)") +
			metricRow(i, "jitter", "抖动 (ms)") +
			metricRow(i, "upload", "上传 (Mbps)") +
			metricRow(i, "download", "下载 (Mbps)") +
			'</div>';
		grid.appendChild(card);
		cardEls[i] = {
			status:   document.getElementById("status-" + i),
			prog:     document.getElementById("prog-" + i),
			phase:    document.getElementById("phase-" + i),
			ping:     document.getElementById("val-" + i + "-ping"),
			jitter:   document.getElementById("val-" + i + "-jitter"),
			upload:   document.getElementById("val-" + i + "-upload"),
			download: document.getElementById("val-" + i + "-download")
		};
	});

	function metricRow(idx, key, label) {
		return '<div class="pivotMetric">' +
			'<span class="pivotMetricLabel">' + label + '</span>' +
			'<span class="pivotMetricValue" id="val-' + idx + '-' + key + '">—</span>' +
		'</div>';
	}

	function escapeHtml(s) {
		var d = document.createElement("div");
		d.textContent = s;
		return d.innerHTML;
	}

	function setStatus(idx, state, text) {
		var el = cardEls[idx].status;
		el.className = "pivotCardStatus " + state;
		el.textContent = text || state;
	}

	function setPhase(idx, text) {
		cardEls[idx].phase.textContent = text;
	}

	function setProgress(idx, pct) {
		cardEls[idx].prog.style.width = Math.min(100, Math.max(0, pct)) + "%";
	}

	function setVal(idx, key, html) {
		var el = cardEls[idx][key];
		if (el) el.innerHTML = html;
	}

	function formatMs(ms) {
		if (ms == null || isNaN(ms)) return "—";
		if (ms < 10) return ms.toFixed(1) + '<span class="unit">ms</span>';
		return Math.round(ms) + '<span class="unit">ms</span>';
	}

	function formatMbps(bps) {
		if (bps == null || isNaN(bps)) return "—";
		if (bps < 1) return bps.toFixed(2) + '<span class="unit">Mbps</span>';
		if (bps < 10) return bps.toFixed(2) + '<span class="unit">Mbps</span>';
		return bps.toFixed(1) + '<span class="unit">Mbps</span>';
	}

	function sleep(ms) {
		return new Promise(function(r) { setTimeout(r, ms); });
	}

	async function measurePing(domain) {
		var latencies = [];
		for (var i = 0; i < PING_COUNT; i++) {
			var t0 = performance.now();
			try {
				await fetch(domain + "/?pivot_ping=" + Date.now() + "-" + i, {
					mode: "no-cors",
					cache: "no-store",
					credentials: "omit"
				});
				var t1 = performance.now();
				latencies.push(t1 - t0);
			} catch (e) {
				latencies.push(null);
			}
			var idx = -1;
			DOMAINS.forEach(function(d, j) { if (d === domain) idx = j; });
			if (idx >= 0) {
				setProgress(idx, (i + 1) / PING_COUNT * 40);
				setPhase(idx, "Ping 测试中 (" + (i + 1) + "/" + PING_COUNT + ")");
			}
			if (i < PING_COUNT - 1) await sleep(PING_INTERVAL);
		}
		var valid = latencies.filter(function(v) { return v != null; });
		if (valid.length === 0) return null;
		var avgPing = valid.reduce(function(a, b) { return a + b; }, 0) / valid.length;
		var sorted = valid.slice().sort(function(a, b) { return a - b; });
		var jitter;
		if (sorted.length >= 2) {
			var diffs = [];
			for (var k = 1; k < sorted.length; k++) diffs.push(Math.abs(sorted[k] - sorted[k - 1]));
			jitter = diffs.reduce(function(a, b) { return a + b; }, 0) / diffs.length;
		} else {
			jitter = 0;
		}
		return { ping: avgPing, jitter: jitter };
	}

	async function measureDownload(domain) {
		var url = domain + "/?pivot_dl=" + Date.now();
		var t0 = performance.now();
		try {
			await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit" });
			var t1 = performance.now();
			var elapsed = t1 - t0;
			if (elapsed < 50) elapsed = 50;
			var bits = DOWNLOAD_BYTES * 8;
			return (bits / (elapsed / 1000)) / 1e6;
		} catch (e) {
			return null;
		}
	}

	async function measureUpload(domain) {
		var payload = new ArrayBuffer(UPLOAD_BYTES);
		var url = domain + "/?pivot_ul=" + Date.now();
		var t0 = performance.now();
		try {
			await fetch(url, {
				method: "POST",
				mode: "no-cors",
				cache: "no-store",
				credentials: "omit",
				body: payload
			});
			var t1 = performance.now();
			var elapsed = t1 - t0;
			if (elapsed < 50) elapsed = 50;
			var bits = UPLOAD_BYTES * 8;
			return (bits / (elapsed / 1000)) / 1e6;
		} catch (e) {
			return null;
		}
	}

	async function testDomain(domain, idx) {
		setStatus(idx, "running", "测试中…");
		setPhase(idx, "Ping 测试中");
		setProgress(idx, 0);
		setVal(idx, "ping", "—");
		setVal(idx, "jitter", "—");
		setVal(idx, "download", "—");
		setVal(idx, "upload", "—");

		try {
			var pingResult = await measurePing(domain);
			if (pingResult != null) {
				setVal(idx, "ping", formatMs(pingResult.ping));
				setVal(idx, "jitter", formatMs(pingResult.jitter));
			} else {
				setVal(idx, "ping", '<span style="color:var(--red)">失败</span>');
				setVal(idx, "jitter", '<span style="color:var(--red)">—</span>');
			}
			setProgress(idx, 40);
			setPhase(idx, "下载测试中");

			var dl = await measureDownload(domain);
			if (dl != null) {
				setVal(idx, "download", formatMbps(dl));
			} else {
				setVal(idx, "download", '<span style="color:var(--red)">失败</span>');
			}
			setProgress(idx, 70);
			setPhase(idx, "上传测试中");

			var ul = await measureUpload(domain);
			if (ul != null) {
				setVal(idx, "upload", formatMbps(ul));
			} else {
				setVal(idx, "upload", '<span style="color:var(--red)">失败</span>');
			}

			setProgress(idx, 100);
			setPhase(idx, "完成");
			setStatus(idx, "done", "完成");
		} catch (e) {
			setStatus(idx, "fail", "错误");
			setPhase(idx, "异常");
		}
	}

	startBtn.addEventListener("click", function() {
		if (running) return;
		running = true;
		startBtn.disabled = true;
		startBtn.innerHTML =
			'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: pulseSpin 0.8s linear infinite;"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' +
			"测试中…";

		DOMAINS.forEach(function(d, i) {
			testDomain(d, i);
		});

		setTimeout(function() {
			running = false;
			startBtn.disabled = false;
			startBtn.innerHTML =
				'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
				"重新测速";
		}, DOMAINS.length * 2000 + 1000);
	});

	// nav.js 是 defer 脚本，在 DOMContentLoaded 后执行
	// 用 MutationObserver 等 nav 的 header 插入后再显示内容
	function showApp() {
		if (loadingEl) loadingEl.style.display = "none";
		if (appEl) appEl.classList.add("isVisible");
	}

	function waitForNav() {
		var header = document.querySelector(".siteHeader");
		if (header) { showApp(); return; }
		var observer = new MutationObserver(function() {
			if (document.querySelector(".siteHeader")) {
				observer.disconnect();
				showApp();
			}
		});
		observer.observe(document.body, { childList: true, subtree: true });
		// 兜底：500ms 后强制显示
		setTimeout(function() { observer.disconnect(); showApp(); }, 500);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", function() {
			waitForNav();
			// nav.js init 也需要在 DOMContentLoaded 后调用
			if (window.siteNav && typeof window.siteNav.init === "function") {
				window.siteNav.init({
					setTheme: function(theme) {
						document.documentElement.setAttribute("data-theme", theme);
					}
				});
			}
		});
	} else {
		waitForNav();
		if (window.siteNav && typeof window.siteNav.init === "function") {
			window.siteNav.init({
				setTheme: function(theme) {
					document.documentElement.setAttribute("data-theme", theme);
				}
			});
		}
	}

})();

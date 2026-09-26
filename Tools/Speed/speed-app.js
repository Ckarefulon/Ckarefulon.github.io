(function() {
	"use strict";

	/* 方法参考 linkage/linkage-app.js：no-cors fetch 计时
	   Ping = 5 次均值；抖动 = 排序后相邻差均值；下载 = 拉首页按字节数折算；上传 = POST 固定 payload 计时 */

	var DEFAULT_HOSTS = [
		"https://Ckarefulon.github.io",
		"https://Ckarefulon.pages.dev",
		"https://Ckarefulon.vercel.app",
		"https://www.baidu.com",
		"https://github.com"
	];

	var STORAGE_KEY = "toolsSpeed.hosts.v1";
	var PING_COUNT = 5;
	var PING_INTERVAL = 200;
	var DOWNLOAD_ESTIMATE_BYTES = 500000; // 跨域读不到实际大小时的估算值
	var UPLOAD_BYTES = 200000;

	var grid = document.getElementById("grid");
	var hostInput = document.getElementById("hostInput");
	var startBtn = document.getElementById("startBtn");
	var resetBtn = document.getElementById("resetBtn");
	var loadingEl = document.getElementById("speedLoading");
	var appEl = document.getElementById("speedApp");

	var cardEls = {};
	var cardElsById = {};
	var running = false;
	var results = [];
	var hosts = [];

	function loadHosts() {
		var raw = null;
		try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) {}
		if (!raw) return DEFAULT_HOSTS.slice();
		var list = raw.split("\n").map(function(s) { return s.trim(); }).filter(Boolean);
		return list.length ? list : DEFAULT_HOSTS.slice();
	}

	function saveHosts() {
		try { localStorage.setItem(STORAGE_KEY, hosts.join("\n")); } catch (e) {}
	}

	function normalizeHost(line) {
		var s = line.trim();
		if (!s) return null;
		if (!/^https?:\/\//i.test(s)) s = "https://" + s;
		try {
			var u = new URL(s);
			if (!/^https?:$/.test(u.protocol)) return null;
			return u.origin + (u.pathname.replace(/\/$/, "") || "") ;
		} catch (e) { return null; }
	}

	function parseHostInput() {
		var seen = {};
		var list = [];
		hostInput.value.split("\n").forEach(function(line) {
			var h = normalizeHost(line);
			if (h && !seen[h]) { seen[h] = true; list.push(h); }
		});
		return list;
	}

	function escapeHtml(s) {
		var d = document.createElement("div");
		d.textContent = s;
		return d.innerHTML;
	}

	function metricRow(idx, key, label) {
		return '<div class="speedMetric">' +
			'<span class="speedMetricLabel">' + label + '</span>' +
			'<span class="speedMetricValue" id="val-' + idx + '-' + key + '">—</span>' +
		'</div>';
	}

	function buildGrid() {
		hosts = parseHostInput();
		grid.innerHTML = "";
		cardEls = {};
		cardElsById = {};
		results = [];

		if (!hosts.length) {
			grid.innerHTML = '<div class="speedGridEmpty">先在上方填入至少一个主机</div>';
			return;
		}

		hosts.forEach(function(d, i) {
			var domain = d.replace(/^https?:\/\//i, "");
			var card = document.createElement("div");
			card.className = "speedCard";
			card.id = "card-" + i;
			card.innerHTML =
				'<div class="speedCardHeader">' +
					'<span class="speedRank">#' + (i + 1) + '</span>' +
					'<a href="' + escapeHtml(d) + '" target="_blank" rel="noopener" class="speedCardDomainLink">' + escapeHtml(domain) + '</a>' +
					'<span class="speedCardStatus waiting" id="status-' + i + '">等待中</span>' +
					'<button class="speedCardRemove" id="remove-' + i + '" type="button" title="从列表移除">✕</button>' +
				'</div>' +
				'<div class="speedProgressWrap">' +
					'<div class="speedProgressBar"><div class="speedProgressFill" id="prog-' + i + '"></div></div>' +
					'<div class="speedPhaseLabel" id="phase-' + i + '">—</div>' +
				'</div>' +
				'<div class="speedCardBody">' +
				metricRow(i, "ping", "Ping (ms)") +
				metricRow(i, "jitter", "抖动 (ms)") +
				metricRow(i, "upload", "上传 (Mbps)") +
				metricRow(i, "download", "下载 (Mbps)") +
				'</div>';
			grid.appendChild(card);
			cardEls[i] = {
				status: document.getElementById("status-" + i),
				prog:   document.getElementById("prog-" + i),
				phase:  document.getElementById("phase-" + i),
				ping:     document.getElementById("val-" + i + "-ping"),
				jitter:   document.getElementById("val-" + i + "-jitter"),
				upload:   document.getElementById("val-" + i + "-upload"),
				download: document.getElementById("val-" + i + "-download")
			};
			cardElsById["card-" + i] = card;
			document.getElementById("remove-" + i).addEventListener("click", function() {
				if (running) return;
				var remaining = parseHostInput().filter(function(h, j) { return j !== i; });
				hostInput.value = remaining.join("\n");
				hosts = remaining;
				saveHosts();
				buildGrid();
			});
		});
	}

	function setStatus(idx, state, text) {
		var el = cardEls[idx].status;
		el.className = "speedCardStatus " + state;
		el.textContent = text || state;
	}

	function setPhase(idx, text) { cardEls[idx].phase.textContent = text; }
	function setProgress(idx, pct) { cardEls[idx].prog.style.width = Math.min(100, Math.max(0, pct)) + "%"; }
	function setVal(idx, key, html) {
		var el = cardEls[idx][key];
		if (el) el.innerHTML = html;
	}

	function formatMs(ms) {
		if (ms == null || isNaN(ms)) return "—";
		if (ms < 10) return ms.toFixed(1) + '<span class="unit">ms</span>';
		return Math.round(ms) + '<span class="unit">ms</span>';
	}

	function formatMbps(bps, estimated) {
		if (bps == null || isNaN(bps)) return "—";
		var txt = bps < 10 ? bps.toFixed(2) : bps.toFixed(1);
		return txt + '<span class="unit">Mbps</span>' + (estimated ? '<span class="estMark">估</span>' : "");
	}

	function sleep(ms) {
		return new Promise(function(r) { setTimeout(r, ms); });
	}

	async function measurePing(domain, idx) {
		var latencies = [];
		for (var i = 0; i < PING_COUNT; i++) {
			var t0 = performance.now();
			try {
				await fetch(domain + "/?speed_ping=" + Date.now() + "-" + i, {
					mode: "no-cors",
					cache: "no-store",
					credentials: "omit"
				});
				latencies.push(performance.now() - t0);
			} catch (e) {
				latencies.push(null);
			}
			setProgress(idx, (i + 1) / PING_COUNT * 40);
			setPhase(idx, "Ping 测试中 (" + (i + 1) + "/" + PING_COUNT + ")");
			if (i < PING_COUNT - 1) await sleep(PING_INTERVAL);
		}
		var valid = latencies.filter(function(v) { return v != null; });
		if (valid.length === 0) return null;
		var avgPing = valid.reduce(function(a, b) { return a + b; }, 0) / valid.length;
		var sorted = valid.slice().sort(function(a, b) { return a - b; });
		var jitter = 0;
		if (sorted.length >= 2) {
			var diffs = [];
			for (var k = 1; k < sorted.length; k++) diffs.push(sorted[k] - sorted[k - 1]);
			jitter = diffs.reduce(function(a, b) { return a + b; }, 0) / diffs.length;
		}
		return { ping: avgPing, jitter: jitter };
	}

	/* 下载：先试 CORS 读实际字节数；失败退回 no-cors 按 500KB 估算 */
	async function measureDownload(domain, idx) {
		var url = domain + "/?speed_dl=" + Date.now();
		var t0 = performance.now();
		try {
			var resp = await fetch(url, { mode: "cors", cache: "no-store", credentials: "omit" });
			var blob = await resp.blob();
			var elapsed = Math.max(50, performance.now() - t0);
			var bits = blob.size * 8;
			if (bits <= 0) throw new Error("empty");
			return { mbps: (bits / (elapsed / 1000)) / 1e6, estimated: false };
		} catch (e1) {
			t0 = performance.now();
			try {
				await fetch(url, { mode: "no-cors", cache: "no-store", credentials: "omit" });
				var elapsed2 = Math.max(50, performance.now() - t0);
				var bits2 = DOWNLOAD_ESTIMATE_BYTES * 8;
				return { mbps: (bits2 / (elapsed2 / 1000)) / 1e6, estimated: true };
			} catch (e2) {
				return null;
			}
		}
	}

	async function measureUpload(domain) {
		var payload = new ArrayBuffer(UPLOAD_BYTES);
		var url = domain + "/?speed_ul=" + Date.now();
		var t0 = performance.now();
		try {
			await fetch(url, {
				method: "POST",
				mode: "no-cors",
				cache: "no-store",
				credentials: "omit",
				body: payload
			});
			var elapsed = Math.max(50, performance.now() - t0);
			var bits = UPLOAD_BYTES * 8;
			return { mbps: (bits / (elapsed / 1000)) / 1e6, estimated: true };
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
			var pingResult = await measurePing(domain, idx);
			if (pingResult != null) {
				setVal(idx, "ping", formatMs(pingResult.ping));
				setVal(idx, "jitter", formatMs(pingResult.jitter));
			} else {
				setVal(idx, "ping", '<span style="color:var(--red)">失败</span>');
				setVal(idx, "jitter", '<span style="color:var(--red)">—</span>');
			}
			setProgress(idx, 40);
			setPhase(idx, "下载测试中");

			var dl = await measureDownload(domain, idx);
			setVal(idx, "download", dl ? formatMbps(dl.mbps, dl.estimated) : '<span style="color:var(--red)">失败</span>');
			setProgress(idx, 70);
			setPhase(idx, "上传测试中");

			var ul = await measureUpload(domain);
			setVal(idx, "upload", ul ? formatMbps(ul.mbps, ul.estimated) : '<span style="color:var(--red)">失败</span>');

			setProgress(idx, 100);
			setPhase(idx, pingResult ? "完成" : "主机不可达");
			setStatus(idx, pingResult ? "done" : "fail", pingResult ? "完成" : "不可达");

			results[idx] = {
				index: idx,
				domain: domain,
				ping: pingResult ? pingResult.ping : null,
				jitter: pingResult ? pingResult.jitter : null,
				download: dl ? dl.mbps : null,
				upload: ul ? ul.mbps : null,
				score: null
			};
			sortAndDisplayResults();
		} catch (e) {
			setStatus(idx, "fail", "错误");
			setPhase(idx, "异常");
		}
	}

	function sortAndDisplayResults() {
		var completed = results.filter(function(r) { return r != null && r.ping !== null; });
		if (completed.length === 0) return;

		var sorted = completed.map(function(r) {
			var ping = r.ping || 9999;
			var jitter = r.jitter || 0;
			var dl = r.download || 0;
			var ul = r.upload || 0;
			var score = (ping * 0.4) + (jitter * 0.2) + ((10 / (dl + 0.1)) * 0.2) + ((10 / (ul + 0.1)) * 0.2);
			return Object.assign({}, r, { score: score });
		}).sort(function(a, b) { return a.score - b.score; });

		var allCards = [];
		for (var i = 0; i < grid.children.length; i++) {
			var card = grid.children[i];
			var match = card.id.match(/card-(\d+)/);
			if (match) {
				allCards.push({ idx: parseInt(match[1]), card: card, rect: card.getBoundingClientRect() });
			}
		}

		for (var rank = 0; rank < sorted.length; rank++) {
			var c = cardElsById["card-" + sorted[rank].index];
			if (c) c.style.order = rank;
		}
		var completedIndices = sorted.map(function(r) { return r.index; });
		var nextOrder = sorted.length;
		for (var j = 0; j < hosts.length; j++) {
			if (completedIndices.indexOf(j) === -1) {
				var c2 = cardElsById["card-" + j];
				if (c2) c2.style.order = nextOrder++;
			}
		}

		for (var k = 0; k < allCards.length; k++) {
			(function(cardInfo) {
				var card = cardInfo.card;
				var deltaY = cardInfo.rect.top - card.getBoundingClientRect().top;
				var deltaX = cardInfo.rect.left - card.getBoundingClientRect().left;
				if (Math.abs(deltaY) > 1 || Math.abs(deltaX) > 1) {
					card.style.transition = "none";
					card.style.transform = "translate(" + deltaX + "px, " + deltaY + "px)";
					requestAnimationFrame(function() {
						requestAnimationFrame(function() {
							card.style.transition = "transform 0.5s cubic-bezier(0.4, 0, 0.2, 1)";
							card.style.transform = "";
							setTimeout(function() { card.style.transition = ""; }, 550);
						});
					});
				}
				var rankIdx = sorted.findIndex(function(r) { return r.index === cardInfo.idx; });
				if (rankIdx >= 0) {
					var rankEl = card.querySelector(".speedRank");
					if (rankEl) {
						rankEl.textContent = "#" + (rankIdx + 1);
						rankEl.classList.add("speedRankAnimating");
						setTimeout(function(el) { el.classList.remove("speedRankAnimating"); }, 600, rankEl);
					}
				}
			})(allCards[k]);
		}
	}

	startBtn.addEventListener("click", function() {
		if (running) return;
		hosts = parseHostInput();
		if (!hosts.length) return;
		hostInput.value = hosts.join("\n");
		saveHosts();
		buildGrid();

		running = true;
		startBtn.disabled = true;
		startBtn.innerHTML =
			'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation: speedSpin 0.8s linear infinite;"><path d="M12 2a10 10 0 0 1 10 10"/></svg>' +
			"测试中…";

		hosts.forEach(function(d, i) { testDomain(d, i); });

		setTimeout(function() {
			running = false;
			startBtn.disabled = false;
			startBtn.innerHTML =
				'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>' +
				"重新测速";
		}, hosts.length * 2000 + 1000);
	});

	resetBtn.addEventListener("click", function() {
		if (running) return;
		hostInput.value = DEFAULT_HOSTS.join("\n");
		saveHosts();
		buildGrid();
	});

	hostInput.addEventListener("change", function() {
		if (running) return;
		saveHosts();
		buildGrid();
	});

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
		setTimeout(function() { observer.disconnect(); showApp(); }, 500);
	}

	function boot() {
		hostInput.value = loadHosts().join("\n");
		buildGrid();
		waitForNav();
		if (window.siteNav && typeof window.siteNav.init === "function") {
			window.siteNav.init({
				setTheme: function(theme) {
					document.documentElement.setAttribute("data-theme", theme);
				}
			});
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}

})();

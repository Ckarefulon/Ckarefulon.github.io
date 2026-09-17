/* ==========================================================
   Question — 问题清单
   列表 = 清单（可多份）；每份清单 = 问题块 + 答案块
   未获答案 → 青色；已获答案 → 紫色
   数据模型沿用全站约定：mut 新者胜，删除 = 墓碑 del:true
   ========================================================== */
(function () {
	'use strict';

	var LS_KEY = 'studyQuestion.v1';
	var CONFIRM_MS = 2500;
	var DEFAULT_LIST_NAME = '主清单';

	function $(id) { return document.getElementById(id); }

	function genId() {
		return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	/* ================= 数据 ================= */

	function clampListName(name, fallback) {
		var s = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
		if (!s) return fallback || DEFAULT_LIST_NAME;
		return s.slice(0, 30);
	}

	function normalizeItem(raw) {
		if (!raw || typeof raw !== 'object') return null;
		var answer = (typeof raw.answer === 'string') ? raw.answer : '';
		var out = {
			id: (typeof raw.id === 'string' && raw.id) ? raw.id : genId(),
			listId: (typeof raw.listId === 'string' && raw.listId) ? raw.listId : '',
			/* no = 序号：建立时分配，筛选 / 搜索 / 删除都不改它，
			   只有整理面板里重新排序才按新顺序重排（renumberList）；
			   缺失/非法一律记 0，由 ensureItemNos() 统一补号 */
			no: (typeof raw.no === 'number' && isFinite(raw.no) && raw.no > 0) ? Math.floor(raw.no) : 0,
			question: (typeof raw.question === 'string') ? raw.question : '',
			answer: answer,
			source: (raw.source === 'import') ? 'import' : 'manual',
			createdAt: (typeof raw.createdAt === 'number') ? raw.createdAt : Date.now(),
			mut: (typeof raw.mut === 'number') ? raw.mut : 0,
			del: !!raw.del
		};
		if (answer.trim()) {
			out.solvedAt = (typeof raw.solvedAt === 'number') ? raw.solvedAt : out.mut;
		} else if (typeof raw.solvedAt === 'number') {
			out.solvedAt = raw.solvedAt;
		}
		if (!out.question && !answer) return null;
		return out;
	}

	function normalizeList(raw) {
		if (!raw || typeof raw !== 'object') return null;
		return {
			id: (typeof raw.id === 'string' && raw.id) ? raw.id : genId(),
			name: clampListName(raw.name),
			createdAt: (typeof raw.createdAt === 'number') ? raw.createdAt : Date.now(),
			mut: (typeof raw.mut === 'number') ? raw.mut : 0,
			del: !!raw.del
		};
	}

	function freshData() {
		var id = genId();
		return {
			lists: [{ id: id, name: DEFAULT_LIST_NAME, createdAt: Date.now(), mut: 0, del: false }],
			items: [],
			activeListId: id,
			listsMut: 0,
			itemsMut: 0
		};
	}

	function load() {
		try {
			var raw = localStorage.getItem(LS_KEY);
			if (raw) {
				var d = JSON.parse(raw);
				if (d && typeof d === 'object') {
					var lists = [];
					var arr = Array.isArray(d.lists) ? d.lists : [];
					for (var i = 0; i < arr.length; i++) {
						var L = normalizeList(arr[i]);
						if (L) lists.push(L);
					}
					var items = [];
					var arr2 = Array.isArray(d.items) ? d.items : [];
					for (var j = 0; j < arr2.length; j++) {
						var it = normalizeItem(arr2[j]);
						if (it) items.push(it);
					}
					if (!lists.length) {
						var nid = genId();
						lists.push({ id: nid, name: DEFAULT_LIST_NAME, createdAt: Date.now(), mut: 0, del: false });
					}
					var active = (typeof d.activeListId === 'string') ? d.activeListId : null;
					var alive = lists.filter(function (L) { return !L.del; });
					if (!active || !alive.some(function (L) { return L.id === active; })) {
						active = alive.length ? alive[0].id : lists[0].id;
					}
					return {
						lists: lists,
						items: items,
						activeListId: active,
						listsMut: (typeof d.listsMut === 'number') ? d.listsMut : 0,
						itemsMut: (typeof d.itemsMut === 'number') ? d.itemsMut : 0
					};
				}
			}
		} catch (e) { /* ignore */ }
		return freshData();
	}

	var data = load();

	/* 启动即补号：老数据（没有 no 字段）按当前可见顺序落成 1、2、3…，
	   之后序号就不再随筛选 / 删除 / 排序变化。补过号就落盘一次，让号固定下来 */
	if (ensureItemNos()) save(false);

	function save(cloudPush) {
		try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* ignore */ }
		if (cloudPush) pushCloud();
	}

	/* ================= 派生数据 ================= */

	function activeLists() {
		return data.lists.filter(function (L) { return !L.del; });
	}
	function getActiveList() {
		var alive = activeLists();
		var found = null;
		for (var i = 0; i < alive.length; i++) {
			if (alive[i].id === data.activeListId) { found = alive[i]; break; }
		}
		if (!found) {
			found = alive[0] || null;
			if (found) data.activeListId = found.id;
		}
		return found;
	}
	function itemsOf(listId) {
		var out = [];
		for (var i = 0; i < data.items.length; i++) {
			var it = data.items[i];
			if (it.del || it.listId !== listId) continue;
			out.push(it);
		}
		return out;
	}

	/* ---------- 序号 ----------
	   序号 = 条目自带的字段 no，建立时分配。
	   · 筛选 / 搜索 / 删除：只改可见范围，序号一律不动（删除只留空档，后续条目不往上挪）
	   · 整理面板里拖动 / ↑↓ 排序：这是「重新整理顺序」，按新顺序重排成 1、2、3… */

	/* 新条目的号 = 本清单当前最大活号 + 1（不填补空档） */
	function nextItemNo(listId) {
		var m = 0;
		for (var i = 0; i < data.items.length; i++) {
			var it = data.items[i];
			if (it.del || it.listId !== listId) continue;
			if (typeof it.no === 'number' && it.no > m) m = it.no;
		}
		return m + 1;
	}

	/* 认领 / 补号（幂等，可重复调用）：
	   ①先认领已有合法号（同清单内先到先得，撞号的后到者视为缺号）；
	   ②再给缺号条目补号 —— 活条目按数组顺序（= 当前显示顺序）补，
	     已删除条目最后补，这样老数据升级后看到的号就是现在的 1、2、3… */
	function ensureItemNos() {
		var used = {}, max = {}, i, it, changed = false;
		var live = [], dead = [];
		for (i = 0; i < data.items.length; i++) {
			it = data.items[i];
			(it.del ? dead : live).push(it);
		}
		function scan(arr) {
			for (var k = 0; k < arr.length; k++) {
				var t = arr[k], lid = t.listId || '';
				var v = (typeof t.no === 'number' && isFinite(t.no) && t.no > 0) ? Math.floor(t.no) : 0;
				t.no = 0;
				if (!v) continue;
				if (!used[lid]) { used[lid] = {}; max[lid] = 0; }
				if (used[lid][v]) continue;                 /* 撞号：后到者重新分配 */
				used[lid][v] = true;
				t.no = v;
				if (v > max[lid]) max[lid] = v;
			}
		}
		function fill(arr) {
			for (var k = 0; k < arr.length; k++) {
				var t = arr[k], lid = t.listId || '';
				if (t.no) continue;
				if (max[lid] == null) max[lid] = 0;
				t.no = ++max[lid];
				changed = true;
			}
		}
		scan(live); fill(live);
		scan(dead); fill(dead);
		return changed;
	}

	/* 整理面板里重新排序后：活条目按新顺序重编成 1、2、3…（顺手把删除留下的空档收拢） */
	function renumberList(listId) {
		var n = 0;
		for (var i = 0; i < data.items.length; i++) {
			var it = data.items[i];
			if (it.del || it.listId !== listId) continue;
			it.no = ++n;
		}
	}
	function isSolved(it) {
		return !!(it && typeof it.answer === 'string' && it.answer.trim());
	}
	function listStats(listId) {
		var all = itemsOf(listId);
		var open = 0;
		for (var i = 0; i < all.length; i++) { if (!isSolved(all[i])) open++; }
		return { total: all.length, open: open, solved: all.length - open };
	}

	/* ================= 视图状态 ================= */
	var view = {
		filter: 'all',      // all | open | solved
		search: '',
		draft: null,        // 新增草稿
		editingId: null,    // 正在编辑的条目 id
		editingAnswerOnly: false,
		answerOpen: {},     // 手风琴：未解条目点名展开
		collapsed: false    // 收起全部答案
	};

	/* ================= 工具 ================= */

	function esc(s) {
		return String(s == null ? '' : s)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	}

	function fmtDate(ts) {
		if (typeof ts !== 'number' || !isFinite(ts)) return '';
		var d = new Date(ts);
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
	}

	/* 极简元信息：当年只显示 MM-DD，跨年才带年份 */
	function fmtShort(ts) {
		if (typeof ts !== 'number' || !isFinite(ts)) return '';
		var d = new Date(ts);
		var mmdd = String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
		return d.getFullYear() === new Date().getFullYear() ? mmdd : d.getFullYear() + '-' + mmdd;
	}

	var toastTimer = 0;
	function toast(msg, kind) {
		var el = $('toast');
		if (!el) return;
		el.textContent = msg;
		el.className = 'show' + (kind ? ' ' + kind : '');
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(function () { el.className = ''; }, 2000);
	}

	function disarm(btn) {
		if (btn.__t) clearTimeout(btn.__t);
		btn.__t = null; btn.__armed = false;
		btn.classList.remove('armed');
		if (btn.__orig != null && btn.classList.contains('actDel')) btn.textContent = btn.__orig;
	}
	function armConfirm(btn, fn) {
		if (btn.__armed) { disarm(btn); fn(); return; }
		btn.__orig = btn.textContent;
		btn.__armed = true;
		btn.classList.add('armed');
		toast('再点一次确认', 'warn');
		btn.__t = setTimeout(function () { disarm(btn); }, CONFIRM_MS);
	}

	/* ================= 列表管理（顶部） ================= */

	function renderListBar() {
		var cur = getActiveList();
		var st = cur ? listStats(cur.id) : { total: 0, open: 0, solved: 0 };
		$('listCurrentText').textContent = cur ? cur.name : DEFAULT_LIST_NAME;
		$('listCurrentCount').textContent = st.total ? (st.total + ' 条') : '';

		var alive = activeLists();
		var others = alive.filter(function (L) { return cur && L.id !== cur.id; });
		var html = '';
		if (!others.length) {
			html = '<div class="listEmptyOption">还没有别的清单，点右侧 + 新建</div>';
		} else {
			html = others.map(function (L) {
				var s = listStats(L.id);
				return '<button class="listOption" type="button" data-list-id="' + esc(L.id) + '" role="menuitem">'
					+ '<span class="listOptionName">' + esc(L.name) + '</span>'
					+ '<span class="listOptionMeta">' + s.total + ' 条 · 剩 ' + s.open + '</span>'
					+ '</button>';
			}).join('');
		}
		$('listMenu').innerHTML = html;

		var bar = $('listBar');
		if (bar) bar.classList.remove('isEditing', 'isCreating');
		var input = $('listNameInput');
		if (input) input.value = cur ? cur.name : '';
		var sel = $('listSelector');
		if (sel) { sel.classList.remove('isOpen'); $('listCurrent').setAttribute('aria-expanded', 'false'); }
		if (cur) $('listDelBtn').title = '删除清单「' + cur.name + '」';
	}

	function setActiveList(id) {
		if (!id || id === data.activeListId) return;
		var alive = activeLists();
		if (!alive.some(function (L) { return L.id === id; })) return;
		data.activeListId = id;
		view.draft = null;
		view.editingId = null;
		view.answerOpen = {};
		save(true);
		renderAll();
	}

	function createList() {
		var input = $('listNameInput');
		var name = clampListName(input ? input.value : '');
		var id = genId();
		data.lists.push({ id: id, name: name, createdAt: Date.now(), mut: Date.now(), del: false });
		data.activeListId = id;
		data.listsMut = Date.now();
		view.draft = null;
		view.editingId = null;
		view.answerOpen = {};
		save(true);
		renderAll();
		toast('已新建「' + name + '」');
	}

	function renameActiveList() {
		var input = $('listNameInput');
		var cur = getActiveList();
		if (!cur) return;
		var name = clampListName(input ? input.value : '', cur.name);
		if (name === cur.name) { renderListBar(); return; }
		cur.name = name;
		cur.mut = Date.now();
		data.listsMut = Date.now();
		save(true);
		renderAll();
		toast('已改名「' + name + '」');
	}

	function deleteActiveList() {
		var cur = getActiveList();
		if (!cur) return;
		var alive = activeLists();
		if (alive.length <= 1) { toast('至少保留一个清单', 'warn'); return; }
		var now = Date.now();
		cur.del = true;
		cur.mut = now;
		for (var i = 0; i < data.items.length; i++) {
			if (data.items[i].listId === cur.id && !data.items[i].del) {
				data.items[i].del = true;
				data.items[i].mut = now;
			}
		}
		data.listsMut = now;
		data.itemsMut = now;
		var rest = activeLists();
		data.activeListId = rest.length ? rest[0].id : null;
		view.draft = null;
		view.editingId = null;
		view.answerOpen = {};
		save(true);
		renderAll();
		toast('已删除「' + cur.name + '」');
	}

	/* ================= 渲染列表 ================= */

	function visibleItems() {
		var cur = getActiveList();
		if (!cur) return [];
		/* 顺序 = 条目建立顺序（数组原序），已获得答案不移位、编号稳定。
		   排序只在「整理」面板手动进行 */
		var all = itemsOf(cur.id);
		var f = view.filter;
		if (f === 'open') all = all.filter(function (it) { return !isSolved(it); });
		else if (f === 'solved') all = all.filter(function (it) { return isSolved(it); });
		var q = view.search.trim().toLowerCase();
		if (q) {
			all = all.filter(function (it) {
				return String(it.question).toLowerCase().indexOf(q) >= 0
					|| String(it.answer || '').toLowerCase().indexOf(q) >= 0;
			});
		}
		return all;
	}

	function answerVisible(it) {
		if (view.editingId === it.id) return true;
		if (view.collapsed) return false;
		if (isSolved(it)) return true;
		return !!view.answerOpen[it.id];
	}

	function itemHtml(it) {
		var solved = isSolved(it);
		var cls = 'item ' + (solved ? 'isSolved' : 'isOpen');
		if (view.editingId === it.id) cls += ' isEditing';
		var h = '<article class="' + cls + '" data-item-id="' + esc(it.id) + '">';
		/* 序号用条目自带的 no（不按可见位置重排） */
		h += '<span class="itemIndex">' + (it.no > 0 ? it.no : '') + '</span>';
		h += '<div class="itemBody">';

		if (view.editingId === it.id) {
			h += editorHtml(it);          /* 编辑态只留编辑器，问题文本不再重复一遍 */
		} else {
			/* 头行：问题在左，「编辑」按钮贴最右；删除/复制/未解按钮已移入整理面板 */
			h += '<div class="itemHead">';
			h += '<div class="qText">' + esc(it.question) + '</div>';
			h += '<span class="actMeta">' + esc(fmtShort(it.createdAt)) + '</span>';
			h += '<button class="actBtn actEdit" type="button">编辑</button>';
			h += '</div>';
			if (solved && answerVisible(it)) {
				h += '<div class="aBlock isFilled"><div class="aText">' + esc(it.answer) + '</div></div>';
			} else if (solved) {
				h += '<div class="aBlock isCollapsed"><button class="collapseBtn actExpand" type="button">答案</button></div>';
			} else {
				h += '<div class="aBlock isCollapsed"><button class="collapseBtn actSolve" type="button">＋ 答案</button></div>';
			}
		}

		h += '</div></article>';
		return h;
	}

	/* 编辑器：只有两个输入框，无按钮（失焦即存、Esc 取消） */
	function editorHtml(it) {
		var key = it ? esc(it.id) : 'new';
		var h = '<div class="editor" data-editor="' + key + '">';
		h += '<textarea class="edArea edQ" rows="2" placeholder="问题"></textarea>';
		h += '<textarea class="edArea edA" rows="3" placeholder="答案（可留空）"></textarea>';
		h += '</div>';
		return h;   /* 内容由 hydrateEditors() 回填，避免内联转义问题 */
	}

	function draftHtml() {
		var h = '<article class="item isOpen isEditing" data-item-id="__draft__">';
		h += '<span class="itemIndex">+</span>';
		h += '<div class="itemBody">';
		h += editorHtml(null);
		h += '</div></article>';
		return h;
	}

	/* 编辑器用 DOM 赋值回填内容，避免内联转义问题 */
	function hydrateEditors() {
		var eds = document.querySelectorAll('.editor');
		for (var i = 0; i < eds.length; i++) {
			var ed = eds[i];
			var key = ed.getAttribute('data-editor');
			var it = key === 'new' ? view.draft : findItem(key);
			if (!it) continue;
			var q = ed.querySelector('.edQ'), a = ed.querySelector('.edA');
			if (q) q.value = it.question || '';
			if (a) a.value = it.answer || '';
		}
	}

	function renderList() {
		var scroll = $('qScroll');
		var keepTop = scroll ? scroll.scrollTop : 0;
		var list = visibleItems();
		/* 新建草稿固定在列表最底端 */
		var html = list.map(function (it) { return itemHtml(it); }).join('');
		if (view.draft != null) html += draftHtml();
		$('qList').innerHTML = html;

		var hint = $('emptyHint');
		if (!list.length && view.draft == null) {
			hint.hidden = false;
			var cur = getActiveList();
			if (!cur) hint.textContent = '点 + 新建清单';
			else if (view.search.trim()) hint.textContent = '没找到「' + view.search.trim() + '」';
			else if (view.filter === 'open') hint.textContent = '没有未解的问题';
			else if (view.filter === 'solved') hint.textContent = '还没有已解的问题';
			else hint.textContent = '点 + 记下第一个问题';
		} else {
			hint.hidden = true;
		}

		if (scroll && view.draft == null) scroll.scrollTop = Math.min(keepTop, scroll.scrollHeight);
		hydrateEditors();
		renderOwed = false;
	}

	function renderStats() {
		var cur = getActiveList();
		var st = cur ? listStats(cur.id) : { total: 0, open: 0, solved: 0 };
		$('qStatLine').innerHTML = st.total + ' 条 · 未解 <b>' + st.open + '</b> · 已解 <i>' + st.solved + '</i>';
		var btns = $('qFilter').querySelectorAll('.qFilterBtn');
		for (var i = 0; i < btns.length; i++) {
			btns[i].classList.toggle('isActive', btns[i].getAttribute('data-filter') === view.filter);
		}
	}

	function renderFoldIcon() {
		var icon = $('foldIcon');
		if (!icon) return;
		icon.innerHTML = view.collapsed
			? '<path d="M6 15L12 9L18 15"/>'
			: '<path d="M6 9L12 15L18 9"/>';
		$('btnFold').title = view.collapsed ? '展开全部答案' : '收起全部答案';
	}

	function renderManage() {
		var alive = activeLists();
		var cur = getActiveList();
		var html = alive.map(function (L) {
			var s = listStats(L.id);
			return '<div class="manageRow' + (cur && L.id === cur.id ? ' isActive' : '') + '" data-list-id="' + esc(L.id) + '">'
				+ '<span class="manageRowName">' + esc(L.name) + '</span>'
				+ '<span class="manageRowMeta">' + s.total + ' 条</span>'
				+ '<button class="miniBtn mgoSwitch" type="button">切换</button>'
				+ '<button class="miniBtn mgoRename" type="button">重命名</button>'
				+ '<button class="miniBtn mgoDel" type="button">删除</button>'
				+ '</div>';
		}).join('');
		$('manageList').innerHTML = html || '<div class="manageHint">还没有清单</div>';
	}

	function renderAll() {
		renderListBar();
		renderStats();
		renderList();
		renderFoldIcon();
		renderManage();
		renderItemsPanel();
	}

	/* ================= 条目操作 ================= */

	/* 切换编辑目标前，先把已打开的编辑器落盘（只写数据，渲染交给调用方）。
	   返回是否有内容被提交 */
	function flushOpenEditors() {
		var eds = document.querySelectorAll('.editor');
		var any = false;
		for (var i = 0; i < eds.length; i++) { if (autosaveSilent(eds[i])) any = true; }
		return any;
	}

	function startDraft() {
		var cur = getActiveList();
		if (!cur) { toast('先新建清单', 'warn'); return; }
		flushOpenEditors();
		view.editingId = null;
		view.draft = { question: '', answer: '' };
		renderList();
		var sc = $('qScroll');
		if (sc) sc.scrollTop = sc.scrollHeight;   /* 草稿在最底端，滚下去 */
		focusEditor('.edQ');
	}

	function startEdit(id) {
		var it = findItem(id);
		if (!it) return;
		flushOpenEditors();
		if (view.editingId === id) return;
		view.draft = null;
		view.editingId = id;
		renderList();
		var ta = document.querySelector('.editor[data-editor="' + cssEsc(id) + '"] .edQ');
		if (ta) { ta.focus(); var n = ta.value.length; try { ta.setSelectionRange(n, n); } catch (e) { /* ignore */ } }
	}

	function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

	function findItem(id) {
		for (var i = 0; i < data.items.length; i++) {
			if (data.items[i].id === id && !data.items[i].del) return data.items[i];
		}
		return null;
	}

	function focusEditor(sel) {
		setTimeout(function () {
			var el = document.querySelector(sel);
			if (el) { el.focus(); }
		}, 0);
	}

	/* 把编辑器内容写进数据层（不渲染）。
	   返回 'saved' | 'same' | 'empty' | 'noop' */
	function commitEditor(ed, id) {
		if (!ed) { if (id === '__draft__') view.draft = null; else view.editingId = null; return 'noop'; }
		var q = (ed.querySelector('.edQ').value || '').trim();
		var a = (ed.querySelector('.edA').value || '').trim();
		var now = Date.now();

		if (id === '__draft__') {
			view.draft = null;
			if (!q && !a) return 'empty';
			var cur = getActiveList();
			if (!cur) { toast('先新建清单', 'warn'); return 'noop'; }
			var it = {
				id: genId(), listId: cur.id, no: nextItemNo(cur.id), question: q, answer: a,
				source: 'manual', createdAt: now, mut: now, del: false
			};
			if (a) it.solvedAt = now;
			data.items.push(it);
			data.itemsMut = now;
			save(true);
			toast(a ? '已记下问题与答案' : '已记下问题');
			return 'saved';
		}

		var target = findItem(id);
		view.editingId = null;
		if (!target) return 'noop';
		if (!q && !a) { toast('内容为空，未保存', 'warn'); return 'empty'; }
		if (target.question === q && (target.answer || '') === a) return 'same';

		var wasSolved = isSolved(target);
		target.question = q;
		target.answer = a;
		if (a && !wasSolved) { target.solvedAt = now; toast('已获得答案'); }
		else if (!a && wasSolved) { delete target.solvedAt; toast('已标为未解'); }
		target.mut = now;
		data.itemsMut = now;
		save(true);
		return 'saved';
	}

	/* 统一收尾：渲染 + 草稿滚到底 */
	function afterCommit(isDraft) {
		renderAll();
		if (isDraft) {
			var list = $('qScroll');
			if (list) list.scrollTop = list.scrollHeight;
		}
	}

	function editorNode(id) {
		return document.querySelector('.editor[data-editor="' + cssEsc(id === '__draft__' ? 'new' : id) + '"]');
	}

	/* 手动提交（Ctrl/⌘+Enter、Enter 跳转后失焦、列表被程序化收起前的兜底） */
	function saveDraft() {
		var ed = editorNode('__draft__');
		if (!ed) { view.draft = null; renderList(); return; }
		ed.__done = true;
		commitEditor(ed, '__draft__');
		afterCommit(true);
	}

	function saveEdit(id) {
		var ed = editorNode(id);
		if (ed) ed.__done = true;
		var r = commitEditor(ed, id);
		if (r === 'noop' && !ed) { renderList(); return; }
		afterCommit(false);
	}

	/* 落盘但欠一次重绘（由接手的点击或被点走的失焦收尾） */
	var renderOwed = false;

	/* 失焦落盘（不渲染）。返回被提交的条目 id，无则 null */
	function autosaveSilent(ed) {
		if (!ed || ed.__done) return null;
		ed.__done = true;
		var card = ed.closest('.item');
		var id = card ? card.getAttribute('data-item-id') : null;
		if (!id) return null;
		commitEditor(ed, id);
		renderOwed = true;
		return id;
	}

	/* 失焦落盘 + 立即渲染 */
	function autosaveFrom(ed) {
		var id = autosaveSilent(ed);
		if (id) afterCommit(id === '__draft__');
	}

	function takeRenderOwed() { var v = renderOwed; renderOwed = false; return v; }

	function solveInline(id) {
		var it = findItem(id);
		if (!it) return;
		flushOpenEditors();
		view.answerOpen[id] = true;
		view.editingId = id;
		renderList();
		focusEditor('.editor[data-editor="' + cssEsc(id) + '"] .edA');
	}

	function openEditAnswer(id) {
		var it = findItem(id);
		if (!it) return;
		flushOpenEditors();
		view.editingId = id;
		renderList();
		focusEditor('.editor[data-editor="' + cssEsc(id) + '"] .edA');
	}

	/* ================= 条目删除 / 整理面板（排序、删除） ================= */

	function deleteItem(id) {
		var it = findItem(id);
		if (!it) return;
		var el = document.querySelector('.item[data-item-id="' + cssEsc(id) + '"]');
		var now = Date.now();
		it.del = true;
		it.mut = now;
		data.itemsMut = now;
		save(true);
		if (el) {
			el.classList.add('isLeaving');
			setTimeout(function () {
				renderAll();
				toast('已删除');
			}, 200);
		} else {
			renderAll();
			toast('已删除');
		}
	}

	/* 整理面板排序：把条目从 from 挪到 to（同清单内）。
	   顺序 = data.items 的数组顺序，挪动后同清单其它条目相对顺序不变。 */
	function reorderItem(id, from, to) {
		var it = findItem(id);
		if (!it) return false;
		var seq = itemsOf(it.listId);
		if (from < 0 || to < 0 || from >= seq.length || to >= seq.length || from === to) return false;
		var anchor = seq[to];
		var ia = data.items.indexOf(it);
		if (ia < 0) return false;
		data.items.splice(ia, 1);                        /* 先抽出 */
		var ib = data.items.indexOf(anchor);
		if (ib < 0) { data.items.splice(ia, 0, it); return false; }
		data.items.splice(to < from ? ib : ib + 1, 0, it);   /* 上移插在锚点前，下移插在锚点后 */
		renumberList(it.listId);                         /* 拖动/↑↓ 排序 = 按新顺序重排名号 */
		var now = Date.now();
		it.mut = now;
		anchor.mut = now;                                /* 顺序变更也走 mut 新者胜，同步到云端 */
		data.itemsMut = now;
		view.editingId = null;
		save(true);
		renderAll();
		return true;
	}

	/* 键盘排序（手柄聚焦时 ↑↓）：拖动为主，键盘为辅 */
	function moveItemByKey(id, dir) {
		var it = findItem(id);
		if (!it) return;
		var seq = itemsOf(it.listId);
		var i = -1;
		for (var k = 0; k < seq.length; k++) { if (seq[k].id === id) { i = k; break; } }
		if (i < 0) return;
		var j = i + dir;
		if (j < 0 || j >= seq.length) return;
		if (!reorderItem(id, i, j)) return;
		var h = document.querySelector('#manageItems .dragHandle[data-drag-for="' + cssEsc(id) + '"]');
		if (h) h.focus();                                /* 重绘后把焦点还回手柄，便于连按 */
	}

	/* 整理面板「条目」区：按当前顺序列出，按住手柄拖动排序、删除需二确认 */
	function renderItemsPanel() {
		var host = $('manageItems');
		if (!host) return;
		var cur = getActiveList();
		var seq = cur ? itemsOf(cur.id) : [];
		if (!seq.length) {
			host.innerHTML = '<div class="manageHint">当前清单还没有条目</div>';
			return;
		}
		host.innerHTML = seq.map(function (it) {
			return '<div class="manageRow manageRowItem" data-item-id="' + esc(it.id) + '">'
				+ '<span class="dragHandle" data-drag-for="' + esc(it.id) + '" role="button" tabindex="0" title="按住拖动排序" aria-label="拖动排序">'
				+ '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="6" cy="3.6" r="1.3"/><circle cx="10" cy="3.6" r="1.3"/><circle cx="6" cy="8" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="6" cy="12.4" r="1.3"/><circle cx="10" cy="12.4" r="1.3"/></svg>'
				+ '</span>'
				+ '<span class="manageRowIdx">' + (it.no > 0 ? it.no : '') + '</span>'
				+ '<span class="manageRowName">' + esc(it.question || '（无问题文本）') + '</span>'
				+ '<button class="miniBtn mgoDelItem" type="button">删除</button>'
				+ '</div>';
		}).join('');
	}

	/* ---------- 整理面板：拖动排序 ---------- */

	var dragState = null;
	var dragRaf = 0;

	function panelRows() {
		var host = $('manageItems');
		return host ? Array.prototype.slice.call(host.querySelectorAll('.manageRowItem')) : [];
	}

	function dragShiftAll() {
		var st = dragState;
		if (!st) return;
		var hf = st.heights[st.from];
		st.row.style.transform = 'translateY(' + st.dy + 'px)';
		for (var k = 0; k < st.rows.length; k++) {
			if (k === st.from) continue;
			var shift = 0;
			if (st.to > st.from && k > st.from && k <= st.to) shift = -hf;
			else if (st.to < st.from && k >= st.to && k < st.from) shift = hf;
			st.rows[k].style.transform = shift ? 'translateY(' + shift + 'px)' : '';
		}
		dragRenumber();
	}

	/* 拖动中按「预览顺序」实时重排名号（松手后落盘的就是这套号） */
	function dragRenumber() {
		var st = dragState;
		if (!st) return;
		for (var k = 0; k < st.rows.length; k++) {
			var n = k;
			if (k === st.from) n = st.to;
			else if (st.to > st.from && k > st.from && k <= st.to) n = k - 1;
			else if (st.to < st.from && k >= st.to && k < st.from) n = k + 1;
			var el = st.rows[k].querySelector('.manageRowIdx');
			if (el) el.textContent = String(n + 1);
		}
	}

	/* 落点 = 拖拽行中心落在第几条之前（其它行的原始中点做基准） */
	function dragCompute() {
		var st = dragState;
		if (!st) return;
		var center = st.tops[st.from] + st.heights[st.from] / 2 + st.dy;
		var to = 0;
		for (var k = 0; k < st.rows.length; k++) {
			if (k === st.from) continue;
			if (st.tops[k] + st.heights[k] / 2 < center) to++;
		}
		st.to = to;
		dragShiftAll();
	}

	function dragEdgeScroll(clientY) {
		var st = dragState;
		if (!st || !st.scroller) return;
		var r = st.scroller.getBoundingClientRect();
		var edge = 48, v = 0;
		if (clientY > r.bottom - edge) v = Math.min(14, (clientY - (r.bottom - edge)) * 0.5 + 3);
		else if (clientY < r.top + edge) v = -Math.min(14, ((r.top + edge) - clientY) * 0.5 + 3);
		st.scrollDir = v;
		if (v && !dragRaf) dragRaf = requestAnimationFrame(dragTick);
	}

	function dragTick() {
		dragRaf = 0;
		var st = dragState;
		if (!st || !st.active) return;
		if (st.scrollDir && st.scroller) {
			st.scroller.scrollTop += st.scrollDir;
			st.dy = st.lastY - st.startY + (st.scroller.scrollTop - st.scrollTop0);
			dragCompute();
		}
		dragEdgeScroll(st.lastY);      /* 重新评估边缘，需要就续下一帧 */
	}

	function dragUpdate(clientY) {
		var st = dragState;
		if (!st) return;
		st.lastY = clientY;
		st.dy = clientY - st.startY + (st.scroller ? st.scroller.scrollTop - st.scrollTop0 : 0);
		dragCompute();
		dragEdgeScroll(clientY);
	}

	function dragDown(e) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		var handle = e.target.closest ? e.target.closest('.dragHandle') : null;
		if (!handle) return;
		var row = handle.closest('.manageRowItem');
		if (!row) return;
		var rows = panelRows();
		if (rows.length < 2) return;
		var sc = row.closest('.manageSheet');
		dragState = {
			id: row.getAttribute('data-item-id'),
			row: row, rows: rows, handle: handle,
			from: rows.indexOf(row), to: rows.indexOf(row),
			startY: e.clientY, lastY: e.clientY, dy: 0, scrollDir: 0,
			pointerId: e.pointerId, active: false,
			scroller: sc, scrollTop0: sc ? sc.scrollTop : 0,
			tops: rows.map(function (r) { return r.offsetTop; }),
			heights: rows.map(function (r) { return r.offsetHeight; })
		};
		try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
	}

	function dragMove(e) {
		var st = dragState;
		if (!st || e.pointerId !== st.pointerId) return;
		if (!st.active) {
			if (Math.abs(e.clientY - st.startY) < 4) return;   /* 微动不算拖，保护点击 */
			st.active = true;
			st.handle.classList.add('isHolding');
			st.row.classList.add('isDragging');
			var host = $('manageItems');
			if (host) host.classList.add('isSorting');
			document.body.classList.add('qDragging');
		}
		if (e.cancelable) e.preventDefault();
		dragUpdate(e.clientY);
	}

	function dragUp(e) {
		var st = dragState;
		if (!st || (e && e.pointerId != null && e.pointerId !== st.pointerId)) return;
		dragState = null;
		if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
		for (var k = 0; k < st.rows.length; k++) {
			st.rows[k].style.transform = '';
			st.rows[k].classList.remove('isDragging');
		}
		st.handle.classList.remove('isHolding');
		var host = $('manageItems');
		if (host) host.classList.remove('isSorting');
		document.body.classList.remove('qDragging');
		try { st.handle.releasePointerCapture(st.pointerId); } catch (err) { /* ignore */ }
		/* 只有真的换了位置才落盘重绘；没动就别动 DOM（保住手柄焦点） */
		if (st.active && st.to !== st.from) reorderItem(st.id, st.from, st.to);
	}

	function bindItemsPanelDrag(host) {
		host.addEventListener('pointerdown', dragDown);
		document.addEventListener('pointermove', dragMove, { passive: false });
		document.addEventListener('pointerup', dragUp);
		document.addEventListener('pointercancel', dragUp);
	}

	function bindItemsPanel() {
		var host = $('manageItems');

		host.addEventListener('click', function (e) {
			var row = e.target.closest('.manageRow[data-item-id]');
			if (!row) return;
			var id = row.getAttribute('data-item-id');
			var del = e.target.closest('.mgoDelItem');
			if (del) {
				/* 行内二确认（不复用 armConfirm，避免文案冲突） */
				if (del.__armed) {
					disarmRow(del);
					deleteItem(id);
					return;
				}
				del.__armed = true;
				del.classList.add('armed');
				del.textContent = '确认删除';
				toast('再点一次确认', 'warn');
				del.__t = setTimeout(function () { disarmRow(del); }, CONFIRM_MS);
			}
		});

		host.addEventListener('keydown', function (e) {
			var h = e.target.closest ? e.target.closest('.dragHandle') : null;
			if (!h) return;
			var row = h.closest('.manageRow[data-item-id]');
			if (!row) return;
			if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
			e.preventDefault();
			moveItemByKey(row.getAttribute('data-item-id'), e.key === 'ArrowUp' ? -1 : 1);
		});

		bindItemsPanelDrag(host);
	}

	/* ================= 事件绑定 ================= */

	function bindListBar() {
		$('listCurrent').addEventListener('click', function (e) {
			e.stopPropagation();
			var sel = $('listSelector');
			var open = !sel.classList.contains('isOpen');
			sel.classList.toggle('isOpen', open);
			this.setAttribute('aria-expanded', open ? 'true' : 'false');
		});

		$('listMenu').addEventListener('click', function (e) {
			var opt = e.target.closest('.listOption[data-list-id]');
			if (!opt) return;
			setActiveList(opt.getAttribute('data-list-id'));
		});

		function enterCreate() {
			var bar = $('listBar');
			if (bar.classList.contains('isCreating')) { createList(); return; }
			bar.classList.remove('isEditing');
			bar.classList.add('isCreating');
			var input = $('listNameInput');
			input.value = '';
			input.placeholder = '新清单名称';
			input.focus();
		}

		function enterRename() {
			var bar = $('listBar');
			if (bar.classList.contains('isEditing')) { renameActiveList(); return; }
			bar.classList.remove('isCreating');
			bar.classList.add('isEditing');
			var input = $('listNameInput');
			var cur = getActiveList();
			input.value = cur ? cur.name : '';
			input.placeholder = '清单名称';
			input.focus();
			try { input.select(); } catch (e) { /* ignore */ }
		}

		function exitEdit() {
			$('listBar').classList.remove('isEditing', 'isCreating');
		}

		/* 点击清单条以外的地方 = 失焦保存（空名字视为放弃） */
		function commitBarEdit() {
			var bar = $('listBar');
			var input = $('listNameInput');
			var v = input ? String(input.value).trim() : '';
			if (bar.classList.contains('isCreating')) {
				if (v) createList(); else renderListBar();
			} else if (bar.classList.contains('isEditing')) {
				if (v) renameActiveList(); else renderListBar();
			}
		}

		$('listAddBtn').addEventListener('click', function (e) { e.stopPropagation(); enterCreate(); });
		$('listEditBtn').addEventListener('click', function (e) { e.stopPropagation(); enterRename(); });

		$('listDelBtn').addEventListener('click', function (e) {
			e.stopPropagation();
			var bar = $('listBar');
			if (bar.classList.contains('isCreating') || bar.classList.contains('isEditing')) { exitEdit(); return; }
			armConfirm(this, deleteActiveList);
		});

		$('listNameInput').addEventListener('keydown', function (e) {
			if (e.key === 'Enter') {
				e.preventDefault();
				if ($('listBar').classList.contains('isCreating')) createList();
				else renameActiveList();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				exitEdit();
				var cur = getActiveList();
				this.value = cur ? cur.name : '';
			}
		});

		document.addEventListener('click', function (e) {
			var sel = $('listSelector');
			var bar = $('listBar');
			if (sel && sel.classList.contains('isOpen') && !sel.contains(e.target)) {
				sel.classList.remove('isOpen');
				$('listCurrent').setAttribute('aria-expanded', 'false');
			}
			if (bar && (bar.classList.contains('isEditing') || bar.classList.contains('isCreating')) && !bar.contains(e.target)) {
				commitBarEdit();
				exitEdit();
			}
		});
	}

	function bindFilterAndSearch() {
		$('qFilter').addEventListener('click', function (e) {
			var btn = e.target.closest('.qFilterBtn');
			if (!btn) return;
			var f = btn.getAttribute('data-filter');
			if (!f || f === view.filter) return;
			view.filter = f;
			renderStats();
			renderList();
		});

		var t = 0;
		$('qSearchInput').addEventListener('input', function () {
			var v = this.value;
			if (t) clearTimeout(t);
			t = setTimeout(function () { view.search = v; renderList(); }, 160);
		});
	}

	function bindList() {
		/* 编辑器内部的留白（两个文本框之间、内边距、滚动条槽）不是可聚焦元素：
		   点下去焦点会掉到 body，focusout 的 relatedTarget 为 null ⇒ 被误判成失焦退出。
		   这里掐掉默认行为，让焦点留在编辑器里（点文本框本体不受影响）。 */
		$('qList').addEventListener('mousedown', function (e) {
			var ed = e.target.closest ? e.target.closest('.editor') : null;
			if (!ed) return;
			if (e.target.tagName === 'TEXTAREA') return;   /* 文本框本体：照常放光标 */
			e.preventDefault();
			if (!ed.contains(document.activeElement)) {
				var ta = ed.querySelector('.edQ') || ed.querySelector('.edA');
				if (ta) ta.focus();
			}
		});

		$('qList').addEventListener('click', function (e) {
			/* 点在编辑器内部（文本框里换光标位置、编辑器留白）：不算失焦、不重绘。
			   否则 click 冒泡到这里会 flush 掉正在编辑的内容 + renderAll()，
			   卡片被重绘回非编辑态 —— 看起来就是「点一下文本里别处就退出编辑」。 */
			if (e.target.closest && e.target.closest('.editor')) return;

			var card = e.target.closest('.item');
			if (!card) {
				/* 点在列表空白处：若有落盘欠下的重绘，必须还上 */
				if (takeRenderOwed()) renderAll();
				return;
			}
			var id = card.getAttribute('data-item-id');

			/* 本次点击会重绘列表，先把打开中的编辑器落盘（只写数据） */
			var flushed = flushOpenEditors() || takeRenderOwed();

			if (e.target.closest('.actSolve') || e.target.closest('.actExpand')) { solveInline(id); return; }
			if (e.target.closest('.actEdit')) { startEdit(id); return; }

			/* 没有按钮命中（点在卡片空白处）：编辑器已落盘，欠下的重绘必须补上。
			   否则界面停留在旧文本，看起来就像「失焦没保存」 */
			if (flushed) renderAll();
		});

		/* 失焦自动保存：焦点移出编辑器即落盘。
		   若焦点落到列表内其它控件（用户正在点某个按钮），只写数据不渲染，
		   交给那次点击的处理函数去重绘，避免中途换 DOM 把点击吞掉。 */
		$('qList').addEventListener('focusout', function (e) {
			var ed = e.target.closest ? e.target.closest('.editor') : null;
			if (!ed || ed.__done) return;
			var next = e.relatedTarget;
			if (next && ed.contains(next)) return;   /* 框内互跳不提交 */
			var intoList = !!(next && next.closest && next.closest('#qList'));
			if (intoList) autosaveSilent(ed);
			else autosaveFrom(ed);
		});

		$('qList').addEventListener('keydown', function (e) {
			var ed = e.target.closest('.editor');
			if (!ed) return;
			var card = ed.closest('.item');
			var id = card ? card.getAttribute('data-item-id') : null;
			var isArea = e.target.tagName === 'TEXTAREA';

			if (e.key === 'Escape') {
				e.preventDefault();
				ed.__done = true;                     /* 取消 = 不提交 */
				if (id === '__draft__') { view.draft = null; renderList(); }
				else { view.editingId = null; renderList(); }
				return;
			}
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				if (id === '__draft__') saveDraft(); else saveEdit(id);
				return;
			}
			/* 问题框 Enter：跳到答案框（不换行、不提交） */
			if (e.key === 'Enter' && !e.shiftKey && isArea && e.target.classList.contains('edQ')) {
				e.preventDefault();
				var a = ed.querySelector('.edA');
				if (a) a.focus();
			}
		});
	}

	function bindFoot() {
		$('btnAdd').addEventListener('click', startDraft);
		$('btnFold').addEventListener('click', function () {
			view.collapsed = !view.collapsed;
			if (!view.collapsed) view.answerOpen = {};
			renderFoldIcon();
			renderList();
			toast(view.collapsed ? '已收起全部答案' : '已展开全部答案');
		});
		$('btnManage').addEventListener('click', openManage);
	}

	function openManage() {
		renderManage();
		renderItemsPanel();
		$('manageOverlay').classList.add('isOpen');
		$('manageOverlay').setAttribute('aria-hidden', 'false');
	}
	function closeManage() {
		$('manageOverlay').classList.remove('isOpen');
		$('manageOverlay').setAttribute('aria-hidden', 'true');
	}

	function bindManage() {
		$('manageClose').addEventListener('click', closeManage);
		$('manageOverlay').addEventListener('click', function (e) {
			if (e.target === this) closeManage();
		});

		$('manageList').addEventListener('click', function (e) {
			var row = e.target.closest('.manageRow[data-list-id]');
			if (!row) return;
			var id = row.getAttribute('data-list-id');
			var L = null;
			for (var i = 0; i < data.lists.length; i++) {
				if (data.lists[i].id === id) { L = data.lists[i]; break; }
			}
			if (!L) return;

			if (e.target.closest('.mgoSwitch')) {
				setActiveList(id);
				renderManage();
				toast('已切到「' + L.name + '」');
				return;
			}
			if (e.target.closest('.mgoRename')) {
				var btn = e.target.closest('.mgoRename');
				armRenameRow(row, L);
				return;
			}
			var delBtn = e.target.closest('.mgoDel');
			if (delBtn) {
				if (activeLists().length <= 1) { toast('至少保留一个清单', 'warn'); return; }
				/* 行内二确认：管理面板里不用 armConfirm（会改按钮文案为「再点一次确认」） */
				if (delBtn.__armed) {
					disarmRow(delBtn);
					deleteListById(id);
					renderManage();
					return;
				}
				delBtn.__armed = true;
				delBtn.classList.add('armed');
				delBtn.textContent = '确认删除';
				toast('再点一次确认', 'warn');
				delBtn.__t = setTimeout(function () { disarmRow(delBtn); }, CONFIRM_MS);
			}
		});
	}

	function disarmRow(btn) {
		if (btn.__t) clearTimeout(btn.__t);
		btn.__t = null; btn.__armed = false;
		btn.classList.remove('armed');
		btn.textContent = '删除';
	}

	function armRenameRow(row, L) {
		var nameEl = row.querySelector('.manageRowName');
		if (!nameEl || nameEl.__input) return;
		var input = document.createElement('input');
		input.type = 'text';
		input.maxLength = 30;
		input.value = L.name;
		input.className = 'listNameInput';
		input.style.display = 'block';
		input.style.flex = '1 1 auto';
		nameEl.style.display = 'none';
		nameEl.__input = input;
		row.insertBefore(input, nameEl);
		input.focus();
		try { input.select(); } catch (e) { /* ignore */ }

		function commit(ok) {
			if (ok) {
				L.name = clampListName(input.value, L.name);
				L.mut = Date.now();
				data.listsMut = Date.now();
				save(true);
				renderAll();
				toast('已改名「' + L.name + '」');
			}
			input.remove();
			nameEl.style.display = '';
			nameEl.__input = null;
		}

		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') { e.preventDefault(); commit(true); }
			else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
		});
		input.addEventListener('blur', function () { if (nameEl.__input) commit(false); });
	}

	function deleteListById(id) {
		var L = null;
		for (var i = 0; i < data.lists.length; i++) {
			if (data.lists[i].id === id) { L = data.lists[i]; break; }
		}
		if (!L || L.del) return;
		var now = Date.now();
		L.del = true;
		L.mut = now;
		for (var j = 0; j < data.items.length; j++) {
			if (data.items[j].listId === id && !data.items[j].del) {
				data.items[j].del = true;
				data.items[j].mut = now;
			}
		}
		data.listsMut = now;
		data.itemsMut = now;
		if (data.activeListId === id) {
			var rest = activeLists();
			data.activeListId = rest.length ? rest[0].id : null;
		}
		view.draft = null;
		view.editingId = null;
		save(true);
		renderAll();
		toast('已删除「' + L.name + '」');
	}

	/* ================= 导入 / 导出 / 清空 ================= */

	function exportData() {
		var out = {
			app: 'study-question',
			version: 1,
			exportedAt: new Date().toISOString(),
			activeListId: data.activeListId,
			lists: data.lists,
			items: data.items,
			listsMut: data.listsMut || 0,
			itemsMut: data.itemsMut || 0
		};
		var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
		var n = new Date();
		var stamp = n.getFullYear() + String(n.getMonth() + 1).padStart(2, '0') + String(n.getDate()).padStart(2, '0')
			+ '-' + String(n.getHours()).padStart(2, '0') + String(n.getMinutes()).padStart(2, '0');
		var a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = 'study-question-' + stamp + '.json';
		document.body.appendChild(a); a.click();
		setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
		var live = data.items.filter(function (it) { return !it.del; }).length;
		toast('已导出 ' + activeLists().length + ' 个清单 · ' + live + ' 条');
	}

	function importData(obj) {
		if (!obj || typeof obj !== 'object') { toast('文件格式不对', 'warn'); return; }
		var now = Date.now();
		var listsIn = Array.isArray(obj.lists) ? obj.lists : [];
		var itemsIn = Array.isArray(obj.items) ? obj.items : [];
		if (!listsIn.length && !itemsIn.length) { toast('没有可导入的数据', 'warn'); return; }

		var byList = {}, byItem = {}, i;
		for (i = 0; i < data.lists.length; i++) byList[data.lists[i].id] = data.lists[i];
		for (i = 0; i < data.items.length; i++) byItem[data.items[i].id] = data.items[i];

		var addedLists = 0, addedItems = 0;
		for (i = 0; i < listsIn.length; i++) {
			var L = normalizeList(listsIn[i]);
			if (!L) continue;
			var existL = byList[L.id];
			if (!existL || (L.mut || 0) > (existL.mut || 0)) { byList[L.id] = L; addedLists++; }
		}
		var validListIds = {};
		Object.keys(byList).forEach(function (k) { if (!byList[k].del) validListIds[k] = true; });

		for (i = 0; i < itemsIn.length; i++) {
			var raw = itemsIn[i];
			if (!raw || typeof raw !== 'object') continue;
			var it = normalizeItem(raw);
			if (!it) continue;
			var lid = (typeof raw.listId === 'string' && raw.listId) ? raw.listId : data.activeListId;
			if (!validListIds[lid]) {
				/* 落单条目：放进当前清单 */
				if (!validListIds[data.activeListId]) continue;
				lid = data.activeListId;
			}
			it.listId = lid;
			it.source = 'import';
			it.mut = (typeof raw.mut === 'number' && raw.mut) ? raw.mut : now;
			var exist = byItem[it.id];
			if (!exist || it.mut > (exist.mut || 0)) { byItem[it.id] = it; addedItems++; }
		}

		data.lists = Object.keys(byList).map(function (k) { return byList[k]; });
		data.items = Object.keys(byItem).map(function (k) { return byItem[k]; });
		ensureItemNos();               /* 带 no 的沿用，缺号的按顺序补 */
		data.listsMut = now;
		data.itemsMut = now;
		var alive = activeLists();
		if (!alive.some(function (L) { return L.id === data.activeListId; })) {
			data.activeListId = alive.length ? alive[0].id : null;
		}
		save(true);
		renderAll();
		toast('导入完成：新增 ' + addedLists + ' 个清单 · ' + addedItems + ' 条');
	}

	function clearCurrentList() {
		var cur = getActiveList();
		if (!cur) return;
		var now = Date.now();
		var n = 0;
		for (var i = 0; i < data.items.length; i++) {
			if (data.items[i].listId === cur.id && !data.items[i].del) {
				data.items[i].del = true;
				data.items[i].mut = now;
				n++;
			}
		}
		data.itemsMut = now;
		view.draft = null;
		view.editingId = null;
		save(true);
		renderAll();
		toast('已清空 ' + n + ' 条');
	}

	function resetAll() {
		var now = Date.now();
		var i;
		for (i = 0; i < data.lists.length; i++) { if (!data.lists[i].del) { data.lists[i].del = true; data.lists[i].mut = now; } }
		for (i = 0; i < data.items.length; i++) { if (!data.items[i].del) { data.items[i].del = true; data.items[i].mut = now; } }
		var nid = genId();
		data.lists.push({ id: nid, name: DEFAULT_LIST_NAME, createdAt: now, mut: now, del: false });
		data.activeListId = nid;
		data.listsMut = now;
		data.itemsMut = now;
		data.items = data.items.filter(function (it) { return !it.del; });
		data.lists = data.lists.filter(function (L) { return !L.del; });
		view.draft = null;
		view.editingId = null;
		view.answerOpen = {};
		save(true);
		renderAll();
		toast('已清空全部数据');
	}

	/* ================= 云同步（Supabase user_data · scope=Study-Question） ================= */

	/* 站点作用域：一律由 site-scope.js 按路径计算；算不出来就返回空串，
	 * 此时禁止任何云端读写（绝不兜底到 Cube-Formula，那会覆盖别站点数据） */
	function questionScope() {
		return window.getCurrentSiteScope ? window.getCurrentSiteScope() : '';
	}

	var cloud = { on: false, pushTimer: 0, aligned: false, blocked: false };

	function setCloud(text, state) {
		var el = $('cloudState');
		if (!el) return;
		el.textContent = text;
		el.setAttribute('data-state', state || 'local');
	}

	/* 云端那一行是不是本应用写的：靠 data.app 认领
	 * 有内容但没有 app 标记（= 别的站点写的）一律视为「不是我们的」，拒绝上传以防覆盖 */
	function isOwnCloudRow(cd, app) {
		if (!cd || typeof cd !== 'object') return true;
		if (!cd.app) return false;
		return cd.app === app;
	}

	function setScopeConflict(cd) {
		cloud.blocked = true;
		setCloud('作用域冲突', 'err');
		console.error('[Question] 云端作用域「' + questionScope() + '」里已有其他站点的数据（app=' + (cd && cd.app ? cd.app : '未标记') + '），已拒绝上传以防覆盖');
		toast('云端该作用域已有其他站点的数据，已停止上传');
	}

	function initCloud() {
		if (!window.authManager) { setCloud('本地'); return; }
		if (!questionScope()) {
			setCloud('无作用域', 'err');
			console.warn('[Question] 当前路径没有可用的站点作用域，已禁用云端同步：' + window.location.pathname);
			return;
		}
		window.authManager.onAuthStateChange(function (user) {
			cloud.on = !!user;
			if (user) {
				setCloud('云端', 'cloud');
				pullCloud();
			} else {
				setCloud('本地', 'local');
			}
		});
	}

	function pullCloud() {
		var client = window.supabaseClient;
		var user = window.authManager && window.authManager.getUser();
		if (!client || !user) return;
		var sc = questionScope();
		if (!sc) { setCloud('无作用域', 'err'); return; }
		client.from('user_data')
			.select('data')
			.eq('user_id', user.id)
			.eq('site_scope', sc)
			.maybeSingle()
			.then(function (result) {
				/* 拉取失败就只标记未同步，不拿本地去覆盖云端 */
				if (result.error) { setCloud('未同步', 'err'); return; }
				var cd = (result.data && result.data.data) ? result.data.data : null;
				if (!isOwnCloudRow(cd, 'study-question')) { setScopeConflict(cd); return; }
				if (cd) mergeFromCloud(cd);
				alignPush();
			})['catch'](function () { setCloud('未同步', 'err'); });
	}

	/* 登录对齐：首次拉取合并后主动上传一次，保证云端一定存有这份数据
	 * （否则纯登录、不改动任何条目时，云端那一行永远不会被创建） */
	function alignPush() {
		if (cloud.aligned) return;
		cloud.aligned = true;
		pushCloud();
	}

	function mergeFromCloud(cd) {
		if (!cd || typeof cd !== 'object') return;
		var changed = false;
		var byList = {}, byItem = {}, i;

		for (i = 0; i < data.lists.length; i++) byList[data.lists[i].id] = data.lists[i];
		var listIn = Array.isArray(cd.lists) ? cd.lists : [];
		for (i = 0; i < listIn.length; i++) {
			var L = normalizeList(listIn[i]);
			if (!L) continue;
			var eL = byList[L.id];
			if (!eL || (L.mut || 0) > (eL.mut || 0)) { byList[L.id] = L; changed = true; }
		}

		for (i = 0; i < data.items.length; i++) byItem[data.items[i].id] = data.items[i];
		var itemIn = Array.isArray(cd.items) ? cd.items : [];
		for (i = 0; i < itemIn.length; i++) {
			var raw = itemIn[i];
			if (!raw || typeof raw !== 'object') continue;
			var it = normalizeItem(raw);
			if (!it) continue;
			var lid = (typeof raw.listId === 'string' && raw.listId) ? raw.listId : null;
			if (!lid) continue;
			it.listId = lid;
			var eI = byItem[it.id];
			if (!eI || (it.mut || 0) > (eI.mut || 0)) { byItem[it.id] = it; changed = true; }
		}

		if (typeof cd.listsMut === 'number' && cd.listsMut > (data.listsMut || 0)) data.listsMut = cd.listsMut;
		if (typeof cd.itemsMut === 'number' && cd.itemsMut > (data.itemsMut || 0)) data.itemsMut = cd.itemsMut;

		if (changed) {
			data.lists = Object.keys(byList).map(function (k) { return byList[k]; });
			data.items = Object.keys(byItem).map(function (k) { return byItem[k]; });
			ensureItemNos();           /* 云端老数据可能没有 no，补齐 */
			var alive = activeLists();
			if (!alive.some(function (L) { return L.id === data.activeListId; })) {
				data.activeListId = alive.length ? alive[0].id : null;
			}
			save(false);
			renderAll();
			toast('已从云端同步');
		}
	}

	function pushCloud() {
		if (!cloud.on || !window.supabaseClient || !window.authManager) return;
		if (cloud.blocked) { setCloud('作用域冲突', 'err'); return; }
		var user = window.authManager.getUser();
		if (!user) return;
		var sc = questionScope();
		if (!sc) { setCloud('无作用域', 'err'); return; }
		if (cloud.pushTimer) window.clearTimeout(cloud.pushTimer);
		setCloud('同步中', 'sync');
		cloud.pushTimer = window.setTimeout(function () {
			cloud.pushTimer = 0;
			window.supabaseClient
				.from('user_data')
				.upsert({
					user_id: user.id,
					site_scope: sc,
					data: {
						version: 1,
						app: 'study-question',
						exportedAt: new Date().toISOString(),
						activeListId: data.activeListId,
						lists: data.lists,
						items: data.items,
						listsMut: data.listsMut || 0,
						itemsMut: data.itemsMut || 0
					},
					updated_at: new Date().toISOString()
				}, { onConflict: 'user_id,site_scope' })
				.then(function (result) {
					setCloud(result.error ? '未同步' : '云端', result.error ? 'err' : 'cloud');
				})['catch'](function () { setCloud('未同步', 'err'); });
		}, 800);
	}

	/* ================= 主题（与全站共享 smartCubeTheme） ================= */

	function initTheme() {
		var saved = null;
		try { saved = localStorage.getItem('smartCubeTheme'); } catch (e) { /* ignore */ }
		var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
		applyTheme(saved || (prefersDark ? 'dark' : 'light'), false);
	}

	function applyTheme(theme, persist) {
		theme = theme === 'dark' ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		var btn = document.getElementById('siteThemeToggle');
		if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾';
		if (persist !== false) {
			try { localStorage.setItem('smartCubeTheme', theme); } catch (e) { /* ignore */ }
		}
	}

	/* ================= 启动 ================= */

	initTheme();

	bindListBar();
	bindFilterAndSearch();
	bindList();
	bindFoot();
	bindManage();
	bindItemsPanel();

	$('btnExport').addEventListener('click', exportData);
	$('btnImport').addEventListener('click', function () { $('fileImport').click(); });
	$('fileImport').addEventListener('change', function () {
		var file = this.files && this.files[0];
		this.value = '';
		if (!file) return;
		var reader = new FileReader();
		reader.onload = function () {
			try { importData(JSON.parse(reader.result)); }
			catch (e) { toast('文件解析失败', 'warn'); }
		};
		reader.readAsText(file);
	});
	$('btnClearItems').addEventListener('click', function () {
		armConfirm(this, function () { clearCurrentList(); });
	});
	$('btnReset').addEventListener('click', function () {
		var btn = this;
		if (btn.__armed) {
			disarm(btn);
			btn.textContent = '清空全部';
			resetAll();
			return;
		}
		btn.__orig = btn.textContent;
		btn.__armed = true;
		btn.classList.add('armed');
		btn.textContent = '确认清空全部';
		toast('再点一次确认', 'warn');
		btn.__t = setTimeout(function () {
			disarm(btn);
			btn.textContent = '清空全部';
		}, CONFIRM_MS);
	});

	/* 全局快捷键：N 新建问题 */
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape') {
			var ov = $('manageOverlay');
			if (ov && ov.classList.contains('isOpen')) { closeManage(); return; }
		}
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		var tag = e.target && e.target.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		if (e.key === 'n' || e.key === 'N') {
			e.preventDefault();
			startDraft();
		}
	});

	renderAll();

	/* 站点导航栏：authManager.init 由 nav 触发，须在云同步之前 */
	if (window.siteNav && typeof window.siteNav.init === 'function') {
		window.siteNav.init({ setTheme: function (theme) { applyTheme(theme, true); } });
	}
	initCloud();
})();

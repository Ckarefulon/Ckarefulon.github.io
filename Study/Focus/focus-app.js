(function(){
'use strict';
var LS_KEY = 'studyTracker.v1';
var CONFIRM_MS = 2500;
function $(id){ return document.getElementById(id); }

/* ================= 数据 ================= */
function clampGoal(v){
  v = Math.round(Number(v));
  if (!isFinite(v)) return 120;
  return Math.min(720, Math.max(15, v));
}
function genId(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}
function load(){
  try{
    var raw = localStorage.getItem(LS_KEY);
    if (raw){
      var d = JSON.parse(raw);
      var sessions = [];
      if (d && Array.isArray(d.sessions)){
        for (var i=0;i<d.sessions.length;i++){
          var s = d.sessions[i];
          if (s && typeof s.start==='number' && typeof s.end==='number' && s.end>s.start && s.end<=Date.now()+86400000){
            sessions.push({
              id:(typeof s.id==='string'&&s.id)?s.id:genId(),
              start:s.start,
              end:s.end,
              mut:(typeof s.mut==='number')?s.mut:0,
              del:!!s.del
            });
          }
        }
      }
      var current = null;
      if (d && d.current && typeof d.current.start==='number' && d.current.start<=Date.now()){
        current = {start:d.current.start};
      }
      return {
        sessions:sessions,
        goal:clampGoal(d && d.goal),
        goalMut:(d && typeof d.goalMut==='number')?d.goalMut:0,
        current:current
      };
    }
  }catch(e){}
  return {sessions:[], goal:120, goalMut:0, current:null};
}

var data = load();
var viewY, viewM, selectedKey;
(function init(){
  var n = new Date();
  viewY = n.getFullYear(); viewM = n.getMonth();
  selectedKey = dayKey(Date.now());
})();

function save(cloudPush){
  try{ localStorage.setItem(LS_KEY, JSON.stringify(data)); }catch(e){}
  if (cloudPush) pushFocus();
}

/* ================= 工具函数 ================= */
function dayKey(ts){
  var d = new Date(ts);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function fmtClock(ms){
  var s = Math.floor(ms/1000);
  var h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = s%60;
  return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
}
function fmtDur(ms){
  var m = Math.floor(ms/60000);
  if (m < 1) return '不足 1 分钟';
  var h = Math.floor(m/60), r = m%60;
  if (h===0) return r+' 分钟';
  if (r===0) return h+' 小时';
  return h+' 小时 '+r+' 分';
}
function fmtShort(ms){
  if (ms <= 0) return '0分';
  var m = Math.floor(ms/60000);
  if (m < 1) return '<1分';
  var h = Math.floor(m/60), r = m%60;
  if (h===0) return r+'分';
  return r ? h+'时'+r+'分' : h+'时';
}
function fmtCell(ms){
  if (ms <= 0) return '';
  var m = Math.round(ms/60000);
  if (m < 1) return '<1分';
  if (m < 60) return m+'分';
  var h = Math.floor(m/60), r = m%60;
  return r ? h+'时'+String(r).padStart(2,'0')+'分' : h+'时';
}
function computeTotals(){
  var map = {};
  for (var i=0;i<data.sessions.length;i++){
    var s = data.sessions[i];
    if (s.del) continue;
    var k = dayKey(s.start);
    map[k] = (map[k]||0) + (s.end - s.start);
  }
  if (data.current){
    var k2 = dayKey(data.current.start);
    map[k2] = (map[k2]||0) + Math.max(0, Date.now() - data.current.start);
  }
  return map;
}
function weekStartTime(){
  var d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() - ((d.getDay()+6)%7));
  return d.getTime();
}
function calcStreak(totals){
  var streak = 0;
  var d = new Date(); d.setHours(0,0,0,0);
  var v = totals[dayKey(d.getTime())]||0;
  if (!v) d.setDate(d.getDate()-1);
  while (true){
    v = totals[dayKey(d.getTime())]||0;
    if (v>0){ streak++; d.setDate(d.getDate()-1); } else break;
  }
  return streak;
}

/* ================= 双击确认 ================= */
function disarm(btn){
  if (btn.__t) clearTimeout(btn.__t);
  btn.__t = null; btn.__armed = false;
  btn.classList.remove('armed');
  if (btn.__orig != null) btn.textContent = btn.__orig;
}
function armConfirm(btn, fn){
  if (btn.__armed){ disarm(btn); fn(); return; }
  btn.__orig = btn.textContent;
  btn.__armed = true;
  btn.classList.add('armed');
  btn.textContent = '确认？';
  btn.__t = setTimeout(function(){ disarm(btn); }, CONFIRM_MS);
}

/* ================= Toast ================= */
var toastTimer = null;
function toast(msg){
  var el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('show'); }, 2200);
}

/* ================= 渲染 ================= */
function tick(){
  var totals = computeTotals();
  var todayK = dayKey(Date.now());
  var today = totals[todayK]||0;
  var big = $('bigTime'), status = $('statusText'), sub = $('subText');
  if (data.current){
    status.textContent = '自习中';
    big.textContent = fmtClock(Date.now() - data.current.start);
    big.classList.add('running');
    sub.textContent = '专注进行中，结束时会记入当天';
  }else{
    status.textContent = '准备开始';
    big.textContent = fmtClock(today);
    big.classList.remove('running');
    sub.textContent = '今日已自习';
  }
  var goalMs = data.goal*60000;
  var pct = Math.min(100, goalMs>0 ? today/goalMs*100 : 0);
  var fill = $('goalFill');
  fill.style.width = pct.toFixed(1)+'%';
  fill.classList.toggle('done', pct>=100);
  $('goalText').childNodes[0].nodeValue = '今日 '+fmtShort(today)+' · 目标 ';
}

function renderStats(totals){
  var todayK = dayKey(Date.now());
  var today = totals[todayK]||0;
  var week = 0, ws = weekStartTime();
  for (var i=0;i<7;i++){
    var t = ws + i*86400000;
    if (t > Date.now()) break;
    week += totals[dayKey(t)]||0;
  }
  var now = new Date();
  var month = 0;
  var first = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  for (var d=first; d<=Date.now(); d+=86400000){
    month += totals[dayKey(d)]||0;
  }
  var total = 0, days = 0;
  for (var k in totals){ total += totals[k]; if (totals[k]>0) days++; }
  $('stToday').textContent = fmtShort(today);
  $('stWeek').textContent = fmtShort(week);
  $('stMonth').textContent = fmtShort(month);
  $('stTotal').textContent = fmtShort(total);
  $('stDays').textContent = days;
  $('streakNum').textContent = calcStreak(totals);
}

function renderCalendar(totals){
  $('calTitle').textContent = viewY+' 年 '+(viewM+1)+' 月';
  var grid = $('calGrid');
  grid.innerHTML = '';
  var first = new Date(viewY, viewM, 1);
  var lead = (first.getDay()+6)%7;
  var days = new Date(viewY, viewM+1, 0).getDate();
  var todayK = dayKey(Date.now());
  var goalMs = data.goal*60000;
  for (var i=0;i<lead;i++){
    var blank = document.createElement('div');
    blank.className = 'cal-empty';
    grid.appendChild(blank);
  }
  for (var day=1; day<=days; day++){
    var ts = new Date(viewY, viewM, day).getTime();
    var k = dayKey(ts);
    var t = totals[k]||0;
    var cell = document.createElement('div');
    cell.className = 'cal-cell';
    cell.setAttribute('data-key', k);
    if (k === todayK) cell.classList.add('is-today');
    if (k === selectedKey) cell.classList.add('selected');
    if (t > 0 && k !== selectedKey){
      var ratio = Math.min(1, goalMs>0 ? t/goalMs : 1);
      var alpha = 0.2 + 0.7*ratio;
      cell.style.background = 'rgba(93,78,168,'+alpha.toFixed(3)+')';
    }
    var dEl = document.createElement('span');
    dEl.className = 'd'; dEl.textContent = day;
    var tEl = document.createElement('span');
    tEl.className = 't'; tEl.textContent = fmtCell(t);
    cell.appendChild(dEl); cell.appendChild(tEl);
    grid.appendChild(cell);
  }
}

function renderDetail(totals){
  var box = $('dayDetail');
  var parts = selectedKey.split('-');
  var title = Number(parts[1])+' 月 '+Number(parts[2])+' 日';
  var total = totals[selectedKey]||0;
  var html = '<div class="dd-title">'+title+'<small>累计 '+(total>0 ? fmtDur(total) : '0 分钟')+'</small></div>';
  var list = [];
  for (var i=0;i<data.sessions.length;i++){
    var s = data.sessions[i];
    if (!s.del && dayKey(s.start) === selectedKey) list.push(s);
  }
  list.sort(function(a,b){ return a.start-b.start; });
  if (!list.length && !(data.current && dayKey(data.current.start)===selectedKey)){
    box.innerHTML = html + '<div class="dd-empty">这一天还没有记录</div>'
          + '<button class="dd-add" id="ddAdd">+ 补录一条</button>';
    syncAddBtn();
    return;
  }
  function hm(ts){
    var d = new Date(ts);
    return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  html += '<div id="sessList">';
  for (var j=0;j<list.length;j++){
    var s2 = list[j];
    html += '<div class="sess"><span class="range">'+hm(s2.start)+' – '+hm(s2.end)+'</span>'
          + '<span class="dur">'+fmtDur(s2.end-s2.start)+'</span><span class="grow"></span>'
          + '<button class="sess-act" data-act="edit" data-id="'+s2.id+'">编辑</button>'
          + '<button class="sess-del" data-id="'+s2.id+'">删除</button></div>';
  }
  if (data.current && dayKey(data.current.start)===selectedKey){
    html += '<div class="sess"><span class="range">'+hm(data.current.start)+' – </span>'
          + '<span class="running-tag">进行中</span><span class="grow"></span></div>';
  }
  html += '</div>';
  html += '<button class="dd-add" id="ddAdd">+ 补录一条</button>';
  box.innerHTML = html;
  syncAddBtn();
}

/* 补录按钮：把选中日期带进弹窗默认值 */
function syncAddBtn(){
  var b = $('ddAdd');
  if (b) b.setAttribute('data-day', selectedKey);
}

function renderChart(totals){
  var chart = $('chart');
  chart.innerHTML = '';
  var cols = [];
  var max = data.goal*60000;
  for (var i=6;i>=0;i--){
    var d = new Date(); d.setHours(0,0,0,0);
    d.setDate(d.getDate()-i);
    var t = totals[dayKey(d.getTime())]||0;
    cols.push({t:t, lab:'周'+'一二三四五六日'[(d.getDay()+6)%7], today:i===0});
    if (t > max) max = t;
  }
  if (max <= 0) max = 1;
  for (var c=0;c<cols.length;c++){
    var col = cols[c];
    var div = document.createElement('div');
    div.className = 'col'+(col.today?' today':'');
    var val = document.createElement('div');
    val.className = 'val';
    val.textContent = col.t>0 ? fmtShort(col.t) : '';
    var box = document.createElement('div');
    box.className = 'barbox';
    var bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.height = Math.max(2, col.t/max*100).toFixed(1)+'%';
    box.appendChild(bar);
    var lab = document.createElement('div');
    lab.className = 'lab';
    lab.textContent = col.lab;
    div.appendChild(val); div.appendChild(box); div.appendChild(lab);
    chart.appendChild(div);
  }
}

function renderGoal(){
  var g = data.goal;
  $('goalEdit').textContent = g>=60 ? (Math.floor(g/60)+' 小时'+(g%60? ' '+(g%60)+' 分':'')) : (g+' 分钟');
}

function renderAll(){
  var totals = computeTotals();
  renderStats(totals);
  renderCalendar(totals);
  renderDetail(totals);
  renderChart(totals);
  renderGoal();
  tick();
}

/* ================= 云同步（Supabase user_data · scope=Study/Focus） ================= */
/* 站点作用域：一律由 site-scope.js 按路径计算；算不出来就返回空串，
 * 此时禁止任何云端读写（绝不兜底到 Cube-Formula，那会覆盖别站点数据） */
function focusScope(){
  return window.getCurrentSiteScope ? window.getCurrentSiteScope() : '';
}
var cloud = { on:false, pushTimer:0, aligned:false, blocked:false };
function setCloud(text, state){
  var el = $('cloudState');
  if (!el) return;
  el.textContent = text;
  el.setAttribute('data-state', state || 'local');
}

/* 云端那一行是不是本应用写的：靠 data.app 认领
 * 有内容但没有 app 标记（= 别的站点写的）一律视为「不是我们的」，拒绝上传以防覆盖 */
function isOwnCloudRow(cd, app){
  if (!cd || typeof cd !== 'object') return true;   // 空行可占用
  if (!cd.app) return false;
  return cd.app === app;
}
function setScopeConflict(cd){
  cloud.blocked = true;
  setCloud('作用域冲突', 'err');
  console.error('[Focus] 云端作用域「' + focusScope() + '」里已有其他站点的数据（app=' + (cd && cd.app ? cd.app : '未标记') + '），已拒绝上传以防覆盖');
  toast('云端该作用域已有其他站点的数据，已停止上传');
}
function initCloud(){
  if (!window.authManager){ setCloud('本地'); return; }
  if (!focusScope()){
    setCloud('无作用域', 'err');
    console.warn('[Focus] 当前路径没有可用的站点作用域，已禁用云端同步：' + window.location.pathname);
    return;
  }
  window.authManager.onAuthStateChange(function(user){
    cloud.on = !!user;
    if (user){
      setCloud('云端', 'cloud');
      pullFocus();
    }else{
      setCloud('本地', 'local');
    }
  });
}
function pullFocus(){
  var client = window.supabaseClient;
  var user = window.authManager && window.authManager.getUser();
  if (!client || !user) return;
  var sc = focusScope();
  if (!sc){ setCloud('无作用域', 'err'); return; }
  client.from('user_data')
    .select('data')
    .eq('user_id', user.id)
    .eq('site_scope', sc)
    .maybeSingle()
    .then(function(result){
      /* 拉取失败就只标记未同步，不拿本地去覆盖云端 */
      if (result.error){ setCloud('未同步','err'); return; }
      var cd = (result.data && result.data.data) ? result.data.data : null;
      if (!isOwnCloudRow(cd, 'study-focus')){ setScopeConflict(cd); return; }
      if (cd) mergeFromCloud(cd);
      alignPush();
    })['catch'](function(){ setCloud('未同步','err'); });
}
/* 登录对齐：首次拉取合并后主动上传一次，保证云端一定存有这份数据
 * （否则纯登录、不改动任何记录时，云端那一行永远不会被创建） */
function alignPush(){
  if (cloud.aligned) return;
  cloud.aligned = true;
  pushFocus();
}
function mergeFromCloud(cd){
  var byId = {}, i;
  for (i=0;i<data.sessions.length;i++){ byId[data.sessions[i].id] = data.sessions[i]; }
  var changed = false;
  var list = Array.isArray(cd.sessions) ? cd.sessions : [];
  for (i=0;i<list.length;i++){
    var r = list[i];
    if (!r || typeof r.id!=='string' || !r.id) continue;
    if (typeof r.start!=='number' || typeof r.end!=='number' || r.end<=r.start) continue;
    var mut = (typeof r.mut==='number') ? r.mut : 0;
    if (!byId[r.id] || mut > (byId[r.id].mut||0)){
      byId[r.id] = {id:r.id, start:r.start, end:r.end, mut:mut, del:!!r.del};
      changed = true;
    }
  }
  var goalChanged = false;
  if (typeof cd.goal==='number' && (cd.goalMut||0) > (data.goalMut||0)){
    var g = clampGoal(cd.goal);
    if (g !== data.goal){ data.goal = g; data.goalMut = cd.goalMut||0; goalChanged = true; }
    else if ((cd.goalMut||0) > (data.goalMut||0)){ data.goalMut = cd.goalMut||0; }
  }
  if (changed || goalChanged){
    data.sessions = Object.keys(byId).map(function(k){ return byId[k]; });
    save(false);
    syncActionButtons();
    renderAll();
    if (changed) toast('已从云端同步记录');
  }
}
function pushFocus(){
  if (!cloud.on || !window.supabaseClient || !window.authManager) return;
  if (cloud.blocked){ setCloud('作用域冲突', 'err'); return; }
  var user = window.authManager.getUser();
  if (!user) return;
  var sc = focusScope();
  if (!sc){ setCloud('无作用域', 'err'); return; }
  if (cloud.pushTimer) window.clearTimeout(cloud.pushTimer);
  setCloud('同步中', 'sync');
  cloud.pushTimer = window.setTimeout(function(){
    cloud.pushTimer = 0;
    window.supabaseClient
      .from('user_data')
      .upsert({
        user_id: user.id,
        site_scope: sc,
        data: {
          version: 1,
          app: 'study-focus',
          exportedAt: new Date().toISOString(),
          sessions: data.sessions,
          goal: data.goal,
          goalMut: data.goalMut||0
        },
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,site_scope' })
      .then(function(result){
        setCloud(result.error ? '未同步' : '云端', result.error ? 'err' : 'cloud');
      })['catch'](function(){ setCloud('未同步', 'err'); });
  }, 800);
}

/* ================= 手动补录 / 编辑记录时间 ================= */
var editingId = null;
function pad2(n){ return String(n).padStart(2,'0'); }
function toInputValue(ts){
  var d = new Date(ts);
  return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate())
       + 'T'+pad2(d.getHours())+':'+pad2(d.getMinutes());
}
function fromInputValue(v){
  if (!v) return NaN;
  var t = new Date(v).getTime();
  return isFinite(t) ? t : NaN;
}
function roundToMinute(ts){
  var d = new Date(ts);
  d.setSeconds(0,0);
  return d.getTime();
}
function openEdit(id){
  var s = null;
  if (id){
    for (var i=0;i<data.sessions.length;i++){
      if (data.sessions[i].id===id && !data.sessions[i].del){ s = data.sessions[i]; break; }
    }
    if (!s){ toast('找不到这条记录'); return; }
  }
  editingId = id || null;
  $('editTitle').textContent = id ? '编辑记录时间' : '补录记录';
  $('editErr').textContent = '';
  if (s){
    $('editStart').value = toInputValue(s.start);
    $('editEnd').value = toInputValue(s.end);
  }else{
    var parts = selectedKey.split('-');
    var base = new Date(Number(parts[0]), Number(parts[1])-1, Number(parts[2]));
    var end = roundToMinute(Date.now());
    var sameDay = dayKey(end) === selectedKey;
    var endStr = sameDay ? toInputValue(end) : toInputValue(base.getTime()+12*3600000);
    var endTs = fromInputValue(endStr);
    $('editStart').value = toInputValue(endTs - 3600000);
    $('editEnd').value = endStr;
  }
  var m = $('editModal');
  m.dataset.open = '1';
  m.setAttribute('aria-hidden','false');
  $('editStart').focus();
}
function closeEdit(){
  var m = $('editModal');
  m.dataset.open = '';
  m.setAttribute('aria-hidden','true');
  editingId = null;
}
function saveEdit(){
  var err = $('editErr');
  var s = fromInputValue($('editStart').value);
  var e = fromInputValue($('editEnd').value);
  if (!isFinite(s) || !isFinite(e)){ err.textContent = '请填写完整的开始和结束时间'; return; }
  if (e <= s){ err.textContent = '结束时间要晚于开始时间'; return; }
  if (e - s < 60000){ err.textContent = '时长至少 1 分钟'; return; }
  if (e > Date.now() + 60000){ err.textContent = '结束时间不能超过当前时间'; return; }
  var now = Date.now();
  if (editingId){
    for (var i=0;i<data.sessions.length;i++){
      if (data.sessions[i].id===editingId){
        data.sessions[i].start = s;
        data.sessions[i].end = e;
        data.sessions[i].mut = now;
        data.sessions[i].del = false;
        break;
      }
    }
    closeEdit();
    selectedKey = dayKey(s);
    save(true); renderAll();
    toast('已更新为 '+fmtDur(e-s));
    return;
  }
  data.sessions.push({id:genId(), start:s, end:e, mut:now});
  closeEdit();
  selectedKey = dayKey(s);
  save(true); renderAll();
  toast('已补录 '+fmtDur(e-s));
}
$('editSave').addEventListener('click', saveEdit);
$('editCancel').addEventListener('click', closeEdit);
$('editModalMask').addEventListener('click', closeEdit);
$('btnManual').addEventListener('click', function(){ openEdit(null); });
document.addEventListener('keydown', function(ev){
  if (ev.key==='Escape' && $('editModal').dataset.open==='1') closeEdit();
  if (ev.key==='Enter' && $('editModal').dataset.open==='1') saveEdit();
});
$('editModal').addEventListener('click', function(ev){
  var q = ev.target.closest('.qbtn');
  if (!q) return;
  var start = fromInputValue($('editStart').value);
  if (!isFinite(start)) start = roundToMinute(Date.now());
  $('editEnd').value = toInputValue(start + Number(q.getAttribute('data-min'))*60000);
  $('editErr').textContent = '';
});

/* ================= 动作 ================= */
$('btnStart').addEventListener('click', function(){
  if (data.current){ toast('已经在自习中了'); return; }
  data.current = {start: Date.now()};
  save(false);
  syncActionButtons();
  renderAll();
  toast('开始自习，加油');
});
$('btnEnd').addEventListener('click', function(){
  if (!data.current) return;
  var s = data.current.start, e = Date.now();
  if (e - s < 1000){
    data.current = null; save(false);
    syncActionButtons(); renderAll();
    toast('本次时间太短，未记录');
    return;
  }
  data.sessions.push({id:genId(), start:s, end:e, mut:Date.now()});
  data.current = null;
  save(true);
  selectedKey = dayKey(s);
  syncActionButtons();
  renderAll();
  toast('本次自习 '+fmtDur(e-s));
});
$('btnGiveup').addEventListener('click', function(){
  var btn = this;
  armConfirm(btn, function(){
    if (!data.current) return;
    data.current = null;
    save(false);
    syncActionButtons();
    renderAll();
    toast('已放弃本次自习（未记录）');
  });
});
function syncActionButtons(){
  var running = !!data.current;
  $('btnStart').classList.toggle('hidden', running);
  $('btnEnd').classList.toggle('hidden', !running);
  $('btnGiveup').classList.toggle('hidden', !running);
}

/* 日历翻页 & 选日 */
$('calPrev').addEventListener('click', function(){
  viewM--; if (viewM<0){ viewM=11; viewY--; }
  renderCalendar(computeTotals());
});
$('calNext').addEventListener('click', function(){
  viewM++; if (viewM>11){ viewM=0; viewY++; }
  renderCalendar(computeTotals());
});
$('calGrid').addEventListener('click', function(ev){
  var cell = ev.target.closest('.cal-cell');
  if (!cell) return;
  selectedKey = cell.getAttribute('data-key');
  renderCalendar(computeTotals());
  renderDetail(computeTotals());
});

/* 详情区：补录 / 编辑 / 删除某条记录（删除二次确认；墓碑标记，云同步新者胜） */
$('dayDetail').addEventListener('click', function(ev){
  var addBtn = ev.target.closest('#ddAdd');
  if (addBtn){ openEdit(null); return; }
  var editBtn = ev.target.closest('.sess-act');
  if (editBtn){ openEdit(editBtn.getAttribute('data-id')); return; }
  var btn = ev.target.closest('.sess-del');
  if (!btn) return;
  armConfirm(btn, function(){
    var id = btn.getAttribute('data-id');
    for (var i=0;i<data.sessions.length;i++){
      if (data.sessions[i].id === id){
        data.sessions[i].del = true;
        data.sessions[i].mut = Date.now();
      }
    }
    save(true);
    renderAll();
    toast('已删除该条记录');
  });
});

/* 目标编辑 */
$('goalEdit').addEventListener('click', function(){
  var input = $('goalInput');
  input.classList.remove('hidden');
  input.value = data.goal;
  input.focus(); input.select();
});
function commitGoal(){
  var input = $('goalInput');
  if (input.classList.contains('hidden')) return;
  input.classList.add('hidden');
  var v = clampGoal(input.value);
  if (v !== data.goal){
    data.goal = v;
    data.goalMut = Date.now();
    save(true);
    toast('每日目标已设为 '+fmtDur(v*60000));
  }
  renderAll();
}
$('goalInput').addEventListener('keydown', function(e){
  if (e.key==='Enter') commitGoal();
  if (e.key==='Escape'){ this.classList.add('hidden'); }
});
$('goalInput').addEventListener('blur', commitGoal);

/* 导出 / 导入 / 清空 */
$('btnExport').addEventListener('click', function(){
  var out = {app:'study-focus', version:1, goal:data.goal, goalMut:data.goalMut||0, sessions:data.sessions};
  var blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  var a = document.createElement('a');
  var n = new Date();
  var stamp = n.getFullYear()+String(n.getMonth()+1).padStart(2,'0')+String(n.getDate()).padStart(2,'0')
            + '-'+String(n.getHours()).padStart(2,'0')+String(n.getMinutes()).padStart(2,'0');
  a.href = URL.createObjectURL(blob);
  a.download = 'study-focus-backup-'+stamp+'.json';
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast('已导出 '+data.sessions.length+' 条记录');
});
$('btnImport').addEventListener('click', function(){ $('fileImport').click(); });
$('fileImport').addEventListener('change', function(){
  var file = this.files && this.files[0];
  this.value = '';
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(){
    try{
      var obj = JSON.parse(reader.result);
      var arr = Array.isArray(obj) ? obj : (obj && Array.isArray(obj.sessions) ? obj.sessions : null);
      if (!arr){ toast('文件格式不对，导入失败'); return; }
      var byId = {};
      for (var i=0;i<data.sessions.length;i++){ byId[data.sessions[i].id] = data.sessions[i]; }
      var merged = 0;
      for (var j=0;j<arr.length;j++){
        var s = arr[j];
        if (!s || typeof s.start!=='number' || typeof s.end!=='number' || s.end<=s.start) continue;
        var id = (typeof s.id==='string' && s.id) ? s.id : genId();
        var mut = (typeof s.mut==='number') ? s.mut : (s.end || Date.now());
        if (!byId[id] || mut > (byId[id].mut||0)){
          byId[id] = {id:id, start:s.start, end:s.end, mut:mut, del:!!s.del};
          merged++;
        }
      }
      data.sessions = Object.keys(byId).map(function(k){ return byId[k]; });
      save(true); renderAll();
      toast('导入完成：合并 '+merged+' 条');
    }catch(err){
      toast('文件解析失败');
    }
  };
  reader.readAsText(file);
});
$('btnClear').addEventListener('click', function(){
  var btn = this;
  armConfirm(btn, function(){
    var now = Date.now();
    for (var i=0;i<data.sessions.length;i++){
      if (!data.sessions[i].del){
        data.sessions[i].del = true;
        data.sessions[i].mut = now;
      }
    }
    data.current = null;
    save(true);
    syncActionButtons();
    renderAll();
    toast('数据已清空');
  });
});

/* ================= 启动 ================= */
syncActionButtons();
renderAll();
/* 站点导航栏：authManager.init 由 nav 触发，须在云同步之前 */
if (window.siteNav && typeof window.siteNav.init === 'function') {
  window.siteNav.init({});
}
initCloud();
setInterval(tick, 500);
})();

/* 降级环境测试：localStorage 被禁用 / 写入配额超限时，应用仍可正常运行 */
'use strict';
class El {
  constructor(t, id) { this.tagName = (t || 'div').toUpperCase(); this.id = id || ''; this._html = ''; this.dataset = {}; this.style = {};
    this.value = ''; this.checked = false; this.disabled = false; this.selectionStart = 0; this.selectionEnd = 0; this._cls = new Set();
    const s = this; this.classList = { add: c => s._cls.add(c), remove: c => s._cls.delete(c), toggle: (c, f) => { const on = f === undefined ? !s._cls.has(c) : !!f; on ? s._cls.add(c) : s._cls.delete(c); return on; }, contains: c => s._cls.has(c) }; }
  set innerHTML(v) { this._html = String(v); } get innerHTML() { return this._html; }
  set textContent(v) { this._t = String(v); } get textContent() { return this._t || ''; }
  addEventListener() {} removeEventListener() {} querySelector() { return null; } querySelectorAll() { return []; }
  closest() { return null; } appendChild(c) { return c; } remove() {} focus() {} click() {} setSelectionRange() {}
  getAttribute(k) { return this.dataset[k]; } setAttribute(k, v) { this.dataset[k] = v; } get offsetWidth() { return 1; }
}
const reg = {}; const byId = id => reg[id] || (reg[id] = new El('div', id));
global.document = { documentElement: new El('html'), body: new El('body'), activeElement: null, getElementById: byId,
  createElement: t => new El(t), querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: () => {} };
global.window = global; Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true }); global.location = { hash: '' }; global.history = { replaceState: () => {} };
/* localStorage 一律抛异常（等同沙箱 iframe 未授予同源权限） */
global.localStorage = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
global.Blob = class { constructor(p) { this.size = (p || []).join('').length; } };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.requestAnimationFrame = fn => { fn(); return 1; };
global.addEventListener = () => {}; global.scrollTo = () => {}; global.print = () => {};
const path = require('path');
['rules.js', 'engine.js', 'insights.js', 'store.js', 'ui.js', 'views-core.js', 'views-tools.js', 'app.js'].forEach(f => require(path.join(__dirname, '../src/js', f)));
const ZC = global.ZC;
let pass = 0, fail = 0;
const t = (n, f) => { try { if (f() === false) throw new Error('false'); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' → ' + e.message); } };

console.log('\n【降级环境：localStorage 完全不可用】');
t('检测到存储不可用', () => ZC.storageOK === false);
t('boot() 仍成功（自动生成示例档案）', () => { ZC.boot(); return ZC.state.profiles.length === 1; });
t('flushSave 降级为内存保存而非报错', () => ZC.flushSave() === 'memory');
t('写入后可再次读回（内存副本）', () => { ZC.state.profiles[0].meta.name = '内存态测试'; ZC.flushSave(); ZC.load(); return ZC.state.profiles[0].meta.name === '内存态测试'; });
t('11 个视图全部可渲染', () => {
  ['dashboard','pinxing','ability','reward','composite','materials','simulate','class','procedure','rulebook','settings'].forEach(v => {
    ZC.state.ui.view = v; const h = ZC.views[v].render(ZC.ctx()); if (!h || h.length < 200) throw new Error(v + ' 渲染失败');
  }); return true;
});
t('录入 / 撤销 / 模拟在降级环境同样可用', () => {
  ZC.actions.add('academic|academic-comp'); ZC.sim.enter(); ZC.sim.quick('vol32'); ZC.sim.exit(true); ZC.undo(); return true;
});
t('设置页显示"不可用，仅内存保存"', () => { ZC.state.ui.view = 'settings'; return ZC.views.settings.render(ZC.ctx()).includes('不可用，仅内存保存'); });
console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);

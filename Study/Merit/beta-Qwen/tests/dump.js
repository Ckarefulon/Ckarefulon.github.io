/* 渲染快照：把各视图的 HTML 导出，便于人工审阅结构与文案（Node 环境） */
'use strict';
class El{constructor(t,id){this.tagName=(t||'div').toUpperCase();this.id=id||'';this._html='';this.dataset={};this.style={};this.value='';this.checked=false;this.disabled=false;this.selectionStart=0;this.selectionEnd=0;this._cls=new Set();const s=this;this.classList={add:c=>s._cls.add(c),remove:c=>s._cls.delete(c),toggle:(c,f)=>{const on=f===undefined?!s._cls.has(c):!!f;on?s._cls.add(c):s._cls.delete(c);return on;},contains:c=>s._cls.has(c)};}
set innerHTML(v){this._html=String(v);}get innerHTML(){return this._html;}set textContent(v){this._t=String(v);}get textContent(){return this._t||'';}
addEventListener(){}removeEventListener(){}querySelector(){return null;}querySelectorAll(){return[];}closest(){return null;}appendChild(c){return c;}remove(){}focus(){}click(){}setSelectionRange(){}getAttribute(k){return this.dataset[k];}setAttribute(k,v){this.dataset[k]=v;}get offsetWidth(){return 1;}}
const reg={};const byId=id=>reg[id]||(reg[id]=new El('div',id));
global.document={documentElement:new El('html'),body:new El('body'),activeElement:null,getElementById:byId,createElement:t=>new El(t),querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{},removeEventListener:()=>{}};
global.window=global;global.navigator={};global.location={hash:''};global.history={replaceState:()=>{}};
global.localStorage={_d:{},getItem(k){return this._d[k]===undefined?null:this._d[k];},setItem(k,v){this._d[k]=String(v);},removeItem(k){delete this._d[k];}};
global.Blob=class{constructor(p){this.size=(p||[]).join('').length;}};global.URL={createObjectURL:()=>'b',revokeObjectURL:()=>{}};
global.requestAnimationFrame=f=>{f();return 1;};global.addEventListener=()=>{};global.scrollTo=()=>{};global.print=()=>{};
const path=require('path');
['rules.js','engine.js','insights.js','store.js','ui.js','views-core.js','views-tools.js','app.js'].forEach(f=>require(path.join(__dirname,'../src/js',f)));
const ZC=global.ZC;ZC.boot();
const views=process.argv[2]?process.argv[2].split(','):['dashboard','pinxing','ability','reward','composite','materials','simulate','class','procedure','rulebook','settings'];
const out=[];
views.forEach(v=>{ZC.state.ui.view=v;out.push('\n\n<!-- ========== '+v+' ========== -->\n'+ZC.views[v].render(ZC.ctx()));});
require('fs').writeFileSync(path.join(__dirname,'../.dump.html'),out.join('\n'));
console.log('dumped '+out.join('').length+' chars → .dump.html  ('+views.join(',')+')');

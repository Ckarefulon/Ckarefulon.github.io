/*
 * Analyzer 打乱反算 Worker（2026-11-19）
 *
 * 为什么要有它：求解器（cubejs 两阶段）首次建表实测约 1.4s，是同步计算。
 * 放在主线程会卡住计时器的 rAF 循环 —— 而「结束打乱」之后用户随时可能起表，
 * 这一卡正好落在最不该卡的时刻。挪进 Worker 后主线程完全不参与，
 * 建表多久都不影响计时、输入与渲染。
 *
 * 协议（主线程 ↔ Worker）：
 *   → { id, type:'scramble', facelet }   求「从复原拧到 facelet」的等价打乱
 *   ← { id, ok:true, moves:[...] }        成功（复原态返回 []）
 *   ← { id, ok:false, error:'...' }       失败
 *   ← { type:'ready' }                    求解器就绪（建表完成）
 */
'use strict';

// cubejs 用 (function(){...}).call(this) + this.Cube = ... 挂全局，importScripts 下 this 即 worker 全局
// 路径相对本文件（/Cube/Analyzer/）→ 退一级到 /Cube/assets/cube-solve/
importScripts('../assets/cube-solve/cubejs-cube.js', '../assets/cube-solve/cubejs-solve.js');

const SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
let ready = false;
let broken = false;

function ensureSolver() {
  if (ready) return true;
  if (broken) return false;
  if (!self.Cube || typeof self.Cube.initSolver !== 'function' || typeof self.Cube.fromString !== 'function') {
    broken = true;
    return false;
  }
  try {
    self.Cube.initSolver();
    ready = true;
  } catch (e) {
    broken = true;
  }
  return ready;
}

/** 单个 token 取逆（X2 不变） */
function invert(tokens) {
  return tokens.slice().reverse().map(t => t.endsWith('2') ? t : (t.endsWith("'") ? t.slice(0, -1) : t + "'"));
}

/** facelet → 「从复原拧到这里」的等价打乱；复原态返回 []，无法求解返回 null */
function scrambleFrom(facelet) {
  const f = String(facelet || '').trim();
  if (f.length !== 54) return null;
  if (f === SOLVED) return [];
  if (!ensureSolver()) return null;
  try {
    const sol = String(self.Cube.fromString(f).solve() || '').trim().split(/\s+/).filter(Boolean);
    return sol.length ? invert(sol) : null;
  } catch (e) {
    return null;
  }
}

self.onmessage = e => {
  const msg = e.data || {};
  if (msg.type !== 'scramble') return;
  const id = msg.id;
  try {
    const moves = scrambleFrom(msg.facelet);
    self.postMessage({ id, ok: !!moves, moves: moves || [], error: moves ? null : 'unsolvable' });
  } catch (err) {
    self.postMessage({ id, ok: false, moves: [], error: String(err && err.message || err) });
  }
};

// 起来就先把表建好，主线程之后问就秒回
if (ensureSolver()) self.postMessage({ type: 'ready' });

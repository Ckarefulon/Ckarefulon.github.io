/*
 * Analyzer 数据体检 —— 异常记录检测与标注（2026-09-29）
 *
 * 原则（用户定案，红线）：
 *   1. 记录永不删除、训练数据字段永不修改；
 *   2. 异常记录自动打 anomaly Flag，分析统计侧自动排除（与 DNF 同口径：保留在记录与计数中，不进 AO/趋势/分段/Case）；
 *   3. 用户可将某条标记为「误报」（anomalyCleared），原始检测结果 anomaly 数组保留，可随时恢复；
 *   4. 检测在加载/导入/新记录落库时自动执行，只写 anomaly / anomalyCleared 两个自有字段。
 *
 * 检测项（对照 AI_CFOP 数据清洗口径）：
 *   invalid_time  用时无效（非正数 / 非数值，且非 DNF）
 *   too_fast      用时过短（< 2s；3x3 复原不可能快于 2s，多为误触或半途起停）
 *   too_long      用时过长（> 10min，多为忘记停表）
 *   missing_moves 智能魔方记录但动作/时间戳缺失或不对齐
 *   ts_disorder   时间戳非单调递增
 */
(() => {
  'use strict';

  const FAST_MS = 2000;
  const LONG_MS = 600000;

  const LABELS = {
    invalid_time: '用时无效',
    too_fast: `用时过短（< ${FAST_MS / 1000}s）`,
    too_long: `用时过长（> ${LONG_MS / 60000}min）`,
    missing_moves: '动作数据缺失或不对齐',
    ts_disorder: '时间戳倒挂',
  };

  function assess(s) {
    const flags = [];
    if (!s || typeof s !== 'object') return ['invalid_time'];
    const t = Number(s.totalTime);
    const isDnf = String(s.flag || '').toLowerCase() === 'dnf';
    if (!Number.isFinite(t) || t <= 0) {
      if (!isDnf) flags.push('invalid_time');
    } else if (t < FAST_MS) {
      flags.push('too_fast');
    } else if (t > LONG_MS) {
      flags.push('too_long');
    }
    if (String(s.captureType || '') === 'smartcube') {
      const mv = Array.isArray(s.moves) ? s.moves.length : 0;
      const ts = Array.isArray(s.timestamps) ? s.timestamps.length : 0;
      if (!mv || mv !== ts) {
        flags.push('missing_moves');
      } else {
        for (let i = 1; i < ts; i++) {
          if (Number(s.timestamps[i]) < Number(s.timestamps[i - 1])) { flags.push('ts_disorder'); break; }
        }
      }
    }
    return flags;
  }

  /* 只补检测、不覆盖：已有 anomaly 数组的记录绝不重算（保留首次检测事实与用户确认状态） */
  function ensure(solves) {
    let changed = 0;
    (Array.isArray(solves) ? solves : []).forEach(s => {
      if (!Array.isArray(s.anomaly)) { s.anomaly = assess(s); changed++; }
    });
    return changed;
  }

  /* 生效异常 = 检出异常 且 用户未确认误报 */
  function active(s) {
    return Array.isArray(s?.anomaly) && s.anomaly.length && !s.anomalyCleared;
  }

  function label(flags) {
    return (Array.isArray(flags) ? flags : []).map(f => LABELS[f] || f).join('、');
  }

  window.CubeAnalyzerQuality = { assess, ensure, active, label, LABELS, FAST_MS, LONG_MS };
})();

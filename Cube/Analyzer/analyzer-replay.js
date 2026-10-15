(() => {
  'use strict';

  /* =====================================================================
   * Analyzer 录像回放（2026-10-12）
   * ---------------------------------------------------------------------
   * 参照 CubeStation / csTimer Replay / Twistytimer 一类成熟产品的口径：
   *   · 3D 魔方按**真实时间戳**逐动作重演，停顿（识别时间）原样保留
   *   · 时间轴可任意拖动 / 单步前进后退 / 跳到某一阶段
   *   · 0.25x–4x 变速，暂停、循环、跳到开头/结尾
   *   · 与 Analyzer 独有的分段数据联动：Cross / F2L / OLL / PLL 分段配色，
   *     并把 recognition（识别/停顿）与 execution（执行）在时间轴上区分开来
   *   · 动作列表跟随高亮，可点击单步定位
   *
   * 数据来源全部是记录里已有的字段，绝不新增/修改训练数据：
   *   startFacelet + moves + timestamps + snapshots/stateSequence + steps
   * ===================================================================== */

  const A = () => window.CubeAnalyzerSolveAnalysis;
  const Core = () => window.CubeAnalyzerCore;

  const FACE_RE = /^([URFDLB])(2|')?$/;
  const ROT_RE = /^([xyz])(2|')?$/i;
  const SLICE_RE = /^([MES])(2|')?$/;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtTime(ms, digits = 2) {
    const v = Number(ms);
    return Number.isFinite(v) ? `${(v / 1000).toFixed(digits)}s` : '—';
  }
  function fmtClock(ms) {
    const v = Math.max(0, Number(ms) || 0);
    return `${(v / 1000).toFixed(2)}`;
  }

  /* ---------------------------------------------------------------------
   * 1. 把一条 solve 记录整理成回放模型
   * ------------------------------------------------------------------- */

  // 移动 → twisty 的 [layerStart, layerEnd, face, power] 指令。
  // 只处理面转：单层（layer 1）。
  //
  // 为什么不处理其余三类动作（实测结论，见 .tests/replay-selfcheck.js）：
  //   · x/y/z 整体旋转：mathlib 的 toFaceCube() 是「相对魔方自身」的面位串，
  //     整体旋转对它没有任何影响（实测 x 前后 facelet 逐字相同），而 twisty 的
  //     [1,3,face,pow] 会真的把魔方转过去 —— 两边口径不一致，一律按「无操作」跳过。
  //   · M/E/S 中层：twistynnn 的层筛选是 dimension-2*layerStart+2.5 那一套，
  //     实测 [2,2,'L',1] 只命中中心层（不是数学意义上的 M），表达不出正确的中层，
  //     所以不用猜测的指令，改用记录里的权威快照纠正。
  function twistyCommand(move) {
    const m = String(move || '').trim();
    if (!m) return null;
    const face = FACE_RE.exec(m);
    if (face) return [1, 1, face[1], face[2] === '2' ? 2 : face[2] === "'" ? -1 : 1];
    return null;
  }

  // 该动作是否对 facelet 完全没有影响（整体旋转 x/y/z），可以只推进计数、不碰魔方
  function isNoop(move) {
    return ROT_RE.test(String(move || '').trim());
  }

  function faceletString(value) {
    if (!value) return '';
    const s = typeof value === 'string' ? value : (value.facelet || '');
    const text = String(s || '').trim().toUpperCase();
    return text.length === 54 ? text : '';
  }

  // 状态序列：优先用硬件快照（含旋转/切片也准确），退化到解析器重建，最后退回记录里的 stateSequence。
  function buildStates(solve) {
    const moves = solve.moves || [];
    const n = moves.length;
    const api = A();
    if (api && typeof api.statesFromSnapshots === 'function') {
      try {
        const cubes = api.statesFromSnapshots(solve.startFacelet, moves, solve.snapshots, solve.rawSolutionSequence);
        if (cubes.length === n + 1) {
          const out = cubes.map(c => { try { return typeof c?.toFaceCube === 'function' ? c.toFaceCube() : ''; } catch (_) { return ''; } });
          if (out[0] && out.every(x => x.length === 54)) return out;
        }
      } catch (e) { console.warn('[Replay] 状态重建失败，退回记录内快照', e); }
    }
    const seq = solve.stateSequence || solve.snapshots;
    if (Array.isArray(seq)) {
      const out = seq.map(faceletString);
      if (out.length === n + 1 && out.every(x => x.length === 54)) return out;
    }
    return [];
  }

  // 时间轴分段：steps 已经带 startIndex / endIndex（对全局 moves 的下标）。
  function buildSegments(solve, moveCount) {
    const steps = (solve.steps || []).filter(s => Number.isFinite(Number(s.startIndex)) && Number.isFinite(Number(s.endIndex)));
    if (!steps.length) return [];
    // F2L 的 4 个子段（slotIndex）单独拆出，其余按聚合段显示：与详情弹窗同一口径
    const rows = steps.slice().sort((a, b) => Number(a.startIndex) - Number(b.startIndex));
    return rows.map(st => {
      const label = st.slotIndex ? `F2L ${st.slotIndex}` : (st.label || st.name || st.key || 'Stage');
      const startIdx = Math.max(0, Math.min(moveCount, Number(st.startIndex)));
      const endIdx = Math.max(startIdx, Math.min(moveCount, Number(st.endIndex)));
      return {
        label,
        kind: st.slotIndex ? 'sub' : (st.name || st.key || 'stage'),
        startIdx,
        endIdx,
        time: Number(st.time) || 0,
        recognition: Number(st.recognition) || 0,
        execution: Number(st.execution) || 0,
        turns: Number(st.turns) || 0,
        caseName: st.caseName || '',
        auf: st.auf && st.auf.count ? st.auf : null,
      };
    }).filter((s, i, arr) => {
      // 零长度且无耗时的段（识别器对未落位 slot 会给出 start==end 的空段）不画，避免时间轴上出现 1px 碎片
      if (!(s.endIdx > s.startIdx || s.time > 0)) return false;
      // 与某个聚合段完全同区间的子段也不画：时间轴上两个同位置的段会重叠成看不清的碎片，
      // 而且点哪个都是同一段，留着只会让分段条更乱。
      if (s.kind === 'sub') {
        return !arr.some(o => o !== s && o.kind !== 'sub' && o.startIdx === s.startIdx && o.endIdx === s.endIdx);
      }
      return true;
    });
  }

  // 识别出的底面（十字所在面）。analysisFrame.crossFace 是 URFDLB 之一，
  // 它指的是「记录帧里哪一面被当作底面」，回放时据此把那一面摆到屏幕下方。
  // 六色底 / 任意持握的记录会给出不同值；识别不到时为 null，此时按 twisty 默认朝向（D 朝下）。
  function detectCrossFace(solve) {
    const face = String(solve?.analysisFrame?.crossFace || '').trim().toUpperCase();
    return /^[URFDLB]$/.test(face) ? face : null;
  }

  function buildModel(solve) {
    const moves = (solve.moves || []).map(m => String(m || '').trim());
    const timestamps = (solve.timestamps || []).map(Number);
    const n = moves.length;
    const ts = timestamps.length === n ? timestamps : null;
    const total = Number(solve.totalTime) || (ts && ts.length ? ts[ts.length - 1] : 0);
    const states = buildStates(solve);
    const segments = buildSegments(solve, n);
    // 每个动作的等效时间：正常用记录时间戳；缺失时按总时长均分（保证仍可播放）
    const times = ts || moves.map((_, i) => (n > 1 ? (total * (i + 1)) / n : total));
    return {
      solve,
      moves,
      times,
      n,
      total,
      states,
      segments,
      crossFace: detectCrossFace(solve),
      method: solve.analysisType || 'CFOP',
      hasTrace: n > 0 && times.every(Number.isFinite),
    };
  }

  /* ---------------------------------------------------------------------
   * 2. 3D 场景：three.js + twisty（与 /Cube/Cross 同一套公用资源）
   * ------------------------------------------------------------------- */

  const CUBE_COLORS = [0xffffff, 0xf05a3b, 0x2dbb70, 0xffd447, 0xff941f, 0x2f69df];

  /* —— 视角：把「识别出的底面」放到魔方的底面位置 ——
   *
   * twisty 默认把 U 面朝上、相机正对一面（kernel 的 vrcOri），既扁平又不符合
   * 这一把的实际持握。Analyzer 已经在 analysisFrame.crossFace 里识别出这把的
   * 底面（六色底 / 任意持握都能给出来），回放就按它摆正：
   * 把那一面转到魔方的底面位置（屏幕下方），顶面换成它的对面 —— 与选手当时的
   * 观察方向一致，Cross / F1L / OLL / PLL 的分段才看得懂。
   *
   * 实现分两步，缺一不可：
   *   1) 相机：固定用一组标准等轴参数（theta=20, phi=4），保证始终能看到三个面、
   *      有立体感。参数语义与 twisty 的 moveCamera 一致（48 单位 = 一圈）。
   *   2) 朝向：旋转 twisty 的根对象（twisty._3d）。实测这样只影响渲染，
   *      不影响 getFacelet 与动作结算 —— 所以逻辑状态与画面能各管各的，互不干扰。
   *
   * 为什么不用「调相机去迎合底面」：相机 up 与 lookAt 的组合在这个精简版 three.js 里
   * 无法稳定表达任意朝向（实测会出现压平/滚转），而转魔方对象的做法对所有六个面
   * 都验证过，底面确实落在屏幕下方。
   */
  const VIEW_THETA = 20;   // 水平方位（48 单位 = 一圈）
  const VIEW_PHI = 4;      // 仰角：0 = 水平，越大越俯视

  // 把某个面转到「底面位置」所需的根对象旋转（欧拉角，单位弧度）
  const FACE_ORIENTATION = {
    D: [0, 0, 0],
    U: [-Math.PI, 0, 0],
    F: [Math.PI / 2, 0, 0],
    B: [-Math.PI / 2, 0, 0],
    R: [0, 0, -Math.PI / 2],
    L: [0, 0, Math.PI / 2],
  };

  // 复刻 twisty 内部 moveCamera 的球坐标换算，得到标准等轴视角的相机位置
  function cameraOffset(theta, phi) {
    const THREE = window.THREE;
    const TAU = Math.PI * 2;
    const z = 2 * Math.sqrt(2) * Math.sin((phi * TAU) / 48);
    const xy = 2 * Math.sqrt(2) * Math.cos((phi * TAU) / 48);
    return new THREE.Vector3(
      xy * Math.sin((theta * TAU) / 48),
      z,
      xy * Math.cos((theta * TAU) / 48),
    );
  }

  /* 摆好视角与朝向。必须在 twisty 的 resize() 之后调用
   * （resize 内部会用 vrcOri 重置相机，并且在重建时把根对象的角度清零）。
   * 保留用户已有的拖动量，这样重算视角不会把用户转过的角度抹掉。 */
  function applyFaceView(scene, crossFace) {
    if (!scene || !window.THREE) return;
    try {
      if (typeof scene.setViewState === 'function') {
        const prev = scene.getViewState ? scene.getViewState() : null;
        scene.setViewState({
          baseCameraOffset: cameraOffset(VIEW_THETA, VIEW_PHI),
          baseCameraUp: new window.THREE.Vector3(0, 1, 0),
          dragTheta: prev ? prev.dragTheta : 0,
          dragPhi: prev ? prev.dragPhi : 0,
        });
      }
      const twisty = scene.getTwisty && scene.getTwisty();
      const root = twisty && twisty._3d;
      if (root && root.rotation) {
        const r = FACE_ORIENTATION[crossFace] || FACE_ORIENTATION.D;
        root.rotation.x = r[0];
        root.rotation.y = r[1];
        root.rotation.z = r[2];
        root.updateMatrix && root.updateMatrix();
      }
      if (scene.render) scene.render();
    } catch (e) {
      console.warn('[Replay] 视角设置失败', e);
    }
  }

  function createScene(stage) {
    if (!window.twistyjs || !window.THREE) return null;
    const scene = new window.twistyjs.TwistyScene();
    stage.innerHTML = '';
    stage.appendChild(scene.getDomElement());
    scene.initializeTwisty({
      type: 'cube',
      dimension: 3,
      stickerWidth: 1.72,
      scale: 0.96,
      allowDragging: false,
      faceColors: CUBE_COLORS,
    });
    bindMoveListener(scene);
    return scene;
  }

  /* twisty 的动作回调：step 0 = 入队、1 = 动画开始、2 = 动画结束。
   * 播放时以「动画结束」为唯一信号推进 cursor —— 画面、计数器、列表高亮严格同步。
   *
   * ⚠️ 这个回调在 initializeTwisty（硬重置）时会被 stopAnimation 打断，
   * 不会误触发（stopAnimation 只取消 rAF，不 fireMoveEnded），所以监听器
   * 在重置后依然安全。监听器挂在 TwistyScene 上，重建贴纸不会丢。 */
  function bindMoveListener(scene) {
    if (!scene || typeof scene.addMoveListener !== 'function') return;
    try {
      scene.addMoveListener((move, step) => {
        if (step !== 2 || !R.playing) return;
        const model = R.model;
        if (!model) return;
        R.cursor = Math.min(model.n, R.cursor + 1);
        painter();
        drainQueue();   // 队列空了就补下一个动作，保持动画连贯
      });
    } catch (e) { console.warn('[Replay] 动作回调注册失败', e); }
  }

  /* 把 3D 场景调到与舞台一致。
   * twisty 的 resize() 内部用 min(容器宽, 容器高) 决定画布边长，而容器就是
   * getDomElement() 返回的那个 div —— 所以我们先把那个 div 钉成正方形，
   * 再调 resize()，画布尺寸就一定是稳定且正确的。
   * 视角一律在 resize 之后重设（resize 内部会用 vrcOri 把相机重置掉）。 */
  function resizeScene(scene, stage) {
    if (!scene || !stage) return;
    const rect = stage.getBoundingClientRect();
    const side = Math.max(80, Math.floor(Math.min(rect.width, rect.height) - 8));
    const holder = scene.getDomElement ? scene.getDomElement() : stage.firstElementChild;
    if (holder) { holder.style.width = `${side}px`; holder.style.height = `${side}px`; }
    try { scene.resize(); } catch (e) { console.warn('[Replay] resize 失败', e); }
    applyCurrentFaceView(scene);
  }

  // 用当前记录识别出的底面摆视角
  function applyCurrentFaceView(scene) {
    applyFaceView(scene, R.model?.crossFace || 'D');
  }

  /* ---------------------------------------------------------------------
   * 3. 回放器
   * ------------------------------------------------------------------- */

  const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4];

  const R = {
    model: null,
    open: false,
    scene: null,
    stage: null,
    el: {},
    // 播放状态
    cursor: 0,        // 已应用的 moves 数量（0..n）
    playing: false,
    speed: 1,
    loop: false,
    rafId: 0,
    playStartAt: 0,   // performance.now()
    playStartCursorMs: 0,
    dragging: false,
    lastPaintedIdx: -1,
    autoScroll: true,
    preferSegment: false,   // 刚点过分段条：阶段名/高亮优先指向目标段
    animSpeed: null,        // 当前为动画设置的 vrcSpeed（非 null 表示回放改过它）
    baseVrcSpeed: '90',     // 打开回放时的 vrcSpeed 原值，退出时还原
    settleTimer: 0,         // 暂停后等待动画跑空再钉状态的定时器
  };

  function moveTimeBefore(model, idx) { return idx <= 0 ? 0 : Number(model.times[idx - 1]) || 0; }
  function cursorMs() { return moveTimeBefore(R.model, R.cursor); }

  /* 把魔方摆到「已完成 idx 个动作」的状态 —— 唯一的定位入口
   * （拖动进度条、单步、跳到某阶段、点动作列表、以及播放逐帧都走这里）。
   * 状态来源始终是记录里的权威贴纸快照 states[]。
   */
  function applyCursor(idx, opts = {}) {
    const model = R.model;
    if (!model) return;
    const want = Math.max(0, Math.min(model.n, Math.round(idx)));
    if (want === R.cursor && !opts.force) return;
    // 除「点分段条」以外的任何定位都不再锚定到某一段
    if (!opts.anchorSegment) R.preferSegment = false;
    jumpTo(want);
  }

  // 硬重置：把 twisty 拉回复原态并清掉所有挂起的动画。
  // 重复调用 initializeTwisty 在 twisty 内部顺序是
  //   moveQueue/currentMove/moveProgress 清空 → stopViewAnimation → stopAnimation → 重建贴纸
  /* 把 3D 场景拉回「干净、无挂起动画」的状态。
   *
   * 为什么必须重建而不是只调 initializeTwisty：
   * twisty 的动画状态机里有一个模块级的 cachedFireMoves（已播完待提交的动作），
   * initializeTwisty 并不会清它 —— 实测残留会在之后被 fire 出来，
   * 把 setFacelet 刚摆好的状态又改回去（表现：拖动/单步后魔方停在错的地方）。
   * 直接丢掉整个 TwistyScene 对象才能连它一起丢干净。
   *
   * 代价是每次瞬时定位重建一次场景；实测单次约几毫秒，拖动时足够跟手。 */
  function hardResetScene() {
    const model = R.model;
    if (!model || !R.stage) return;
    R.scene = createScene(R.stage);
    if (!R.scene) return;
    R.scene.setViewDragClamped?.(true);
    resizeScene(R.scene, R.stage);
  }

  /* 瞬时定位到「已完成 idx 个动作」的状态。
   *
   * 步骤：硬重置（twisty 内部会 stopAnimation + 清空 moveQueue/currentMove/缓存，
   * 于是「动画队列非空」这条不变量被恢复）→ 用权威贴纸快照 setFacelet 摆过去。
   * 这是拖动进度条、单步、跳到阶段、点动作列表、循环回到起点共用的路径。
   *
   * keepPlaying: 播放内部用（处理 kara 动作/循环），跳完不停播放。
   */
  function jumpTo(idx, keepPlaying = false) {
    const model = R.model;
    if (!model) return;
    if (R.playing && !keepPlaying) pause();
    hardResetScene();
    const want = Math.max(0, Math.min(model.n, Math.round(idx)));
    // 没有权威快照时（极端的老记录）只能停在复原态，并明确标记起点不可信
    if (!model.states || !model.states.length) { R.cursor = want; return; }
    snapToState(want);
    R.cursor = want;
  }

  /* 摆到「已完成 idx 个动作」的权威状态（贴纸快照）。
   * 实测：setFacelet 的结果与 mathlib 逐字一致，之后继续 addMoves 跑动画也依然精确。
   *
   * 调用前提：动画队列必须已排空（由 jumpTo 的 hardResetScene 保证）。
   * 若在动画进行中调用，队列里剩下的动作会继续作用到新状态上 —— 实测会与计数脱节。 */
  function snapToState(idx) {
    const model = R.model, scene = R.scene;
    if (!model || !scene) return false;
    const facelet = model.states[idx];
    if (!facelet) return false;
    try {
      const twisty = scene.getTwisty && scene.getTwisty();
      if (!twisty || typeof twisty.setFacelet !== 'function') return false;
      const ok = twisty.setFacelet(twisty, facelet);
      if (scene.render) scene.render();
      return ok !== false;
    } catch (e) {
      console.warn('[Replay] 状态快照失败', e);
      return false;
    }
  }

  // 起点状态：记录里的 startFacelet 就是权威起点，直接摆上去。
  // 拿不到 stateSequence 的极老记录退回「复原态 + scramble」，再退回复原态并给出提示。
  function applyStartState() {
    const model = R.model;
    if (!model || !R.scene) return;
    if (model.states[0] && snapToState(0)) {
      R.startReady = true;
      R.startRoute = 'facelet';
      return;
    }
    const scramble = String(model.solve.scramble || '').trim();
    const cmds = scramble.split(/\s+/).filter(Boolean).map(twistyCommand).filter(Boolean);
    if (cmds.length) {
      R.scene.applyMoves(cmds);
      R.startReady = true;
      R.startRoute = 'scramble';
      return;
    }
    R.startReady = false;
    R.startRoute = '';
  }

  /* ------------------------------ UI ------------------------------ */

  // 当前处于哪一段。
  // 边界口径：一个动作执行完（cursor = k）就属于「包含第 k 个动作」的那一段，
  // 所以默认用 startIdx < k <= endIdx 判定。
  // preferStart = true 时优先匹配「起点恰为 k」的段 —— 用户从分段条跳到某段开头，
  // 阶段名应该显示他点的那一段，而不是上一段的收尾。
  function stageAt(idx, preferStart = false) {
    const segs = R.model?.segments || [];
    if (!segs.length) return null;
    if (preferStart) {
      const own = segs.find(s => s.startIdx === idx);
      if (own) return own;
    }
    for (const s of segs) {
      if (idx > s.startIdx && idx <= s.endIdx) return s;
    }
    for (const s of segs) {
      if (idx >= s.startIdx && idx <= s.endIdx) return s;
    }
    return idx <= segs[0].startIdx ? segs[0] : segs[segs.length - 1];
  }

  function rollingTPS(idx, window = 5) {
    const model = R.model;
    if (!model || idx <= 0) return null;
    const from = Math.max(0, idx - window);
    const turns = model.moves.slice(from, idx).filter(m => !ROT_RE.test(m) && !SLICE_RE.test(m)).length;
    const dt = moveTimeBefore(model, idx) - moveTimeBefore(model, from);
    return dt > 0 ? (turns * 1000) / dt : null;
  }

  function gapBefore(idx) {
    const model = R.model;
    if (!model || idx <= 0 || idx > model.n) return null;
    return moveTimeBefore(model, idx) - moveTimeBefore(model, idx - 1);
  }

  function renderSegments() {
    const model = R.model, host = R.el.segments;
    if (!host) return;
    const segs = model.segments;
    if (!segs.length) {
      host.innerHTML = '<div class="replay-seg-empty muted">本把没有可用的阶段分段数据（需要智能魔方完整轨迹）</div>';
      return;
    }
    const total = Math.max(1, model.n);
    host.innerHTML = segs.map((s, i) => {
      const left = (s.startIdx / total) * 100;
      const width = Math.max(1.2, ((s.endIdx - s.startIdx) / total) * 100);
      const recognitionPct = s.time > 0 ? Math.min(100, (s.recognition / s.time) * 100) : 0;
      const sub = s.slotIndex ? ' is-sub' : '';
      return `<button type="button" class="replay-seg${sub}" data-seg="${i}" style="left:${left}%;width:${width}%" title="${esc(s.label)} · ${fmtTime(s.time)}（识别 ${fmtTime(s.recognition)} / 执行 ${fmtTime(s.execution)}）">
        <i class="replay-seg-rec" style="width:${recognitionPct}%"></i>
        <span>${esc(s.label)}</span>
      </button>`;
    }).join('');
  }

  function renderMoveList() {
    const model = R.model, host = R.el.moves;
    if (!host) return;
    if (!model.n) { host.innerHTML = '<div class="muted">本把没有动作数据</div>'; return; }
    // 原始动作序列优先（含设备级连招拆解）；否则退化为逻辑动作列表
    const rows = model.moves.map((m, i) => {
      const raw = model.solve.rawSolutionSequence?.[i];
      const rawText = Array.isArray(raw?.rawMoves) && raw.rawMoves.length ? raw.rawMoves.join(' ') : '';
      const gap = i === 0 ? moveTimeBefore(model, 1) : (model.times[i] - model.times[i - 1]);
      const cls = ROT_RE.test(m) ? 'is-rotation' : SLICE_RE.test(m) ? 'is-slice' : '';
      return `<button type="button" class="replay-move ${cls}" data-move="${i}">
        <span class="replay-move-no">${i + 1}</span>
        <span class="replay-move-face">${esc(m)}</span>
        <span class="replay-move-time mono">${fmtClock(model.times[i])}</span>
        <span class="replay-move-gap mono${gap > 400 ? ' slow' : ''}">${Number.isFinite(gap) ? `+${Math.round(gap)}` : '—'}</span>
        <span class="replay-move-raw">${esc(rawText && rawText !== m ? rawText : '')}</span>
      </button>`;
    });
    host.innerHTML = rows.join('');
  }

  function painter() {
    const model = R.model;
    if (!model || !R.open) return;
    const idx = R.cursor;
    const t = moveTimeBefore(model, idx);
    if (R.el.scrub && !R.dragging) {
      R.el.scrub.value = String(model.total > 0 ? Math.round((t / model.total) * 1000) : 0);
      R.el.scrub.disabled = model.total <= 0;
    }
    if (R.el.time) R.el.time.textContent = fmtClock(t);
    if (R.el.total) R.el.total.textContent = fmtClock(model.total);
    if (R.el.movesCount) R.el.movesCount.textContent = `${idx} / ${model.n}`;
    const tps = rollingTPS(idx);
    if (R.el.tps) R.el.tps.textContent = Number.isFinite(tps) ? tps.toFixed(2) : '—';
    const gap = gapBefore(idx);
    if (R.el.gap) R.el.gap.textContent = Number.isFinite(gap) ? `${Math.round(gap)}ms` : '—';
    if (R.el.currentMove) R.el.currentMove.textContent = idx > 0 ? model.moves[idx - 1] : '—';
    const seg = stageAt(idx, R.preferSegment);
    if (R.el.stageName) R.el.stageName.textContent = seg ? seg.label : '—';
    if (R.el.progress) R.el.progress.style.width = `${model.total > 0 ? Math.min(100, (t / model.total) * 100) : 0}%`;

    // 分段高亮
    R.el.segments?.querySelectorAll('.replay-seg').forEach((b, i) => {
      const s = model.segments[i];
      b.classList.toggle('active', !!s && !!seg && s === seg);
    });
    // 动作列表高亮 + 跟随
    const list = R.el.moves;
    if (list && R.lastPaintedIdx !== idx) {
      R.lastPaintedIdx = idx;
      const prev = list.querySelector('.replay-move.current');
      if (prev) prev.classList.remove('current');
      const node = list.querySelector(`.replay-move[data-move="${idx - 1}"]`);
      if (node) {
        node.classList.add('current');
        if (R.autoScroll) {
          const box = list.parentElement;
          if (box) {
            const top = node.offsetTop - box.clientHeight / 2 + node.offsetHeight / 2;
            box.scrollTop = Math.max(0, top);
          }
        }
      }
      // 已完成的动作标灰
      const done = list.querySelectorAll('.replay-move.done');
      if (done.length > 64) done.forEach(n => n.classList.remove('done'));
      list.querySelectorAll('.replay-move').forEach(n => {
        const i = Number(n.dataset.move);
        n.classList.toggle('done', i < idx - 1);
      });
    }
  }

  /* --------------------------- 播放循环 --------------------------- */

  /* 播放实现口径（2026-10-12，实测定稿）：
   *
   * 播放用 twisty 自己的动画队列（addMoves）逐动作重演，转动有插值；
   * 而拖动进度条 / 单步 / 跳到某阶段走「硬重置 + 贴纸快照」的瞬时定位。
   *
   * 两者绝对不能同时进行 —— 实测：
   *   · setFacelet 摆起点后接 addMoves，动画结果与 mathlib 逐字一致（可靠）；
   *   · 但动画进行中再调 setFacelet，队列里剩下的动作会继续作用到新状态上，
   *     画面就与计数脱节了。
   * 所以所有瞬时定位都先 hardResetScene()（twisty 内部会 stopAnimation 并清空队列），
   * 保证「队列要么在跑动画、要么为空」这条不变量。
   *
   * 计数与画面严格同步：cursor 只由动画结束回调（moveListener step=2）推进，
   * 时间轴跑得再快也不会让计数超过画面。
   */
  let pendingTarget = 0;

  function loop() {
    if (!R.playing || !R.open) { R.rafId = 0; return; }
    const model = R.model;
    const elapsed = (performance.now() - R.playStartAt) * R.speed + R.playStartCursorMs;
    const done = elapsed >= model.total;
    let idx = model.n;
    if (!done) {
      idx = 0;
      while (idx < model.n && model.times[idx] <= elapsed) idx++;
    }
    pendingTarget = idx;
    drainQueue();
    painter();

    if (done && R.cursor >= model.n && (R.scene?.isMoveFinished?.() ?? true)) {
      // 播完：先做一次收尾对齐 —— 动画的最后一帧与权威快照之间可能差一个渲染帧，
      // 收尾把状态钉死在 states[n]（顺带保证「播放结束 = 复原」这一眼能看出来）。
      if (!R.loop) settleFinalState();
      if (R.loop) {
        resetToStartForLoop();
        R.playStartAt = performance.now();
        R.playStartCursorMs = 0;
        painter();
        R.rafId = requestAnimationFrame(loop);
      } else {
        R.playing = false;
        syncTransport();
        painter();
        R.rafId = 0;
      }
      return;
    }
    R.rafId = requestAnimationFrame(loop);
  }

  // 播放收尾：把魔方钉到最后一步的权威快照上（不动 cursor，只是让画面与记录完全一致）
  function settleFinalState() {
    const model = R.model;
    if (!model || !R.scene || !model.states?.length) return;
    // 队列已由上面的 isMoveFinished 判断保证为空，直接 setFacelet 安全
    snapToState(model.n);
  }

  // 播放期间只补一个动作：入队后交给动画队列，等 moveListener 回调再补下一个。
  // 这样每一拍都对应一次真实的转动动画，也不会出现「一帧内猛推进好几步」的跳变。
  function drainQueue() {
    const model = R.model, scene = R.scene;
    if (!model || !scene) return;
    if (R.cursor >= pendingTarget) return;
    if (scene.isMoveFinished && !scene.isMoveFinished()) return; // 还有动作在飞
    const i = R.cursor;
    const move = String(model.moves[i] || '').trim();
    R.preferSegment = false;

    // 整体旋转 x/y/z 对 facelet 没有影响（记录里旋转前后状态完全相同）→ 只推进计数。
    // 紧接着递归补下一个动作：noop 不占动画时间，若停在这里会留下一个「空闲但未播完」
    // 的窗口，采样/收尾逻辑会把那一刻当成稳定状态，造成计数与画面短暂错位。
    if (isNoop(move)) { R.cursor = i + 1; painter(); drainQueue(); return; }

    const cmd = twistyCommand(move);
    if (cmd) {
      tuneMoveAnimation(model, i);
      scene.addMoves([cmd]);
      return;
    }

    // 无法表达的动作（M/E/S 等）：动画链里表达不了，直接用该步之后的权威快照摆过去。
    // 这里**不重建场景** —— 上面已经确认队列是空的，setFacelet 可以安全地就地改状态，
    // 重建反而会打断动画链的节拍（实测会让切片之后的播放出现停滞）。
    // 这类动作在真实数据里极少，瞬跳不影响观感。
    snapToState(i + 1);
    R.cursor = i + 1;
    painter();
    drainQueue();
  }

  /* 让这一步的转动动画时长贴近它真实的间隔 —— 回放才看得出「这一步拧得快还是慢」。
   *
   * twisty 的动画进度公式是
   *     progress += (Δt / vrcSpeed) * (moveQueue.length + 2) / 2
   * 我们逐动作入队（动画期间队列长度 ≈ 0），所以 (0+2)/2 = 1，
   * 即「动画时长 ≈ vrcSpeed 毫秒」。把 vrcSpeed 设成该步的真实间隔即可对齐。
   *
   * 上下夹住：太短看不见转动（瞬跳），太长会在长停顿处显得卡住；
   * 再按当前播放倍速缩放（2x 时动画也该快一倍）。 */
  const ANIM_MIN_MS = 110;
  const ANIM_MAX_MS = 380;
  function tuneMoveAnimation(model, i) {
    const k = window.kernel;
    if (!k || typeof k.setProp !== 'function') return;
    const gap = i === 0
      ? (Number(model.times[0]) || ANIM_MIN_MS)
      : (Number(model.times[i]) || 0) - (Number(model.times[i - 1]) || 0);
    const speed = R.speed || 1;
    let ms = Number.isFinite(gap) && gap > 0 ? gap : ANIM_MIN_MS;
    ms = Math.max(ANIM_MIN_MS, Math.min(ANIM_MAX_MS, ms)) / speed;
    R.animSpeed = ms;
    k.setProp('vrcSpeed', String(Math.round(ms)));
  }

  // 循环播放回到起点。必须是「瞬时定位」路径，否则会和刚播完的队列残留冲突。
  function resetToStartForLoop() {
    const model = R.model;
    if (!model) return;
    jumpTo(0, true);
  }

  function syncTransport() {
    const b = R.el.playBtn;
    if (b) {
      b.textContent = R.playing ? '暂停' : '播放';
      b.classList.toggle('playing', R.playing);
      b.setAttribute('aria-label', R.playing ? '暂停回放' : '开始回放');
    }
    const l = R.el.loopBtn;
    if (l) l.classList.toggle('active', R.loop);
    R.el.speedHost?.querySelectorAll('[data-speed]').forEach(x => {
      x.classList.toggle('active', Number(x.dataset.speed) === R.speed);
    });
  }

  function play() {
    const model = R.model;
    if (!model || !model.n || R.playing) return;
    if (R.cursor >= model.n) seek(0, { keepPlaying: true });
    R.playing = true;
    R.playStartAt = performance.now();
    R.playStartCursorMs = cursorMs();
    syncTransport();
    if (window.CubeAudio && typeof CubeAudio.effect === 'function') { try { CubeAudio.effect('click'); } catch (e) {} }
    if (!R.rafId) R.rafId = requestAnimationFrame(loop);
  }

  function pause() {
    R.playing = false;
    if (R.rafId) { cancelAnimationFrame(R.rafId); R.rafId = 0; }
    syncTransport();
    // 暂停时可能正好停在某个动作的动画中途：等它自然播完，再把画面钉到该步的
    // 权威快照上 —— 暂停后看到的必须是记录里的真实状态，而不是转了一半的中间态。
    settleAfterMoveAnimation();
  }

  // 等 twisty 的动画队列跑空（最多等一小会儿），然后把当前 cursor 的状态钉准
  function settleAfterMoveAnimation() {
    const model = R.model;
    if (!model || !R.scene) return;
    clearTimeout(R.settleTimer);
    let tries = 0;
    const tick = () => {
      if (!R.open || !R.scene) return;
      const scene = R.scene;
      if (scene.isMoveFinished && !scene.isMoveFinished() && tries < 60) {
        tries++;
        R.settleTimer = setTimeout(tick, 25);
        return;
      }
      if (R.playing) return;      // 已经重新开播了，别乱钉
      snapToState(R.cursor);
      painter();
    };
    R.settleTimer = setTimeout(tick, 30);
  }

  function toggle() { R.playing ? pause() : play(); }

  // 跳转（不带动画，也不改变播放状态）
  function seek(idx, opts = {}) {
    const model = R.model;
    if (!model) return;
    const want = Math.max(0, Math.min(model.n, Math.round(idx)));
    applyCursor(want, { animate: false, force: true });
    painter();
    if (R.playing && !opts.keepPlaying) {
      R.playStartAt = performance.now();
      R.playStartCursorMs = cursorMs();
    }
  }

  function seekMs(ms) {
    const model = R.model;
    if (!model) return;
    const t = Math.max(0, Math.min(model.total, Number(ms) || 0));
    let idx = 0;
    while (idx < model.n && model.times[idx] <= t) idx++;
    seek(idx);
  }

  function stepBy(delta) {
    pause();
    seek(R.cursor + delta);
  }

  function seekSegment(index) {
    const model = R.model;
    if (!model) return;
    const s = model.segments[index];
    if (!s) return;
    pause();
    // 跳到该阶段开始处（还没做该段第一个动作），阶段名/高亮都指向目标段本身
    R.preferSegment = true;
    applyCursor(s.startIdx, { force: true, anchorSegment: true });
    painter();
  }

  /* ------------------------------ 弹窗 ------------------------------ */

  function buildShell() {
    const modal = R.el.modal;
    if (!modal) return;
    modal.innerHTML = `
      <div class="modal card replay-modal" role="dialog" aria-modal="true" aria-labelledby="replayTitle">
        <div class="modal-head">
          <div class="replay-headline">
            <h2 id="replayTitle">录像回放</h2>
            <span class="replay-sub" id="replaySub"></span>
          </div>
          <div class="replay-headline-actions">
            <button class="icon-btn" id="replayClose" type="button" aria-label="关闭回放">×</button>
          </div>
        </div>
        <div class="replay-body">
          <div class="replay-stage-wrap">
            <div class="replay-stage" id="replayStage"></div>
            <div class="replay-stage-hint" id="replayStageHint">拖动魔方可旋转视角</div>
          </div>
          <div class="replay-side">
            <div class="replay-metrics">
              <div><span class="mini-label">当前动作</span><strong id="replayCurrentMove" class="mono">—</strong></div>
              <div><span class="mini-label">阶段</span><strong id="replayStageName" class="mono">—</strong></div>
              <div><span class="mini-label">TPS</span><strong id="replayTps" class="mono">—</strong></div>
              <div><span class="mini-label">本步间隔</span><strong id="replayGap" class="mono">—</strong></div>
            </div>
            <div class="replay-move-box">
              <div class="replay-move-head"><span>动作列表</span><span class="muted" id="replayMovesCount">0 / 0</span></div>
              <div class="replay-move-scroll" id="replayMoves"></div>
            </div>
          </div>
        </div>
        <div class="replay-timeline">
          <div class="replay-track">
            <div class="replay-progress" id="replayProgress"></div>
            <input class="replay-scrub" id="replayScrub" type="range" min="0" max="1000" value="0" step="1" aria-label="回放进度">
          </div>
          <div class="replay-segments" id="replaySegments"></div>
        </div>
        <div class="replay-transport">
          <div class="replay-transport-main">
            <button class="btn btn-ghost" id="replayToStart" type="button" title="回到开头">⏮</button>
            <button class="btn btn-ghost" id="replayPrevStep" type="button" title="上一个动作（←）">◀</button>
            <button class="btn btn-primary replay-play" id="replayPlay" type="button">播放</button>
            <button class="btn btn-ghost" id="replayNextStep" type="button" title="下一个动作（→）">▶</button>
            <button class="btn btn-ghost" id="replayToEnd" type="button" title="跳到结尾">⏭</button>
            <button class="btn btn-ghost" id="replayLoop" type="button" title="循环播放">↻ 循环</button>
          </div>
          <div class="replay-transport-side">
            <div class="replay-clock"><strong class="mono" id="replayTime">0.00</strong><span class="muted">/ <span id="replayTotal" class="mono">0.00</span></span></div>
            <div class="segmented replay-speeds" id="replaySpeeds">
              ${SPEEDS.map(s => `<button data-speed="${s}" type="button">${s}x</button>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
    R.el.modal.hidden = false;
  }

  function cacheRefs() {
    const q = id => document.getElementById(id);
    R.el.close = q('replayClose');
    R.el.stage = q('replayStage');
    R.el.sub = q('replaySub');
    R.el.scrub = q('replayScrub');
    R.el.progress = q('replayProgress');
    R.el.segments = q('replaySegments');
    R.el.moves = q('replayMoves');
    R.el.movesCount = q('replayMovesCount');
    R.el.playBtn = q('replayPlay');
    R.el.loopBtn = q('replayLoop');
    R.el.speedHost = q('replaySpeeds');
    R.el.time = q('replayTime');
    R.el.total = q('replayTotal');
    R.el.tps = q('replayTps');
    R.el.gap = q('replayGap');
    R.el.currentMove = q('replayCurrentMove');
    R.el.stage = q('replayStage');
    R.el.stageName = q('replayStageName');
    R.el.stageHint = q('replayStageHint');
  }

  function bindEvents() {
    const el = R.el;
    const q = id => document.getElementById(id);
    el.close.onclick = close;
    el.modal.onclick = e => { if (e.target === el.modal) close(); };

    el.playBtn.onclick = toggle;
    el.loopBtn.onclick = () => { R.loop = !R.loop; syncTransport(); };
    q('replayToStart').onclick = () => { pause(); seek(0); };
    q('replayToEnd').onclick = () => { pause(); seek(R.model.n); };
    q('replayPrevStep').onclick = () => stepBy(-1);
    q('replayNextStep').onclick = () => stepBy(1);

    el.speedHost.onclick = e => {
      const b = e.target.closest('[data-speed]');
      if (!b) return;
      R.speed = Number(b.dataset.speed) || 1;
      // 变速时以当前位置为新基准，避免时间跳变
      if (R.playing) { R.playStartCursorMs = cursorMs(); R.playStartAt = performance.now(); }
      syncTransport();
    };

    // 拖动进度条：拖动中暂停但不打乱播放意图
    el.scrub.addEventListener('input', () => {
      R.dragging = true;
      const v = Number(el.scrub.value) || 0;
      const model = R.model;
      if (!model) return;
      const t = (v / 1000) * model.total;
      let idx = 0;
      while (idx < model.n && model.times[idx] <= t) idx++;
      applyCursor(idx, { animate: false, force: true });
      painter();
    });
    const endDrag = () => {
      if (!R.dragging) return;
      R.dragging = false;
      if (R.playing) { R.playStartCursorMs = cursorMs(); R.playStartAt = performance.now(); }
    };
    el.scrub.addEventListener('change', endDrag);
    el.scrub.addEventListener('pointerup', endDrag);

    el.segments.onclick = e => {
      const b = e.target.closest('[data-seg]');
      if (b) seekSegment(Number(b.dataset.seg));
    };
    el.moves.onclick = e => {
      const b = e.target.closest('[data-move]');
      if (!b) return;
      pause();
      seek(Number(b.dataset.move) + 1);
    };

    // 键盘：空格播放/暂停、←→ 单步、Esc 关闭
    document.addEventListener('keydown', R.onKey = e => {
      if (!R.open) return;
      const tag = document.activeElement?.tagName || '';
      if (e.key === 'Escape') { close(); return; }
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { /* 允许在进度条上用方向键 */ }
        else return;
      }
      if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepBy(-1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepBy(1); return; }
      if (e.key === 'Home') { e.preventDefault(); pause(); seek(0); return; }
      if (e.key === 'End') { e.preventDefault(); pause(); seek(R.model.n); }
    });
  }

  // 视角拖动
  function bindDrag() {
    const stage = R.el.stage;
    if (!stage) return;
    const drag = { active: false, x: 0, y: 0, yaw: 0, pitch: 0 };
    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !R.scene?.setViewDrag) return;
      drag.active = true; drag.x = e.clientX; drag.y = e.clientY;
      const vs = R.scene.getViewState ? R.scene.getViewState() : { dragTheta: 0, dragPhi: 0 };
      drag.yaw = vs.dragTheta; drag.pitch = vs.dragPhi;
      stage.setPointerCapture?.(e.pointerId);
      stage.classList.add('dragging');
    });
    stage.addEventListener('pointermove', e => {
      if (!drag.active || !R.scene?.setViewDrag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      R.scene.setViewDrag(drag.yaw + dx / 160, drag.pitch + dy / 160);
    });
    const stop = () => { drag.active = false; stage.classList.remove('dragging'); };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
    stage.addEventListener('pointerleave', stop);
  }

  /* ------------------------------ 生命周期 ------------------------------ */

  function subtitle(solve) {
    const bits = [
      solve.analysisType || 'CFOP',
      solve.session || '',
      solve.device || '',
      `${fmtTime(solve.totalTime)}${Core()?.normalizeFlag(solve.flag) === 'plus_two' ? ' +2' : Core()?.normalizeFlag(solve.flag) === 'dnf' ? ' DNF' : ''}`,
    ].filter(Boolean);
    const date = new Date(solve.date);
    if (!Number.isNaN(date.getTime())) bits.push(date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
    return bits.join(' · ');
  }

  function open(solve) {
    if (!solve) return false;
    if (!window.twistyjs || !window.THREE) {
      notify('3D 魔方组件未加载完成，请刷新页面后重试');
      return false;
    }
    const model = buildModel(solve);
    if (!model.n || !model.hasTrace) {
      notify('这条记录没有完整的动作时间戳，无法回放');
      return false;
    }
    R.model = model;
    R.open = true;
    R.cursor = 0;
    R.playing = false;
    R.lastPaintedIdx = -1;
    R.autoScroll = true;
    R.animSpeed = null;
    // 记下当前的 twisty 动画速度，播放会临时改它，退出时还原
    R.baseVrcSpeed = (window.kernel && kernel.getProp) ? String(kernel.getProp('vrcSpeed', '90')) : '90';
    pause();
    R.el.modal = document.getElementById('replayModal');

    buildShell();
    cacheRefs();
    bindEvents();
    R.el.modal.hidden = false;
    if (R.el.sub) R.el.sub.textContent = subtitle(solve);

    // 3D 场景（等一帧，保证容器已有尺寸）
    R.stage = R.el.stage;
    requestAnimationFrame(() => {
      if (!R.open) return;
      R.scene = createScene(R.stage);
      if (!R.scene) { notify('3D 魔方初始化失败'); return; }
      R.scene.setViewDragClamped?.(true);
      resizeScene(R.scene, R.stage);
      bindDrag();
      // 起点 = 记录里的权威起点状态（贴纸快照，与 mathlib 逐字一致）
      applyStartState();
      R.cursor = 0;
      if (R.el.stageHint) {
        R.el.stageHint.textContent = R.startReady
          ? '拖动魔方可旋转视角'
          : '⚠ 这条记录缺少起点状态，魔方从复原态开始显示';
      }
      renderSegments();
      renderMoveList();
      painter();
      syncTransport();
      // 弹窗刚显示那一帧容器尺寸可能还没稳定，再校准一次
      window.setTimeout(() => { if (R.open && R.scene) resizeScene(R.scene, R.stage); }, 120);
      // 自动开播：这类页面用户点开回放就是想看过程
      window.setTimeout(() => { if (R.open && R.cursor === 0) play(); }, 200);
    });
    return true;
  }

  function close() {
    R.open = false;
    pause();
    clearTimeout(R.settleTimer);
    restoreMoveSpeed();
    if (R.onKey) document.removeEventListener('keydown', R.onKey);
    const modal = R.el.modal;
    if (modal) { modal.hidden = true; modal.innerHTML = ''; }
    R.scene = null;
    R.stage = null;
    R.el = {};
    R.model = null;
    R.cursor = 0;
    R.lastPaintedIdx = -1;
    if (typeof window._replayOnClose === 'function') { try { window._replayOnClose(); } catch (e) {} }
  }

  // 回放会临时改 kernel 的 vrcSpeed（见 tuneMoveAnimation），
  // 那是全站共享的 twisty 配置，退出时必须还原，否则会影响别的页面。
  function restoreMoveSpeed() {
    const k = window.kernel;
    if (!k || typeof k.setProp !== 'function') return;
    if (R.animSpeed == null) return;
    k.setProp('vrcSpeed', R.baseVrcSpeed);
    R.animSpeed = null;
  }

  function available(solve) {
    if (!solve) return false;
    return !!(solve.moves?.length && solve.timestamps?.length === solve.moves.length);
  }

  function notify(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(notify._t);
    notify._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // 窗口尺寸变化：重算画布，保证 3D 不糊
  window.addEventListener('resize', () => {
    if (R.open && R.scene && R.stage) resizeScene(R.scene, R.stage);
  });

  window.CubeAnalyzerReplay = {
    open,
    close,
    available,
    isOpen: () => R.open,
    _twistyCommand: twistyCommand,
    _buildModel: buildModel,
    // 自检钩子（.tests/replay-selfcheck.js 用）：只读/驱动，不改变正式 API 语义
    __testStepTo: idx => {
      const model = R.model;
      if (!model) return null;
      const want = Math.max(0, Math.min(model.n, Math.round(idx)));
      applyCursor(want, { animate: false, force: true });
      painter();
      return R.cursor;
    },
    __testScene: () => R.scene,
    __testCursor: () => R.cursor,
  };
})();

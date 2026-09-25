/* Cube 公用识别层 · 双层（宽体）合并状态机
 * 外层单层转动 + 同轴整体转体在窗口内按份量累计，净抵消（mod 4）⇒ 合并成一条宽体记号。
 * 例：L + z' → r；L + z2 + L（外层被量化成两个 90）→ r2。
 * 纯决策层：不碰 DOM / 记录存储 / 动画；记录改写与动画收放由宿主完成。
 * 宿主注入：oppositeFace(face)、faceNormal(face)、now()；窗口 forwardMs / reverseMs。
 */
(function (global) {
	"use strict";

	function norm4(v) {
		return ((v % 4) + 4) % 4;
	}

	function suffixOf(powN) {
		return powN === 2 ? "2" : powN === 3 ? "'" : "";
	}

	/* 从记号列表尾部吃掉 face 共 removePow 份，在吃掉起点插入 wideText。
	 * 只吃与 face 同面的连续尾段；吃不完则原样返回（宁缺勿错）。
	 * parse(token) → {face, pow} | null；format(face, pow) → token。
	 * 适用于 manualMoveHistory / 公式 entry.moves / performedProcessMoves
	 * （转体不进这些列表，尾段连续同面即候选贡献）。 */
	function rewriteTrailing(tokens, parse, format, face, removePow, wideText) {
		if (!tokens || !tokens.length || !removePow) {
			return tokens;
		}
		var out = tokens.slice();
		var rem = norm4(removePow);
		var insertAt = out.length;
		for (var i = out.length - 1; i >= 0 && rem > 0; i--) {
			var fp = parse(out[i]);
			if (!fp || fp.face !== face) {
				break;
			}
			var tp = norm4(fp.pow);
			if (tp === 0) {
				break;
			}
			if (tp <= rem) {
				out.splice(i, 1);
				rem -= tp;
				insertAt = i;
			} else {
				// 部分吃掉：折叠记号里候选贡献在时序尾部，残余留在前、宽体插在后
				var rest = tp - rem;
				out.splice(i, 1, format(face, rest === 3 ? -1 : rest));
				rem = 0;
				insertAt = i + 1;
			}
		}
		if (rem !== 0) {
			return tokens;
		}
		out.splice(insertAt, 0, wideText);
		return out;
	}

	/*
	 * createManager(options)
	 * options:
	 *   forwardMs  候选存活窗口（自最后一次贡献起算，默认 900）
	 *   reverseMs  外层后到时可回吸的最近转体窗口（默认 600）
	 *   now()      时间源（默认 Date.now）
	 *   oppositeFace(face) → 对面字母
	 *   faceNormal(face) → [x,y,z]（轴字母与面字母共用一套法向量）
	 *   log(kind, message)
	 *
	 * API:
	 *   reset()                          作废候选与回吸材料（手动操作/断连/重新对齐等）
	 *   alive()                          候选是否在场
	 *   addFaceMove(entry) → merge|null  外层落账后调用（记录已入账）
	 *     entry: {face, pow, text, source, time, at, animToken}
	 *     animToken 为该次已播动画的 twisty token（未播动画传 null），合并时由宿主撤回
	 *   addRotationParts(entry) → merge|null  转体落账【前】调用；命中时宿主跳过转体动画与 x/y/z 记录
	 *     entry: {parts, bodyParts, gyroFollow, at}
	 *     parts 为场景帧分解（含动画份量）、bodyParts 为体帧分解；帧选择与旧识别一致
	 *   noteRecordedRotation(entry)      转体已照常落账后调用（供之后外层后到时回吸）
	 *     entry: {rotParts, texts, at, animTokens}
	 *     rotParts 用与判定相同的帧（gyroFollow ? bodyParts : parts）
	 *
	 * merge 信息：{wideText, face, faceSum, animFace, animPow, pending, time, source}
	 *   pending: [{kind:"face"|"rot", text|texts, at, time, animToken|animTokens}]
	 *   kind=face 的记录在 moveHistory（text+time 定位）；kind=rot 的记录走宿主 removeRotationRecord
	 */
	function createManager(options) {
		options = options || {};
		var forwardMs = options.forwardMs || 900;
		var reverseMs = options.reverseMs || 600;
		var now = options.now || function () { return Date.now(); };
		var oppositeFace = options.oppositeFace || function () { return ""; };
		var faceNormal = options.faceNormal || function () { return null; };
		var log = options.log || function () {};

		var candidate = null;
		var lastRotation = null;

		function reset() {
			candidate = null;
			lastRotation = null;
		}

		function alive() {
			return !!candidate;
		}

		// 转体份量对面法向的投影（同轴才非零）；与旧 wideRotationCancels 同一套符号约定
		function contribution(face, part) {
			var normal = faceNormal(face);
			var axisNormal = faceNormal(part.axis);
			if (!normal || !axisNormal) {
				return null;
			}
			var dot = normal[0] * axisNormal[0] + normal[1] * axisNormal[1] + normal[2] * axisNormal[2];
			if (dot === 0) {
				return null;
			}
			return part.pow * (dot > 0 ? 1 : -1);
		}

		// 纯同轴才可整体吸收/移除记录：混轴复合转体的残余份量没有独立记录可撤
		function pureAxisSum(face, parts) {
			var sum = 0;
			for (var i = 0; i < parts.length; i++) {
				var c = contribution(face, parts[i]);
				if (c === null) {
					return null;
				}
				sum += c;
			}
			return sum;
		}

		function buildMerge() {
			var f = norm4(candidate.faceSum);
			var r = norm4(candidate.rotSum);
			if (f !== 0 && norm4(f + r) === 0) {
				var opp = oppositeFace(candidate.face);
				var info = {
					wideText: opp.toLowerCase() + suffixOf(f),
					face: candidate.face,
					faceSum: f,
					animFace: opp,
					animPow: f === 3 ? -1 : f,
					pending: candidate.pending,
					time: candidate.time,
					source: candidate.source
				};
				candidate = null;
				lastRotation = null;
				log("view", "双层合并成立：" + info.wideText);
				return info;
			}
			if (f === 0) {
				// 外层净零（回摆）：候选作废
				candidate = null;
			}
			return null;
		}

		// 外层先落账：候选已在场（或新建）时累计；转体后到由 addRotationParts 处理
		function addFaceMove(entry) {
			if (candidate && (candidate.face !== entry.face || now() - candidate.at > forwardMs)) {
				candidate = null;
			}
			if (!candidate) {
				candidate = {
					face: entry.face,
					faceSum: 0,
					rotSum: 0,
					pending: [],
					time: entry.time,
					source: entry.source,
					at: entry.at
				};
				// 回吸：转体先落账、外层后到（顺序二）。只吸收窗口内、纯同轴的最近转体
				if (lastRotation && now() - lastRotation.at <= reverseMs) {
					var sum = pureAxisSum(entry.face, lastRotation.rotParts);
					if (sum !== null && norm4(sum) !== 0) {
						candidate.rotSum += sum;
						candidate.pending.unshift({
							kind: "rot",
							texts: lastRotation.texts,
							at: lastRotation.at,
							animTokens: lastRotation.animTokens
						});
						lastRotation = null;
					}
				}
			}
			candidate.faceSum += entry.pow;
			candidate.at = entry.at;
			candidate.pending.push({
				kind: "face",
				text: entry.text,
				at: entry.at,
				time: entry.time,
				animToken: entry.animToken || null
			});
			return buildMerge();
		}

		// 转体后到（顺序一）：命中则转体不入账（不动画、不记 x/y/z），由宿主改写记录
		function addRotationParts(entry) {
			if (candidate && now() - candidate.at > forwardMs) {
				candidate = null;
			}
			if (!candidate) {
				return null;
			}
			var rotParts = entry.gyroFollow ? entry.bodyParts : entry.parts;
			var sum = pureAxisSum(candidate.face, rotParts || []);
			if (sum === null || norm4(sum) === 0) {
				// 无关轴 / 净零转体：不贡献、不作废候选
				return null;
			}
			candidate.rotSum += sum;
			candidate.at = entry.at;
			var merge = buildMerge();
			if (merge) {
				return merge;
			}
			// 未抵消：转体照常落账，先挂进候选等待后续外层补齐（双层 180 的关键）
			candidate.pending.push({
				kind: "rot",
				texts: entry.texts || [],
				at: entry.at,
				animTokens: entry.animTokens || []
			});
			return null;
		}

		// 转体已照常落账：保存材料供之后外层后到时回吸（单槽，保留最近一次）
		function noteRecordedRotation(entry) {
			lastRotation = {
				rotParts: (entry.rotParts || []).map(function (part) {
					return { axis: part.axis, pow: part.pow };
				}),
				texts: entry.texts || [],
				at: entry.at,
				animTokens: entry.animTokens || []
			};
		}

		return {
			reset: reset,
			alive: alive,
			addFaceMove: addFaceMove,
			addRotationParts: addRotationParts,
			noteRecordedRotation: noteRecordedRotation
		};
	}

	global.CubeWideMerge = {
		createManager: createManager,
		rewriteTrailing: rewriteTrailing
	};
})(typeof window !== "undefined" ? window : this);

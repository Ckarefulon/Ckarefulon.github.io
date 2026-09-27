// 功能块：面位差距搜索（连接握手期「数据流开始前的转动」补回）
// 提取自 Cube/Formula/assets/app/main.js 的 findFaceletGap（2026-09-15「连接后第一个操作
// 被忽略」修复的页面层部分，2026-09-27 收口为 Cube 公用，Analyzer/Formula 共用）。
//
// 背景：蓝牙数据流开始前（选设备 / 读 MAC 阶段）的转动不会上报为 move 事件，
// 只会体现在连接基线的初始面位里。把「连接前已知面位 → 基线面位」的 1~2 步落差
// 搜出来补发，即可还原这些转动；差更多说明本来就是另一套状态（例如魔方还没摆好），
// 必须不动（宁缺勿补）。
//
// 契约：window.CubeFaceletGap = { gapMoves(fromFacelet, toFacelet, maxDepth) }
//   - fromFacelet / toFacelet：54 字符面位串（URFDLB 口径）
//   - 返回：转动序列数组（如 ["U", "R'"]）；起点即终点返回 []；
//     无解 / 超过 maxDepth / 入参非法返回 null（调用方按「不补」处理）
//   - 依赖：window.mathlib.CubieCube（页面需先加载共享 mathlib.js）
(function() {
	'use strict';

	function gapMoves(fromFacelet, toFacelet, maxDepth) {
		if (!window.mathlib || !mathlib.CubieCube || !fromFacelet || fromFacelet.length !== 54) {
			return null;
		}
		var single = [];
		var faces = ["U", "R", "F", "D", "L", "B"];
		var suffixes = ["", "'", "2"];
		for (var i = 0; i < faces.length; i++) {
			for (var j = 0; j < suffixes.length; j++) {
				single.push(faces[i] + suffixes[j]);
			}
		}
		var search = function(prefix) {
			var cc = new mathlib.CubieCube();
			if (cc.fromFacelet(fromFacelet) === -1) {
				return null;
			}
			for (var k = 0; k < prefix.length; k++) {
				cc.selfMoveStr(prefix[k]);
			}
			if (cc.toFaceCube() === toFacelet) {
				return prefix.slice();
			}
			if (prefix.length >= maxDepth) {
				return null;
			}
			for (var s = 0; s < single.length; s++) {
				var hit = search(prefix.concat([single[s]]));
				if (hit) {
					return hit;
				}
			}
			return null;
		};
		return search([]);
	}

	window.CubeFaceletGap = {
		gapMoves: gapMoves
	};
})();

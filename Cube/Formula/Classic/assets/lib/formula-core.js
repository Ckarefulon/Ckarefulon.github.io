(function(root, factory) {
	var api = factory();
	if (typeof module === "object" && module.exports) module.exports = api;
	root.FormulaCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
	"use strict";

	var MOVE_RE = /[URFDLBMESXYZ]/i;
	var OPEN = { "(": ")", "[": "]" };
	var PRIME_RE = /['’‘`´]/;

	function normalizeSource(value) {
		return String(value == null ? "" : value)
			.replace(/[’‘`´]/g, "'")
			.replace(/[（]/g, "(").replace(/[）]/g, ")")
			.replace(/[［【]/g, "[").replace(/[］】]/g, "]")
			.replace(/[，、]/g, ",");
	}

	function canonicalFace(face) {
		face = String(face || "").toUpperCase();
		return /[XYZ]/.test(face) ? face.toLowerCase() : face;
	}

	function suffixText(prime, count) {
		return (prime ? "'" : "") + (count === 1 ? "" : String(count));
	}

	function readSuffix(source, state) {
		var prime = false;
		var count = null;
		while (state.index < source.length) {
			var ch = source.charAt(state.index);
			if (PRIME_RE.test(ch)) {
				if (prime) throw new Error("重复的逆向标记，位置 " + state.index);
				prime = true;
				state.index++;
				continue;
			}
			if (/\d/.test(ch)) {
				if (count !== null) throw new Error("重复的次数后缀，位置 " + state.index);
				var start = state.index;
				while (/\d/.test(source.charAt(state.index))) state.index++;
				count = Number(source.slice(start, state.index));
				if (!Number.isFinite(count) || count < 1 || count > 999) {
					throw new Error("次数必须在 1 到 999 之间，位置 " + start);
				}
				continue;
			}
			break;
		}
		return { prime: prime, count: count === null ? 1 : count };
	}

	function parseAlgorithm(value) {
		var source = normalizeSource(value);
		var state = { index: 0 };

		function skipSeparators() {
			while (state.index < source.length && /[\s,]/.test(source.charAt(state.index))) state.index++;
		}

		function parseSequence(close) {
			var nodes = [];
			while (state.index < source.length) {
				skipSeparators();
				if (state.index >= source.length) break;
				var ch = source.charAt(state.index);
				if (close && ch === close) {
					state.index++;
					return nodes;
				}
				if (ch === ")" || ch === "]") throw new Error("不匹配的右括号，位置 " + state.index);
				if (OPEN[ch]) {
					var groupOpen = ch;
					state.index++;
					var children = parseSequence(OPEN[groupOpen]);
					if (!children.length) throw new Error("空公式组，位置 " + state.index);
					var groupSuffix = readSuffix(source, state);
					nodes.push({ type: "group", nodes: children, prime: groupSuffix.prime, count: groupSuffix.count });
					continue;
				}
				if (!MOVE_RE.test(ch)) throw new Error("无法识别的公式片段，位置 " + state.index + ": " + ch);
				state.index++;
				var moveSuffix = readSuffix(source, state);
				nodes.push({
					type: "move",
					face: canonicalFace(ch),
					prime: moveSuffix.prime,
					count: moveSuffix.count
				});
			}
			if (close) throw new Error("缺少右括号 " + close);
			return nodes;
		}

		var ast = parseSequence(null);
		skipSeparators();
		if (state.index !== source.length) throw new Error("公式末尾存在无效片段");
		if (!ast.length) throw new Error("公式为空");
		return ast;
	}

	function formatNodes(nodes) {
		return nodes.map(function(node) {
			if (node.type === "move") return node.face + suffixText(node.prime, node.count);
			return "(" + formatNodes(node.nodes) + ")" + suffixText(node.prime, node.count);
		}).join(" ");
	}

	function invertNodes(nodes) {
		var result = [];
		for (var i = nodes.length - 1; i >= 0; i--) {
			var node = nodes[i];
			if (node.type === "move") {
				result.push({ type: "move", face: node.face, prime: !node.prime, count: node.count });
			} else {
				result.push({ type: "group", nodes: invertNodes(node.nodes), prime: node.prime, count: node.count });
			}
		}
		return result;
	}

	function expandLogical(nodes, inverse, output) {
		output = output || [];
		var list = inverse ? nodes.slice().reverse() : nodes;
		for (var i = 0; i < list.length; i++) {
			var node = list[i];
			if (node.type === "group") {
				for (var r = 0; r < node.count; r++) expandLogical(node.nodes, inverse !== node.prime, output);
				continue;
			}
			var negative = inverse !== node.prime;
			for (var count = 0; count < node.count; count++) output.push(node.face + (negative ? "'" : ""));
		}
		return output;
	}

	function toExecutionMoves(ast) {
		return expandLogical(ast, false, []);
	}

	function reduceMoves(tokens) {
		var stack = [];
		(tokens || []).forEach(function(raw) {
			var match = /^([URFDLBMES]|[xyz])([2']?)$/i.exec(String(raw || "").replace(/[’‘`´]/g, "'"));
			if (!match) return;
			var face = canonicalFace(match[1]);
			var delta = match[2] === "2" ? 2 : match[2] === "'" ? -1 : 1;
			var last = stack[stack.length - 1];
			if (last && last.face === face) {
				last.pow = (last.pow + delta + 8) % 4;
				if (last.pow === 0) stack.pop();
			} else {
				stack.push({ face: face, pow: (delta + 4) % 4 });
			}
		});
		return stack.map(function(item) {
			return item.face + (item.pow === 2 ? "2" : item.pow === 3 ? "'" : "");
		});
	}

	function sameProcess(actual, target) {
		var a = reduceMoves(actual);
		var b = reduceMoves(target);
		return a.length === b.length && a.every(function(value, index) { return value === b[index]; });
	}

	function splitDefinitions(value) {
		var source = normalizeSource(value).replace(/：/g, ":").replace(/；/g, ";");
		var parts = [];
		var start = 0;
		var depth = 0;
		for (var i = 0; i < source.length; i++) {
			var ch = source.charAt(i);
			if (ch === "(" || ch === "[") depth++;
			else if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
			if (depth === 0 && (ch === ";" || ch === "\n" || ch === "\r")) {
				var part = source.slice(start, i).trim();
				if (part) parts.push({ text: part, terminal: ch === ";" });
				start = i + 1;
			}
		}
		var tail = source.slice(start).trim();
		if (tail) parts.push({ text: tail, terminal: false });
		return parts;
	}

	function parseDefinitions(value) {
		var parts = splitDefinitions(value);
		var entries = [];
		var current = "";
		parts.forEach(function(part) {
			if (/^[^:]+:/.test(part.text)) {
				if (current) entries.push(current);
				current = part.text;
			} else if (current) {
				current += " " + part.text;
			} else {
				entries.push(part.text);
			}
			if (part.terminal && current) {
				entries.push(current);
				current = "";
			}
		});
		if (current) entries.push(current);

		var formulas = [];
		var errors = [];
		entries.forEach(function(entry, index) {
			if (/^##/.test(entry)) return;
			var colon = entry.indexOf(":");
			if (colon <= 0) {
				errors.push({ index: index, fragment: entry, message: "缺少公式名称或冒号" });
				return;
			}
			var name = entry.slice(0, colon).trim();
			var algSource = entry.slice(colon + 1).trim();
			try {
				var ast = parseAlgorithm(algSource);
				formulas.push({ name: name, alg: formatNodes(ast), ast: ast, moves: toExecutionMoves(ast) });
			} catch (error) {
				errors.push({ index: index, fragment: entry, message: error.message });
			}
		});
		return { formulas: formulas, errors: errors, skipped: errors.length };
	}

	function invertAlgorithm(value) {
		return formatNodes(invertNodes(parseAlgorithm(value)));
	}

	function processTarget(value) {
		return expandLogical(parseAlgorithm(value), false, []);
	}

	return {
		normalizeSource: normalizeSource,
		parseAlgorithm: parseAlgorithm,
		formatNodes: formatNodes,
		toExecutionMoves: toExecutionMoves,
		expandLogical: expandLogical,
		reduceMoves: reduceMoves,
		sameProcess: sameProcess,
		parseDefinitions: parseDefinitions,
		invertAlgorithm: invertAlgorithm,
		processTarget: processTarget
	};
});

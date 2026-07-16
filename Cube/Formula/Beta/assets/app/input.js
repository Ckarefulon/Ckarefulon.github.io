(function() {
			"use strict";

			function isFormulaInput(el) {
				return !!(el && el.matches && el.matches("#formulaTextInput, #memoryPlanEditTextarea, #formulaExportText"));
			}

			function norm(el) {
				var v = el.value;
				if (v.indexOf("\uFF1A") < 0 && v.indexOf("\uFF1B") < 0) return;
				var p = el.selectionStart || 0, n = 0;
				for (var i = 0; i < p; i++) { if (v[i] === "\uFF1A") n++; }
				el.value = v.replace(/\uFF1A/g, ": ").replace(/\uFF1B/g, ";");
				try { el.setSelectionRange(p + n, p + n); } catch(e) {}
			}

			var ime = false, pendingEnter = false;

			document.addEventListener("compositionstart", function() { ime = true; }, true);
			document.addEventListener("compositionend", function(e) {
				ime = false;
				var el = e.target;
				if (!isFormulaInput(el)) return;
				norm(el);
				if (pendingEnter) {
					pendingEnter = false;
					var s = el.selectionStart || 0, v = el.value || "";
					if (v.charAt(s - 1) !== ';') {
						el.value = v.slice(0, s) + ";" + v.slice(s);
						try { el.setSelectionRange(s + 1, s + 1); } catch(ex) {}
					}
				}
			}, true);
			document.addEventListener("input", function(e) { if (!ime && isFormulaInput(e.target)) norm(e.target); }, true);
			document.addEventListener("keydown", function(e) {
				if (e.key !== "Enter") return;
				var el = e.target;
				if (!isFormulaInput(el)) return;
				if (ime) { pendingEnter = true; return; }
				var s = el.selectionStart || 0, v = el.value || "";
				if (v.charAt(s - 1) !== ';') {
					el.value = v.slice(0, s) + ";" + v.slice(s);
					try { el.setSelectionRange(s + 1, s + 1); } catch(ex) {}
				}
			}, true);
		})();


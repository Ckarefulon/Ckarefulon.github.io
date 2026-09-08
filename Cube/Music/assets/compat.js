// Polyfills for APIs removed in jQuery 4.0
		if (typeof jQuery !== 'undefined') {
			jQuery.delayExec = (function() {
				var timers = {};
				return function(name, fn, delay) {
					if (timers[name]) {
						clearTimeout(timers[name]);
					}
					timers[name] = setTimeout(function() {
						delete timers[name];
						fn();
					}, delay);
				};
			})();
		}
(function() {
			"use strict";

			window.DEBUG = false;
			window.DEBUGBL = false;
			Math.TAU = Math.TAU || Math.PI * 2;

			if (!Array.prototype.at) {
				Array.prototype.at = function(index) {
					index = Math.trunc(index) || 0;
					if (index < 0) index += this.length;
					return this[index];
				};
			}

			window.requestAnimFrame = window.requestAnimationFrame ||
				window.webkitRequestAnimationFrame ||
				window.mozRequestAnimationFrame ||
				function(callback) { return setTimeout(callback, 16); };

			window.execMain = function(fn, args) {
				return fn.apply(null, args || []);
			};

			var propStore = {
				vrcOri: "18,6",
				vrcSpeed: "90",
				giiRST: "n",
				giiMacMap: localStorage.getItem("smartCubeMacMap") || "{}"
			};

			var MAC_HELP_TEXT = [
				"请输入智能硬件的MAC地址（xx:xx:xx:xx:xx:xx）。",
				"你可以通过 chrome://bluetooth-internals/#devices 找到MAC地址，或者修改以下配置让csTimer自动获取蓝牙地址：",
				"Chrome：在浏览器设置里打开 chrome://flags/#enable-experimental-web-platform-features",
				"Bluefy：在浏览器设置里开启 Enable BLE Advertisements"
			].join("\n");

			window.kernel = {
				getProp: function(key, fallback) {
					if (key === "giiSolved") {
						return propStore.giiSolved || (window.mathlib && mathlib.SOLVED_FACELET) ||
							"UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB";
					}
					return key in propStore ? propStore[key] : fallback;
				},
				setProp: function(key, value) {
					propStore[key] = value;
					if (key === "giiMacMap") {
						localStorage.setItem("smartCubeMacMap", value);
					}
				}
			};

			window.GIIKER_NOBLEMSG = "当前浏览器不可用 Web Bluetooth。请使用支持 Web Bluetooth 的浏览器，并通过 localhost 或 https 打开。";
			window.GIIKER_REQMACMSG = MAC_HELP_TEXT;
			window.CONFIRM_GIIRST = "是否把当前魔方状态标记为复原？";
			window.LGHINT_BTCONSUC = "蓝牙已连接";
			window.LGHINT_BTDISCON = "蓝牙已断开";
			window.LGHINT_BTNOTSUP = "暂不支持这个智能硬件";
			window.LGHINT_BTINVMAC = "MAC 地址格式不正确";

			window.logohint = {
				push: function(message) {
					if (window.smartCubeApp) {
						window.smartCubeApp.log("hint", message);
						if (/mac|地址|not support|不支持|invalid/i.test(String(message))) {
							window.smartCubeApp.showMacHelp(String(message));
						}
					} else {
						console.log(message);
					}
				}
			};

			window.giikerutil = {
				chkAvail: function() {
					if (!navigator.bluetooth) {
						return Promise.reject(window.GIIKER_NOBLEMSG);
					}
					if (!navigator.bluetooth.getAvailability) {
						return Promise.resolve();
					}
					return navigator.bluetooth.getAvailability().then(function(available) {
						if (!available) {
							return Promise.reject(window.GIIKER_NOBLEMSG);
						}
					});
				},
				log: function() {
					if (window.smartCubeApp) {
						window.smartCubeApp.log.apply(window.smartCubeApp, arguments);
					} else {
						console.log.apply(console, arguments);
					}
				},
				reqMacAddr: function(forcePrompt, isWrongKey, deviceMac, defaultMac) {
					var rawMap = kernel.getProp("giiMacMap", "{}");
					var savedMap = {};
					try {
						savedMap = JSON.parse(rawMap);
					} catch (error) {
						savedMap = {};
					}
					var key = "last";
					var mac = deviceMac || savedMap[key] || defaultMac || "";
					if (!mac || forcePrompt && !deviceMac) {
						if (window.smartCubeApp) {
							window.smartCubeApp.showMacHelp(isWrongKey ? "上一次 MAC 可能不正确，请重新输入。" : "这个设备需要 MAC 地址来解密蓝牙数据。");
						}
						mac = prompt((isWrongKey ? "上一次 MAC 可能不正确。\n" : "") + window.GIIKER_REQMACMSG, mac || "xx:xx:xx:xx:xx:xx");
					}
					if (!mac || !/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(mac)) {
						window.logohint.push(window.LGHINT_BTINVMAC);
						if (window.smartCubeApp) {
							window.smartCubeApp.showMacHelp("MAC 地址格式不正确，连接无法继续。");
							window.smartCubeApp.setStatus("error", "MAC 地址格式不正确");
						}
						return;
					}
					savedMap[key] = mac;
					kernel.setProp("giiMacMap", JSON.stringify(savedMap));
					return mac;
				},
				markSolved: function() {
					if (window.smartCubeApp) {
						window.smartCubeApp.log("view", "忽略硬件复原标记，当前页面只同步转动");
					}
				},
				updateBattery: function(value) {
					if (window.smartCubeApp) {
						window.smartCubeApp.setDevice(value && value[1], value && value[0]);
					}
				}
			};
		})();


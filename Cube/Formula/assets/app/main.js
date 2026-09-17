(function() {
			"use strict";

			var PRACTICE_STATS_SCHEMA_VERSION = 3;
			var PRACTICE_STATS_KEY = "smartCubePracticeStats";

			var app = {
				twistyScene: null,
				virtualCubie: null,
				moveHistory: [],
				importedFormulas: [],
				formulaInputText: "",
				formulaImported: false,
				formulaInputEntries: [],
				formulaEntries: [],
				formulaExportTextOverride: "",
				activeFormulaId: null,
				isRecordingFormula: false,
				formulaOrganizeMode: false,
				dragFormulaId: null,
				formulaLibraries: [],
				formulaLibrarySelections: {},
				expandedFormulaLibraries: {},
				formulaLibraryLoaded: false,
				formulaLibraryLoading: false,
				suppressLibraryTransferOnce: false,
				showFormulaThumbs: false,
				showPracticeFormula: false,
				practiceStats: {
					schemaVersion: 3,
					groups: {}
				},
				thumbnailScenes: [],
				thumbnailYaw: 0,
				thumbnailPitch: 0,
				moveCount: 0,
				movesSinceState: 0,
				practiceSolveStartTime: null,
				formulaSolveTimes: {},
				lastCubePrevMoves: [],
				lastCubeHistoryStamp: null,
				pendingCubeMove: null,
				pendingCubeMoveTimer: null,
				cubeSliceWindowMs: 90,
				currentFormulaIndex: -1,
				currentMode: "practice",
				isPracticeMode: false,
				practiceMode: "sequence",
				randomBag: [],
				recentFormulaIndices: [],
				solveSwitchTimer: null,
				solvedAdvancePending: false,
				solvedCheckFeedbackActive: false,
				solvedCheckHideTimer: null,
				seenUnsolvedSinceState: false,
				seenUnsolvedFaceletSinceState: false,
				seenUnsolvedVirtualSinceState: false,
				lastFaceletSolved: false,
				solveDetectionMode: 2,
				performedProcessMoves: [],
				processTargetMoves: [],
				activeRestorationTarget: null,
				currentFacelet: "",
				deviceName: "",
				batteryLevel: null,
				connected: false,
				ignoreMoves: false,
				hasValidCubeState: false,
				macWarningVisible: false,
				cubeDimension: 3,
				orientationMatrix: null,
				orientationMoves: [],
				wideMode: false,
				manualMoveHistory: [],
				viewYaw: 0,
				viewPitch: 0,
				followSavedYaw: 0,
				followSavedPitch: 0,
				gyroFollow: false,
				gyroTargetQ: null,
				gyroCurrentQ: null,
				gyroYawOffset: 0,
				cubeHasGyro: false,
				gyroAutoEnabled: false,
				gyroReanchored: false,
				gyroAnimFrame: null,
				gyroLastT: 0,
				gyroLastQ: null,
				gyroRecordM: null,
				lastRotationCommit: null,
				sliceCoreClaim: null,
				rotSyncM: null,
				rotAltM: null,
				rotRestRefM: null,
				rotRestSince: 0,
				rotCandidate: null,
				rotLastM: null,
				rotFlushTimer: null,
				rotGroupCache: null,
				cubeRotStillTol: 6,
				cubeRotRestMs: 380,
				cubeRotMinAngle: 45,
				cubeRotSnapTol: 24,
				cubeRotSnapTolLoose: 33,
				cubeRotFrameBias: 10,
				cubeRotPartialFrom: 36,
				cubeRotAltStillMs: 120,
				rotStillMs: 0,
				cubeRotSettleMs: 110,
				cubeRotDwellMs: 520,
				cubeRotFlushMs: 160,
				// 中层带起的核心转动：陀螺仪数据未到时的认领窗口 / 已判定时的撤回时限
				sliceCoreExpectMs: 800,
				sliceRetractMs: 400,
				hiddenStickerMask: {},
				seamlessMode: false,
				customCubeScene: null,
				customCubeDraftMask: null,
				customStickerGroups: null,
				elements: {},
				modeOrder: ["practice", "memory", "formula", "library"],
				modeDefs: {
					practice: { meta: { label: "训练模式", icon: "trainIcon", title: "训练模式" } },
					formula: { meta: { label: "公式制作", icon: "formulaModeIcon", title: "公式制作" } },
					library: { meta: { label: "公式库", icon: "libraryIcon", title: "公式库" } }
				},
				initFns: [],
				events: {},

				addInit: function(fn) {
					if (typeof fn === "function") this.initFns.push(fn);
				},

				addMode: function(id, def) {
					if (id && def && def.meta) this.modeDefs[id] = def;
				},

				on: function(type, fn) {
					if (!type || typeof fn !== "function") return;
					(this.events[type] || (this.events[type] = [])).push(fn);
				},

				emit: function(type) {
					var args = Array.prototype.slice.call(arguments, 1);
					(this.events[type] || []).slice().forEach(function(fn) {
						try { fn.apply(app, args); }
						catch (error) { console.error("[App event] " + type, error); }
					});
				},

			init: function() {
				this.initFns.slice().forEach(function(fn) { fn.call(app); });
				this.refreshElements();
				this.renderKeys();

				this.loadFormulaEntries();
				this.loadPracticeStats();
				this.loadFormulaInputText();
				this.initTwisty();
					this.initTheme();
					this.initSiteHeader();
					this.renderMode("practice");
					this.bindUI();
					this.bindGroupSync();
					this.syncGroupState(false);
					this.setStatus("idle", "未连接");
					this.log("ready", "页面已就绪");
					if (!navigator.bluetooth) {
						this.setStatus("error", "浏览器不支持 Web Bluetooth");
						this.log("error", "请通过 Chrome/Edge 等支持 Web Bluetooth 的浏览器访问 localhost");
					}
				},

				bindGroupSync: function() {
					if (typeof this.onActiveGroupChanged === "function") {
						this.onActiveGroupChanged(function() { this.syncGroupState(true); }.bind(this));
					}
					if (typeof this.onGroupListChanged === "function") {
						this.onGroupListChanged(function() { this.renderGroupPicker(); }.bind(this));
					}
				},

				syncGroupState: function(readGroup) {
					if (!this.elements) return;
					if (readGroup && typeof this.getActiveGroupPlanText === "function") {
						this.formulaInputText = this.getActiveGroupPlanText();
					}
					this.syncGroupFormulas();
					var textarea = document.getElementById("formulaTextInput");
					var planTextarea = document.getElementById("planTextarea");
					var activeEl = document.activeElement;
					if (textarea && activeEl !== textarea) textarea.value = this.formulaInputText;
					if (planTextarea && activeEl !== planTextarea) planTextarea.value = this.formulaInputText;
					this.renderGroupPicker();
					this.updateSyncButton();
					if (this.elements.planBox && this.elements.planBox.classList.contains("isOpen")) {
						this.loadPlanSelectionState();
						this.renderPlanFormulaList();
						this.syncPlanTextarea();
					}
					this.formulaSolveTimes = this.getPracticeData().solveTimes;
					this.syncFormulaState();
					this.applyGroupMaskToCube();
					if (readGroup && this.isPracticeMode) this.resetPracticeFormula();
					this.updatePracticeAoTimes();
				},

				syncFormulaState: function() {
					this.fillFormulaInputText(this.formulaInputText, false, false);
					if (!this.formulaInputText || !this.formulaInputText.trim()) {
						this.formulaInputEntries = [];
						this.importedFormulas = [];
						this.formulaImported = false;
						if (this.elements.practiceGrid) this.elements.practiceGrid.innerHTML = "";
						this.syncPracticeToggle();
						return;
					}
					if (!this.formulaInputEntries.length) {
						this.importFormulaText(this.formulaInputText, "restore");
						this.formulaImported = true;
						return;
					}
					this.formulaImported = true;
					this.importedFormulas = this.formulaInputEntries.map(function(entry) {
						return { name: entry.name, alg: entry.alg, moves: entry.moves || [], image: entry.image || null, customSolvedState: entry.customSolvedState || null };
					});
					this.renderFormulaCards();
					this.syncPracticeToggle();
				},

				refreshElements: function() {
					this.elements = {
						cubeStage: document.getElementById("cubeStage"),
						keyToggle: document.getElementById("keyToggle"),
						keyDrawer: document.getElementById("keyDrawer"),
						keyHandle: document.getElementById("keyHandle"),
						keyBody: document.getElementById("keyBody"),
						practiceSolvedCheck: document.getElementById("practiceSolvedCheck"),
						modeSwitcher: document.getElementById("modeSwitcher"),
						modeCurrent: document.getElementById("modeCurrent"),
						modeIcon: document.getElementById("modeIcon"),
						modeLabel: document.getElementById("modeLabel"),
						modeMenu: document.getElementById("modeMenu"),
						connectBtn: document.getElementById("connectBtn"),
						gyroToggleBtn: document.getElementById("gyroToggleBtn"),
						resetBtn: document.getElementById("resetBtn"),
						seamlessToggleBtn: document.getElementById("seamlessToggleBtn"),
						exportFormulaBtn: document.getElementById("exportFormulaBtn"),
						confirmLibraryImportBtn: document.getElementById("confirmLibraryImportBtn"),
						libraryList: document.getElementById("libraryList"),
						libraryStatus: document.getElementById("libraryStatus"),
						practiceModeSelect: document.getElementById("practiceModeSelect"),
						orientationMoves: document.getElementById("orientationMoves"),
						draftList: document.getElementById("draftList"),
						statusPill: document.getElementById("statusPill"),
						deviceName: document.getElementById("deviceName"),
						moveCount: document.getElementById("moveCount"),
						moveList: document.getElementById("moveList"),
						log: document.getElementById("log"),
						lastTs: document.getElementById("lastTs"),
						manualMoves: document.getElementById("manualMoves"),
						customFinalStateBtn: document.getElementById("customFinalStateBtn"),
						formulaDropZone: document.getElementById("formulaDropZone"),
						chooseFormulaFileBtn: document.getElementById("chooseFormulaFileBtn") || document.getElementById("planImportBtn"),
						formulaFileInput: document.getElementById("formulaFileInput") || document.getElementById("planFileInput"),
						toggleTextImportBtn: document.getElementById("toggleTextImportBtn") || document.getElementById("planViewToggleBtn"),
						textImportBox: document.getElementById("textImportBox"),
						formulaTextInput: document.getElementById("formulaTextInput") || document.getElementById("planTextarea"),
						importFormulaTextBtn: document.getElementById("importFormulaTextBtn") || document.getElementById("planSaveBtn"),
						planBox: document.getElementById("planBox"),
						planExpandBtn: document.getElementById("planExpandBtn"),
						planPanel: document.getElementById("planPanel"),
						planViewToggleBtn: document.getElementById("planViewToggleBtn"),
						planImportBtn: document.getElementById("planImportBtn"),
						planContentArea: document.getElementById("planContentArea"),
						planFormulaList: document.getElementById("planFormulaList"),
						planTextarea: document.getElementById("planTextarea"),
						planCollapseBtn: document.getElementById("planCollapseBtn"),
						planCancelBtn: document.getElementById("planCancelBtn"),
						planSaveBtn: document.getElementById("planSaveBtn"),
						planFileInput: document.getElementById("planFileInput"),
						planCount: document.getElementById("planCount"),
						planDailyCount: document.getElementById("planDailyCount"),
						planSyncBtn: document.getElementById("planSyncBtn"),
						showFormulaThumbs: document.getElementById("showFormulaThumbs"),
						showPracticeFormula: document.getElementById("showPracticeFormula"),
						practiceFormulaText: document.getElementById("practiceFormulaText"),
						practiceFormulaToggle: document.getElementById("practiceFormulaToggle"),
						practiceAoTimes: document.getElementById("practiceAoTimes"),
						practiceFormulaCount: document.getElementById("practiceFormulaCount"),
						practiceFormulaName: document.getElementById("practiceFormulaName"),
						practiceGrid: document.getElementById("practiceGrid"),
						macHelp: document.getElementById("macHelp"),
						macHelpReason: document.getElementById("macHelpReason")
					};
				},

				initTwisty: function() {
					this.clearPendingCubeMove(false);
					this.elements.cubeStage.innerHTML = "";
					this.elements.cubeStage.dataset.roll = "0";
					this.orientationMatrix = this.identityMatrix();
					this.orientationMoves = [];
					this.viewYaw = 0;
					// 跟随模式下俯视 45°（打开陀螺仪后的固定视角），关闭后恢复原视角
					this.viewPitch = this.gyroFollow ? Math.PI / 4 : 0;
					this.twistyScene = new twistyjs.TwistyScene();
					this.elements.cubeStage.appendChild(this.twistyScene.getDomElement());
					this.twistyScene.initializeTwisty({
						type: "cube",
						dimension: this.cubeDimension,
						stickerWidth: 1.72,
						scale: 0.96,
						allowDragging: false,
						faceColors: [0xffffff, 0xf05a3b, 0x2dbb70, 0xffd447, 0xff941f, 0x2f69df]
					});
					this.prepareStickerScene(this.twistyScene);
					this.applyHiddenMask(this.twistyScene, this.hiddenStickerMask);
					if (this.seamlessMode) {
						this.applySeamlessMode(this.twistyScene, true);
						this.syncHiddenLook();
					}
					this.resizeTwisty();
					// 场景重建后（重置视图/切模式），陀螺仪跟随从正面向目标姿态平滑恢复；校准角不清空
					if (this.gyroFollow) {
						this.setViewDrag(this.viewYaw, this.viewPitch);
						this.reanchorGyroDisplay();
						if (this.gyroTargetQ) {
							this.gyroCurrentQ = this.currentDisplayQuat();
							this.startGyroAnimation();
						}
					}
				},

				resizeSceneToStage: function(scene, stage) {
					if (!scene || !stage) return;
					var rect = stage.getBoundingClientRect();
					var child = stage.firstElementChild;
					if (child) {
						child.style.width = rect.width + "px";
						child.style.height = rect.height + "px";
					}
					if (scene.resize) scene.resize();
				},

			resizeTwisty: function() {
				this.resizeSceneToStage(this.twistyScene, this.elements.cubeStage);
				this.resizeSceneToStage(this.customCubeScene, document.getElementById("customCubeStage"));
				// 训练模式缩略图随卡片尺寸变化重新适配（窗口缩放/旋转/侧栏展开等）。
				if (this.thumbnailScenes) {
					for (var i = 0; i < this.thumbnailScenes.length; i++) {
						if (this.thumbnailScenes[i] && this.thumbnailScenes[i].resize) {
							this.thumbnailScenes[i].resize();
						}
					}
				}
			},

			// 依容器宽度推导训练卡片布局：空间→列数→卡片宽→魔方缩略图大小（文字决定高度）。
			layoutPracticeCards: function() {
				if (!this.isPracticeMode) return;
				var list = this.elements.practiceGrid;
				if (!list) return;
				var w = list.clientWidth;
				if (!w) return;
				// 同宽只算一次，避免 ResizeObserver 因高度变化反复触发。
				if (this._lastPracticeWidth === w) return;
				this._lastPracticeWidth = w;
				var gap = 10;
				var ideal = 132; // 目标卡片宽
				var cols = Math.round((w + gap) / (ideal + gap));
				if (cols < 2) cols = 2;
				if (cols > 7) cols = 7;
				var cardW = (w - gap * (cols - 1)) / cols;
				// 列数决定卡片宽；魔方缩略图横向匹配卡片内容区宽度（不封顶），
				// 立方体为正方形→横向即决定纵向；卡片高由 flex 自动 = 魔方高 + 文字高。
				list.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
				list.style.setProperty("--cols", String(cols));
				var previews = list.querySelectorAll(".statePreview");
				for (var i = 0; i < previews.length; i++) {
					var pv = previews[i];
					pv.style.width = "100%";
					pv.style.height = "auto";
					var pw = pv.clientWidth;
					if (!pw) continue;
					list.style.setProperty("--thumb", pw + "px");
					var inner = pv.querySelector("div");
					if (inner) {
						inner.style.width = pw + "px";
						inner.style.height = pw + "px";
					}
				}
				var self = this;
				requestAnimationFrame(function() {
					if (!self.thumbnailScenes) return;
					for (var j = 0; j < self.thumbnailScenes.length; j++) {
						if (self.thumbnailScenes[j] && self.thumbnailScenes[j].resize) {
							self.thumbnailScenes[j].resize();
						}
					}
				});
			},

				toggleSeamlessMode: function() {
					this.seamlessMode = !this.seamlessMode;
					var btn = this.elements.seamlessToggleBtn;
					if (btn) {
						if (this.seamlessMode) {
							btn.classList.add("isActive");
						} else {
							btn.classList.remove("isActive");
						}
					}
					// Apply to main twisty scene
					this.applySeamlessMode(this.twistyScene, this.seamlessMode);
					// Apply to thumbnail scenes
					if (this.thumbnailScenes) {
						for (var i = 0; i < this.thumbnailScenes.length; i++) {
							this.applySeamlessMode(this.thumbnailScenes[i], this.seamlessMode);
						}
					}
					// Apply to custom cube scene
					if (this.customCubeScene) {
						this.applySeamlessMode(this.customCubeScene, this.seamlessMode);
					}
					this.syncHiddenLook();
				},

				applySeamlessMode: function(scene, enable) {
					if (!scene || !scene.getTwisty) {
						return;
					}
					var twisty = scene.getTwisty();
					if (twisty && twisty.toggleSeamlessMode) {
						twisty.toggleSeamlessMode(twisty, enable);
					}
					if (scene.render) {
						scene.render();
					}
				},

				syncHiddenLook: function() {
					var scenes = [this.twistyScene];
					if (this.thumbnailScenes) {
						scenes = scenes.concat(this.thumbnailScenes);
					}
					if (this.customCubeScene) {
						scenes.push(this.customCubeScene);
					}
					for (var s = 0; s < scenes.length; s++) {
						var scene = scenes[s];
						if (!scene) {
							continue;
						}
						if (this.seamlessMode) {
							if (!scene._seamlessHiddenMaterial) {
								scene._seamlessHiddenMaterial = new THREE.MeshBasicMaterial({
									color: 0x9aa0aa,
									opacity: 1,
									transparent: false
								});
							}
							scene._customHiddenMaterial = scene._seamlessHiddenMaterial;
						} else {
							if (!scene._defaultHiddenMaterial) {
								scene._defaultHiddenMaterial = new THREE.MeshBasicMaterial({
									color: 0x9aa0aa,
									opacity: 0.28,
									transparent: true
								});
							}
							scene._customHiddenMaterial = scene._defaultHiddenMaterial;
						}
						this.applyHiddenMask(scene, this.hiddenStickerMask);
					}
				},

				bindUI: function() {
					var self = this;
					document.querySelectorAll("#modeNav, #sideNav").forEach(function(navigation) {
						navigation.addEventListener("click", function(event) {
							var option = event.target.closest("[data-mode]");
							if (option) {
								self.switchMode(option.getAttribute("data-mode"));
								if (navigation.id === "sideNav" && window.matchMedia("(orientation: portrait)").matches) self.closeSideNav();
							}
						});
					});
					var panelHandle = document.getElementById("panelHandle");
					var panelOverlay = document.getElementById("panelOverlay");
					var keyboardToggle = document.getElementById("keyToggle");
					var keyboardHandle = document.getElementById("keyHandle");

					document.querySelectorAll("[data-action-panel-toggle]").forEach(function(toggle) {
						toggle.addEventListener("click", function() { self.togglePanel(); });
					});
					if (panelHandle) {
						panelHandle.addEventListener("click", function() { self.closePanel(); });
						this.bindPanelDrag(panelHandle);
					}
					if (panelOverlay) panelOverlay.addEventListener("click", function(event) {
						if (event.target === panelOverlay) self.closePanel();
					});
					if (keyboardToggle) keyboardToggle.addEventListener("click", function() { self.toggleKeys(); });
					if (keyboardHandle) {
						keyboardHandle.addEventListener("click", function(event) {
							if (self._keyHandleDragged) {
								self._keyHandleDragged = false;
								event.preventDefault();
								return;
							}
							self.closeKeys();
						});
						this.bindKeyDrag(keyboardHandle);
					}
					this.bindKeyDismiss();
					var layoutMenu = document.getElementById("layoutMenuToggle");
					var railScrim = document.getElementById("sideNavScrim");
					if (layoutMenu) layoutMenu.addEventListener("click", function() { self.toggleSideNav(); });
					if (railScrim) railScrim.addEventListener("click", function() { self.closeSideNav(); });
					window.addEventListener("orientationchange", function() { self.syncSideNav(); });
					this.syncSideNav();
					var fullscreenToggle = document.getElementById("fullscreenToggle");
					if (fullscreenToggle) fullscreenToggle.addEventListener("click", function() { self.toggleFullscreen(); });
					document.addEventListener("fullscreenchange", function() {
						self.syncFullscreen();
						requestAnimationFrame(function() { self.resizeTwisty(); });
					});
					document.addEventListener("webkitfullscreenchange", function() {
						self.syncFullscreen();
						requestAnimationFrame(function() { self.resizeTwisty(); });
					});
					this.syncFullscreen();
					this.elements.modeSwitcher.addEventListener("click", function(event) {
						var option = event.target.closest("[data-mode]");
						if (option) {
							event.preventDefault();
							event.stopPropagation();
							self.closeModeMenu();
							self.switchMode(option.getAttribute("data-mode"));
							return;
						}
						self.toggleModeMenu();
						event.stopPropagation();
					});
					this.elements.modeSwitcher.addEventListener("keydown", function(event) {
						if (event.target.closest("[data-mode]")) {
							return;
						}
						if (event.key === "Enter" || event.key === " ") {
							self.toggleModeMenu();
							event.preventDefault();
						}
					});
				window.addEventListener("resize", function() {
					self.resizeTwisty();
					self.layoutPracticeCards();
					self.syncKeySize();
				});
				if (window.ResizeObserver) {
					new ResizeObserver(function() {
						self.resizeTwisty();
					}).observe(self.elements.cubeStage);
					// 训练模式卡片随列表宽度变化实时重算列数与缩略图尺寸。
					this.thumbnailResizeObserver = new ResizeObserver(function() {
						self.layoutPracticeCards();
					});
					if (this.elements.practiceGrid) {
						this.thumbnailResizeObserver.observe(this.elements.practiceGrid);
					}
				}
					this.bindViewDrag();
					document.addEventListener("keydown", function(event) {
						var panelOverlay = document.getElementById("panelOverlay");
						if (event.key === "Tab" && panelOverlay && panelOverlay.classList.contains("isOpen")) {
							var focusable = Array.from(panelOverlay.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function(node) { return node.offsetParent !== null; });
							if (focusable.length) {
								var first = focusable[0];
								var last = focusable[focusable.length - 1];
								if (event.shiftKey && document.activeElement === first) { last.focus(); event.preventDefault(); }
								else if (!event.shiftKey && document.activeElement === last) { first.focus(); event.preventDefault(); }
							}
						}
						if (event.key === "Escape") {
							self.closeKeys();
							self.closePanel();
							self.closeSideNav();
							self.closeModeMenu();
							return;
						}
						var keyMap = {
							u: "U",
							r: "R",
							f: "F",
							d: "D",
							l: "L",
							b: "B",
							x: "x",
							y: "y",
							z: "z"
						};
						var move = keyMap[event.key && event.key.toLowerCase()];
						if (move && !self.isPracticeMode && self.currentMode !== "library" && !event.altKey && !event.ctrlKey && !event.metaKey) {
							self.playMove(self.wideMode || event.shiftKey ? move.toLowerCase() : move, "keyboard", Date.now());
						}
						if (event.key === "Backspace" && !event.altKey && !event.ctrlKey && !event.metaKey) {
							self.playLastMoveInverse("keyboard");
						}
					});
					var pressInsideMenuContainer = null;
					document.addEventListener("mousedown", function(event) {
						var inMode = self.elements.modeSwitcher.contains(event.target);
						var inPractice = self.elements.practiceModeSelect && self.elements.practiceModeSelect.contains(event.target);
						pressInsideMenuContainer = inMode ? "mode" : (inPractice ? "practice" : null);
					});
					document.addEventListener("mouseup", function() {
						if (pressInsideMenuContainer) {
							pressInsideMenuContainer = null;
							return;
						}
						self.closeModeMenu();
						self.closePracticeModeMenu();
					});
				},

				isPortraitLayout: function() {
					return window.matchMedia("(orientation: portrait)").matches;
				},

				renderKeys: function() {
					var body = document.getElementById("keyBody");
					if (body && !body.firstElementChild) body.innerHTML = this.getManualMovesHtml();
				},

				getKeyBounds: function() {
					var drawer = document.getElementById("keyDrawer");
					if (!drawer) return this.isPortraitLayout() ? { small: 112, large: 318 } : { small: 96, large: 297 };
					var portrait = this.isPortraitLayout();
					var wasLarge = drawer.classList.contains("isLarge");
					var inlineSize = portrait ? drawer.style.height : drawer.style.width;
					if (portrait) drawer.style.height = "";
					else drawer.style.width = "";
					drawer.classList.remove("isLarge");
					var small = portrait ? drawer.getBoundingClientRect().height : drawer.getBoundingClientRect().width;
					drawer.classList.add("isLarge");
					var large = portrait ? drawer.getBoundingClientRect().height : drawer.getBoundingClientRect().width;
					drawer.classList.toggle("isLarge", wasLarge);
					if (portrait) drawer.style.height = inlineSize;
					else drawer.style.width = inlineSize;
					return { small: small, large: large };
				},

				setKeySize: function(large) {
					var drawer = document.getElementById("keyDrawer");
					if (!drawer) return;
					var bounds = this.getKeyBounds();
					drawer.classList.toggle("isLarge", !!large);
					drawer.classList.remove("isPreviewLarge");
					var size = large ? bounds.large : bounds.small;
					if (this.isPortraitLayout()) {
						drawer.style.width = "";
						drawer.style.height = "";
					} else {
						drawer.style.height = "";
						drawer.style.width = "";
					}
					document.documentElement.style.setProperty("--keyboard-drawer-height", size + "px");
				},

				syncKeyMode: function(mode) {
					this.setKeySize(mode === "formula");
				},

				syncKeySize: function() {
					var drawer = document.getElementById("keyDrawer");
					if (drawer) this.setKeySize(drawer.classList.contains("isLarge"));
				},

				toggleKeys: function() {
					var drawer = document.getElementById("keyDrawer");
					if (drawer && drawer.classList.contains("isOpen")) this.closeKeys();
					else this.openKeys();
				},

				openKeys: function() {
					var drawer = document.getElementById("keyDrawer");
					var toggle = document.getElementById("keyToggle");
					if (!drawer) return;
					drawer.classList.add("isOpen");
					drawer.setAttribute("aria-hidden", "false");
					if (toggle) {
						toggle.setAttribute("aria-expanded", "true");
						toggle.setAttribute("aria-label", "关闭键盘");
						toggle.title = "关闭键盘";
					}
				},

				closeKeys: function() {
					var drawer = document.getElementById("keyDrawer");
					var toggle = document.getElementById("keyToggle");
					if (drawer) {
						var keepLarge = drawer.classList.contains("isLarge");
						drawer.classList.remove("isOpen", "isDragging", "isPreviewLarge");
						drawer.setAttribute("aria-hidden", "true");
						this.setKeySize(keepLarge);
					}
					if (toggle) {
						toggle.setAttribute("aria-expanded", "false");
						toggle.setAttribute("aria-label", "打开键盘");
						toggle.title = "打开键盘";
						if (document.activeElement === toggle) toggle.blur();
					}
				},

				bindKeyDismiss: function() {
					if (this._keyDrawerDismissBound) return;
					this._keyDrawerDismissBound = true;
					var self = this;
					function isInsideKeyboard(target, event) {
						var drawer = document.getElementById("keyDrawer");
						var toggle = document.getElementById("keyToggle");
						var path = event && typeof event.composedPath === "function" ? event.composedPath() : [];
						return !!(target && ((drawer && (drawer.contains(target) || path.indexOf(drawer) >= 0)) || (toggle && (toggle.contains(target) || path.indexOf(toggle) >= 0))));
					}
					document.addEventListener("focusin", function(event) {
						var drawer = document.getElementById("keyDrawer");
						if (drawer && drawer.classList.contains("isOpen") && !isInsideKeyboard(event.target, event)) self.closeKeys();
					});
					document.addEventListener("pointerdown", function(event) {
						var drawer = document.getElementById("keyDrawer");
						if (drawer && drawer.classList.contains("isOpen") && !isInsideKeyboard(event.target, event)) self.closeKeys();
					}, true);
					window.addEventListener("blur", function() { self.closeKeys(); });
				},

				bindKeyDrag: function(handle) {
					var self = this;
					var drawer = handle.closest(".keyDrawer");
					var start = 0, startSize = 0, currentSize = 0, delta = 0, dragging = false, dragBounds = null;
					handle.addEventListener("pointerdown", function(event) {
						dragging = true;
						delta = 0;
						self._keyHandleDragged = false;
						var portrait = self.isPortraitLayout();
						dragBounds = self.getKeyBounds();
						start = portrait ? event.clientY : event.clientX;
						startSize = portrait ? drawer.getBoundingClientRect().height : drawer.getBoundingClientRect().width;
						currentSize = startSize;
						drawer.classList.add("isDragging");
						handle.setPointerCapture(event.pointerId);
						event.preventDefault();
					});
					handle.addEventListener("pointermove", function(event) {
						if (!dragging) return;
						var current = self.isPortraitLayout() ? event.clientY : event.clientX;
						delta = current - start;
						var bounds = dragBounds || self.getKeyBounds();
						currentSize = Math.max(0, Math.min(bounds.large, startSize - delta));
						drawer.classList.toggle("isPreviewLarge", !drawer.classList.contains("isLarge") && currentSize > bounds.small + 1);
						if (self.isPortraitLayout()) drawer.style.height = currentSize + "px";
						else drawer.style.width = currentSize + "px";
						document.documentElement.style.setProperty("--keyboard-drawer-height", currentSize + "px");
						if (Math.abs(delta) >= 6) self._keyHandleDragged = true;
						event.preventDefault();
					});
					function finishDrag(event) {
						if (!dragging) return;
						dragging = false;
						var bounds = dragBounds || self.getKeyBounds();
						if (currentSize < bounds.small * 0.58) {
							self.closeKeys();
							if (event && handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
							return;
						}
						if (Math.abs(delta) < 6) {
							drawer.classList.remove("isDragging", "isPreviewLarge");
							if (event && handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
							return;
						}
						var large = currentSize >= (bounds.small + bounds.large) / 2;
						drawer.classList.remove("isDragging", "isPreviewLarge");
						self.setKeySize(large);
						if (event && handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
					}
					handle.addEventListener("pointerup", finishDrag);
					handle.addEventListener("pointercancel", finishDrag);
				},

				toggleSideNav: function() {
					if (this.isPortraitLayout()) {
						document.body.classList.toggle("railOpen");
					} else {
						document.body.classList.toggle("railExpanded");
					}
					this.syncSideNav();
				},

				closeSideNav: function() {
					document.body.classList.remove("railOpen", "railExpanded");
					this.syncSideNav();
				},

				syncSideNav: function() {
					var portrait = this.isPortraitLayout();
					var rail = document.getElementById("sideNav");
					var scrim = document.getElementById("sideNavScrim");
					var menu = document.getElementById("layoutMenuToggle");
					if (portrait) document.body.classList.remove("railExpanded");
					else document.body.classList.remove("railOpen");
					var expanded = portrait ? document.body.classList.contains("railOpen") : document.body.classList.contains("railExpanded");
					if (rail) rail.setAttribute("aria-hidden", portrait && !expanded ? "true" : "false");
					if (scrim) scrim.setAttribute("aria-hidden", portrait && expanded ? "false" : "true");
					if (menu) {
						menu.setAttribute("aria-expanded", expanded ? "true" : "false");
						menu.setAttribute("aria-label", expanded ? "收起左侧栏" : "展开左侧栏");
						menu.title = expanded ? "收起左侧栏" : "展开左侧栏";
					}
				},

				organizeOps: function() {
					var body = document.getElementById("modeOpsBody");
					var view = document.querySelector("aside.modeView");
					if (!body || !view || !window.AppUI) return;
					this.closePanel();
					window.AppUI.organizeOps({
						body: body,
						view: view,
						mode: this.currentMode
					});
				},

				togglePanel: function() {
					var overlay = document.getElementById("panelOverlay");
					if (overlay && overlay.classList.contains("isOpen")) this.closePanel();
					else this.openPanel();
				},

				bindPanelDrag: function(handle) {
					var self = this;
					var drawer = handle.closest(".panelDrawer");
					var start = 0, delta = 0, dragging = false;
					handle.addEventListener("pointerdown", function(event) {
						dragging = true; delta = 0;
						start = self.isPortraitLayout() ? event.clientY : event.clientX;
						handle.setPointerCapture(event.pointerId);
						drawer.style.transition = "none";
					});
					handle.addEventListener("pointermove", function(event) {
						if (!dragging) return;
						var current = self.isPortraitLayout() ? event.clientY : event.clientX;
						delta = current - start;
						delta = self.isPortraitLayout() ? Math.max(0,delta) : Math.min(0,delta);
						drawer.style.transform = self.isPortraitLayout() ? "translateY("+delta+"px)" : "translateX("+delta+"px)";
					});
					function finishDrag() {
						if (!dragging) return;
						dragging = false;
						drawer.style.transition = "";
						drawer.style.transform = "";
						if (Math.abs(delta)>64) self.closePanel();
					}
					handle.addEventListener("pointerup",finishDrag);
					handle.addEventListener("pointercancel",finishDrag);
				},
				openPanel: function() {
					var overlay = document.getElementById("panelOverlay");
					var toggles = document.querySelectorAll("[data-action-panel-toggle]");
					if (!overlay) return;
					this._panelFocus = document.activeElement;
					if (this.isPortraitLayout()) this.closeSideNav();
					overlay.classList.add("isOpen");
					overlay.setAttribute("aria-hidden", "false");
					toggles.forEach(function(toggle) { toggle.setAttribute("aria-expanded", "true"); toggle.setAttribute("aria-label", "关闭操作面板"); toggle.title = "关闭操作面板"; });
					var primary = document.getElementById("connectBtn");
					if (primary) requestAnimationFrame(function() { primary.focus(); });
				},

				closePanel: function() {
					var overlay = document.getElementById("panelOverlay");
					var toggles = document.querySelectorAll("[data-action-panel-toggle]");
					var wasOpen = overlay && overlay.classList.contains("isOpen");
					if (overlay) {
						overlay.classList.remove("isOpen");
						overlay.setAttribute("aria-hidden", "true");
					}
					toggles.forEach(function(toggle) { toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "展开操作面板"); toggle.title = "展开操作面板"; });
					if (wasOpen && this._panelFocus && this._panelFocus.focus) {
						this._panelFocus.focus();
					}
				},

				toggleFullscreen: function() {
					var self = this;
					var active = document.fullscreenElement || document.webkitFullscreenElement;
					var owner = active ? document : document.documentElement;
					var method = active ? (document.exitFullscreen || document.webkitExitFullscreen) :
						(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
					if (!method) {
						self.showToast("当前浏览器不支持全屏");
						return;
					}
					var action = method.call(owner);
					if (action && action.catch) {
						action.catch(function() { self.showToast("当前环境无法切换全屏"); });
					}
				},

				syncFullscreen: function() {
					var active = !!(document.fullscreenElement || document.webkitFullscreenElement);
					document.body.classList.toggle("isFullscreen", active);
					var label = document.getElementById("fullscreenLabel");
					var button = document.getElementById("fullscreenToggle");
					if (label) label.textContent = active ? "退出" : "全屏";
					if (button) { button.setAttribute("aria-label", active ? "退出全屏" : "进入全屏"); button.setAttribute("aria-pressed", active ? "true" : "false"); button.title = active ? "退出全屏" : "进入全屏"; }
				},

				toggleModeMenu: function() {
					var isOpen = this.elements.modeSwitcher.classList.toggle("isOpen");
					this.elements.modeSwitcher.setAttribute("aria-expanded", isOpen ? "true" : "false");
					this.elements.modeCurrent.setAttribute("aria-expanded", isOpen ? "true" : "false");
				},

				closeModeMenu: function() {
					this.elements.modeSwitcher.classList.remove("isOpen");
					this.elements.modeSwitcher.setAttribute("aria-expanded", "false");
					this.elements.modeCurrent.setAttribute("aria-expanded", "false");
				},

				togglePracticeMenu: function() {
					var element = this.elements.practiceModeSelect;
					var isOpen = element.classList.toggle("isOpen");
					element.querySelector(".practiceModeCurrent").setAttribute("aria-expanded", isOpen ? "true" : "false");
				},

				closePracticeModeMenu: function() {
					var element = this.elements.practiceModeSelect;
					if (element) {
						element.classList.remove("isOpen");
						element.querySelector(".practiceModeCurrent").setAttribute("aria-expanded", "false");
					}
				},

				syncPracticeMode: function() {
					var element = this.elements.practiceModeSelect;
					if (element) {
						var meta = {
							sequence: "顺序模式",
							random: "随机模式",
							loop: "循环模式"
						};
						var currentValue = this.practiceMode || "sequence";
						element.querySelector(".practiceModeCurrentText").textContent = meta[currentValue] || meta.sequence;
						var order = ["sequence", "random", "loop"].filter(function(item) {
							return item !== currentValue;
						});
						element.querySelector(".practiceModeMenu").innerHTML = order.map(function(item) {
							return '<button class="practiceModeOption" type="button" data-value="' + item + '" role="menuitem">' + meta[item] + '</button>';
						}).join("");
					}
				},

				getModeMeta: function(mode) {
					return this.modeDefs[mode] && this.modeDefs[mode].meta || null;
				},

				switchMode: function(mode) {
					if (!this.getModeMeta(mode)) {
						return;
					}
					if (mode === this.currentMode && document.querySelector("aside.modeView")) {
						return;
					}
					var sourceMode = this.currentMode;
					var enteringFormulaMode = mode === "formula" && sourceMode !== "formula";
					var savedViewYaw = this.viewYaw || 0;
					var savedViewPitch = this.viewPitch || 0;
					this.saveInputText();
					var formulaTransferText = null;
					var formulaTextAppended = false;
					if (sourceMode === "formula" && mode !== "formula") {
						if (this.isRecordingFormula) {
							this.stopFormulaRecording();
						}
						this.formulaOrganizeMode = false;
						this.dragFormulaId = null;
						formulaTransferText = this.buildFormulaExport();
					}
					if (sourceMode === "library" && mode === "practice") {
						if (this.suppressLibraryTransferOnce) {
							this.suppressLibraryTransferOnce = false;
						} else {
							formulaTransferText = this.buildLibExport();
						}
					}
					if (formulaTransferText !== null && formulaTransferText.trim()) {
						this.showGroupPicker(formulaTransferText, sourceMode);
						formulaTextAppended = false;
					}
					if (enteringFormulaMode) {
						this.clearMaker();
					}
					this.renderMode(mode);
					if (formulaTextAppended) {
						this.importFormulaText(this.formulaInputText, sourceMode === "library" ? "library" : "formula");
						var addedCount = 0;
						if (sourceMode === "formula" && this.formulaEntries) {
							addedCount = this.formulaEntries.filter(function(f) { return f.selected; }).length;
						}
						if (addedCount > 0) {
							this.showToast("已添加 " + addedCount + " 个公式到状态列表");
						}
					}
					if (enteringFormulaMode) {
						this.resetView();
						return;
					}
					this.setViewDrag(savedViewYaw, savedViewPitch);
				},

				setModeChrome: function(mode) {
					var meta = this.getModeMeta(mode);
					var self = this;
					var order = this.modeOrder.filter(function(item) {
						return item !== mode && self.getModeMeta(item);
					});
					document.title = meta.title;
					this.elements.modeLabel.textContent = meta.label;
					this.elements.modeIcon.className = "modeIcon " + meta.icon;
					this.elements.modeMenu.innerHTML = order.map(function(item) {
						var itemMeta = self.getModeMeta(item);
						return '<button class="modeOption" type="button" data-mode="' + item + '" role="menuitem"><span class="modeIcon ' + itemMeta.icon + '" aria-hidden="true"></span><span class="modeText">' + itemMeta.label + '</span></button>';
					}).join("");
					document.querySelectorAll(".modeNavBtn[data-mode]").forEach(function(button) {
						var selected = button.getAttribute("data-mode") === mode;
						button.classList.toggle("isActive", selected);
						if (selected) button.setAttribute("aria-current", "page");
						else button.removeAttribute("aria-current");
					});
				},

				renderMode: function(mode) {
					var view = document.querySelector("aside.modeView");
					if (!view) {
						return;
					}
					var prev = this.modeDefs[this.currentMode];
					if (this.currentMode !== mode && prev && typeof prev.leave === "function") prev.leave.call(this);
					this.currentMode = mode;
					this.isPracticeMode = mode === "practice";
					if (!this.isPracticeMode) {
						this.cancelSolvedAdvance();
					}
					this.setModeChrome(mode);
					view.outerHTML = this.getModeHtml(mode);
					this.refreshElements();
					this.bindModeUI();
					this.syncConnectionUi();
					this.fillFormulaInputText(this.formulaInputText, false, false);
					this.renderFormulaCards();
					this.renderMoves();
					this.renderFormulaList();
					this.renderLibs();
					this.renderGroupPicker();
					this.applyGroupMaskToCube();
					this.syncKeyMode(mode);
				if (mode === "library") {
					this.loadFormulaLibraries();
				}
				var def = this.modeDefs[mode];
				if (def && typeof def.enter === "function") def.enter.call(this);
				this.organizeOps();
			},

				getModeHtml: function(mode) {
					var def = this.modeDefs[mode];
					if (def && typeof def.html === "function") return def.html.call(this);
					if (mode === "practice") {
						return this.getPracticeHtml();
					}
					if (mode === "library") {
						return this.getLibraryHtml();
					}
					if (mode === "formula") {
						return this.getMakerHtml();
					}
					return this.getPracticeHtml();
				},

				getMacHelpHtml: function() {
					return '<section id="macHelp" class="viewSec macHelp" aria-live="polite"><strong>MAC 地址提示</strong><p>请输入智能硬件的MAC地址（xx:xx:xx:xx:xx:xx），你可以通过 <code>chrome://bluetooth-internals/#devices</code> 找到MAC地址，或者修改以下配置让csTimer自动获取蓝牙地址：<br>Chrome：在浏览器设置里打开 <code>chrome://flags/#enable-experimental-web-platform-features</code><br>Bluefy：在浏览器设置里开启 <code>Enable BLE Advertisements</code></p><div id="macHelpReason" class="macHelpReason"></div></section>';
				},

				getViewHead: function(title) {
					return '<header class="viewHead"><div class="viewHeadContent"><h1>' + title + '</h1></div></header>';
				},

				getSeamlessToggleHtml: function(inHeader) {
					var label = inHeader ? '' : '<span class="toggleLabel">无缝模式</span>';
					var switchHtml = inHeader ? '' : '<span class="toggleSwitch"></span>';
					return (inHeader ? '' : '<div class="controls" style="margin-top: 10px;">') + '<button id="seamlessToggleBtn" class="seamlessToggle" type="button" title="切换无缝模式：色块变大无空隙，隐藏色块显示为不透明灰色">' + label + switchHtml + '</button>' + (inHeader ? '' : '</div>');
				},

				getGroupSelectorHtml: function() {
					return '<div class="memoryLibraryBar sharedGroupBar" id="sharedGroupBar"><button id="planSyncBtn" class="planSyncBtn memoryLibraryIconBtn" type="button" title="同步选择状态"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15 6.7L21 16"/><path d="M21 21v-5h-5"/></svg></button><div id="sharedGroupSelector" class="memoryLibrarySelector" style="flex:1 1 auto"><button id="sharedGroupCurrent" class="memoryLibraryCurrent" type="button" aria-haspopup="true" aria-expanded="false"><span id="sharedGroupCurrentText" class="memoryLibraryCurrentText"></span><span class="memoryLibraryChevron"></span></button><div id="sharedGroupMenu" class="memoryLibraryMenu" role="menu"></div></div><input id="sharedGroupNameInput" class="memoryLibraryNameInput" type="text" maxlength="30"><button id="sharedGroupAddBtn" class="memoryLibraryIconBtn" type="button" title="新建组"><svg class="memoryIconPlus" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3V13M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><svg class="memoryIconAddCheck" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none"><path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="sharedGroupRenameBtn" class="memoryLibraryIconBtn" type="button" title="重命名组"><svg class="memoryIconPencil" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11.5 2.5L13.5 4.5L5 13L2 14L3 11L11.5 2.5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M9.5 4.5L11.5 6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><svg class="memoryIconCheck" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none"><path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button id="sharedGroupDeleteBtn" class="memoryLibraryIconBtn" type="button" title="删除组"><svg class="memoryIconTrash" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg><svg class="memoryIconClose" width="16" height="16" viewBox="0 0 16 16" fill="none" style="display:none"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div><div id="planBox" class="planBox"><button id="planExpandBtn" class="planExpandBtn" type="button" aria-expanded="false"><span class="planExpandLabel">规划学习</span></button><div id="planPanel" class="planPanel"><div class="planPanelContent"><div class="planViewToggle"><button id="planViewToggleBtn" class="planViewBtn" type="button" data-view="list"><svg class="planViewIconList" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><svg class="planViewIconText" style="display:none" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span class="planViewToggleText">文本编辑</span></button><button id="planImportBtn" class="planViewBtn planImportBtn" type="button"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>导入公式</button></div><div id="planContentArea" class="planContentArea"><div id="planFormulaListWrap" class="planFormulaListWrap"><div id="planFormulaList" class="planFormulaList"></div></div><div id="planTextEditWrap" class="planTextEditWrap"><textarea id="planTextarea" class="planTextarea" spellcheck="false" placeholder="输入公式，每行一个，格式：名称:公式 如 PLL-T:R U R..."></textarea></div></div><div class="planDailyRow"><label class="planDailyLabel">每日公式数 <input id="planDailyCount" class="planDailyInput" type="number" min="1" max="999" value="10"></label><span id="planCount" class="planCount">[0]/[10]</span></div><div class="memoryDialogActions planPanelActions"><button id="planCancelBtn" class="button secondary" type="button">取消</button><button id="planSaveBtn" class="button" type="button">保存</button></div></div><button id="planCollapseBtn" class="planCollapseBtn" type="button"><span class="collapseChevrons"><span></span><span></span></span>收起</button></div></div><input id="planFileInput" class="hiddenFileInput" type="file" accept=".txt,text/plain">';
				},

				getFormulaImportHtml: function(showThumbOption, practiceCards, includeGroupControls) {
					var groupControls = includeGroupControls === false ? "" : this.getGroupSelectorHtml();
					return '<section class="viewSec stateImport memoryManageSection" id="formulaImport">' + groupControls + (showThumbOption ? '<div class="stateOptionRow"><label class="stateOptions smartCheck"><input id="showFormulaThumbs" type="checkbox"><span class="checkVisual"></span><span>显示公式缩略图</span></label></div>' : "") + (practiceCards ? '<label id="practiceFormulaToggle" class="practiceFormulaToggle smartCheck"><span id="practiceFormulaCount" class="practiceFormulaCount">共0个</span><span id="practiceFormulaName" class="practiceFormulaName"></span><input id="showPracticeFormula" type="checkbox"><span class="checkVisual"></span><span id="practiceFormulaText">显示公式</span></label><div id="practiceAoTimes" class="practiceAoTimes"><div class="practiceAoTime"><span>本次</span><strong>--</strong></div><div class="practiceAoTime"><span>AO5</span><strong>--</strong></div><div class="practiceAoTime"><span>AO10</span><strong>--</strong></div><div class="practiceAoTime"><span>AO50</span><strong>--</strong></div></div>' : "") + '<div id="practiceGrid" class="practiceGrid"></div></section>';
				},

				getDiagnosticsHtml: function(hidden) {
					var cls = hidden ? ' class="practiceDiagnostics" aria-hidden="true"' : ' class="history"';
					if (hidden) {
						return '<section' + cls + '><strong id="deviceName">-</strong><strong id="moveCount">0</strong><span id="lastTs">--:--</span><div id="moveList"></div><div id="log"></div></section>';
					}
					return '<section' + cls + '><div class="historyTitle"><span>最近转动</span><span id="lastTs">--:--</span></div><div id="moveList" class="moveList"></div><div id="log" class="log"></div></section>';
				},

				getManualMovesHtml: function() {
					return '<section class="viewSec"><div class="moves" id="manualMoves" aria-label="手动测试转动"><div class="keyboardExtraMoves"><button class="moveButton" type="button" data-move="U" data-base="U">U</button><button class="moveButton" type="button" data-move="R" data-base="R">R</button><button class="moveButton" type="button" data-move="F" data-base="F">F</button><button class="moveButton" type="button" data-move="D" data-base="D">D</button><button class="moveButton" type="button" data-move="L" data-base="L">L</button><button class="moveButton" type="button" data-move="B" data-base="B">B</button><button class="moveButton" type="button" data-move="U&#39;" data-base="U">U&#39;</button><button class="moveButton" type="button" data-move="R&#39;" data-base="R">R&#39;</button><button class="moveButton" type="button" data-move="F&#39;" data-base="F">F&#39;</button><button class="moveButton" type="button" data-move="D&#39;" data-base="D">D&#39;</button><button class="moveButton" type="button" data-move="L&#39;" data-base="L">L&#39;</button><button class="moveButton" type="button" data-move="B&#39;" data-base="B">B&#39;</button><button class="moveButton" type="button" data-move="M">M</button><button class="moveButton" type="button" data-move="E">E</button><button class="moveButton" type="button" data-move="S">S</button><button class="moveButton" type="button" data-move="M&#39;">M&#39;</button><button class="moveButton" type="button" data-move="E&#39;">E&#39;</button><button class="moveButton" type="button" data-move="S&#39;">S&#39;</button></div><div class="keyboardRotationMoves"><button class="moveButton rotation" type="button" data-move="x">x</button><button class="moveButton rotation" type="button" data-move="y">y</button><button class="moveButton rotation" type="button" data-move="z">z</button><button class="moveButton rotation" type="button" data-move="x&#39;">x&#39;</button><button class="moveButton rotation" type="button" data-move="y&#39;">y&#39;</button><button class="moveButton rotation" type="button" data-move="z&#39;">z&#39;</button></div><div class="keyboardControlRow"><button class="moveButton keyBackspace" id="keyBackspace" type="button" aria-label="退格" title="退格"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5H9.5c-.7 0-1.3.4-1.7 1l-4.8 6c-.4.5-.4 1.3 0 1.8l4.8 6c.4.6 1 1 1.7 1H19c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-2.3 10.6L14.2 17l-2.5-2.5L9.2 17 7 14.8l2.5-2.5L7 9.8 9.2 7.6l2.5 2.5 2.5-2.5 2.3 2.2-2.5 2.5 2.5 2.5z" fill="currentColor"/></svg></button><button class="moveButton keyShiftIcon" id="keyShift" type="button" aria-label="双层操作" title="双层操作" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l8 8h-5v8H9v-8H4z" fill="currentColor"/></svg></button></div></div></section>';
				},

				updateManualMoveLabels: function() {
					var buttons = document.querySelectorAll(".keyboardExtraMoves .moveButton[data-base]");
					for (var i = 0; i < buttons.length; i++) {
						var button = buttons[i];
						var base = button.getAttribute("data-base");
						var isPrime = button.getAttribute("data-move").indexOf("'") >= 0;
						var newMove = (this.wideMode ? base.toLowerCase() : base) + (isPrime ? "'" : "");
						button.setAttribute("data-move", newMove);
						button.textContent = newMove;
					}
				},

				getPracticeHtml: function() {
					return '<aside class="modeView practiceView">' + this.getViewHead("训练模式") + '<section class="viewSec"><div class="controls practiceControls"><div id="practiceModeSelect" class="practiceModeSelect" aria-label="练习切换模式"><button class="practiceModeCurrent" type="button" aria-haspopup="true" aria-expanded="false"><span class="practiceModeCurrentText">顺序模式</span><span class="practiceModeChevron" aria-hidden="true"></span></button><div class="practiceModeMenu" role="menu"><button class="practiceModeOption" type="button" data-value="sequence" role="menuitem">顺序模式</button><button class="practiceModeOption" type="button" data-value="random" role="menuitem">随机模式</button><button class="practiceModeOption" type="button" data-value="loop" role="menuitem">循环模式</button></div></div></div></section>' + this.getMacHelpHtml() + '' + this.getFormulaImportHtml(false, true) + this.getDiagnosticsHtml(true) + '</aside>';
				},

				getLibraryHtml: function() {
					return '<aside class="modeView libraryView">' + this.getViewHead("公式库") + '<section class="viewSec"><div class="controls libraryControls"><button id="confirmLibraryImportBtn" class="button secondary" type="button">导出公式</button></div></section>' + this.getMacHelpHtml() + '<section class="viewSec"><div id="libraryStatus" class="importStatus">正在读取公式库</div><div id="libraryList" class="libraryList"></div></section>' + this.getDiagnosticsHtml(true) + '</aside>';
				},

				getMakerHtml: function() {
					return '<aside class="modeView makerView">' + this.getViewHead("公式制作") + '<section class="viewSec"><div class="controls formulaControls"><button id="exportFormulaBtn" class="button secondary" type="button">导出公式</button></div></section>' + this.getMacHelpHtml() + '<section class="viewSec"><div id="draftList" class="draftList"></div></section>' + this.getDiagnosticsHtml(true) + '</aside>';
				},

				bindOnce: function(element, key, handler) {
					if (!element || element.dataset[key]) {
						return;
					}
					element.dataset[key] = "1";
					handler(element);
				},

				bindModeUI: function() {
					var self = this;
					if (this.isPracticeMode) {
						this.ensureDetectOpts(document.querySelector(".practiceView"));
					}
					this.bindOnce(this.elements.connectBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							if (self.connected) {
								self.disconnect();
							} else {
								self.connect();
							}
						});
					});
					this.bindOnce(this.elements.resetBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							self.resetView();
						});
					});
					this.bindOnce(this.elements.seamlessToggleBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							self.toggleSeamlessMode();
						});
						if (self.seamlessMode) {
							element.classList.add("isActive");
						}
					});
					this.bindOnce(this.elements.gyroToggleBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							self.toggleGyroFollow();
						});
					});
					this.bindOnce(this.elements.customFinalStateBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							self.openCustomStateDialog(element);
						});
					});
					this.bindOnce(this.elements.exportFormulaBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							self.openFormulaExport({ anchor: element });
						});
					});
					this.bindOnce(this.elements.confirmLibraryImportBtn, "smartBound", function(element) {
						element.addEventListener("click", function() {
							self.openLibExport(element);
						});
					});
					this.bindOnce(this.elements.practiceModeSelect, "smartBound", function(element) {
						self.syncPracticeMode();
						element.querySelector(".practiceModeCurrent").addEventListener("click", function(event) {
							event.stopPropagation();
							self.togglePracticeMenu();
						});
						element.querySelector(".practiceModeMenu").addEventListener("click", function(event) {
							var option = event.target.closest("[data-value]");
							if (option) {
								var value = option.getAttribute("data-value");
								self.practiceMode = value === "random" ? "random" : (value === "loop" ? "loop" : "sequence");
								self.randomBag = [];
								self.syncPracticeMode();
								self.closePracticeModeMenu();
								self.savePracticeStats();
							}
						});
					});
					this.bindOnce(this.elements.orientationMoves, "smartBound", function(element) {
						element.addEventListener("click", function(event) {
							var button = event.target.closest("[data-move]");
							if (button) {
								self.playMove(button.getAttribute("data-move"), "manual", Date.now());
							}
						});
					});
					this.bindOnce(this.elements.manualMoves, "smartBound", function(element) {
						element.addEventListener("click", function(event) {
							var button = event.target.closest("[data-move]");
							if (button) {
								self.playMove(button.getAttribute("data-move"), "manual", Date.now());
								return;
							}
							var control = event.target.closest("#keyBackspace, #keyShift");
							if (control && control.id === "keyBackspace") {
								self.playLastMoveInverse("manual");
							} else if (control && control.id === "keyShift") {
								self.wideMode = !self.wideMode;
								control.classList.toggle("isActive", !!self.wideMode);
								control.setAttribute("aria-pressed", String(!!self.wideMode));
								self.updateManualMoveLabels();
							}
						});
					});
					if ((this.elements.formulaDropZone || this.elements.planExpandBtn) && !(this.elements.formulaDropZone && this.elements.formulaDropZone.dataset.smartBound) && !(this.elements.planExpandBtn && this.elements.planExpandBtn.dataset.smartBound)) {
						this.bindFormulaImport();
					}
					if (this.elements.draftList && !this.elements.draftList.dataset.smartBound) {
						this.bindFormulaList();
					}
					if (this.elements.libraryList && !this.elements.libraryList.dataset.smartBound) {
						this.bindLibList();
					}
					if (!this._sharedGroupBound) {
						this._sharedGroupBound = true;
						var self = this;

						function exitGroupEdit() {
							var bar = document.getElementById('sharedGroupBar');
							if (bar) bar.classList.remove('isEditing', 'isCreating');
						}
						function confirmGroupEdit() {
							var bar = document.getElementById('sharedGroupBar');
							var nameInput = document.getElementById('sharedGroupNameInput');
							var newName = nameInput ? nameInput.value.trim() : '';
							if (bar && bar.classList.contains('isCreating')) {
								if (newName && typeof self.createFormulaGroup === 'function') {
									self.createFormulaGroup(newName);
								}
							} else if (bar && bar.classList.contains('isEditing')) {
								if (newName && typeof self.renameFormulaGroup === 'function') {
									self.renameFormulaGroup(typeof self.getActiveGroupId === 'function' ? self.getActiveGroupId() : null, newName);
								}
							}
							if (bar) bar.classList.remove('isEditing', 'isCreating');
						}

						document.addEventListener('click', function(e) {
							var current = e.target.closest('#sharedGroupCurrent');
							var option = e.target.closest('.memoryLibraryOption[data-group-id]');
							var addBtn = e.target.closest('#sharedGroupAddBtn');
							var renameBtn = e.target.closest('#sharedGroupRenameBtn');
							var deleteBtn = e.target.closest('#sharedGroupDeleteBtn');
							var customBtn = e.target.closest('#sharedCustomStateBtn');
							var bar = document.getElementById('sharedGroupBar');
							var selector = document.getElementById('sharedGroupSelector');

							if (current) {
								if (selector) selector.classList.toggle('isOpen');
								return;
							}
							if (option) {
								var gid = option.getAttribute('data-group-id');
								if (gid && typeof self.setActiveGroupId === 'function') {
									self.setActiveGroupId(gid);
								}
								if (selector) selector.classList.remove('isOpen');
								exitGroupEdit();
								return;
							}
							if (selector && selector.classList.contains('isOpen') && !selector.contains(e.target)) {
								selector.classList.remove('isOpen');
							}
							if (bar && (bar.classList.contains('isEditing') || bar.classList.contains('isCreating'))) {
								if (!bar.contains(e.target)) {
									exitGroupEdit();
								}
							}
							if (addBtn) {
								if (bar && bar.classList.contains('isCreating')) {
									confirmGroupEdit();
								} else {
									exitGroupEdit();
									if (bar) bar.classList.add('isCreating');
									var nameInput = document.getElementById('sharedGroupNameInput');
									if (nameInput) { nameInput.value = ''; nameInput.focus(); }
								}
								return;
							}
							if (renameBtn) {
								if (bar && bar.classList.contains('isEditing')) {
									confirmGroupEdit();
								} else {
									exitGroupEdit();
									if (bar) bar.classList.add('isEditing');
									var nameInput = document.getElementById('sharedGroupNameInput');
									if (nameInput) {
										nameInput.value = typeof self.getActiveGroupName === 'function' ? self.getActiveGroupName() : '';
										nameInput.focus();
										nameInput.select();
									}
								}
								return;
							}
							if (deleteBtn) {
								if (bar && bar.classList.contains('isCreating')) {
									exitGroupEdit();
									return;
								}
								if (typeof self.deleteFormulaGroup === 'function') {
									var gname = typeof self.getActiveGroupName === 'function' ? self.getActiveGroupName() : '';
									self.openNoticePrompt({
										title: "删除公式组",
										message: '确定删除组「' + gname + '」？该组的所有公式和记忆数据将被永久删除。',
										confirmText: "删除",
										warning: true,
										onConfirm: function() {
											self.deleteFormulaGroup(typeof self.getActiveGroupId === 'function' ? self.getActiveGroupId() : null);
										}
									});
								}
								return;
							}
							if (customBtn) {
								var origBtn = document.getElementById('customFinalStateBtn');
								if (origBtn) {
									origBtn.click();
								} else {
									if (typeof self.openCustomStateDialog === 'function') {
										self.openCustomStateDialog();
									}
								}
							}
						});
						document.addEventListener('keydown', function(e) {
							var nameInput = document.getElementById('sharedGroupNameInput');
							if (e.target === nameInput) {
								if (e.key === 'Enter') {
									e.preventDefault();
									confirmGroupEdit();
								} else if (e.key === 'Escape') {
									e.preventDefault();
									exitGroupEdit();
								}
							}
						});
					}
				},

				cloneStickerMask: function(mask) {
					var clone = {};
					for (var key in mask || {}) {
						if (mask[key]) {
							clone[key] = true;
						}
					}
					return clone;
				},

				prepareStickerScene: function(scene) {
					if (!scene || !scene.getTwisty) {
						return;
					}
					var twisty = scene.getTwisty();
					if (!twisty || !twisty.cubePieces) {
						return;
					}
					var dimension = twisty.options.dimension;
					for (var faceIndex = 0; faceIndex < twisty.cubePieces.length; faceIndex++) {
						var face = twisty.cubePieces[faceIndex];
						for (var stickerIndex = 0; stickerIndex < face.length; stickerIndex++) {
							var sticker = face[stickerIndex];
							var mesh = sticker[1].children[0];
							sticker[1]._customFaceletIndex = this.matrixToFaceletIndex(sticker[0], dimension);
							mesh._customColoredMaterial = mesh.materials[0];
						}
					}
				},

				matrixToFaceletIndex: function(matrix, dimension) {
					var xyXchg = [1, 0, 0, 1, 0, 0];
					var xInv = [1, -1, -1, -1, -1, -1];
					var yInv = [1, -1, 1, 1, 1, -1];
					var coord = [Math.round(matrix.n24), Math.round(matrix.n14), Math.round(matrix.n34)];
					var coordIndex = coord.indexOf(dimension) + coord.indexOf(-dimension) + 1;
					var axis = coordIndex + (coord[coordIndex] > 0 ? 0 : 3);
					coord.splice(coordIndex, 1);
					var xy = xyXchg[axis];
					var x = (coord[xy] * xInv[axis] + dimension - 1) / 2;
					var y = (coord[1 - xy] * yInv[axis] + dimension - 1) / 2;
					return axis * dimension * dimension + x * dimension + y;
				},

				applyHiddenMask: function(scene, mask) {
					if (!scene || !scene.getTwisty) {
						return;
					}
					var twisty = scene.getTwisty();
					if (!twisty || !twisty.cubePieces) {
						return;
					}
					if (!scene._customHiddenMaterial) {
						scene._customHiddenMaterial = new THREE.MeshBasicMaterial({
							color: 0x9aa0aa,
							opacity: 0.28,
							transparent: true
						});
					}
					for (var faceIndex = 0; faceIndex < twisty.cubePieces.length; faceIndex++) {
						var face = twisty.cubePieces[faceIndex];
						for (var stickerIndex = 0; stickerIndex < face.length; stickerIndex++) {
							var sticker = face[stickerIndex][1];
							var mesh = sticker.children[0];
							if (mask && mask[sticker._customFaceletIndex]) {
								mesh.materials[0] = scene._customHiddenMaterial;
							} else if (mesh._customColoredMaterial) {
								mesh.materials[0] = mesh._customColoredMaterial;
							}
						}
					}
					if (scene.render) {
						scene.render();
					}
				},

				getStickerGroupKey: function(faceletIndex) {
					var face = Math.floor(faceletIndex / 9);
					var index = faceletIndex % 9;
					var row = Math.floor(index / 3);
					var col = index % 3;
					var type = index === 4 ? "center" : (row !== 1 && col !== 1 ? "corner" : "edge");
					var area = "second";
					if (face === 3) {
						area = "bottom-face";
					} else if (face === 0) {
						area = "top-face";
					} else if (row === 2) {
						area = "first-layer";
					} else if (row === 0) {
						area = "third-layer";
					}
					return area + ":" + type;
				},

				getStickerGroupKey: function(faceletIndex) {
					return this.customStickerGroups && this.customStickerGroups[faceletIndex] || this.getStickerGroupKey(faceletIndex);
				},

				buildStickerGroups: function(scene) {
					var groups = {};
					var twisty = scene && scene.getTwisty && scene.getTwisty();
					if (!twisty || !twisty.cubePieces) {
						return groups;
					}
					var dimension = twisty.options.dimension;
					for (var faceIndex = 0; faceIndex < twisty.cubePieces.length; faceIndex++) {
						var face = twisty.cubePieces[faceIndex];
						for (var stickerIndex = 0; stickerIndex < face.length; stickerIndex++) {
							var sticker = face[stickerIndex];
							var identity = sticker[1]._customFaceletIndex;
							var currentPosition = this.matrixToFaceletIndex(sticker[0], dimension);
							groups[identity] = this.getStickerGroupKey(currentPosition);
						}
					}
					return groups;
				},

				getStickerGroup: function(faceletIndex) {
					var group = this.getStickerGroupKey(faceletIndex);
					var members = [];
					for (var i = 0; i < 54; i++) {
						if (this.getStickerGroupKey(i) === group) {
							members.push(i);
						}
					}
					return members;
				},

				toggleStickerGroup: function(faceletIndex) {
					var members = this.getStickerGroup(faceletIndex);
					var shouldHide = false;
					for (var i = 0; i < members.length; i++) {
						if (!this.customCubeDraftMask[members[i]]) {
							shouldHide = true;
							break;
						}
					}
					for (var j = 0; j < members.length; j++) {
						var member = members[j];
						if (!shouldHide) {
							delete this.customCubeDraftMask[member];
							continue;
						}
						this.customCubeDraftMask[member] = true;
					}
					this.applyHiddenMask(this.customCubeScene, this.customCubeDraftMask);
					this.updateCustomStateHint();
				},

				updateCustomStateHint: function() {
					var hint = document.getElementById("customStateHint");
					if (!hint) {
						return;
					}
					var count = Object.keys(this.customCubeDraftMask || {}).length;
					hint.textContent = "拖动旋转视角，点击贴纸切换同区域同类贴纸 · 已隐藏 " + count + " 张";
				},

				syncThumbMask: function() {
					for (var i = 0; i < this.thumbnailScenes.length; i++) {
						this.applyHiddenMask(this.thumbnailScenes[i], this.hiddenStickerMask);
					}
				},

				copyTwistyState: function(sourceScene, targetScene) {
					var source = sourceScene && sourceScene.getTwisty && sourceScene.getTwisty();
					var target = targetScene && targetScene.getTwisty && targetScene.getTwisty();
					if (!source || !target || !source.cubePieces || !target.cubePieces) {
						return;
					}
					for (var faceIndex = 0; faceIndex < source.cubePieces.length; faceIndex++) {
						for (var stickerIndex = 0; stickerIndex < source.cubePieces[faceIndex].length; stickerIndex++) {
							var sourceSticker = source.cubePieces[faceIndex][stickerIndex];
							var targetSticker = target.cubePieces[faceIndex][stickerIndex];
							targetSticker[0].copy(sourceSticker[0]);
							targetSticker[1].matrix.copy(sourceSticker[1].matrix);
							targetSticker[1].update();
						}
					}
				},

				openCustomStateDialog: function(anchor) {
					var self = this;
					var existing = document.getElementById("customStateInline");
					if (existing) {
						this.closeInlineExpansion(existing, anchor || this.elements.customFinalStateBtn);
						return;
					}
					anchor = anchor || this.elements.customFinalStateBtn;
					var host = anchor && anchor.closest(".globalOps");
					if (!host) { return; }
					this.customCubeDraftMask = this.cloneStickerMask(this.hiddenStickerMask);
					var expansion = document.createElement("section");
					expansion.id = "customStateInline";
					expansion.className = "inlineBox customStateInline";
					expansion.setAttribute("aria-labelledby", "customStateTitle");
					expansion.innerHTML = '<div class="inlineCard"><div class="customStateHeader"><strong id="customStateTitle">自定义魔方复原状态</strong><button id="closeCustomStateBtn" class="button secondary small" type="button">收起</button></div><div id="customCubeStage" class="customCubeStage"></div><p id="customStateHint" class="customStateHint"></p><div class="customStateActions"><button id="showAllStickersBtn" class="button secondary" type="button">显示全部</button><div class="customStateActionRight"><button id="cancelCustomStateBtn" class="button secondary" type="button">取消</button><button id="confirmCustomStateBtn" class="button" type="button">确认</button></div></div></div>';
					host.appendChild(expansion);
					anchor.setAttribute("aria-expanded", "true");
					var stage = expansion.querySelector("#customCubeStage");
					var closeBox = function() {
						document.removeEventListener("keydown", onKeyDown, true);
						self.closeInlineExpansion(expansion, anchor, function() {
							self.customCubeScene = null;
							self.customCubeDraftMask = null;
							self.customStickerGroups = null;
						});
					};
					var onKeyDown = function(event) {
						if (event.key === "Escape") {
							event.preventDefault();
							event.stopPropagation();
							closeBox();
						}
					};
					document.addEventListener("keydown", onKeyDown, true);
					expansion.querySelector("#closeCustomStateBtn").addEventListener("click", closeBox);
					expansion.querySelector("#cancelCustomStateBtn").addEventListener("click", closeBox);
					expansion.querySelector("#showAllStickersBtn").addEventListener("click", function() {
						self.customCubeDraftMask = {};
						self.applyHiddenMask(self.customCubeScene, self.customCubeDraftMask);
						self.updateCustomStateHint();
					});
					expansion.querySelector("#confirmCustomStateBtn").addEventListener("click", function() {
						self.hiddenStickerMask = self.cloneStickerMask(self.customCubeDraftMask);
						self.applyHiddenMask(self.twistyScene, self.hiddenStickerMask);
						if (typeof self.setActiveGroupCustomMask === "function") {
							self.setActiveGroupCustomMask(self.hiddenStickerMask);
						}
						self.syncThumbMask();
						closeBox();
					});
					requestAnimationFrame(function() {
						expansion.classList.add("isOpen");
						self.customCubeScene = new twistyjs.TwistyScene();
						stage.appendChild(self.customCubeScene.getDomElement());
						self.customCubeScene.initializeTwisty({
							type: "cube",
							dimension: self.cubeDimension,
							stickerWidth: 1.72,
							scale: 0.96,
							allowDragging: false,
							faceColors: [0xffffff, 0xf05a3b, 0x2dbb70, 0xffd447, 0xff941f, 0x2f69df]
						});
						self.prepareStickerScene(self.customCubeScene);
						if (self.orientationMoves.length > 0) {
							var orientTwistyMoves = [];
							for (var oi = 0; oi < self.orientationMoves.length; oi++) {
								var om = self.normalizeMove(self.orientationMoves[oi]);
								if (om) {
									om = self.mapManualMove(om);
									orientTwistyMoves.push(om.twisty);
								}
							}
							if (orientTwistyMoves.length > 0) {
								self.customCubeScene.applyMoves(orientTwistyMoves);
							}
						}
						self.customStickerGroups = self.buildStickerGroups(self.customCubeScene);
						if (self.twistyScene.getViewState && self.customCubeScene.setViewState) {
							self.customCubeScene.setViewState(self.twistyScene.getViewState());
						}
						self.applyHiddenMask(self.customCubeScene, self.customCubeDraftMask);
						if (self.seamlessMode) {
							self.applySeamlessMode(self.customCubeScene, true);
						}
						self.bindCustomCubeDrag(stage);
						self.resizeTwisty();
						self.updateCustomStateHint();
					});
				},
				bindCustomCubeDrag: function(stage) {
					var self = this;
					var drag = { active: false, moved: false, x: 0, y: 0, yaw: this.viewYaw, pitch: this.viewPitch, currentYaw: this.viewYaw, currentPitch: this.viewPitch };
					stage.addEventListener("pointerdown", function(event) {
						if (event.button !== 0 || !self.customCubeScene) {
							return;
						}
						drag.active = true;
						drag.moved = false;
						drag.x = event.clientX;
						drag.y = event.clientY;
						drag.yaw = drag.currentYaw;
						drag.pitch = drag.currentPitch;
						stage.setPointerCapture(event.pointerId);
						event.preventDefault();
					});
					stage.addEventListener("pointermove", function(event) {
						if (!drag.active) {
							return;
						}
						var dx = event.clientX - drag.x;
						var dy = event.clientY - drag.y;
						if (!drag.moved && Math.sqrt(dx * dx + dy * dy) < 5) {
							return;
						}
						drag.moved = true;
						stage.classList.add("isDragging");
						var rect = stage.getBoundingClientRect();
						var scale = (Math.PI / 4) / Math.max(140, Math.min(rect.width, rect.height) * 0.45);
						drag.currentYaw = drag.yaw - dx * scale;
						drag.currentPitch = drag.pitch + dy * scale;
						var length = Math.sqrt(drag.currentYaw * drag.currentYaw + drag.currentPitch * drag.currentPitch);
						var limit = Math.PI / 4;
						if (length > limit) {
							drag.currentYaw = drag.currentYaw / length * limit;
							drag.currentPitch = drag.currentPitch / length * limit;
						}
						self.customCubeScene.setViewDrag(drag.currentYaw, drag.currentPitch);
						event.preventDefault();
					});
					var finish = function(event) {
						if (!drag.active) {
							return;
						}
						drag.active = false;
						stage.classList.remove("isDragging");
						try {
							stage.releasePointerCapture(event.pointerId);
						} catch (error) {
						}
						if (!drag.moved && self.customCubeScene && self.customCubeScene.getStickerAt) {
							var hit = self.customCubeScene.getStickerAt(event.clientX, event.clientY);
							var twisty = self.customCubeScene.getTwisty();
							if (hit && twisty && twisty.cubePieces[hit.faceIndex]) {
								var sticker = twisty.cubePieces[hit.faceIndex][hit.stickerIndex][1];
								self.toggleStickerGroup(sticker._customFaceletIndex);
							}
						}
					};
					stage.addEventListener("pointerup", finish);
					stage.addEventListener("pointercancel", finish);
				},

				syncConnectionUi: function() {
					if (this.elements.connectBtn) {
						if (this.connected) {
							this.setConnectLabel(this.deviceName ? this.deviceName : "已连接");
							this.elements.connectBtn.classList.add("isActive");
						} else {
							this.setConnectLabel("连接魔方");
							this.elements.connectBtn.classList.remove("isActive");
						}
					}
					if (this.elements.deviceName) {
						this.setDevice(this.deviceName, this.batteryLevel);
					}
				},

				loadFormulaEntries: function() {
					try {
						var saved = storageManager.getJson("smartCubeFormulaEntries", []);
						var self = this;
						this.formulaEntries = Array.isArray(saved) ? saved.map(function(item) {
							var moves = Array.isArray(item.moves) ? item.moves : [];
							var alg = item.alg || moves.join(" ");
							var compressedAlg = self.compressAlgText(alg);
							return {
								id: item.id || String(Date.now() + Math.random()),
								name: item.name || "",
								alg: compressedAlg,
								moves: compressedAlg ? self.parseMoveSequence(compressedAlg) : [],
								editingMoves: false
							};
						}) : [];
					} catch (error) {
						this.formulaEntries = [];
					}
				},

				saveFormulaEntries: function() {
					var data = this.formulaEntries.map(function(item) {
						return {
							id: item.id,
							name: item.name || "",
							alg: item.alg || (item.moves || []).join(""),
							moves: item.moves || []
						};
					});
					storageManager.setJson("smartCubeFormulaEntries", data);
					if (this.markDataDirty) {
						this.markDataDirty();
					}
				},

				loadPracticeStats: function() {
					var saved = storageManager.getJson(PRACTICE_STATS_KEY, null);
					if (!saved) {
						this.practiceStats = { schemaVersion: 3, groups: {}, solveDetectionMode: 2 };
					} else if (saved.schemaVersion === 3 && saved.groups) {
						this.practiceStats = saved;
						this.practiceStats.solveDetectionMode = Number(saved.solveDetectionMode) === 1 ? 1 : 2;
					} else {
						var groupId = (typeof this.getActiveGroupId === 'function') ? this.getActiveGroupId() : 'lib_default';
						this.practiceStats = {
							schemaVersion: 3,
							groups: {}
						};
						if (saved.solveTimes) {
							this.practiceStats.groups[groupId] = { solveTimes: saved.solveTimes };
						}
						this.savePracticeStats();
					}
					this.solveDetectionMode = Number(this.practiceStats.solveDetectionMode) === 1 ? 1 : 2;
					var groupData = this.getPracticeData();
					this.formulaSolveTimes = groupData.solveTimes;
				},

				savePracticeStats: function() {
					this.practiceStats.schemaVersion = 3;
					storageManager.setJson(PRACTICE_STATS_KEY, this.practiceStats);
					if (this.markDataDirty) {
						this.markDataDirty();
					}
				},

				getPracticeData: function() {
					var gid = (typeof this.getActiveGroupId === 'function') ? this.getActiveGroupId() : 'lib_default';
					if (!this.practiceStats.groups) this.practiceStats.groups = {};
					if (!this.practiceStats.groups[gid]) {
						this.practiceStats.groups[gid] = { solveTimes: {} };
					}
					return this.practiceStats.groups[gid];
				},

				clearMaker: function() {
					this.formulaEntries = [];
					this.formulaExportTextOverride = "";
					this.activeFormulaId = null;
					this.isRecordingFormula = false;
					this.formulaOrganizeMode = false;
					this.dragFormulaId = null;
					this.saveFormulaEntries();
				},

				loadFormulaLibraries: function() {
					var self = this;
					if (this.formulaLibraryLoaded) {
						this.renderLibs();
						return;
					}
					if (this.formulaLibraryLoading) {
						return;
					}
					this.formulaLibraryLoading = true;
					this.renderLibs();
					fetch("assets/DB.txt", { cache: "no-store" }).then(function(response) {
						if (!response.ok) {
							throw new Error("HTTP " + response.status);
						}
						return response.arrayBuffer();
					}).then(function(buffer) {
						var text = self.decodeTextBuffer(buffer);
						self.formulaLibraries = self.parseLibText(text);
						self.formulaLibrarySelections = {};
						self.formulaLibraryLoaded = true;
						self.formulaLibraryLoading = false;
						self.renderLibs();
					}).catch(function(error) {
						self.formulaLibraryLoading = false;
						if (self.elements.libraryStatus) {
							self.elements.libraryStatus.textContent = "读取公式库失败: " + String(error && error.message || error);
						}
						if (self.elements.libraryList) {
							self.elements.libraryList.innerHTML = '<div class="libraryEmpty">请检查 assets/DB.txt</div>';
						}
					});
				},

				parseLibText: function(text) {
					var source = String(text || "");
					var headerPattern = /<([^\/<>]+)>/g;
					var headers = [];
					var match;
					while ((match = headerPattern.exec(source))) {
						headers.push({
							name: match[1].trim(),
							headerStart: match.index,
							contentStart: headerPattern.lastIndex
						});
					}
					if (headers.length === 0) {
						return [this.buildFormulaLibrary("公式库", source, 0)];
					}
					var libraries = [];
					for (var i = 0; i < headers.length; i++) {
						var nextStart = i + 1 < headers.length ? headers[i + 1].headerStart : source.length;
						libraries.push(this.buildFormulaLibrary(headers[i].name || "公式库 " + (i + 1), source.slice(headers[i].contentStart, nextStart), i));
					}
					return libraries;
				},

				buildFormulaLibrary: function(name, raw, index) {
					var parsed = this.parseFormulaDefs(raw);
					var libraryId = "library-" + index;
					return {
						id: libraryId,
						name: name,
						skipped: parsed.skipped,
						formulas: parsed.formulas.map(function(state, stateIndex) {
							return {
								id: libraryId + "-formula-" + stateIndex,
								name: state.name,
								alg: state.alg,
								moves: state.moves
							};
						})
					};
				},

				bindLibList: function() {
					var self = this;
					if (!this.elements.libraryList || this.elements.libraryList.dataset.smartBound) {
						return;
					}
					this.elements.libraryList.dataset.smartBound = "1";
					this.elements.libraryList.addEventListener("click", function(event) {
						if (event.target.closest(".smartCheck")) {
							return;
						}
						var header = event.target.closest("[data-library-toggle]");
						if (header) {
							self.toggleFormulaLibrary(header.getAttribute("data-library-toggle"));
							return;
						}
						var row = event.target.closest("[data-formula-row]");
						if (row) {
							self.toggleFormulaPick(row.getAttribute("data-formula-row"));
						}
					});
					this.elements.libraryList.addEventListener("change", function(event) {
						var libraryInput = event.target.closest("[data-library-check]");
						if (libraryInput) {
							self.setLibrarySelection(libraryInput.getAttribute("data-library-check"), libraryInput.checked);
							return;
						}
						var formulaInput = event.target.closest("[data-formula-check]");
						if (formulaInput) {
							self.setFormulaSelection(formulaInput.getAttribute("data-formula-check"), formulaInput.checked);
						}
					});
				},

				toggleFormulaLibrary: function(libraryId) {
					this.expandedFormulaLibraries[libraryId] = !this.expandedFormulaLibraries[libraryId];
					this.renderLibs();
				},

				findFormulaLibrary: function(libraryId) {
					for (var i = 0; i < this.formulaLibraries.length; i++) {
						if (this.formulaLibraries[i].id === libraryId) {
							return this.formulaLibraries[i];
						}
					}
					return null;
				},

				findLibraryFormula: function(formulaId) {
					for (var i = 0; i < this.formulaLibraries.length; i++) {
						var formulas = this.formulaLibraries[i].formulas || [];
						for (var j = 0; j < formulas.length; j++) {
							if (formulas[j].id === formulaId) {
								return formulas[j];
							}
						}
					}
					return null;
				},

				setLibrarySelection: function(libraryId, checked) {
					var library = this.findFormulaLibrary(libraryId);
					if (!library) {
						return;
					}
					(library.formulas || []).forEach(function(formula) {
						if (checked) {
							this.formulaLibrarySelections[formula.id] = true;
						} else {
							delete this.formulaLibrarySelections[formula.id];
						}
					}, this);
					this.renderLibs();
				},

				setFormulaSelection: function(formulaId, checked) {
					if (!this.findLibraryFormula(formulaId)) {
						return;
					}
					if (checked) {
						this.formulaLibrarySelections[formulaId] = true;
					} else {
						delete this.formulaLibrarySelections[formulaId];
					}
					this.renderLibs();
				},

				toggleFormulaPick: function(formulaId) {
					this.setFormulaSelection(formulaId, !this.formulaLibrarySelections[formulaId]);
				},

				getLibPickState: function(library) {
					var formulas = library && library.formulas || [];
					var selected = 0;
					for (var i = 0; i < formulas.length; i++) {
						if (this.formulaLibrarySelections[formulas[i].id]) {
							selected++;
						}
					}
					return {
						total: formulas.length,
						selected: selected,
						checked: formulas.length > 0 && selected === formulas.length,
						indeterminate: selected > 0 && selected < formulas.length
					};
				},

				getPickedLibFormulas: function() {
					var selected = [];
					for (var i = 0; i < this.formulaLibraries.length; i++) {
						var formulas = this.formulaLibraries[i].formulas || [];
						for (var j = 0; j < formulas.length; j++) {
							if (this.formulaLibrarySelections[formulas[j].id]) {
								selected.push(formulas[j]);
							}
						}
					}
					return selected;
				},

				buildLibExport: function() {
					var selected = this.getPickedLibFormulas();
					return selected.map(function(formula) {
						return formula.name + ":" + formula.alg + ";";
					}).join("\n");
				},

				renderLibs: function() {
					if (!this.elements.libraryList) {
						return;
					}
					this.syncLibStatus();
					if (this.formulaLibraryLoading && this.formulaLibraries.length === 0) {
						this.elements.libraryList.innerHTML = '<div class="libraryEmpty">正在读取 assets/DB.txt</div>';
						return;
					}
					if (!this.formulaLibraries.length) {
						this.elements.libraryList.innerHTML = '<div class="libraryEmpty">未读取到公式库</div>';
						return;
					}
					var self = this;
					this.elements.libraryList.innerHTML = this.formulaLibraries.map(function(library) {
						var expanded = !!self.expandedFormulaLibraries[library.id];
						var state = self.getLibPickState(library);
						var countText = state.selected + "/" + state.total;
						var skippedText = library.skipped ? "，跳过 " + library.skipped + " 条" : "";
						var formulasHtml = (library.formulas || []).map(function(formula) {
							return '<div class="libraryFormulaRow" data-formula-row="' + self.escapeAttr(formula.id) + '"><div><span class="libraryFormulaName">' + self.escapeHtml(formula.name) + '</span><span class="libraryFormulaAlg">' + self.escapeHtml(formula.alg) + '</span></div><label class="smartCheck" aria-label="选择公式"><input type="checkbox" data-formula-check="' + self.escapeAttr(formula.id) + '"><span class="checkVisual"></span></label></div>';
						}).join("") || '<div class="libraryEmpty">此库没有可导入公式' + self.escapeHtml(skippedText) + '</div>';
						return '<div class="libraryItem' + (expanded ? " isExpanded" : "") + '" data-library-id="' + self.escapeAttr(library.id) + '"><div class="libraryHeader" data-library-toggle="' + self.escapeAttr(library.id) + '" aria-expanded="' + (expanded ? "true" : "false") + '"><span class="libraryToggle" aria-hidden="true"></span><div class="libraryTitle"><strong>' + self.escapeHtml(library.name) + '</strong><small>' + self.escapeHtml(countText + " 个已选" + skippedText) + '</small></div><label class="smartCheck" aria-label="选择公式库"><input type="checkbox" data-library-check="' + self.escapeAttr(library.id) + '"><span class="checkVisual"></span></label></div><div class="libraryFormulas">' + formulasHtml + '</div></div>';
					}).join("");
					this.syncLibChecks();
				},

				syncLibStatus: function() {
					var selected = this.getPickedLibFormulas().length;
					var total = 0;
					for (var i = 0; i < this.formulaLibraries.length; i++) {
						total += (this.formulaLibraries[i].formulas || []).length;
					}
					if (this.elements.confirmLibraryImportBtn) {
						this.elements.confirmLibraryImportBtn.disabled = selected === 0;
					}
					if (!this.elements.libraryStatus) {
						return;
					}
					if (this.formulaLibraryLoading) {
						this.elements.libraryStatus.textContent = "正在读取公式库";
					} else if (!this.formulaLibraryLoaded) {
						this.elements.libraryStatus.textContent = "等待读取公式库";
					} else if (total === 0) {
						this.elements.libraryStatus.textContent = "未读取到可导入公式";
					} else {
						this.elements.libraryStatus.textContent = "已读取 " + this.formulaLibraries.length + " 个库，已选 " + selected + " / " + total + " 个公式";
					}
				},

				syncLibChecks: function() {
					var self = this;
					this.elements.libraryList.querySelectorAll("[data-library-check]").forEach(function(input) {
						var library = self.findFormulaLibrary(input.getAttribute("data-library-check"));
						var state = self.getLibPickState(library);
						input.checked = state.checked;
						input.indeterminate = state.indeterminate;
						input.disabled = state.total === 0;
						input.setAttribute("aria-checked", state.indeterminate ? "mixed" : state.checked ? "true" : "false");
					});
					this.elements.libraryList.querySelectorAll("[data-formula-check]").forEach(function(input) {
						input.checked = !!self.formulaLibrarySelections[input.getAttribute("data-formula-check")];
					});
				},

				importPickedLibs: function() {
					var text = this.buildLibExport();
					if (!text) {
						if (this.elements.libraryStatus) {
							this.elements.libraryStatus.textContent = "请先选择要导入的公式";
						}
						return;
					}
					var selectedCount = Object.keys(this.formulaLibrarySelections || {}).filter(function(k) { return this.formulaLibrarySelections[k]; }.bind(this)).length;
					this.addInputText(text);
					this.switchMode("learn");
					this.fillFormulaInputText(this.formulaInputText, false, false);
					this.importFormulaText(this.formulaInputText, "library");
					if (selectedCount > 0) {
						this.showToast("已添加 " + selectedCount + " 个公式到状态列表");
					}
				},

				openLibExport: function(anchor) {
					var text = this.buildLibExport();
					if (!text) {
						if (this.elements.libraryStatus) {
							this.elements.libraryStatus.textContent = "请先选择要导出的公式";
						}
						return;
					}
					this.openFormulaExport({
						text: text,
						title: "导出公式",
						anchor: anchor,
						onSave: function(editedText) {
							this.suppressLibraryTransferOnce = true;
							this.switchMode("learn");
							var appended = this.addInputText(editedText);
							this.fillFormulaInputText(this.formulaInputText, false, false);
							if (appended) {
								this.importFormulaText(this.formulaInputText, "library");
								var selectedCount = Object.keys(this.formulaLibrarySelections || {}).filter(function(k) { return this.formulaLibrarySelections[k]; }.bind(this)).length;
								if (selectedCount > 0) {
									this.showToast("已添加 " + selectedCount + " 个公式到状态列表");
								}
							}
						}.bind(this)
					});
				},

				bindFormulaList: function() {
					var self = this;
					this.elements.draftList.dataset.smartBound = "1";
					this.elements.draftList.addEventListener("click", function(event) {
						var add = event.target.closest("[data-formula-add]");
						if (add) {
							self.addFormulaEntry();
							return;
						}
						var organize = event.target.closest("[data-formula-organize]");
						if (organize) {
							self.toggleFormulaOrganize();
							return;
						}
						var remove = event.target.closest("[data-formula-delete]");
						if (remove) {
							self.deleteFormulaEntry(remove.getAttribute("data-formula-delete"));
							return;
						}
						var action = event.target.closest("[data-formula-action]");
						if (!action) {
							return;
						}
						var id = action.getAttribute("data-formula-id");
						var type = action.getAttribute("data-formula-action");
						if (type === "record") {
							self.startFormulaRecording(id);
						} else if (type === "stop") {
							self.stopFormulaRecording();
						} else if (type === "edit") {
							self.editFormulaMoves(id);
						}
					});
					this.elements.draftList.addEventListener("dragstart", function(event) {
						var handle = event.target.closest("[data-formula-drag-id]");
						if (!handle || !self.formulaOrganizeMode) {
							return;
						}
						self.dragFormulaId = handle.getAttribute("data-formula-drag-id");
						var row = handle.closest("[data-formula-row]");
						if (row) {
							row.classList.add("isDragging");
						}
						if (event.dataTransfer) {
							event.dataTransfer.effectAllowed = "move";
							event.dataTransfer.setData("text/plain", self.dragFormulaId);
						}
					});
					this.elements.draftList.addEventListener("dragover", function(event) {
						var row = event.target.closest("[data-formula-row]");
						if (!row || !self.formulaOrganizeMode || !self.dragFormulaId || row.getAttribute("data-formula-row") === self.dragFormulaId) {
							return;
						}
						event.preventDefault();
						self.markDropPos(row, event.clientY);
						if (event.dataTransfer) {
							event.dataTransfer.dropEffect = "move";
						}
					});
					this.elements.draftList.addEventListener("dragleave", function(event) {
						var row = event.target.closest("[data-formula-row]");
						if (row && !row.contains(event.relatedTarget)) {
							row.classList.remove("dropBefore", "dropAfter");
						}
					});
					this.elements.draftList.addEventListener("drop", function(event) {
						var row = event.target.closest("[data-formula-row]");
						if (!row || !self.formulaOrganizeMode || !self.dragFormulaId) {
							return;
						}
						event.preventDefault();
						var targetId = row.getAttribute("data-formula-row");
						var rect = row.getBoundingClientRect();
						self.moveFormulaEntry(self.dragFormulaId, targetId, event.clientY > rect.top + rect.height / 2);
						self.clearDropMarks();
					});
					this.elements.draftList.addEventListener("dragend", function() {
						self.dragFormulaId = null;
						self.clearDropMarks();
					});
					this.elements.draftList.addEventListener("input", function(event) {
						var nameInput = event.target.closest("[data-formula-name]");
						if (nameInput) {
							var entry = self.getFormulaEntry(nameInput.getAttribute("data-formula-name"));
							if (entry) {
								self.formulaExportTextOverride = "";
								entry.name = nameInput.value;
								self.saveFormulaEntries();
							}
							return;
						}
						var movesInput = event.target.closest("[data-formula-moves]");
						if (movesInput) {
							var moveEntry = self.getFormulaEntry(movesInput.getAttribute("data-formula-moves"));
							if (moveEntry) {
								var parsedMoves = self.readMovesInput(movesInput);
								movesInput.setCustomValidity(parsedMoves.valid === false ? parsedMoves.error : "");
								if (parsedMoves.valid !== false) {
									self.formulaExportTextOverride = "";
									moveEntry.alg = parsedMoves.alg;
									moveEntry.moves = parsedMoves.moves;
									self.saveFormulaEntries();
								}
							}
						}
					});
					this.elements.draftList.addEventListener("keydown", function(event) {
						if (event.key !== "Enter") {
							return;
						}
						var nameInput = event.target.closest("[data-formula-name]");
						if (nameInput) {
							event.preventDefault();
							var row = nameInput.closest("[data-formula-row]");
							var action = row && row.querySelector("[data-formula-action='record']");
							if (action) {
								self.startFormulaRecording(action.getAttribute("data-formula-id"));
							}
						}
						var movesInput = event.target.closest("[data-formula-moves]");
						if (movesInput) {
							event.preventDefault();
							var entry = self.getFormulaEntry(movesInput.getAttribute("data-formula-moves"));
							if (entry) {
								self.formulaExportTextOverride = "";
								var parsedMoves = self.readMovesInput(movesInput);
								if (parsedMoves.valid === false) {
									movesInput.setCustomValidity(parsedMoves.error);
									movesInput.reportValidity();
									return;
								}
								entry.alg = parsedMoves.alg;
								entry.moves = parsedMoves.moves;
								entry.editingMoves = false;
								if (self.activeFormulaId === entry.id) {
									self.activeFormulaId = null;
									self.isRecordingFormula = false;
								}
								self.saveFormulaEntries();
								self.renderFormulaList();
							}
						}
					});
					this.renderFormulaList();
				},

				addFormulaEntry: function() {
					if (this.isRecordingFormula) {
						return;
					}
					this.formulaOrganizeMode = false;
					var draft = null;
					for (var i = 0; i < this.formulaEntries.length; i++) {
						if (!this.formulaEntries[i].name && !this.formulaEntries[i].alg && (!this.formulaEntries[i].moves || this.formulaEntries[i].moves.length === 0)) {
							draft = this.formulaEntries[i];
							break;
						}
					}
					if (draft) {
						this.renderFormulaList();
						this.focusFormulaName(draft.id);
						return;
					}
					var entry = {
						id: String(Date.now()) + "-" + Math.floor(Math.random() * 100000),
						name: "",
						alg: "",
						moves: [],
						editingMoves: false
					};
					this.formulaExportTextOverride = "";
					this.formulaEntries.push(entry);
					this.saveFormulaEntries();
					this.renderFormulaList();
					this.focusFormulaName(entry.id);
				},

				focusFormulaName: function(id) {
					if (!this.elements.draftList) {
						return;
					}
					var input = this.elements.draftList.querySelector('[data-formula-name="' + id + '"]');
					if (input) {
						input.focus();
					}
				},

				getFormulaEntry: function(id) {
					for (var i = 0; i < this.formulaEntries.length; i++) {
						if (this.formulaEntries[i].id === id) {
							return this.formulaEntries[i];
						}
					}
					return null;
				},

				renderFormulaList: function() {
					if (!this.elements.draftList) {
						return;
					}
					var self = this;
					this.elements.draftList.className = "draftList" + (this.formulaOrganizeMode ? " isOrganizing" : "");
					var html = this.formulaEntries.map(function(entry) {
						return self.getFormulaRowHtml(entry);
					}).join("");
					var addDisabled = this.isRecordingFormula ? " disabled" : "";
					var organizeDisabled = this.isRecordingFormula || this.formulaEntries.length === 0 ? " disabled" : "";
					html += '<div class="draftListActions">';
					html += '<button class="formulaAddButton" type="button" data-formula-add aria-label="新增公式" title="新增公式"' + addDisabled + '></button>';
					html += '<button class="button secondary formulaOrganizeButton' + (this.formulaOrganizeMode ? " isActive" : "") + '" type="button" data-formula-organize aria-label="' + (this.formulaOrganizeMode ? "完成整理" : "整理") + '" title="' + (this.formulaOrganizeMode ? "完成整理" : "整理") + '"' + organizeDisabled + '></button>';
					html += '</div>';
					this.elements.draftList.innerHTML = html;
				},

				getFormulaRowHtml: function(entry) {
					var isRecording = this.activeFormulaId === entry.id && this.isRecordingFormula;
					var action = isRecording ? "stop" : entry.moves && entry.moves.length ? "edit" : "record";
					var movesText = this.getFormulaDisplayText(entry);
					var organize = this.formulaOrganizeMode;
					var readonly = organize ? " readonly" : "";
					var actionDisabled = organize ? " disabled" : "";
					var dragHandle = organize ? '<button class="formulaDragHandle" type="button" draggable="true" data-formula-drag-id="' + this.escapeAttr(entry.id) + '" aria-label="拖动排序"></button>' : "";
					var deleteButton = organize ? '<button class="formulaDeleteButton" type="button" data-formula-delete="' + this.escapeAttr(entry.id) + '" aria-label="删除公式"></button>' : "";
					var content = entry.editingMoves ?
						'<input class="formulaAlgInput" data-formula-moves="' + this.escapeAttr(entry.id) + '" value="' + this.escapeAttr(movesText) + '" spellcheck="false"' + readonly + '>' :
						'<div class="formulaTrackText ' + (movesText ? "hasMoves" : "") + '">' + this.escapeHtml(isRecording ? "录制中：" + movesText : movesText || "等待录制") + '</div>';
					return '<div class="formulaRow' + (organize ? " isOrganizing" : "") + '" data-formula-row="' + this.escapeAttr(entry.id) + '">' + dragHandle + '<input class="formulaNameInput" data-formula-name="' + this.escapeAttr(entry.id) + '" value="' + this.escapeAttr(entry.name || "") + '" placeholder="公式名"' + readonly + '><div class="formulaTrack"><button class="formulaIconButton" type="button" data-formula-id="' + this.escapeAttr(entry.id) + '" data-formula-action="' + action + '" aria-label="' + (action === "record" ? "开始录制" : action === "stop" ? "停止录制" : "编辑公式") + '"' + actionDisabled + '></button>' + content + '</div>' + deleteButton + '</div>';
				},

				toggleFormulaOrganize: function() {
					if (this.isRecordingFormula) {
						return;
					}
					this.formulaOrganizeMode = !this.formulaOrganizeMode;
					this.dragFormulaId = null;
					if (this.formulaOrganizeMode) {
						this.formulaEntries.forEach(function(entry) {
							entry.editingMoves = false;
						});
					}
					this.renderFormulaList();
				},

				deleteFormulaEntry: function(id) {
					if (this.isRecordingFormula) {
						return;
					}
					var entry = this.getFormulaEntry(id);
					if (!entry) {
						return;
					}
					this.formulaEntries = this.formulaEntries.filter(function(item) {
						return item.id !== id;
					});
					this.formulaExportTextOverride = "";
					this.saveFormulaEntries();
					if (this.formulaEntries.length === 0) {
						this.formulaOrganizeMode = false;
					}
					this.renderFormulaList();
				},

				markDropPos: function(row, clientY) {
					if (this.elements.draftList) {
						this.elements.draftList.querySelectorAll(".formulaRow").forEach(function(item) {
							item.classList.remove("dropBefore", "dropAfter");
						});
					}
					var rect = row.getBoundingClientRect();
					row.classList.add(clientY > rect.top + rect.height / 2 ? "dropAfter" : "dropBefore");
				},

				clearDropMarks: function() {
					if (!this.elements.draftList) {
						return;
					}
					this.elements.draftList.querySelectorAll(".formulaRow").forEach(function(row) {
						row.classList.remove("isDragging", "dropBefore", "dropAfter");
					});
				},

				moveFormulaEntry: function(dragId, targetId, insertAfter) {
					if (!dragId || !targetId || dragId === targetId) {
						return;
					}
					var fromIndex = this.formulaEntries.findIndex(function(item) {
						return item.id === dragId;
					});
					if (fromIndex < 0) {
						return;
					}
					var moving = this.formulaEntries.splice(fromIndex, 1)[0];
					var toIndex = this.formulaEntries.findIndex(function(item) {
						return item.id === targetId;
					});
					if (toIndex < 0) {
						this.formulaEntries.push(moving);
					} else {
						this.formulaEntries.splice(toIndex + (insertAfter ? 1 : 0), 0, moving);
					}
					this.dragFormulaId = null;
					this.formulaExportTextOverride = "";
					this.saveFormulaEntries();
					this.renderFormulaList();
				},

				startFormulaRecording: function(id) {
					var entry = this.getFormulaEntry(id);
					if (!entry || this.isRecordingFormula) {
						return;
					}
					this.formulaOrganizeMode = false;
					entry.name = (entry.name || "").trim() || "未命名公式";
					entry.alg = "";
					entry.moves = [];
					entry.editingMoves = false;
					this.formulaExportTextOverride = "";
					this.activeFormulaId = id;
					this.isRecordingFormula = true;
					this.saveFormulaEntries();
					this.renderFormulaList();
				},

				stopFormulaRecording: function() {
					if (!this.isRecordingFormula) {
						return;
					}
					var entry = this.getFormulaEntry(this.activeFormulaId);
					if (entry) {
						entry.editingMoves = false;
					}
					this.activeFormulaId = null;
					this.isRecordingFormula = false;
					this.saveFormulaEntries();
					this.renderFormulaList();
				},

				editFormulaMoves: function(id) {
					var entry = this.getFormulaEntry(id);
					if (!entry || this.isRecordingFormula) {
						return;
					}
					this.formulaOrganizeMode = false;
					this.activeFormulaId = id;
					this.isRecordingFormula = true;
					entry.editingMoves = true;
					this.saveFormulaEntries();
					this.renderFormulaList();
					var input = this.elements.draftList.querySelector('[data-formula-moves="' + id + '"]');
					if (input) {
						input.focus();
						input.select();
					}
				},

				recordFormulaMove: function(move) {
					if (!this.isRecordingFormula || !this.activeFormulaId) {
						return;
					}
					var entry = this.getFormulaEntry(this.activeFormulaId);
					var text = this.moveToStandardText(move);
					if (!entry || !text) {
						return;
					}
					this.syncEditingMovesFromInput();
					entry.moves.push(text);
					var compressedTokens = this.compressDisplayTokens(this.tokenizeMoves(entry.moves.join(" ")));
					entry.moves = compressedTokens;
					entry.alg = compressedTokens.join(" ");
					this.formulaExportTextOverride = "";
					this.saveFormulaEntries();
					if (this.elements.draftList) {
						var row = this.elements.draftList.querySelector('[data-formula-row="' + entry.id + '"] .formulaTrackText');
						if (row) {
							row.textContent = "录制中：" + this.getFormulaDisplayText(entry);
							row.classList.toggle("hasMoves", entry.moves.length > 0);
						}
						var input = this.elements.draftList.querySelector('[data-formula-moves="' + entry.id + '"]');
						if (input) {
							input.value = this.getFormulaDisplayText(entry);
						}
					}
				},

				getFormulaDisplayText: function(entry) {
					var alg = entry && entry.alg || "";
					var moves = entry && entry.moves || [];
					if (!alg && !moves.length) {
						return "";
					}
					return this.compressAlgText(alg || moves.join(" "));
				},

				moveToStandardText: function(move) {
					if (!move) {
						return "";
					}
					if (move.type === "slice") {
						return move.text || "";
					}
					if (move.type !== "face") {
						return "";
					}
					if (move.text) {
						return move.text;
					}
					var displayFace = move.wide ? move.face.toLowerCase() : move.face;
					return this.formatMoveText(displayFace, move.pow);
				},

				mapWorldFace: function(face) {
					if (!this.orientationMatrix || !this.faceNormal(face)) {
						return face;
					}
					var normal = this.matrixVectorMultiply(this.matrixTranspose(this.orientationMatrix), this.faceNormal(face));
					return this.faceFromNormal(normal) || face;
				},

				parseEditMoves: function(text) {
					return this.parseEditInput(text).moves;
				},

				parseEditInput: function(text) {
					try {
						var ast = FormulaCore.parseAlgorithm(text || "");
						var display = this.compressAlgText(FormulaCore.formatNodes(ast));
						return {
							alg: display,
							moves: display ? this.parseMoveSequence(display) : [],
							valid: true
						};
					} catch (error) {
						return { alg: "", moves: [], valid: false, error: error.message || "公式格式无效" };
					}
				},

				readMovesInput: function(input) {
					var value = input ? String(input.value || "") : "";
					if (!value.trim()) {
						return { alg: "", moves: [], valid: true };
					}
					return this.parseEditInput(value);
				},

				syncEditingMovesFromInput: function() {
					if (!this.isRecordingFormula || !this.activeFormulaId || !this.elements.draftList) {
						return;
					}
					var entry = this.getFormulaEntry(this.activeFormulaId);
					if (!entry || !entry.editingMoves) {
						return;
					}
					var input = this.elements.draftList.querySelector('[data-formula-moves="' + entry.id + '"]');
					if (!input) {
						return;
					}
					var parsedMoves = this.readMovesInput(input);
					if (parsedMoves.valid === false) {
						return;
					}
					entry.alg = parsedMoves.alg;
					entry.moves = parsedMoves.moves;
				},

				addDisplayToken: function(alg, token) {
					var tokens = this.tokenizeMoves(String(alg || "") + String(token || ""));
					return this.compressDisplayTokens(tokens).join(" ");
				},

				compressAlgText: function(alg) {
					try {
						var text = String(alg || "").trim();
						if (!text) {
							return "";
						}
						return this.compressDisplayTokens(this.tokenizeMoves(text)).join(" ");
					} catch (error) {
						return "";
					}
				},

				compressDisplayTokens: function(tokens) {
					var result = [];
					var pending = null;
					for (var i = 0; i <= tokens.length; i++) {
						var current = i < tokens.length ? this.getTokenFacePow(tokens[i]) : null;
						if (pending && (!current || current.face !== pending.face)) {
							var abs = Math.abs(pending.pow) % 4;
							if (abs !== 0) {
								result.push(pending.face + (pending.pow < 0 ? "'" : "") + (abs === 1 ? "" : String(abs)));
							}
							pending = null;
						}
						if (current) {
							if (!pending || pending.face !== current.face) {
								pending = { face: current.face, pow: current.pow };
							} else {
								pending.pow += current.pow;
							}
						}
					}
					return result;
				},

				getTokenFacePow: function(token) {
					var match = /^([URFDLBMESurfdlbmes]|[xyz])([2'3]?)$/.exec(String(token || ""));
					if (!match) {
						return null;
					}
					var face = match[1];
					return {
						face: face,
						pow: match[2] === "2" ? 2 : match[2] === "3" ? 3 : match[2] === "'" ? -1 : 1
					};
				},

				buildFormulaExport: function() {
					if (String(this.formulaExportTextOverride || "").trim()) {
						return String(this.formulaExportTextOverride || "").trim();
					}
					var self = this;
					return this.formulaEntries.filter(function(entry) {
						return entry.name && entry.moves && entry.moves.length;
					}).map(function(entry) {
						var name = self.sanitizeFormulaName(entry.name);
						var alg = self.getFormulaDisplayText(entry);
						return name + ": " + alg + ";";
					}).join("\n");
				},

				invertAlgText: function(alg, fallbackMoves) {
					try {
						return FormulaCore.invertAlgorithm(alg);
					} catch (coreError) {
						// 仅为兼容早期已保存的 moves 数据保留旧回退。
					}
					try {
						var tokens = this.tokenizeMoves(alg);
						if (tokens.length > 0) {
							var result = [];
							for (var i = tokens.length - 1; i >= 0; i--) {
								result.push(this.invertFormulaToken(tokens[i]));
							}
							return result.join("");
						}
					} catch (error) {
					}
					return this.invertFormulaMoves(fallbackMoves || []).join("");
				},

				invertFormulaToken: function(token) {
					var match = /^([URFDLBurfdlb]|[XYZMES])(['"]?)([23]?)$/.exec(String(token || ""));
					if (!match) {
						return "";
					}
					var isWide = /[urfdlb]/.test(match[1]);
					var face = match[1].toUpperCase();
					var displayFace = isWide ? face.toLowerCase() : face;
					var count = match[3] ? Number(match[3]) : 1;
					var pow = match[2] === "'" ? -count : count;
					return this.formatMoveText(displayFace, -pow);
				},

				invertFormulaMoves: function(moves) {
					var result = [];
					for (var i = moves.length - 1; i >= 0; i--) {
						var move = this.normalizeMove(moves[i]);
						if (!move) {
							continue;
						}
						if (move.type === "slice") {
							result.push(this.invertFormulaToken(move.text));
							continue;
						}
						result.push(this.formatMoveText(move.type === "orientation" ? move.text.charAt(0) : move.face, Math.abs(move.pow) === 2 ? 2 : -move.pow));
					}
					return result;
				},

				sanitizeFormulaName: function(name) {
					return String(name || "未命名公式").replace(/[\r\n]+/g, " ").replace(/:/g, "：").replace(/;/g, "；").trim() || "未命名公式";
				},

				applyFormulaExport: function(text) {
					text = String(text || "").trim();
					var parsed = this.parseFormulaDefs(text);
					var self = this;
					this.formulaEntries = parsed.formulas.map(function(state, index) {
						var alg = self.compressAlgText(state.alg);
						return {
							id: String(Date.now()) + "-" + index + "-" + Math.floor(Math.random() * 100000),
							name: state.name,
							alg: alg,
							moves: alg ? self.parseMoveSequence(alg) : [],
							editingMoves: false
						};
					});
					this.formulaExportTextOverride = text;
					this.formulaOrganizeMode = false;
					this.activeFormulaId = null;
					this.isRecordingFormula = false;
					this.saveFormulaEntries();
					this.renderFormulaList();
				},

				openFormulaExport: function(options) {
					options = options || {};
					var self = this;
					var anchor = options.anchor || this.elements.exportFormulaBtn;
					var old = document.getElementById("formulaExportInline");
					if (old) {
						this.closeInlineExpansion(old, anchor);
						return;
					}
					var host = anchor && anchor.closest(".viewSec");
					if (!host) { return; }
					var text = options.text != null ? String(options.text) : this.buildFormulaExport();
					var expansion = document.createElement("section");
					expansion.id = "formulaExportInline";
					expansion.className = "inlineBox formulaExportInline";
					expansion.innerHTML = '<div class="inlineCard"><div class="formulaExportHeader"><strong>' + this.escapeHtml(options.title || "导出公式") + '</strong><button id="closeFormulaExportBtn" class="button secondary small" type="button">收起</button></div><textarea id="formulaExportText" class="formulaExportText" spellcheck="false"></textarea><div class="formulaExportActions"><button id="saveFormulaTextBtn" class="button" type="button">保存</button><div class="formulaExportActionsRight"><button id="copyFormulaTextBtn" class="button secondary" type="button">复制文本</button><button id="downloadFormulaTxtBtn" class="button" type="button">下载 TXT</button></div></div></div>';
					host.appendChild(expansion);
					anchor.setAttribute("aria-expanded", "true");
					var textarea = expansion.querySelector("#formulaExportText");
					var copyButton = expansion.querySelector("#copyFormulaTextBtn");
					var saveButton = expansion.querySelector("#saveFormulaTextBtn");
					textarea.value = text;
					var closeBox = function() { self.closeInlineExpansion(expansion, anchor); };
					expansion.querySelector("#closeFormulaExportBtn").addEventListener("click", closeBox);
					saveButton.addEventListener("click", function() {
						var editedText = textarea.value;
						if (typeof options.onSave === "function") {
							options.onSave(editedText);
						} else {
							self.applyFormulaExport(editedText);
						}
						closeBox();
					});
					copyButton.addEventListener("click", function() {
						var originalText = copyButton.textContent;
						var markCopied = function() {
							copyButton.textContent = "已复制";
							setTimeout(function() { copyButton.textContent = originalText; }, 1200);
						};
						var fallbackCopy = function() {
							textarea.focus();
							textarea.select();
							document.execCommand("copy");
							markCopied();
						};
						if (navigator.clipboard && window.isSecureContext) {
							navigator.clipboard.writeText(textarea.value).then(markCopied).catch(fallbackCopy);
						} else {
							fallbackCopy();
						}
					});
					expansion.querySelector("#downloadFormulaTxtBtn").addEventListener("click", function() {
						var blob = new Blob([textarea.value], { type: "text/plain;charset=utf-8" });
						var url = URL.createObjectURL(blob);
						var link = document.createElement("a");
						link.href = url;
						link.download = "formulas.txt";
						link.click();
						setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
					});
					requestAnimationFrame(function() {
						expansion.classList.add("isOpen");
						textarea.focus();
					});
				},
				escapeHtml: function(value) {
					return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch) {
						return {
							"&": "&amp;",
							"<": "&lt;",
							">": "&gt;",
							"\"": "&quot;",
							"'": "&#39;"
						}[ch];
					});
				},

				escapeAttr: function(value) {
					return this.escapeHtml(value);
				},

				initTheme: function() {
					var saved = localStorage.getItem("smartCubeTheme");
					this.setTheme(saved || "dark", false);
				},

				setTheme: function(theme, save) {
					theme = theme === "dark" ? "dark" : "light";
					document.documentElement.dataset.theme = theme;
					var siteThemeBtn = document.getElementById("siteThemeToggle");
					if (siteThemeBtn) {
						siteThemeBtn.textContent = theme === "dark" ? "☀" : "☾";
					}
					if (save !== false) {
						localStorage.setItem("smartCubeTheme", theme);
						if (window.globalDataManager && window.globalDataManager.isReady()) {
							window.globalDataManager.saveThemePreference(theme).catch(function(error) {
								console.warn("[Theme] 云端主题同步失败:", error);
							});
						}
					}
				},

				installHeaderControls: function() {
					var left = document.querySelector(".siteHeaderLeft");
					var right = document.querySelector(".siteHeaderRight");
					if (left && !document.getElementById("layoutMenuToggle")) {
						var menu = document.createElement("button");
						menu.id = "layoutMenuToggle";
						menu.className = "siteHeaderBtn siteHeaderMenuBtn";
						menu.type = "button";
						menu.title = "展开左侧栏";
						menu.setAttribute("aria-label", "展开左侧栏");
						menu.setAttribute("aria-controls", "sideNav");
						menu.setAttribute("aria-expanded", "false");
						menu.innerHTML = "<span></span><span></span><span></span>";
						left.prepend(menu);
					}
					if (right && !document.getElementById("fullscreenToggle")) {
						var fullscreen = document.createElement("button");
						fullscreen.id = "fullscreenToggle";
						fullscreen.className = "siteHeaderBtn siteHeaderFullscreenBtn";
						fullscreen.type = "button";
						fullscreen.textContent = "⛶";
						fullscreen.title = "进入全屏";
						fullscreen.setAttribute("aria-label", "进入全屏");
						fullscreen.setAttribute("aria-pressed", "false");
						var theme = document.getElementById("siteThemeToggle");
						var donate = document.getElementById("donateEntry");
						if (theme && donate) {
							right.insertBefore(donate, theme);
							right.insertBefore(fullscreen, theme);
						} else if (theme) {
							right.insertBefore(fullscreen, theme);
						} else {
							right.prepend(fullscreen);
						}
					}
				},

				initSiteHeader: function() {
					var self = this;
					this.cloudDataDirty = false;
					this.cloudApplyingDownload = false;

					this.markDataDirty = function() {
						if (this.cloudApplyingDownload) return;
						if (window._siteNavApplyingCloudData) return;
						this.cloudDataDirty = true;
						if (typeof window._siteNavSetDirty === "function") {
							window._siteNavSetDirty(true);
						}
					};

					this.markDataClean = function() {
						this.cloudDataDirty = false;
						if (typeof window._siteNavSetDirty === "function") {
							window._siteNavSetDirty(false);
						}
					};

					this.reloadDataFromStorage = function() {
					this.cloudApplyingDownload = true;
					window._siteNavApplyingCloudData = true;
					try {
						if (typeof this.reloadMemoryData === "function") {
							this.reloadMemoryData();
						}
						this.loadFormulaEntries();
						this.loadPracticeStats();
						this.renderFormulaList();
						if (typeof this.getActiveGroupPlanText === 'function') {
							this.formulaInputText = this.getActiveGroupPlanText();
						} else {
							this.formulaInputText = this.getActiveLibraryPlanText ? this.getActiveLibraryPlanText() : "";
						}
						this.syncGroupFormulas();
						this.fillFormulaInputText(this.formulaInputText, false, false);
						if (this.formulaInputText && this.formulaInputText.trim()) {
							this.fillFormulaInputText(this.formulaInputText, false, false);
							this.formulaImported = this.formulaInputEntries.length > 0;
							if (!this.formulaImported) {
								this.importFormulaText(this.formulaInputText, "restore");
								this.formulaImported = true;
							}
						} else {
							this.importedFormulas = [];
							var groupData = this.getPracticeData();
							groupData.solveTimes = {};
							this.formulaSolveTimes = groupData.solveTimes;
							this.formulaImported = false;
							if (this.elements && this.elements.practiceGrid) this.elements.practiceGrid.innerHTML = '';
							this.syncPracticeToggle();
							this.updatePracticeAoTimes();
						}
						this.applyGroupMaskToCube();
						this.syncConnectionUi();
						this.syncPracticeMode();
						this.renderGroupPicker();
					} finally {
						this.cloudApplyingDownload = false;
						setTimeout(function() { window._siteNavApplyingCloudData = false; }, 0);
					}
				};

					window._siteNavReloadData = function() {
						self.reloadDataFromStorage();
					};

					var origSetJson = null;
					if (window.storageManager && typeof window.storageManager.setJson === "function") {
						origSetJson = window.storageManager.setJson.bind(window.storageManager);
						window.storageManager.setJson = function(key, value) {
							origSetJson(key, value);
							if ((key === "cube_memory_progress" || key === "smartCubeFormulaEntries" || key === "smartCubePracticeStats") && !self.cloudApplyingDownload && !window._siteNavApplyingCloudData) {
								self.markDataDirty();
							}
						};
					}

					var origSetItem = null;
					if (window.storageManager && typeof window.storageManager.setItem === "function") {
						origSetItem = window.storageManager.setItem.bind(window.storageManager);
						window.storageManager.setItem = function(key, value) {
							origSetItem(key, value);
						};
					}

					if (window.siteNav && typeof window.siteNav.init === "function") {
						window.siteNav.init(this);
					}
					this.installHeaderControls();

					window._siteNavQuickUpload = function() {
						if (!window.cloudSyncManager || !window.cloudSyncManager.isReady()) {
							return Promise.resolve({ success: false, message: "请先登录" });
						}
						if (typeof window._siteNavSetCloudStatus === "function") {
							window._siteNavSetCloudStatus("正在上传...", "");
						}
						return window.cloudSyncManager.uploadLocalToCloud().then(function(result) {
							if (typeof window._siteNavSetCloudStatus === "function") {
								window._siteNavSetCloudStatus(result.message, result.success ? "Success" : "Error");
							}
							if (result.success) {
								self.markDataClean();
							}
							return result;
						});
					};

					window._siteNavOnUploadSuccess = function() {
						self.markDataClean();
					};

					function waitForAuthAndSync() {
						var checks = 0;
						var _syncedUserId = null;
						var _notified = false;
						function finishInitialSync() {
							if (_notified) return;
							_notified = true;
							if (typeof window._siteNavInitialSyncComplete === "function") {
								window._siteNavInitialSyncComplete();
							}
						}
						function waitForCloudReady(user) {
							var readyChecks = 0;
							function checkReady() {
								readyChecks++;
								if (window.cloudSyncManager && window.cloudSyncManager.isReady()) {
									finishInitialSync();
									return;
								}
								if (readyChecks < 100) {
									setTimeout(checkReady, 100);
								} else {
									finishInitialSync();
								}
							}
							checkReady();
						}
						function handleAuthUser(user) {
							if (user) {
								if (_syncedUserId === user.id) return;
								_syncedUserId = user.id;
								_notified = false;
								if (window._siteNavConsumeAutoDownloadSkip && window._siteNavConsumeAutoDownloadSkip()) {
									self.markDataDirty();
									if (typeof window._siteNavSetCloudStatus === "function") {
										window._siteNavSetCloudStatus("已保留本地数据，可回滚或上传", "Warning");
									}
									finishInitialSync();
									return;
								}
								waitForCloudReady(user);
							} else {
								_syncedUserId = null;
								_notified = false;
								finishInitialSync();
							}
						}
						function check() {
							checks++;
							if (window.authManager) {
								window.authManager.onAuthStateChange(handleAuthUser);
								if (window.authManager.isLoggedIn()) {
									var u = window.authManager.getUser();
									if (u) handleAuthUser(u);
								} else {
									handleAuthUser(null);
								}
								return;
							}
							if (checks < 100) {
								setTimeout(check, 50);
							} else {
								finishInitialSync();
							}
						}
						check();
					}
					waitForAuthAndSync();

					self.markDataClean();
				},

				bindFormulaImport: function() {
					var self = this;
					this._planSelectedIds = {};
					this._planTextView = false;
					if (this.elements.planExpandBtn) {
						this.bindPlanPanel();
					}
					if (this.elements.showFormulaThumbs) {
						this.elements.showFormulaThumbs.checked = this.showFormulaThumbs;
						this.elements.showFormulaThumbs.addEventListener("change", function(event) {
							self.showFormulaThumbs = event.target.checked;
							self.renderFormulaCards();
						});
					}
					if (this.elements.showPracticeFormula) {
						this.elements.showPracticeFormula.checked = this.showPracticeFormula;
						this.elements.showPracticeFormula.addEventListener("change", function(event) {
							self.showPracticeFormula = event.target.checked;
							self.syncPracticeToggle();
						});
					}
					this.syncPracticeToggle();
					if (this.elements.practiceGrid) {
						this.elements.practiceGrid.addEventListener("click", function(event) {
							var button = event.target.closest("[data-state-index]");
							if (button) {
								self.applyImportedFormula(Number(button.getAttribute("data-state-index")));
							}
						});
						this.bindThumbnailDrag();
					}
				},

				bindPlanPanel: function() {
					var self = this;
					if (!this.elements.planExpandBtn || this.elements.planExpandBtn.dataset.smartBound) {
						return;
					}
					this.elements.planExpandBtn.dataset.smartBound = "1";
					this.updateSyncButton();
					this.elements.planExpandBtn.addEventListener("click", function() {
						self.togglePlanPanel();
					});
					if (this.elements.planCollapseBtn) {
						this.elements.planCollapseBtn.addEventListener("click", function() {
							self.closePlanPanel();
						});
					}
					if (this.elements.planSyncBtn) {
						this.elements.planSyncBtn.addEventListener("click", function() {
							if (typeof self.setSyncEnabled === 'function') {
								var current = self.getSyncEnabled();
								self.setSyncEnabled(!current);
								self.updateSyncButton();
								self.renderPlanFormulaList();
								self.showToast(!current ? "已开启选择同步" : "已关闭选择同步");
							}
						});
					}
					if (this.elements.planViewToggleBtn) {
						this.elements.planViewToggleBtn.addEventListener("click", function() {
							self.switchPlanView(!self._planTextView);
						});
					}
					if (this.elements.planCancelBtn) {
						this.elements.planCancelBtn.addEventListener("click", function() {
							self.closePlanPanel();
						});
					}
					if (this.elements.planImportBtn) {
						this.elements.planImportBtn.addEventListener("click", function() {
							if (self.elements.planFileInput) {
								self.elements.planFileInput.click();
							}
						});
					}
					if (this.elements.planFileInput) {
						this.elements.planFileInput.addEventListener("change", function(event) {
							self.importFiles(event.target.files);
							event.target.value = "";
						});
					}
					if (this.elements.planTextarea) {
						this.elements.planTextarea.addEventListener("input", function(event) {
							self.formulaInputText = event.target.value;
							self.saveFormulaInputText();
						});
					}
					if (this.elements.planFormulaList) {
						this.elements.planFormulaList.addEventListener("click", function(event) {
							var row = event.target.closest(".planFormulaRow");
							if (!row) return;
							var fid = row.getAttribute("data-formula-id");
							if (!fid) return;
							self._planSelectedIds[fid] = !self._planSelectedIds[fid];
							self.updatePlanCheckVisual(row, self._planSelectedIds[fid]);
							self.updatePlanCount();
						});
					}
					if (this.elements.planSaveBtn) {
						this.elements.planSaveBtn.addEventListener("click", function() {
							self.savePlanSelection();
						});
					}
					if (this.elements.planDailyCount) {
						this.elements.planDailyCount.addEventListener("change", function(event) {
							var val = Math.max(1, Math.min(999, Math.round(Number(event.target.value) || 10)));
							event.target.value = val;
							var l = typeof self.getActiveGroupId === 'function' ? (self.getAllFormulas && self.getAllFormulas()) : null;
							if (typeof self.setActiveGroupSettings === 'function') {
								self.setActiveGroupSettings({ dailyCount: val });
							}
							self.updatePlanCount();
						});
					}
				},

				togglePlanPanel: function() {
					if (!this.elements.planBox) return;
					var isOpen = this.elements.planBox.classList.contains("isOpen");
					if (isOpen) {
						this.closePlanPanel();
					} else {
						this.openPlanPanel();
					}
				},

				openPlanPanel: function() {
					if (!this.elements.planPanel || !this.elements.planExpandBtn || !this.elements.planBox) return;
					this.loadPlanSelectionState();
					this.renderPlanFormulaList();
					this.syncPlanTextarea();
					this.updateSyncButton();
					if (this.elements.planDailyCount) {
						var dailyVal = 10;
						if (typeof this.getActiveGroupSettings === 'function') {
							var s = this.getActiveGroupSettings();
							dailyVal = (s && s.dailyCount) || 10;
						}
						this.elements.planDailyCount.value = String(dailyVal);
					}
					this.elements.planBox.classList.toggle("isPracticeMode", this.isPracticeMode);
					this.elements.planBox.classList.add("isOpen");
					this.elements.planPanel.classList.add("isOpen");
					this.elements.planExpandBtn.classList.add("isOpen");
					this.elements.planExpandBtn.setAttribute("aria-expanded", "true");
					this.elements.planExpandBtn.setAttribute("tabindex", "-1");
				},

				closePlanPanel: function() {
					if (!this.elements.planPanel || !this.elements.planExpandBtn || !this.elements.planBox) return;
					this.elements.planBox.classList.remove("isOpen");
					this.elements.planPanel.classList.remove("isOpen");
					this.elements.planExpandBtn.classList.remove("isOpen");
					this.elements.planExpandBtn.setAttribute("aria-expanded", "false");
					this.elements.planExpandBtn.removeAttribute("tabindex");
					if (this._planTextView) {
						this.switchPlanView(false);
					}
				},

				switchPlanView: function(textView) {
					var self = this;
					var wasTextView = this._planTextView;
					this._planTextView = !!textView;
					if (wasTextView && !this._planTextView && typeof this.setActiveGroupPlanText === 'function') {
						var text = this.elements.planTextarea ? this.elements.planTextarea.value : this.formulaInputText;
						this.formulaInputText = text;
						this.setActiveGroupPlanText(text, true);
					}
					if (this.elements.planContentArea) {
						this.elements.planContentArea.classList.toggle("isTextView", this._planTextView);
					}
					if (this.elements.planViewToggleBtn) {
						var btn = this.elements.planViewToggleBtn;
						var listIcon = btn.querySelector(".planViewIconList");
						var textIcon = btn.querySelector(".planViewIconText");
						var textSpan = btn.querySelector(".planViewToggleText");
						btn.setAttribute("data-view", this._planTextView ? "text" : "list");
						if (listIcon) listIcon.style.display = this._planTextView ? "" : "none";
						if (textIcon) textIcon.style.display = this._planTextView ? "none" : "";
						if (textSpan) textSpan.textContent = this._planTextView ? "公式列表" : "文本编辑";
					}
					if (this._planTextView && this.elements.planTextarea) {
						this.syncPlanTextarea();
						setTimeout(function() {
							if (self.elements.planTextarea) self.elements.planTextarea.focus();
						}, 320);
					} else if (!this._planTextView) {
						this.loadPlanSelectionState();
						this.renderPlanFormulaList();
					}
				},

				syncPlanTextarea: function() {
					if (this.elements.planTextarea) {
						var text = this.formulaInputText || "";
						if (this.elements.planTextarea.value !== text) {
							this.elements.planTextarea.value = text;
						}
					}
				},

				updateSyncButton: function() {
					if (!this.elements.planSyncBtn) return;
					var enabled = true;
					if (typeof this.getSyncEnabled === 'function') {
						enabled = this.getSyncEnabled();
					}
					this.elements.planSyncBtn.classList.toggle("isActive", enabled);
				},

				loadPlanSelectionState: function() {
					this._planSelectedIds = {};
					var allFormulas = typeof this.getAllFormulas === 'function' ? this.getAllFormulas() : [];
					var syncEnabled = true;
					if (typeof this.getSyncEnabled === 'function') {
						syncEnabled = this.getSyncEnabled();
					}
					if (syncEnabled) {
						var selectedFormulas = typeof this.getActiveGroupFormulas === 'function' ? this.getActiveGroupFormulas() : [];
						selectedFormulas.forEach(function(f) {
							this._planSelectedIds[f.id] = true;
						}, this);
						allFormulas.forEach(function(f) {
							if (!(f.id in this._planSelectedIds)) {
								this._planSelectedIds[f.id] = false;
							}
						}, this);
					} else {
						var saved = typeof this.getTrainingSelectedFormulaIds === 'function' ? this.getTrainingSelectedFormulaIds() : {};
						allFormulas.forEach(function(f) {
							this._planSelectedIds[f.id] = saved[f.id] === true;
						}, this);
					}
				},

				renderPlanFormulaList: function() {
					if (!this.elements.planFormulaList) return;
					var allFormulas = typeof this.getAllFormulas === 'function' ? this.getAllFormulas() : [];
					var learnedIds = this.getLearnedFormulaIds ? this.getLearnedFormulaIds() : {};
					if (!allFormulas.length) {
						this.elements.planFormulaList.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">暂无公式，请导入或输入公式</div>';
						this.updatePlanCount();
						return;
					}
					var html = allFormulas.map(function(f) {
						var isSelected = !!this._planSelectedIds[f.id];
						var isLearned = !!(learnedIds[f.id]);
						var checkClass = isLearned ? 'isLearned' : (isSelected ? 'isSelected' : '');
						return '<div class="planFormulaRow" data-formula-id="' + this.escapeHtml(f.id) + '"><div class="planFormulaCheck ' + checkClass + '"></div><div class="planFormulaLabel"><strong>' + this.escapeHtml(f.name) + '</strong>: ' + this.escapeHtml(f.alg || f.formula || '') + '</div></div>';
					}, this).join('');
					this.elements.planFormulaList.innerHTML = html;
					this.updatePlanCount();
				},

				updatePlanCheckVisual: function(row, checked) {
					var check = row.querySelector('.planFormulaCheck');
					if (!check) return;
					var learnedIds = this.getLearnedFormulaIds ? this.getLearnedFormulaIds() : {};
					var fid = row.getAttribute("data-formula-id");
					var isLearned = !!(learnedIds[fid]);
					check.classList.remove('isLearned', 'isSelected');
					if (isLearned && checked) {
						check.classList.add('isLearned');
					} else if (checked) {
						check.classList.add('isSelected');
					}
				},

				updatePlanCount: function() {
					if (!this.elements.planCount) return;
					var allFormulas = typeof this.getAllFormulas === 'function' ? this.getAllFormulas() : [];
					var selectedCount = 0;
					for (var fid in this._planSelectedIds) {
						if (this._planSelectedIds[fid]) selectedCount++;
					}
					if (selectedCount === 0 && allFormulas.length > 0 && Object.keys(this._planSelectedIds).length === 0) {
						selectedCount = allFormulas.length;
					}
					var daily = 10;
					if (this.elements.planDailyCount) {
						daily = Math.max(1, Math.min(999, Math.round(Number(this.elements.planDailyCount.value) || 10)));
					}
					this.elements.planCount.textContent = '[' + selectedCount + ']/[' + daily + ']';
				},

				savePlanSelection: function() {
					var allFormulas = typeof this.getAllFormulas === 'function' ? this.getAllFormulas() : [];
					var syncEnabled = true;
					if (typeof this.getSyncEnabled === 'function') {
						syncEnabled = this.getSyncEnabled();
					}
					var text = this.elements.planTextarea ? this.elements.planTextarea.value : this.formulaInputText;
					if (text !== this.formulaInputText || this._planTextView) {
						this.formulaInputText = text;
						if (typeof this.setActiveGroupPlanText === 'function') {
							this.setActiveGroupPlanText(text, true);
						} else {
							this.saveFormulaInputText();
						}
						this.switchPlanView(false);
						this.showToast("公式已保存");
						return;
					}
				var selected = allFormulas.filter(function(f) {
						return this._planSelectedIds[f.id];
					}, this);
					var daily = this.elements.planDailyCount ? Math.max(1, Math.min(999, Math.round(Number(this.elements.planDailyCount.value) || 10))) : 10;
					if (typeof this.setActiveGroupSettings === 'function') {
						this.setActiveGroupSettings({ dailyCount: daily });
					}
					if (this.isMemoryMode) {
						if (selected.length === 0) {
							this.showToast("请至少选择一个公式");
							return;
						}
						if (typeof window.applyMemoryPlan === 'function') {
							window.applyMemoryPlan(selected, allFormulas);
						}
					} else {
						if (syncEnabled) {
							if (typeof this.setPlanFormulas === 'function') {
								this.setPlanFormulas(selected, allFormulas);
							}
						} else {
							if (typeof this.setTrainingSelectedFormulaIds === 'function') {
								this.setTrainingSelectedFormulaIds(this._planSelectedIds);
							}
						}
					}
					this.closePlanPanel();
					this.showToast("已保存学习计划");
					if (this.isMemoryMode && typeof window.startMemoryMode === 'function') {
						window.startMemoryMode();
					} else if (this.isPracticeMode) {
						this.syncGroupFormulas();
						this.importedFormulas = this.formulaInputEntries;
						this.formulaImported = this.formulaInputEntries.length > 0;
						this.randomBag = [];
						this.showNextState();
					}
				},

				getLearnedFormulaIds: function() {
					var ids = {};
					var allFormulas = typeof this.getAllFormulas === 'function' ? this.getAllFormulas() : [];
					if (typeof this.getFormulaProgress === 'function') {
						allFormulas.forEach(function(f) {
							var p = this.getFormulaProgress(f.id);
							if (p && p.reps && p.reps > 0) ids[f.id] = true;
						}, this);
					}
					return ids;
				},

				bindThumbnailDrag: function() {
					var self = this;
					var drag = {
						active: false,
						preview: null,
						x: 0,
						y: 0,
						yaw: 0,
						pitch: 0
					};
					this.elements.practiceGrid.addEventListener("pointerdown", function(event) {
						var preview = event.target.closest(".statePreview");
						if (!preview || event.button !== 0) {
							return;
						}
						drag.active = true;
						drag.preview = preview;
						drag.x = event.clientX;
						drag.y = event.clientY;
						drag.yaw = self.thumbnailYaw;
						drag.pitch = self.thumbnailPitch;
						preview.classList.add("isDragging");
						preview.setPointerCapture(event.pointerId);
						event.preventDefault();
					});
					this.elements.practiceGrid.addEventListener("pointermove", function(event) {
						if (!drag.active) {
							return;
						}
						var rect = drag.preview.getBoundingClientRect();
						var limit = Math.PI / 4;
						var dragSpan = Math.max(90, Math.min(rect.width, rect.height) * 0.85);
						var scale = limit / dragSpan;
						self.setThumbnailDrag(drag.yaw - (event.clientX - drag.x) * scale, drag.pitch + (event.clientY - drag.y) * scale);
						event.preventDefault();
					});
					["pointerup", "pointercancel", "pointerleave"].forEach(function(type) {
						self.elements.practiceGrid.addEventListener(type, function(event) {
							if (!drag.active) {
								return;
							}
							drag.active = false;
							if (drag.preview) {
								drag.preview.classList.remove("isDragging");
								try {
									drag.preview.releasePointerCapture(event.pointerId);
								} catch (error) {
								}
							}
							drag.preview = null;
						});
					});
				},

			setThumbnailDrag: function(yaw, pitch) {
				// 缩略图旋转不限制在 45° 内（主魔方 setViewDrag 保持原有限制不受影响）。
				this.thumbnailYaw = yaw;
				this.thumbnailPitch = pitch;
				for (var i = 0; i < this.thumbnailScenes.length; i++) {
					if (this.thumbnailScenes[i] && this.thumbnailScenes[i].setViewDrag) {
						this.thumbnailScenes[i].setViewDrag(yaw, pitch);
					}
				}
			},

			fillFormulaInputText: function(text, reveal, focus) {
				var newText = text || "";
				var changed = newText !== (this.formulaInputText || "");
				this.formulaInputText = newText;
				if (changed) {
					this.saveFormulaInputText();
				}
				var textarea = this.elements.planTextarea || this.elements.formulaTextInput;
				if (!textarea) {
					return;
				}
				textarea.value = newText;
				if (this.elements.planTextarea && this.elements.formulaTextInput && this.elements.formulaTextInput !== this.elements.planTextarea) {
					this.elements.formulaTextInput.value = newText;
				}
				if (reveal) {
					if (this.elements.textImportBox) {
						this.elements.textImportBox.classList.add("isVisible");
						if (this.elements.toggleTextImportBtn && this.elements.toggleTextImportBtn !== this.elements.planViewToggleBtn) {
							this.elements.toggleTextImportBtn.textContent = "收起文本框";
						}
					}
					if (this.elements.planPanel && this.elements.planExpandBtn) {
						this.openPlanPanel();
						this.switchPlanView(true);
					}
				}
				if (focus) {
					textarea.focus();
				}
			},

			saveInputText: function() {
				if (this.elements.formulaTextInput) {
					this.formulaInputText = this.elements.formulaTextInput.value;
					this.saveFormulaInputText();
				}
			},

			loadFormulaInputText: function() {
				if (typeof this.getActiveGroupPlanText === 'function') {
					var text = this.getActiveGroupPlanText();
					if (text) {
						this.formulaInputText = text;
						return;
					}
				}
				var old = storageManager.getItem("smartCubeStateImportText", "");
				if (old && typeof this.setActiveGroupPlanTextQuiet === 'function') {
					this.setActiveGroupPlanTextQuiet(old);
					storageManager.removeItem("smartCubeStateImportText");
					this.formulaInputText = old;
					return;
				}
				this.formulaInputText = "";
			},

			saveFormulaInputText: function() {
				var text = this.formulaInputText || "";
				if (typeof this.setActiveGroupPlanTextQuiet === 'function') {
					this.setActiveGroupPlanTextQuiet(text);
				} else if (typeof this.setActiveLibraryPlanTextQuiet === 'function') {
					this.setActiveLibraryPlanTextQuiet(text);
				}
				if (this.markDataDirty) {
					this.markDataDirty();
				}
			},

			syncGroupFormulas: function() {
				if (typeof this.getAllFormulas !== 'function') {
					if (typeof this.getActiveGroupFormulas !== 'function') return;
					var formulas = this.getActiveGroupFormulas();
					this.formulaInputEntries = formulas.map(function(f) {
						return {
							id: f.id,
							name: f.name,
							alg: f.alg,
							moves: f.moves || [],
							selected: true,
							image: f.image || null,
							customSolvedState: f.customSolvedState || null
						};
					});
					this.formulaImported = this.formulaInputEntries.length > 0;
					return;
				}
				var allFormulas = this.getAllFormulas();
				var syncEnabled = true;
				if (typeof this.getSyncEnabled === 'function') {
					syncEnabled = this.getSyncEnabled();
				}
				var entriesToUse;
				if (syncEnabled) {
					var selectedFormulas = typeof this.getActiveGroupFormulas === 'function' ? this.getActiveGroupFormulas() : allFormulas;
					entriesToUse = selectedFormulas.length ? selectedFormulas : allFormulas;
				} else {
					var trainingIds = typeof this.getTrainingSelectedFormulaIds === 'function' ? this.getTrainingSelectedFormulaIds() : {};
					var hasSelection = false;
					for (var k in trainingIds) { if (trainingIds[k]) { hasSelection = true; break; } }
					if (hasSelection) {
						entriesToUse = allFormulas.filter(function(f) { return trainingIds[f.id] === true; });
					} else {
						entriesToUse = allFormulas;
					}
				}
				this.formulaInputEntries = entriesToUse.map(function(f) {
					return {
						id: f.id,
						name: f.name,
						alg: f.alg,
						moves: f.moves || [],
						selected: true,
						image: f.image || null,
						customSolvedState: f.customSolvedState || null
					};
				});
				this.formulaImported = this.formulaInputEntries.length > 0;
			},

			applyGroupMaskToCube: function() {
				if (typeof this.getActiveGroupCustomMask !== 'function') return;
				var mask = this.getActiveGroupCustomMask();
				this.hiddenStickerMask = this.cloneStickerMask(mask || {});
				if (this.twistyScene && typeof this.applyHiddenMask === 'function') {
					this.applyHiddenMask(this.twistyScene, this.hiddenStickerMask);
				}
			},

			showGroupPicker: function(text, sourceMode) {
				var self = this;
				var groups = typeof this.getFormulaGroups === 'function' ? this.getFormulaGroups() : [];
				var currentGroupName = typeof this.getActiveGroupName === 'function' ? this.getActiveGroupName() : '当前组';
				var currentGroupId = typeof this.getActiveGroupId === 'function' ? this.getActiveGroupId() : null;
				var overlay = document.createElement('div');
				overlay.className = 'groupPicker';
				var otherGroupOptions = groups.filter(function(g) { return g.id !== currentGroupId; }).map(function(g) {
					return '<button class="button secondary formulaGroupOption" type="button" data-group-id="' + self.escapeHtml(g.id) + '">' + self.escapeHtml(g.name) + '</button>';
				}).join('');
				overlay.innerHTML = '<section class="groupPickerBox appPromptCard" role="dialog" aria-modal="true" aria-labelledby="formulaAddGroupTitle"><div class="groupPickerLead"><span class="groupPickerIcon" aria-hidden="true"></span><div><div id="formulaAddGroupTitle" class="groupPickerTitle">添加公式到公式组</div><div class="groupPickerDesc">选择这组公式的保存位置</div></div></div><div class="groupPickerActions"><button class="button formulaAddCurrent" type="button"><span>添加至当前组</span><strong>' + self.escapeHtml(currentGroupName) + '</strong></button>' + (otherGroupOptions ? '<button class="button secondary formulaAddOther" type="button" aria-expanded="false">选择其他公式组</button><div class="formulaAddOtherList" aria-hidden="true">' + otherGroupOptions + '</div>' : '') + '<button class="button ghost formulaAddCancel" type="button">取消，不导入</button></div></section>';
				var cleanup;
				if (window.AppUI) {
					cleanup = window.AppUI.mount(overlay, {
						closeSelector: ".formulaAddCancel",
						duration: 180
					});
				} else {
					document.body.appendChild(overlay);
					cleanup = function() { if (overlay.parentNode) overlay.remove(); };
				}
				function addToGroup(groupId) {
					var gid = groupId || (typeof self.getActiveGroupId === 'function' ? self.getActiveGroupId() : null);
					if (!gid) { cleanup(); return; }
					if (typeof self.appendTextToGroup === 'function') {
						self.appendTextToGroup(gid, text);
					} else {
						self.addInputText(text);
					}
					self.showToast("公式已添加到组");
					cleanup();
				}
				overlay.querySelector('.formulaAddCurrent').addEventListener('click', function() { addToGroup(null); });
				var otherButton = overlay.querySelector('.formulaAddOther');
				if (otherButton) {
					otherButton.addEventListener('click', function() {
						var list = overlay.querySelector('.formulaAddOtherList');
						var open = !list.classList.contains('isOpen');
						list.classList.toggle('isOpen', open);
						list.setAttribute('aria-hidden', open ? 'false' : 'true');
						this.setAttribute('aria-expanded', open ? 'true' : 'false');
					});
				}
				overlay.querySelectorAll('.formulaGroupOption').forEach(function(btn) {
					btn.addEventListener('click', function() {
						addToGroup(btn.getAttribute('data-group-id'));
					});
				});
				overlay.querySelector('.formulaAddCancel').addEventListener('click', cleanup);
				overlay.addEventListener('click', function(e) {
					if (e.target === overlay) cleanup();
				});
			},

			renderGroupPicker: function() {
				var textEl = document.getElementById('sharedGroupCurrentText');
				var menu = document.getElementById('sharedGroupMenu');
				var bar = document.getElementById('sharedGroupBar');
				if (!textEl || !menu) return;
				var groups = typeof this.getFormulaGroups === 'function' ? this.getFormulaGroups() : [];
				var activeId = typeof this.getActiveGroupId === 'function' ? this.getActiveGroupId() : null;
				var activeGroup = groups.find(function(g) { return g.id === activeId; });
				textEl.textContent = activeGroup ? activeGroup.name : '默认组';
				menu.innerHTML = groups.filter(function(g) { return g.id !== activeId; }).map(function(g) {
					return '<button class="memoryLibraryOption" type="button" data-group-id="' + this.escapeHtml(g.id) + '" role="menuitem">' + this.escapeHtml(g.name) + '</button>';
				}.bind(this)).join('');
				if (bar) {
					bar.classList.remove('isEditing', 'isCreating');
				}
				var nameInput = document.getElementById('sharedGroupNameInput');
				if (nameInput) nameInput.value = activeGroup ? activeGroup.name : '';
				var selector = document.getElementById('sharedGroupSelector');
				if (selector) selector.classList.remove('isOpen');
			},

				addInputText: function(text) {
					text = String(text || "").trim();
					if (!text) {
						return false;
					}
					var current = String(this.formulaInputText || "").replace(/\s+$/g, "");
					if (this.inputEndsWith(current, text)) {
						return false;
					}
					this.formulaInputText = current ? current + "\n" + text : text;
					this.saveFormulaInputText();
					return true;
				},

				inputEndsWith: function(current, text) {
					current = String(current || "").trim();
					text = String(text || "").trim();
					if (!current || !text) {
						return false;
					}
					return current === text || current.slice(-text.length - 1) === "\n" + text;
				},

				importFiles: function(files) {
					var self = this;
					var file = files && files[0];
					if (!file) {
						return;
					}
					this.syncPracticeToggle();
					file.arrayBuffer().then(function(buffer) {
						var text = self.decodeTextBuffer(buffer);
						self.fillFormulaInputText(text, false, false);
						self.importFormulaText(text, file.name);
					}).catch(function(error) {
						self.syncPracticeToggle();
					});
				},

				decodeTextBuffer: function(buffer) {
					try {
						return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
					} catch (error) {
						try {
							return new TextDecoder("gb18030").decode(buffer);
						} catch (fallbackError) {
							return new TextDecoder("utf-8").decode(buffer);
						}
					}
				},

				importFormulaText: function(text, source) {
					var result = this.parseFormulaDefs(text || "");
					var oldStates = this.importedFormulas || [];
					var currentGroupData = this.getPracticeData();
					var oldSolveTimes = source === "restore"
						? (currentGroupData.solveTimes || {})
						: (this.formulaSolveTimes || {});
					var newSolveTimes = {};
					function normalizeAlg(alg) {
						return String(alg || "").replace(/\s+/g, "").toUpperCase();
					}
					function findMatchingTimes(newState) {
						var newAlg = normalizeAlg(newState.alg);
						if (!newAlg) return null;
						for (var ki = 0; ki < oldStates.length; ki++) {
							var oldState = oldStates[ki];
							if (normalizeAlg(oldState.alg) === newAlg) {
								var oldKey = oldState.name || String(ki);
								if (oldSolveTimes[oldKey] && oldSolveTimes[oldKey].length) {
									return oldSolveTimes[oldKey];
								}
							}
						}
						var byNameKey = newState.name ? oldSolveTimes[newState.name] : null;
						if (byNameKey && byNameKey.length) return byNameKey;
						return null;
					}
					for (var si = 0; si < result.formulas.length; si++) {
						var state = result.formulas[si];
						var key = state.name || String(si);
						var migrated = findMatchingTimes(state);
						if (migrated) {
							newSolveTimes[key] = migrated.slice();
						} else if (source === "restore" && oldSolveTimes[key]) {
							newSolveTimes[key] = oldSolveTimes[key].slice();
						}
					}
					this.importedFormulas = result.formulas;
					this.formulaSolveTimes = newSolveTimes;
					currentGroupData.solveTimes = newSolveTimes;
					this.formulaImported = result.formulas.length > 0;
					var isUserImport = source !== "restore" && source !== "library";
					if (isUserImport && this.setActiveLibraryFormulas) {
						this.setActiveLibraryFormulas(result.formulas);
					}
					if (isUserImport) {
						this.formulaInputText = text || "";
						this.saveFormulaInputText();
					}
					this.renderFormulaCards();

					this.syncPracticeToggle();
					this.updatePracticeAoTimes();
					this.log("state", "import " + result.formulas.length + " from " + (source || "text"));
					if (this.isPracticeMode && result.formulas.length > 0 && source !== "restore" && source !== "library") {
						this.applyImportedFormula(0);
					}
					if (isUserImport) {
						this.savePracticeStats();
					}
				},

				parseFormulaDefs: function(text) {
					var result = FormulaCore.parseDefinitions(text);
					var self = this;
					result.formulas.forEach(function(state) {
						state.alg = self.compressAlgText(state.alg);
						state.moves = state.alg ? self.parseMoveSequence(state.alg) : [];
					});
					return result;
				},

				findFormulaDelimiter: function(entry) {
					var english = entry.indexOf(":");
					var chinese = entry.indexOf("：");
					if (english < 0) {
						return chinese;
					}
					if (chinese < 0) {
						return english;
					}
					return Math.min(english, chinese);
				},

				parseMoveSequence: function(alg) {
					var logical = FormulaCore.expandLogical(FormulaCore.parseAlgorithm(alg), false, []);
					var moves = [];
					for (var i = 0; i < logical.length; i++) {
						var expanded = this.expandSliceMoveToken(logical[i]);
						if (expanded) {
							moves = moves.concat(expanded);
							continue;
						}
						var move = this.normalizeMove(logical[i]);
						if (!move) throw new Error("bad move");
						moves.push(move.text);
					}
					return moves;
				},

				getInitialStateMoves: function(state) {
					if (!state || !state.alg) return [];
					return this.parseMoveSequence(this.invertAlgText(state.alg, state.moves || []));
				},

				formatMoves: function(alg) {
					return FormulaCore.formatNodes(FormulaCore.parseAlgorithm(alg));
				},

				tokenizeMoves: function(alg) {
					return FormulaCore.expandLogical(FormulaCore.parseAlgorithm(alg), false, []);
				},

				formatMoveToken: function(token) {
					try {
						return FormulaCore.formatNodes(FormulaCore.parseAlgorithm(token));
					} catch (error) {
						return "";
					}
				},

				normProcessMoves: function(tokens) {
					var reducedLogical = FormulaCore.reduceMoves(tokens || []);
					var expanded = [];
					for (var i = 0; i < reducedLogical.length; i++) {
						var sliceParts = this.expandSliceMoveToken(reducedLogical[i]);
						if (sliceParts) expanded = expanded.concat(sliceParts);
						else expanded.push(reducedLogical[i]);
					}
					return FormulaCore.reduceMoves(expanded);
				},

				isFormulaProcessMatch: function(actual, target) {
					return FormulaCore.sameProcess(
						this.normProcessMoves(actual),
						this.normProcessMoves(target)
					);
				},

				expandSliceMoveToken: function(token) {
					var match = /^([MES])([2']?)$/i.exec(String(token || ""));
					if (!match) {
						return null;
					}
					var baseKey = match[1].toUpperCase() + (match[2] === "'" ? "'" : "");
					var expansions = {
						M: ["R", "L'", "x'"],
						"M'": ["R'", "L", "x"],
						E: ["U", "D'", "y'"],
						"E'": ["U'", "D", "y"],
						S: ["F'", "B", "z"],
						"S'": ["F", "B'", "z'"]
					};
					if (!expansions[baseKey]) {
						return null;
					}
					if (match[2] === "2") {
						return expansions[baseKey].concat(expansions[baseKey]);
					}
					return expansions[baseKey].slice();
				},

				renderFormulaCards: function() {
					if (!this.elements.practiceGrid) {
						return;
					}
					var self = this;
					this.thumbnailScenes = [];
					this.elements.practiceGrid.innerHTML = "";
					var frag = document.createDocumentFragment();
					var pendingPreviews = [];
					this.importedFormulas.forEach(function(state, index) {
						if (self.isPracticeMode) {
							var practiceCard = document.createElement("div");
							practiceCard.className = "stateCard";
							practiceCard.setAttribute("role", "button");
							practiceCard.setAttribute("tabindex", "0");
							practiceCard.setAttribute("data-state-index", String(index));
							if (index === self.currentFormulaIndex) {
								practiceCard.classList.add("isActive");
							}
							var practicePreview = document.createElement("div");
							practicePreview.className = "statePreview";
							practiceCard.appendChild(practicePreview);
							pendingPreviews.push({ container: practicePreview, state: state });
							var practiceName = document.createElement("strong");
							practiceName.className = "stateName";
							practiceName.textContent = state.name;
							practiceCard.appendChild(practiceName);
							frag.appendChild(practiceCard);
							return;
						}
						var card = document.createElement("div");
						card.className = "stateCard";

						var info = document.createElement("div");
						var name = document.createElement("strong");
						name.textContent = state.name;
						var alg = document.createElement("small");
						alg.textContent = self.getDisplayAlg(state);
						info.appendChild(name);
						info.appendChild(alg);

						var apply = document.createElement("button");
						apply.className = "button small";
						apply.type = "button";
						apply.textContent = "应用";
						apply.setAttribute("data-state-index", String(index));

						card.appendChild(info);
						card.appendChild(apply);
						if (self.showFormulaThumbs) {
							var preview = document.createElement("div");
							preview.className = "statePreview";
							card.appendChild(preview);
							pendingPreviews.push({ container: preview, state: state });
						}
						frag.appendChild(card);
					});
					this.elements.practiceGrid.appendChild(frag);
				// Defer preview rendering until the containers are attached to the
				// live DOM so that TwistyScene.resize() can compute a non-zero size
				// from the styled container.
				pendingPreviews.forEach(function(entry) {
					self.renderFormulaPreview(entry.container, entry.state);
				});
			// 新渲染的缩略图仅应用了无缝贴片缩放，隐藏贴片材质需要在此同步，
			// 否则切换模式后缩略图要重开无缝模式才会刷新隐藏贴片外观。
			if (this.seamlessMode) {
				this.syncHiddenLook();
			}
			// 卡片已挂载到 DOM，按容器宽度推导列数/缩略图尺寸。
			this.layoutPracticeCards();
		},

				getDisplayAlg: function(state) {
					return state && state.alg ? state.alg : "";
				},

				syncPracticeToggle: function() {
					if (!this.elements.practiceFormulaToggle || !this.elements.practiceFormulaText) {
						return;
					}
					var state = this.importedFormulas[this.currentFormulaIndex];
					var total = this.importedFormulas.length;
					if (this.elements.practiceFormulaCount) {
						this.elements.practiceFormulaCount.textContent = "共" + total + "个";
					}
					if (this.elements.practiceFormulaName) {
						this.elements.practiceFormulaName.textContent = state && state.name ? "[" + state.name + "]" : "";
					}
					if (this.elements.showPracticeFormula) {
						this.elements.showPracticeFormula.checked = this.showPracticeFormula;
					}
					if (this.showPracticeFormula && state) {
						this.elements.practiceFormulaToggle.classList.add("isFormula");
						this.elements.practiceFormulaText.textContent = this.getDisplayAlg(state);
					} else {
						this.elements.practiceFormulaToggle.classList.remove("isFormula");
						this.elements.practiceFormulaText.textContent = "显示公式";
					}
				},

			updatePracticeAoTimes: function() {
				if (!this.elements.practiceAoTimes) {
					return;
				}
				var state = this.importedFormulas[this.currentFormulaIndex];
				var key = state ? state.name : String(this.currentFormulaIndex);
				var times = this.formulaSolveTimes[key] || [];
				var self = this;
				// 训练模式下始终展示 AO 区块；数据不足时以 "--" 占位。
				var latest = times.length ? this.formatDuration(times[times.length - 1]) : "--";
				var stats = [5, 10, 50].map(function(count) {
					return self.formatDuration(self.averageOfPractice(times, count));
				});
				this.elements.practiceAoTimes.innerHTML =
					'<div class="practiceAoTime"><span>本次</span><strong>' + latest + '</strong></div>' +
					'<div class="practiceAoTime"><span>AO5</span><strong>' + stats[0] + '</strong></div>' +
					'<div class="practiceAoTime"><span>AO10</span><strong>' + stats[1] + '</strong></div>' +
					'<div class="practiceAoTime"><span>AO50</span><strong>' + stats[2] + '</strong></div>';
			},

				formatDuration: function(value) {
					if (typeof value !== "number" || !isFinite(value)) {
						return "--";
					}
					return (value / 1000).toFixed(2) + "s";
				},

				averageOfPractice: function(times, count) {
					if (!Array.isArray(times) || times.length < count) {
						return null;
					}
					var sample = times.slice(times.length - count).filter(function(value) {
						return typeof value === "number" && isFinite(value);
					});
					if (sample.length < count) {
						return null;
					}
					sample.sort(function(a, b) { return a - b; });
					var trim = Math.max(1, Math.ceil(count * 0.05));
					var middle = sample.slice(trim, sample.length - trim);
					return middle.reduce(function(sum, value) { return sum + value; }, 0) / middle.length;
				},

				renderFormulaPreview: function(container, state) {
					var previewScene = new twistyjs.TwistyScene();
					container.appendChild(previewScene.getDomElement());
				previewScene.initializeTwisty({
					type: "cube",
					dimension: this.cubeDimension,
					stickerWidth: 1.9,
					scale: 0.92,
					allowDragging: false,
					faceColors: [0xffffff, 0xf05a3b, 0x2dbb70, 0xffd447, 0xff941f, 0x2f69df]
				});
				// 缩略图不受 45° 旋转限制（主魔方保持默认限制）。
				if (previewScene.setViewDragClamped) {
					previewScene.setViewDragClamped(false);
				}
				this.prepareStickerScene(previewScene);
					var moves = this.buildTwistyMoves(this.getInitialStateMoves(state), false);
					if (moves.length) {
						previewScene.applyMoves(moves);
					}
					this.applyHiddenMask(previewScene, this.hiddenStickerMask);
					if (this.seamlessMode) {
						this.applySeamlessMode(previewScene, true);
					}
					previewScene.resize();
					this.thumbnailScenes.push(previewScene);
					if (previewScene.setViewDrag) {
						previewScene.setViewDrag(this.thumbnailYaw, this.thumbnailPitch);
					}
				},

				applyImportedFormula: function(index) {
					var state = this.importedFormulas[index];
					if (!state) {
						return;
					}
					this.hideSolvedMark();
					var savedViewYaw = this.viewYaw || 0;
					var savedViewPitch = this.viewPitch || 0;
					this.moveHistory = [];
					this.manualMoveHistory = [];
					this.moveCount = 0;
					if (this.isPracticeMode) {
						this.cancelSolvedAdvance();
						this.currentFormulaIndex = index;
						this.movesSinceState = 0;
						this.seenUnsolvedSinceState = false;
						this.practiceSolveStartTime = null;
						this.seenUnsolvedFaceletSinceState = false;
						this.seenUnsolvedVirtualSinceState = false;
						this.lastFaceletSolved = false;
						this.resetDetectCtx(state);
						this.recordFormulaVisit(index);
						this.setActiveFormulaCard(index);
					}
					this.initTwisty();
					this.setViewDrag(savedViewYaw, savedViewPitch);
					if (this.isPracticeMode) {
						this.resetVirtualState();
					}
					var moves = this.buildTwistyMoves(this.getInitialStateMoves(state), true, this.isPracticeMode);
					if (moves.length) {
						this.twistyScene.applyMoves(moves);
					}
					if (this.isPracticeMode) {
						this.seenUnsolvedVirtualSinceState = !this.isVirtualStateSolved();
						this.seenUnsolvedSinceState = this.seenUnsolvedVirtualSinceState;
					}
					this.renderMoves();
					this.elements.moveCount.textContent = "0";
					this.elements.lastTs.textContent = this.formatTime(Date.now());

					this.syncPracticeToggle();
					this.updatePracticeAoTimes();
					this.log("state", "applied " + state.name);
				},

				setActiveFormulaCard: function(index) {
					if (!this.elements.practiceGrid) {
						return;
					}
					var cards = this.elements.practiceGrid.querySelectorAll("[data-state-index]");
					for (var i = 0; i < cards.length; i++) {
						cards[i].classList.toggle("isActive", Number(cards[i].getAttribute("data-state-index")) === index);
					}
				},

				recordFormulaVisit: function(index) {
					var recent = [];
					for (var i = 0; i < this.recentFormulaIndices.length; i++) {
						if (this.recentFormulaIndices[i] !== index) {
							recent.push(this.recentFormulaIndices[i]);
						}
					}
					recent.unshift(index);
					recent.length = Math.min(recent.length, Math.max(1, Math.min(4, this.importedFormulas.length)));
					this.recentFormulaIndices = recent;
					this.randomBag = this.randomBag.filter(function(item) {
						return item !== index;
					});
				},

				showSolvedMark: function() {
					if (this.elements.practiceSolvedCheck) {
						this.elements.practiceSolvedCheck.classList.add("isVisible");
					}
				},

				hideSolvedMark: function() {
					// 打勾反馈作为非阻塞视觉提示：在反馈窗口内保留显示，
					// 由独立的隐藏定时器收尾，不被状态切换/还原检测提前清掉。
					if (this.solvedCheckFeedbackActive) {
						return;
					}
					if (this.elements.practiceSolvedCheck) {
						this.elements.practiceSolvedCheck.classList.remove("isVisible");
					}
				},

				cancelSolvedAdvance: function() {
					if (this.solveSwitchTimer) {
						clearTimeout(this.solveSwitchTimer);
						this.solveSwitchTimer = null;
					}
					this.solvedAdvancePending = false;
					this.hideSolvedMark();
				},

				scheduleSolvedAdvance: function() {
					if (this.solvedAdvancePending || this.importedFormulas.length === 0 || !this.isPracticeMode) {
						return;
					}
					this.solvedAdvancePending = true;
					if (this.practiceSolveStartTime !== null) {
						var solveTime = performance.now() - this.practiceSolveStartTime;
						var state = this.importedFormulas[this.currentFormulaIndex];
						var key = state ? state.name : String(this.currentFormulaIndex);
						if (!this.formulaSolveTimes[key]) {
							this.formulaSolveTimes[key] = [];
						}
						this.formulaSolveTimes[key].push(solveTime);
						if (this.formulaSolveTimes[key].length > 200) {
							this.formulaSolveTimes[key] = this.formulaSolveTimes[key].slice(-200);
						}
						this.updatePracticeAoTimes();
						this.savePracticeStats();
					}

					this.showSolvedMark();
					var self = this;
					// 打勾仅作为视觉反馈，不阻塞流程：检测到完成立即切换到下一个训练状态。
					this.solvedCheckFeedbackActive = true;
					this.solveSwitchTimer = setTimeout(function() {
						self.solveSwitchTimer = null;
						self.solvedAdvancePending = false;
						if (self.practiceMode === "loop") {
							self.applyImportedFormula(self.currentFormulaIndex);
						} else {
							self.nextPracticeFormula();
						}
					}, 0);
			// 反馈窗口结束后再隐藏打勾图标（独立于状态切换，不阻塞切换）。
				if (this.solvedCheckHideTimer) {
					clearTimeout(this.solvedCheckHideTimer);
				}
				this.solvedCheckHideTimer = setTimeout(function() {
					self.solvedCheckFeedbackActive = false;
					self.hideSolvedMark();
				}, 700);
				},

				nextPracticeFormula: function() {
					if (!this.importedFormulas.length) {
						return;
					}
					var nextIndex = this.practiceMode === "random" ? this.pickRandFormula() : this.pickSeqFormula();
					this.applyImportedFormula(nextIndex);
				},

				pickSeqFormula: function() {
					if (!this.importedFormulas.length) {
						return -1;
					}
					if (this.currentFormulaIndex < 0) {
						return 0;
					}
					return (this.currentFormulaIndex + 1) % this.importedFormulas.length;
				},

				pickRandFormula: function() {
					var count = this.importedFormulas.length;
					if (count <= 1) {
						return 0;
					}
					if (!this.randomBag.length) {
						this.refillRandomBag();
					}
					if (!this.randomBag.length) {
						return this.pickSeqFormula();
					}
					return this.randomBag.shift();
				},

				refillRandomBag: function() {
					var count = this.importedFormulas.length;
					var recentLimit = Math.min(3, Math.max(1, count - 1));
					var recent = this.recentFormulaIndices.slice(0, recentLimit);
					var preferred = [];
					var delayed = [];
					for (var i = 0; i < count; i++) {
						if (recent.indexOf(i) === -1) {
							preferred.push(i);
						} else {
							delayed.push(i);
						}
					}
					this.shuffle(preferred);
					this.shuffle(delayed);
					this.randomBag = preferred.concat(delayed);
				},

				shuffle: function(items) {
					for (var i = items.length - 1; i > 0; i--) {
						var j = Math.floor(Math.random() * (i + 1));
						var tmp = items[i];
						items[i] = items[j];
						items[j] = tmp;
					}
					return items;
				},

				updateSolveDetection: function(facelet, hadCubeMove) {
					this.updatePracticeSolve(facelet, hadCubeMove);
					this.emit("solveCheck", facelet, hadCubeMove);
				},

				updatePracticeSolve: function(facelet, hadCubeMove) {
					if (!this.isPracticeMode || !this.importedFormulas.length || this.currentFormulaIndex < 0) {
						return;
					}
					if (!this.performedProcessMoves.length) return;
					var completed = false;
					if (this.solveDetectionMode === 1) {
						var targetReduced = this.normProcessMoves(this.processTargetMoves);
						completed = this.isFormulaProcessMatch(this.performedProcessMoves, this.processTargetMoves);
						if (completed && targetReduced.length === 0) {
							completed = this.performedProcessMoves.join(" ") === this.processTargetMoves.join(" ");
						}
					} else if (this.virtualCubie) {
						completed = this.virtualMatches(this.activeRestorationTarget);
					} else {
						completed = this.faceletMatches(facelet, this.activeRestorationTarget);
					}
					if (completed) {
						this.lastFaceletSolved = true;
						this.scheduleSolvedAdvance();
					} else {
						this.cancelSolvedAdvance();
					}
				},

				isFaceletSolved: function(facelet) {
					facelet = String(facelet || "").toUpperCase().replace(/[^URFDLB]/g, "");
					var solved = window.mathlib && mathlib.SOLVED_FACELET || kernel.getProp("giiSolved", "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB");
					solved = String(solved || "").toUpperCase().replace(/[^URFDLB]/g, "");
					if (facelet === solved) {
						return true;
					}
					if (facelet.length !== 54) {
						return false;
					}
					var ignored = this.getHiddenStickers();
					if (Object.keys(ignored).length) {
						var visibleFaceColors = [];
						for (var maskedOffset = 0; maskedOffset < 54; maskedOffset += 9) {
							var visibleColor = "";
							for (var maskedIndex = 0; maskedIndex < 9; maskedIndex++) {
								var position = maskedOffset + maskedIndex;
								if (ignored[position]) {
									continue;
								}
								if (!visibleColor) {
									visibleColor = facelet.charAt(position);
								} else if (facelet.charAt(position) !== visibleColor) {
									return false;
								}
							}
							if (visibleColor) {
								visibleFaceColors.push(visibleColor);
							}
						}
						return new Set(visibleFaceColors).size === visibleFaceColors.length;
					}
					var centers = [];
					for (var offset = 0; offset < 54; offset += 9) {
						var color = facelet.charAt(offset);
						if (!color) {
							return false;
						}
						for (var i = 1; i < 9; i++) {
							if (facelet.charAt(offset + i) !== color) {
								return false;
							}
						}
						centers.push(facelet.charAt(offset + 4));
					}
					return new Set(centers).size === 6;
				},

				resetVirtualState: function() {
					this.virtualCubie = window.mathlib && mathlib.CubieCube ? new mathlib.CubieCube() : null;
				},

				getHiddenStickers: function() {
					var ignored = {};
					var hasHidden = false;
					for (var key in this.hiddenStickerMask) {
						if (this.hiddenStickerMask[key]) {
							hasHidden = true;
							break;
						}
					}
					if (!hasHidden) {
						return ignored;
					}
					var permutation = this.virtualCubie && this.virtualCubie.toPerm ? this.virtualCubie.toPerm() : null;
					for (var position = 0; position < 54; position++) {
						var stickerIdentity = permutation ? permutation[position] : position;
						if (this.hiddenStickerMask[stickerIdentity]) {
							ignored[position] = true;
						}
					}
					return ignored;
				},

				applyVirtualMove: function(move) {
					if (!this.virtualCubie || !move || move.type !== "face" || !this.virtualCubie.selfMoveStr) {
						return;
					}
					var face = move.wide ? (move.face + "w") : move.face;
					var pow = move.pow;
					// 将 3/-3/-2 归一化为 mathlib 可识别的 Uw'/Uw/Uw2
					if (pow === 3) {
						this.virtualCubie.selfMoveStr(face + "'");
					} else if (pow === -3) {
						this.virtualCubie.selfMoveStr(face);
					} else if (pow === -2) {
						this.virtualCubie.selfMoveStr(face + "2");
					} else {
						this.virtualCubie.selfMoveStr(this.formatMoveText(face, pow));
					}
				},

				isVirtualStateSolved: function() {
					if (!this.virtualCubie || !this.virtualCubie.isEqual) {
						return false;
					}
					if (!Object.keys(this.hiddenStickerMask).length || !this.virtualCubie.toPerm) {
						return this.virtualCubie.isEqual();
					}
					var permutation = this.virtualCubie.toPerm();
					for (var position = 0; position < permutation.length; position++) {
						var stickerIdentity = permutation[position];
						if (!this.hiddenStickerMask[stickerIdentity] && stickerIdentity !== position) {
							return false;
						}
					}
					return true;
				},

				resetDetectCtx: function(state) {
					this.performedProcessMoves = [];
					this.processTargetMoves = [];
					this.activeRestorationTarget = state && state.customSolvedState || null;
					if (state && state.alg) {
						try { this.processTargetMoves = FormulaCore.processTarget(state.alg); } catch (error) {}
					}
				},

				setSolveDetectionMode: function(mode) {
					this.solveDetectionMode = Number(mode) === 1 ? 1 : 2;
					if (this.practiceStats && this.isPracticeMode) {
						this.practiceStats.solveDetectionMode = this.solveDetectionMode;
						this.savePracticeStats();
					}
					this.updateSolveDetection(this.currentFacelet, false);
					this.renderDetectOpts();
					this.emit("detectMode", this.solveDetectionMode);
				},

				ensureDetectOpts: function(root) {
					if (!root || root.querySelector("[data-solve-detection-controls]")) return;
					var host = root.querySelector(".viewSec");
					if (!host) return;
					var controls = document.createElement("div");
					controls.className = "controls strictDetectionControls";
					controls.setAttribute("data-solve-detection-controls", "1");
					controls.setAttribute("aria-label", "严格检测");
					controls.innerHTML = '<label class="smartCheck strictDetectionToggle"><input type="checkbox" data-strict-detection><span class="checkVisual"></span><span>严格检测</span></label>';
					var self = this;
					controls.addEventListener("change", function(event) {
						var input = event.target.closest("[data-strict-detection]");
						if (input) self.setSolveDetectionMode(input.checked ? 1 : 2);
					});
					host.appendChild(controls);
					this.renderDetectOpts();
				},

				renderDetectOpts: function() {
					var inputs = document.querySelectorAll("[data-strict-detection]");
					for (var i = 0; i < inputs.length; i++) {
						inputs[i].checked = this.solveDetectionMode === 1;
					}
				},

				isFourTurnReset: function(moves) {
					if (!moves || moves.length < 4) return false;
					var last = moves.slice(-4);
					return /^([URFDLB])('?)$/.test(last[0]) && last.every(function(token) { return token === last[0]; });
				},

				recordSolveMove: function(move, source, options) {
					options = options || {};
					if (!move || options.silent || options.noCount) return;
					var token = "";
					if (move.type === "slice" || move.type === "orientation") {
						token = move.text;
					} else if (move.type === "face") {
						token = this.moveToStandardText(move);
					}
					if (!token) return;
					this.performedProcessMoves.push(token);
					this.performedProcessMoves = this.compressDisplayTokens(this.performedProcessMoves);
					if (this.isPracticeMode && this.isFourTurnReset(this.performedProcessMoves)) {
						this.applyImportedFormula(this.currentFormulaIndex);
						return;
					}
					this.emit("solveMove", token, move, source, options);
					if (this.isPracticeMode) this.updateSolveDetection(this.currentFacelet, !!options.fromCube);
				},

				buildTargetCubie: function(facelet) {
					if (!window.mathlib || !mathlib.CubieCube) return null;
					var target = new mathlib.CubieCube();
					var normalized = String(facelet || mathlib.SOLVED_FACELET || "").toUpperCase().replace(/[^URFDLB]/g, "");
					if (normalized.length !== 54 || target.fromFacelet(normalized) === -1) return new mathlib.CubieCube();
					return target;
				},

				virtualMatches: function(facelet) {
					if (!this.virtualCubie) return false;
					var target = this.buildTargetCubie(facelet);
					if (!target) return false;
					var mask = this.hiddenStickerMask || {};
					if (!Object.keys(mask).length || !this.virtualCubie.toPerm || !target.toPerm) return this.virtualCubie.isEqual(target);
					var currentPerm = this.virtualCubie.toPerm();
					var targetPerm = target.toPerm();
					for (var position = 0; position < targetPerm.length; position++) {
						if (!mask[targetPerm[position]] && currentPerm[position] !== targetPerm[position]) return false;
					}
					return true;
				},

				faceletMatches: function(facelet, targetFacelet) {
					var current = String(facelet || "").toUpperCase().replace(/[^URFDLB]/g, "");
					var target = String(targetFacelet || window.mathlib && mathlib.SOLVED_FACELET || "").toUpperCase().replace(/[^URFDLB]/g, "");
					if (current.length !== 54 || target.length !== 54) return false;
					for (var i = 0; i < 54; i++) {
						if (!(this.hiddenStickerMask || {})[i] && current.charAt(i) !== target.charAt(i)) return false;
					}
					return true;
				},

				buildTwistyMoves: function(tokens, updateOrientationState, trackVirtualState) {
					var moves = [];
					for (var i = 0; i < tokens.length; i++) {
						var move = this.normalizeMove(tokens[i]);
						if (!move) {
							continue;
						}
						if ((this.gyroFollow || this.cubeHasGyro) && move.type === "orientation") {
							// 带陀螺仪的魔方：x/y/z 不产生任何作用（含状态恢复/公式回放路径）
							continue;
						}
						move = this.mapManualMove(move);
						moves.push(move.twisty);
						if (trackVirtualState) {
							this.applyVirtualMove(move);
						}
						if (updateOrientationState && move.type === "orientation") {
							this.updateOrientation(move.axis, move.pow);
							this.orientationMoves.push(move.text);
						}
					}
					return moves;
				},

				bindViewDrag: function() {
					var self = this;
					var drag = {
						active: false,
						x: 0,
						y: 0,
						yaw: 0,
						pitch: 0
					};
					// 陀螺仪开启时的校准拖动：只水平、无角度限制，调的是偏航校准角
					var cal = {
						active: false,
						x: 0,
						offset: 0
					};
					this.elements.cubeStage.addEventListener("pointerdown", function(event) {
						if (event.button !== 0) {
							return;
						}
						if (self.gyroFollow) {
							cal.active = true;
							cal.x = event.clientX;
							cal.offset = self.gyroYawOffset;
						} else {
							drag.active = true;
							drag.x = event.clientX;
							drag.y = event.clientY;
							drag.yaw = self.viewYaw;
							drag.pitch = self.viewPitch;
						}
						self.elements.cubeStage.classList.add("isDragging");
						self.elements.cubeStage.setPointerCapture(event.pointerId);
						event.preventDefault();
					});
					this.elements.cubeStage.addEventListener("pointermove", function(event) {
						if (cal.active) {
							var calRect = self.elements.cubeStage.getBoundingClientRect();
							var calSpan = Math.max(140, Math.min(calRect.width, calRect.height) * 0.45);
							self.gyroYawOffset = cal.offset + (event.clientX - cal.x) * ((Math.PI / 4) / calSpan);
							self.startGyroAnimation();
							event.preventDefault();
							return;
						}
						if (!drag.active) {
							return;
						}
						var rect = self.elements.cubeStage.getBoundingClientRect();
						var limit = Math.PI / 4;
						var dragSpan = Math.max(140, Math.min(rect.width, rect.height) * 0.45);
						var scale = limit / dragSpan;
						self.setViewDrag(drag.yaw - (event.clientX - drag.x) * scale, drag.pitch + (event.clientY - drag.y) * scale);
						event.preventDefault();
					});
					["pointerup", "pointercancel", "pointerleave"].forEach(function(type) {
						self.elements.cubeStage.addEventListener(type, function(event) {
							if (!drag.active && !cal.active) {
								return;
							}
							drag.active = false;
							cal.active = false;
							self.elements.cubeStage.classList.remove("isDragging");
							try {
								self.elements.cubeStage.releasePointerCapture(event.pointerId);
							} catch (error) {
							}
						});
					});
				},

				nudgeCamera: function(keyCode, repeat) {
					if (!this.twistyScene || !this.twistyScene.keydown) {
						return;
					}
					repeat = repeat || 1;
					for (var i = 0; i < repeat; i++) {
						this.twistyScene.keydown({
							keyCode: keyCode,
							altKey: false,
							ctrlKey: false,
							preventDefault: function() {}
						});
					}
				},

				setViewDrag: function(yaw, pitch) {
					var limit = Math.PI / 4;
					var length = Math.sqrt(yaw * yaw + pitch * pitch);
					if (length > limit) {
						yaw = yaw / length * limit;
						pitch = pitch / length * limit;
					}
					this.viewYaw = yaw;
					this.viewPitch = pitch;
					if (this.twistyScene && this.twistyScene.setViewDrag) {
						this.twistyScene.setViewDrag(yaw, pitch);
					}
				},

				toggleGyroFollow: function() {
					this.gyroFollow = !this.gyroFollow;
					if (this.elements.gyroToggleBtn) {
						this.elements.gyroToggleBtn.classList.toggle("isActive", this.gyroFollow);
					}
					if (this.gyroFollow) {
						// 从当前正面向最近一次收到的姿态平滑过渡（必须刷新：非跟随期间目标姿态不更新，
						// 沿用旧值会在魔方静止时一直显示过时的姿态）
						if (this.gyroLastQ) {
							this.gyroTargetQ = [this.gyroLastQ[0], this.gyroLastQ[1], this.gyroLastQ[2], this.gyroLastQ[3]];
						}

						// 跟随期间固定 45° 俯视（水平归零，水平校准由陀螺仪偏航承担）；关闭后恢复原视角
						this.followSavedYaw = this.viewYaw || 0;
						this.followSavedPitch = this.viewPitch || 0;
						this.viewYaw = 0;
						this.viewPitch = Math.PI / 4;
						this.setViewDrag(this.viewYaw, this.viewPitch);
						this.syncRotationFrame();
						this.gyroReanchored = false;
						if (this.gyroTargetQ) {
							// 重新认面：关闭期间累积的朝向并入显示并清零，跟随从此只由陀螺仪决定
							this.reanchorGyroDisplay();
							// 从"当前画面上的朝向"开始平滑过渡：开启瞬间不跳
							this.gyroCurrentQ = this.currentDisplayQuat();
							this.startGyroAnimation();
						}
					} else {
						// 关闭跟随：当前画面朝向吸附结算进普通视图（立即生效），显示归位，
						// 回到"只检测 XYZ"的普通模式；水平校准角保留，重新开启直接续用
						this.stopGyroAnimation();
						this.viewYaw = this.followSavedYaw || 0;
						this.viewPitch = this.followSavedPitch || 0;
						this.setViewDrag(this.viewYaw, this.viewPitch);
						this.syncFollowOrientationToView();
					}
					this.log("bluetooth", this.gyroFollow ? "陀螺仪跟随已开启" : "陀螺仪跟随已关闭");
				},

				// 关闭跟随：唯一来源仍是"后台最新智能魔方姿态 + 水平校准"。先把这个开启态屏幕朝向
				// 吸附到最近的 24 朝向之一，再立即（不走动画）写入普通模式；普通模式旧状态不参与目标计算。
				// 关闭后即回到"只检测 XYZ"的普通模式：转体方向与屏幕方向一致；
				// 画面与关闭前只差握持本身的倾角（校准后很小）。水平校准角保留在后台，重开直接续用。
				syncFollowOrientationToView: function() {
					var viewM = this.gyroViewMatrix();
					if (!viewM) {
						return;
					}
					var base = this.orientationMatrix || this.identityMatrix();
					var settled = this.rotNearestGroupElement(viewM).matrix;
					var delta = this.matrixMultiply(settled, this.matrixTranspose(base));
					this.orientationMatrix = settled;
					// 关闭后的绝对朝向识别从这个屏幕朝向继续，不沿用旧的轨迹基准。
					this.rotSyncM = settled;
					this.rotLastM = viewM;
					this.rotCandidate = null;
					this.cancelRotFlush();
					this.gyroRecordM = settled;
					if (this.twistyScene && this.twistyScene.applyMoves) {
						var self = this;
						// orientationMatrix 采用左乘累计；applyMoves 也逐步左乘，所以代数分解结果必须倒序执行。
						var moves = this.rotDecompose(delta).reverse().map(function(part) {
							return [1, self.cubeDimension, part.axis, part.pow];
						});
						if (moves.length) {
							this.twistyScene.applyMoves(moves);
						}
					}
					this.applyDisplayQuat([0, 0, 0, 1]);
				},

				// 直接写显示四元数（屏幕朝向 = 显示四元数 ∘ 内部转动状态）
				applyDisplayQuat: function(q) {
					var twisty = this.twistyScene && this.twistyScene.getTwisty ? this.twistyScene.getTwisty() : null;
					if (!twisty || !twisty._3d || !q) {
						return;
					}
					twisty._3d.useQuaternion = true;
					twisty._3d.quaternion.set(q[0], q[1], q[2], q[3]);
					if (this.twistyScene.render) {
						this.twistyScene.render();
					}
				},

				currentDisplayQuat: function() {
					var twisty = this.twistyScene && this.twistyScene.getTwisty ? this.twistyScene.getTwisty() : null;
					if (!twisty || !twisty._3d || !twisty._3d.quaternion) {
						return [0, 0, 0, 1];
					}
					var q = twisty._3d.quaternion;
					return [q.x, q.y, q.z, q.w];
				},

				// 停止跟随显示：只停动画、放掉缓动值，不动画面（避免开关瞬间跳）
				stopGyroDisplay: function() {
					this.stopGyroAnimation();
					this.gyroCurrentQ = null;
				},



				// 断开连接：姿态目标与校准角一并失效（只在连接期间记忆）
				clearGyroSession: function() {
					this.gyroTargetQ = null;
					this.gyroCurrentQ = null;
					this.gyroYawOffset = 0;
					this.gyroLastQ = null;
					this.cubeHasGyro = false;
					this.gyroAutoEnabled = false;
					this.gyroReanchored = false;
					var rotRow = document.querySelector(".keyboardRotationMoves");
					if (rotRow) {
						rotRow.style.display = "";
					}
					this.gyroRecordM = null;
					this.lastRotationCommit = null;
					this.sliceCoreClaim = null;
					this.rotSyncM = null;
					this.rotAltM = null;
					this.rotRestRefM = null;
					this.rotRestSince = 0;
					this.rotCandidate = null;
					this.rotLastM = null;
					this.cancelRotFlush();
				},

				// 标准 3x3 旋转矩阵 → 四元数（与 rotQuatToMatrix 互逆，供跟随显示使用）
				quatFromMatrix: function(m) {
					var t = m[0][0] + m[1][1] + m[2][2];
					var s = 0;
					if (t > 0) {
						s = Math.sqrt(t + 1) * 2;
						return [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
					}
					if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
						s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
						return [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
					}
					if (m[1][1] > m[2][2]) {
						s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
						return [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
					}
					s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
					return [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
				},

				// 校准偏航（绕场景竖直轴，水平拖动设定）的旋转矩阵，与下面显示四元数里的偏航同向
				rotYawMatrix: function(ang) {
					var c = Math.cos(ang);
					var s = Math.sin(ang);
					return [
						[c, 0, s],
						[0, 1, 0],
						[-s, 0, c]
					];
				},

				// "手里魔方"对应的场景矩阵 = 校准偏航 · perm(后台最新硬件姿态)。
				// gyroLastQ 始终由蓝牙流更新，因此关闭期间仍保留实时权威数据；gyroTargetQ 只作首包兜底。
				gyroViewMatrix: function() {
					var q = this.gyroLastQ || this.gyroTargetQ;
					if (!q) {
						return null;
					}
					var m = this.rotQuatToMatrix(q[0], q[1], q[2], q[3]);
					if (this.gyroYawOffset) {
						m = this.matrixMultiply(this.rotYawMatrix(this.gyroYawOffset), m);
					}
					return m;
				},

				// 跟随显示的显示四元数：**跟随以陀螺仪为唯一主导**，显示只由"后台最新硬件姿态
				// + 水平校准"决定
				// （= 校准偏航 · perm(硬件姿态)），与虚拟魔方自身的记录朝向、关闭期间的任何状态无关。
				// 前提：开启跟随（或收到第一包姿态）时会先做一次"重新认面"（reanchorGyroDisplay），
				// 把虚拟魔方已累积的整体朝向并入显示四元数并清零记录朝向，使跟随期间
				// 内部整体朝向恒为单位——"关陀螺仪时的状态"只由"开陀螺仪时的状态"结算而来。
				computeGyroSceneQuat: function() {
					var m = this.gyroViewMatrix();
					if (!m) {
						return null;
					}
					return this.quatFromMatrix(m);
				},

				// 重新认面（开启跟随 / 场景重建 / 首包到达时调用）：
				// 把虚拟魔方已累积的整体朝向（内部状态 + 记录帧 orientationMatrix）并入显示四元数并清零。
				// 两步在同一帧内完成，画面不变；从此跟随显示与关闭期间的状态完全解耦。
				reanchorGyroDisplay: function() {
					var o = this.orientationMatrix;
					if (o && !this.matrixEquals(o, this.identityMatrix())) {
						// 与关闭结算相同：复合旋转必须按分解结果的逆序交给 applyMoves。
						var inv = this.rotDecompose(this.matrixTranspose(o)).reverse();
						if (this.twistyScene && this.twistyScene.applyMoves && inv.length) {
							var self = this;
							this.twistyScene.applyMoves(inv.map(function(part) {
								return [1, self.cubeDimension, part.axis, part.pow];
							}));
						}
						this.orientationMatrix = this.identityMatrix();
					}
					var q3 = this.currentDisplayQuat();
					var m = this.rotQuatToMatrix(q3[0], -q3[2], q3[1], q3[3]);
					if (o) {
						m = this.matrixMultiply(m, o);
					}
					this.applyDisplayQuat(this.quatFromMatrix(m));
					this.gyroReanchored = true;
				},

				slerpQuat: function(a, b, t) {
					var dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
					var bx = b[0];
					var by = b[1];
					var bz = b[2];
					var bw = b[3];
					if (dot < 0) {
						bx = -bx;
						by = -by;
						bz = -bz;
						bw = -bw;
						dot = -dot;
					}
					var k0;
					var k1;
					if (dot > 0.9995) {
						k0 = 1 - t;
						k1 = t;
					} else {
						var theta = Math.acos(Math.min(1, dot));
						var sinTheta = Math.sin(theta);
						k0 = Math.sin((1 - t) * theta) / sinTheta;
						k1 = Math.sin(t * theta) / sinTheta;
					}
					return [
						a[0] * k0 + bx * k1,
						a[1] * k0 + by * k1,
						a[2] * k0 + bz * k1,
						a[3] * k0 + bw * k1
					];
				},

				startGyroAnimation: function() {
					if (this.gyroAnimFrame || !this.gyroTargetQ) {
						return;
					}
					var self = this;
					var step = function(now) {
						self.gyroAnimFrame = null;
						var twisty = self.twistyScene && self.twistyScene.getTwisty ? self.twistyScene.getTwisty() : null;
						var target = self.gyroTargetQ && self.gyroFollow ? self.computeGyroSceneQuat() : null;
						if (!twisty || !twisty._3d || !target) {
							return;
						}
						if (!self.gyroCurrentQ) {
							self.gyroCurrentQ = [0, 0, 0, 1];
						}
						var cur = self.gyroCurrentQ;
						var dot = cur[0] * target[0] + cur[1] * target[1] + cur[2] * target[2] + cur[3] * target[3];
						if (Math.abs(dot) > 0.99995) {
							self.gyroCurrentQ = [target[0], target[1], target[2], target[3]];
						} else {
							var dt = self.gyroLastT ? Math.min(0.05, (now - self.gyroLastT) / 1000) : 0.016;
							var k = 1 - Math.exp(-dt * 16);
							self.gyroCurrentQ = self.slerpQuat(cur, target, k);
							self.gyroLastT = now;
							self.gyroAnimFrame = window.requestAnimationFrame(step);
						}
						twisty._3d.useQuaternion = true;
						twisty._3d.quaternion.set(self.gyroCurrentQ[0], self.gyroCurrentQ[1], self.gyroCurrentQ[2], self.gyroCurrentQ[3]);
						if (self.twistyScene.render) {
							self.twistyScene.render();
						}
					};
					this.gyroLastT = 0;
					this.gyroAnimFrame = window.requestAnimationFrame(step);
				},

				stopGyroAnimation: function() {
					if (this.gyroAnimFrame) {
						window.cancelAnimationFrame(this.gyroAnimFrame);
						this.gyroAnimFrame = null;
					}
				},

				// ---- 绝对朝向吸附（蓝牙陀螺仪流，无论跟随是否开启）----
				// 权威输入始终是"后台最新硬件姿态 + 开启态水平校准"。它先映射为屏幕坐标，
				// 再吸附到 24 个整体朝向；rotSyncM 只保存上一个已确认的绝对朝向。
				// 新朝向稳定后才由两者差值反算 x/y/z，不再依赖速度、轨迹或中间数据包。

				onCubeGyro: function(x, y, z, w) {
					this.gyroLastQ = [x, y, z, w];
					if (!this.cubeHasGyro) {
						// 首次收到姿态数据 = 这台魔方带陀螺仪：x/y/z 手动整体转动一律失效（开关跟随都无效），
						// 面板上的 x/y/z 也收起来，避免"虚拟转体"与手中魔方错位；并自动开启一次跟随，
						// 用户校准后可自行关闭，关闭后不会自动再开。
						this.cubeHasGyro = true;
						var rotRow = document.querySelector(".keyboardRotationMoves");
						if (rotRow) {
							rotRow.style.display = "none";
						}
						if (!this.gyroAutoEnabled && !this.gyroFollow) {
							this.gyroAutoEnabled = true;
							this.toggleGyroFollow();
						}
					}
					if (this.gyroFollow) {
						// 跟随开启：显示由陀螺仪驱动；关闭时只做 XYZ 检测、不驱动显示。
						// 水平校准角等开启状态在后台保留，重新开启立即以同一基准继续。
						if (!this.gyroReanchored) {
							// 开启后第一包：先重新认面（把此前虚拟朝向并入显示并清零）
							this.reanchorGyroDisplay();
							this.gyroCurrentQ = this.currentDisplayQuat();
						}
						this.gyroTargetQ = [x, y, z, w];
						this.startGyroAnimation();
					}
					this.detectCubeRotation(x, y, z, w);
				},

				rotQuatToMatrix: function(x, y, z, w) {
					// 物理帧四元数 → 场景帧（轴置换 x→x、z→y、y→−z）旋转矩阵
					var sx = x;
					var sy = z;
					var sz = -y;
					var sw = w;
					var m = [
						[1 - 2 * (sy * sy + sz * sz), 2 * (sx * sy - sz * sw), 2 * (sx * sz + sy * sw)],
						[2 * (sx * sy + sz * sw), 1 - 2 * (sx * sx + sz * sz), 2 * (sy * sz - sx * sw)],
						[2 * (sx * sz - sy * sw), 2 * (sy * sz + sx * sw), 1 - 2 * (sx * sx + sy * sy)]
					];
					for (var r = 0; r < 3; r++) {
						for (var c = 0; c < 3; c++) {
							m[r][c] = Math.round(m[r][c] * 10000) / 10000;
						}
					}
					return m;
				},

				rotMatrixKey: function(m) {
					return m[0].join(",") + ";" + m[1].join(",") + ";" + m[2].join(",");
				},

				rotGroupElements: function() {
					// 24 个魔方整体朝向（<U,R,F> 生成）
					if (this.rotGroupCache) {
						return this.rotGroupCache;
					}
					var self = this;
					var seen = {};
					var list = [];
					var queue = [this.identityMatrix()];
					seen[this.rotMatrixKey(this.identityMatrix())] = true;
					while (queue.length) {
						var current = queue.shift();
						list.push(current);
						["U", "R", "F"].forEach(function(face) {
							var next = self.matrixMultiply(current, self.rotationMatrix(face, 1));
							var key = self.rotMatrixKey(next);
							if (!seen[key]) {
								seen[key] = true;
								queue.push(next);
							}
						});
					}
					this.rotGroupCache = list;
					return list;
				},

				rotMatrixAngle: function(m) {
					var cos = Math.max(-1, Math.min(1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2));
					return Math.acos(cos) * 180 / Math.PI;
				},

				rotNearestGroupElement: function(m) {
					var group = this.rotGroupElements();
					var best = null;
					var bestCos = -2;
					for (var i = 0; i < group.length; i++) {
						var t = this.matrixMultiply(this.matrixTranspose(group[i]), m);
						var cos = Math.max(-1, Math.min(1, (t[0][0] + t[1][1] + t[2][2] - 1) / 2));
						if (cos > bestCos) {
							bestCos = cos;
							best = group[i];
						}
					}
					return {
						matrix: best,
						residualDeg: Math.acos(Math.max(-1, Math.min(1, bestCos))) * 180 / Math.PI,
						key: best ? this.rotMatrixKey(best) : ""
					};
				},

				rotMatchAxisPow: function(m, faces) {
					// 单步转体候选轴：场景帧用 B/U/R，体帧（标准 x/y/z）用 R/U/F
					faces = faces || ["B", "U", "R"];
					var pows = [1, -1, 2];
					for (var i = 0; i < faces.length; i++) {
						for (var j = 0; j < pows.length; j++) {
							if (this.matrixEquals(this.rotationMatrix(faces[i], pows[j]), m)) {
								return { axis: faces[i], pow: pows[j] };
							}
						}
					}
					return null;
				},

				rotDecompose: function(m, faces) {
					// 拆成 ≤3 个单步转体（覆盖 24 朝向群全部元素）；faces 缺省为场景帧 B/U/R
					faces = faces || ["B", "U", "R"];
					var singles = [];
					var pows = [1, -1, 2];
					for (var i = 0; i < faces.length; i++) {
						for (var j = 0; j < pows.length; j++) {
							singles.push({ axis: faces[i], pow: pows[j] });
						}
					}
					var first = this.rotMatchAxisPow(m, faces);
					if (first) {
						return [first];
					}
					for (var a = 0; a < singles.length; a++) {
						var ma = this.rotationMatrix(singles[a].axis, singles[a].pow);
						for (var b = 0; b < singles.length; b++) {
							var mb = this.rotationMatrix(singles[b].axis, singles[b].pow);
							if (this.matrixEquals(this.matrixMultiply(ma, mb), m)) {
								return [singles[a], singles[b]];
							}
						}
					}
					for (var c = 0; c < singles.length; c++) {
						var mc = this.rotationMatrix(singles[c].axis, singles[c].pow);
						for (var d = 0; d < singles.length; d++) {
							var md = this.matrixMultiply(mc, this.rotationMatrix(singles[d].axis, singles[d].pow));
							for (var e = 0; e < singles.length; e++) {
								if (this.matrixEquals(this.matrixMultiply(md, this.rotationMatrix(singles[e].axis, singles[e].pow)), m)) {
									return [singles[c], singles[d], singles[e]];
								}
							}
						}
					}
					return [];
				},

				// 双帧吸附：同一段转动在场景帧（绕世界轴）与体帧（绕魔方自身轴）里
				// 到标准朝向的距离可以差很远——握持歪 30° 时，绕魔方自身轴的 90° 转动
				// 在场景帧里有约 42° 残差、在体帧里却接近 0°。两帧各吸一次，体帧要明显
				// 更准（cubeRotFrameBias 度以上）才采用，这样握持不歪时仍按场景帧判定、
				// 记录方向与既有行为一致，握持歪时才切到体帧、不会被握姿带偏。
				// preferFrame 用于让已经开始的判定锁定同一帧，避免两帧残差接近时来回跳、
				// 候选反复重置而永远判不出来。
				// 体帧矩阵要放回"记录帧"再应用：记录帧（gyroRecordM / orientationMatrix）才是屏幕上
				// 呈现的魔方姿态，体帧的 90° 必须绕"记录帧下的那条实体轴"转。直接把体帧矩阵当场景帧
				// 应用会绕错轴，姿态矩阵不再等于各次转体之积，偏离握姿越大错得越多。
				rotBodyToApplied: function(bodyMatrix) {
					var baseM = this.gyroFollow ? this.gyroRecordM : this.orientationMatrix;
					if (!baseM || !bodyMatrix) {
						return bodyMatrix;
					}
					return this.matrixMultiply(baseM, this.matrixMultiply(bodyMatrix, this.matrixTranspose(baseM)));
				},

				rotSnapDetect: function(delta, anchor, preferFrame) {
					var sceneSnap = this.rotNearestGroupElement(delta);
					var bodySnap = null;
					var bodyApplied = null;
					if (anchor) {
						var at = this.matrixTranspose(anchor);
						bodySnap = this.rotNearestGroupElement(this.matrixMultiply(at, this.matrixMultiply(delta, anchor)));
						if (bodySnap) {
							bodyApplied = this.rotBodyToApplied(bodySnap.matrix);
						}
					}
					if (bodySnap) {
						// 体帧要"明显更准"才采用：两帧都贴得住时（例如握持不歪）取场景帧，
						// 记录方向才与既有行为一致
						var bodyBetter = bodySnap.residualDeg + this.cubeRotFrameBias < sceneSnap.residualDeg;
						if (preferFrame === "body" && bodySnap.residualDeg <= this.cubeRotSnapTolLoose) {
							return { frame: "body", matrix: bodyApplied, residualDeg: bodySnap.residualDeg, key: "b:" + bodySnap.key };
						}
						if (preferFrame === "scene" && sceneSnap.residualDeg <= this.cubeRotSnapTolLoose) {
							return { frame: "scene", matrix: sceneSnap.matrix, residualDeg: sceneSnap.residualDeg, key: "s:" + sceneSnap.key };
						}
						if (bodyBetter) {
							return { frame: "body", matrix: bodyApplied, residualDeg: bodySnap.residualDeg, key: "b:" + bodySnap.key };
						}
					}
					return { frame: "scene", matrix: sceneSnap.matrix, residualDeg: sceneSnap.residualDeg, key: "s:" + sceneSnap.key };
				},

				// 判定用的转体：先用当前基准量；当前基准贴不住（残差过大）时再退回上一个基准。
				// 退回是"转到一半停一下再继续"的关键：基准在静止时会前移到停顿姿势，
				// 若只认当前基准，这段被拆开的转体就只剩后半截、永远凑不满 90°。
				// 只有当前基准"够得上转动但贴不准"时才看后备基准：正常转体一律由当前基准
				// 命中，刚记完一次转体也不会被后备基准重复计量。
				rotMeasureWith: function(anchor, sceneM, preferFrame) {
					if (!anchor) {
						return null;
					}
					var delta = this.matrixMultiply(sceneM, this.matrixTranspose(anchor));
					var angle = this.rotMatrixAngle(delta);
					if (angle < this.cubeRotPartialFrom) {
						// 净转动不到 cubeRotPartialFrom：算"没转过"，不再用它量
						return null;
					}
					var snap = this.rotSnapDetect(delta, anchor, preferFrame);
					return { angle: angle, key: snap.key, frame: snap.frame, matrix: snap.matrix, residualDeg: snap.residualDeg };
				},

				rotMeasure: function(sceneM, preferFrame) {
					var primary = this.rotMeasureWith(this.rotSyncM, sceneM, preferFrame);
					if (primary && primary.residualDeg <= this.cubeRotSnapTolLoose) {
						return primary;
					}
					if (!primary) {
						// 当前基准下"根本不算转过"（净转动不够），不再看后备基准，
						// 否则刚记完一次转体会被后备基准再记一次
						return null;
					}
					// 后备基准只在姿态已经停稳时启用：正在扫过时（例如慢慢转 180° 的中途）
					// 用后备基准会把中间姿态误当成一次更大幅度的转体记下来
					if (this.rotStillMs < this.cubeRotAltStillMs) {
						return primary;
					}
					var alt = this.rotMeasureWith(this.rotAltM, sceneM, preferFrame);
					if (alt && alt.residualDeg <= this.cubeRotSnapTolLoose) {
						return alt;
					}
					return primary;
				},

				detectCubeRotation: function() {
					// 不再从运动轨迹猜 x/y/z。每包先还原成"开启跟随时的屏幕朝向"，
					// 再吸附到 24 个绝对朝向；最终只比较上一个已确认朝向和新朝向。
					// 快速、复合转体即使漏掉中间数据包，最终绝对方向也不会累积出错。
					var sceneM = this.gyroViewMatrix();
					if (!sceneM) {
						return;
					}
					var now = Date.now();
					this.rotLastM = sceneM;
					var snap = this.rotNearestGroupElement(sceneM);
					if (!snap.matrix || snap.residualDeg > this.cubeRotSnapTolLoose) {
						this.rotCandidate = null;
						this.cancelRotFlush();
						return;
					}
					if (!this.rotSyncM) {
						// 第一个可靠吸附结果只建立绝对基准，不判转体。
						this.rotSyncM = snap.matrix;
						this.rotAltM = null;
						this.rotRestRefM = snap.matrix;
						this.rotRestSince = now;
						this.rotCandidate = null;
						this.cancelRotFlush();
						this.gyroRecordM = snap.matrix;
						return;
					}
					if (this.matrixEquals(snap.matrix, this.rotSyncM)) {
						this.rotCandidate = null;
						this.cancelRotFlush();
						return;
					}

					var delta = this.matrixMultiply(snap.matrix, this.matrixTranspose(this.rotSyncM));
					if (this.rotCandidate && this.rotCandidate.key === snap.key) {
						this.rotCandidate.absoluteM = snap.matrix;
						this.rotCandidate.matrix = delta;
						this.rotCandidate.residualDeg = snap.residualDeg;
						this.rotCandidate.hits = (this.rotCandidate.hits || 1) + 1;
						var age = now - this.rotCandidate.since;
						// 稳定数据走双包 + 时间确认；某些魔方停稳即停流，则由静默定时器确认最后一包。
						if (this.rotCandidate.hits >= 2 &&
							age >= (snap.residualDeg <= this.cubeRotSnapTol ? this.cubeRotSettleMs : this.cubeRotDwellMs)) {
							this.commitDetectedRotation();
							return;
						}
						this.scheduleRotFlush();
						return;
					}
					this.rotCandidate = {
						key: snap.key, absoluteM: snap.matrix, matrix: delta,
						residualDeg: snap.residualDeg, since: now, hits: 1
					};
					this.scheduleRotFlush();
				},

				commitDetectedRotation: function() {
					var candidate = this.rotCandidate;
					if (!candidate) {
						return;
					}
					this.rotCandidate = null;
					this.cancelRotFlush();
					// 直接推进到候选的绝对吸附朝向，不使用运动轨迹的最后采样点。
					this.rotAltM = this.rotSyncM;
					this.rotSyncM = candidate.absoluteM || this.rotSyncM;
					this.rotRestRefM = this.rotSyncM;
					this.rotRestSince = Date.now();
					this.applyDetectedRotation(candidate.matrix);
				},

				// 补判：陀螺仪停流（静默 cubeRotFlushMs）或硬件转动落账前，
				// 把已经稳定贴近的朝向先判定掉
				flushPendingRotation: function() {
					if (!this.rotCandidate) {
						return;
					}
					this.commitDetectedRotation();
				},

				scheduleRotFlush: function() {
					var self = this;
					this.cancelRotFlush();
					this.rotFlushTimer = setTimeout(function() {
						self.rotFlushTimer = null;
						self.flushPendingRotation();
					}, this.cubeRotFlushMs);
				},

				cancelRotFlush: function() {
					if (this.rotFlushTimer) {
						clearTimeout(this.rotFlushTimer);
						this.rotFlushTimer = null;
					}
				},

				// 单轴 90/180/270 的整台转动：单个中层的核心转动是 90°，间隔很短的连续中层
				// 会被陀螺仪判定合并成 180/270，甚至一次复合转动，都按核心转动处理
				isSliceCoreDelta: function(m) {
					if (!m) {
						return false;
					}
					var faces = ["U", "D", "R", "L", "F", "B"];
					for (var i = 0; i < faces.length; i++) {
						if (this.matrixEquals(m, this.rotationMatrix(faces[i], 1)) ||
							this.matrixEquals(m, this.rotationMatrix(faces[i], -1)) ||
							this.matrixEquals(m, this.rotationMatrix(faces[i], 2))) {
							return true;
						}
					}
					return false;
				},

				// 物理中层落账（playCubeSliceMove）时调用
				absorbSliceCoreRotation: function() {
					var base = this.rotSyncM;
					if (!base) {
						// 还没有绝对基准：它建立时取到的本来就是核心转动之后的朝向
						return;
					}
					var pose = this.gyroViewMatrix();
					var snap = pose ? this.rotNearestGroupElement(pose) : null;
					if (snap && snap.matrix && !this.matrixEquals(snap.matrix, base)) {
						// 核心转动的数据已经到了（姿态已离开基准）：按实测转动落账。
						// 连续快速的中层在这里会读到累计后的 180/270，一并落账。
						var observed = this.matrixMultiply(snap.matrix, this.matrixTranspose(base));
						if (this.isSliceCoreDelta(observed)) {
							this.rotSyncM = snap.matrix;
							this.rotRestRefM = snap.matrix;
							this.rotAltM = null;
							this.rotCandidate = null;
							this.cancelRotFlush();
							this.applyRotationBookkeeping(observed);
							this.sliceCoreClaim = null;
							this.log("view", "中层带起的转体已并入中层动画");
							return;
						}
					}
					// 陀螺仪数据先到、刚刚已被判成一次整台转体（手上姿态仍停在判定后的朝向）：
					// 撤回多出来的动画与记录，基准已经在核心转动之后
					if (snap && snap.matrix && this.matrixEquals(snap.matrix, base) && this.retractRotationCommit()) {
						return;
					}
					// 数据还没到：登记认领（连续中层会累计张数），窗口内先到的整台转体判定
					// 按核心转动处理（只记账，不放动画、不写记录）
					var pending = this.sliceCoreClaim && Date.now() <= this.sliceCoreClaim.until ? this.sliceCoreClaim.count : 0;
					this.sliceCoreClaim = { until: Date.now() + this.sliceCoreExpectMs, count: pending + 1 };
				},

				// 转体记账：与 applyDetectedRotation 里的推进完全一致，只是不放动画、不写记录。
				// 跟随模式下朝向由陀螺仪直接呈现，朝向矩阵不动。
				applyRotationBookkeeping: function(deltaMatrix) {
					var parts = this.rotDecompose(deltaMatrix).reverse();
					for (var i = 0; i < parts.length; i++) {
						if (!this.gyroFollow) {
							this.updateOrientation(parts[i].axis, parts[i].pow);
						}
						if (this.gyroRecordM) {
							this.gyroRecordM = this.matrixMultiply(this.rotationMatrix(parts[i].axis, parts[i].pow), this.gyroRecordM);
						}
					}
				},

				// 陀螺仪数据先到、核心转动已被判成一次整台转体：把多出来的那一次撤回
				// （屏幕动画倒回、转体记录删掉；朝向矩阵与记录帧保留）。
				retractRotationCommit: function() {
					var last = this.lastRotationCommit;
					if (!last || !last.delta) {
						return false;
					}
					if (Date.now() - last.at > this.sliceRetractMs || !this.isSliceCoreDelta(last.delta)) {
						return false;
					}
					this.lastRotationCommit = null;
					if (last.visual && this.twistyScene && this.twistyScene.applyMoves) {
						// applyMoves 会立即结清在途动画，能把屏幕上的整台转体干净倒回
						var self = this;
						var back = this.rotDecompose(this.matrixTranspose(last.delta)).reverse().map(function(part) {
							return [1, self.cubeDimension, part.axis, part.pow];
						});
						if (back.length) {
							this.twistyScene.applyMoves(back);
						}
					}
					for (var i = 0; i < last.texts.length; i++) {
						this.removeRotationRecord(last.texts[i], last.at);
					}
					this.log("view", "中层带起的转体已并入中层动画");
					return true;
				},

				removeRotationRecord: function(text, at) {
					for (var i = this.orientationMoves.length - 1; i >= 0; i--) {
						if (this.orientationMoves[i] === text) {
							this.orientationMoves.splice(i, 1);
							break;
						}
					}
					for (var j = 0; j < this.moveHistory.length; j++) {
						var item = this.moveHistory[j];
						if (item && item.text === text && Math.abs((item.time || 0) - at) < 1500) {
							this.moveHistory.splice(j, 1);
							break;
						}
					}
				},

				applyDetectedRotation: function(deltaMatrix) {
					// 中层带起的核心转动：只记账（见 absorbSliceCoreRotation）。
					// 否则整台转体动画会与中层动画叠加，虚拟魔方多转一次、记录里也多一条转体。
					// 连续中层的核心转动可能被判定合并（180/270 甚至复合），认领张数 ≥2 时
					// 不再限制角度，统一按累计核心转动记账。
					if (this.sliceCoreClaim && this.sliceCoreClaim.count > 0) {
						var claim = this.sliceCoreClaim;
						var claimed = Date.now() <= claim.until;
						var accept = claimed && (claim.count >= 2 || this.isSliceCoreDelta(deltaMatrix));
						this.sliceCoreClaim = null;
						if (accept) {
							this.applyRotationBookkeeping(deltaMatrix);
							this.log("view", "中层带起的转体已并入中层动画");
							// 手上姿态仍偏离基准 ⇒ 还有核心转动没落账，继续认领剩下的张数
							var pose = this.gyroViewMatrix();
							var snapNow = pose ? this.rotNearestGroupElement(pose) : null;
							if (snapNow && snapNow.matrix && !this.matrixEquals(snapNow.matrix, this.rotSyncM)) {
								this.sliceCoreClaim = { until: Date.now() + this.sliceCoreExpectMs, count: claim.count - 1 };
							}
							return;
						}
					}
					// applyMoves/updateOrientation 都按左乘累计，复合分解必须倒序执行。
					var parts = this.rotDecompose(deltaMatrix).reverse();
					var self = this;
					this.lastRotationCommit = {
						at: Date.now(),
						visual: !this.gyroFollow,
						delta: deltaMatrix.map(function(row) { return row.slice(); }),
						parts: parts.map(function(part) { return { axis: part.axis, pow: part.pow }; }),
						texts: []
					};
					if (!parts.length) {
						if (this.gyroRecordM) {
							this.gyroRecordM = this.matrixMultiply(deltaMatrix, this.gyroRecordM);
						}
						this.log("view", "转体已同步");
						return;
					}
					// 记录字母按标准体帧：x=绕实体 R 轴、y=绕 U 轴、z=绕 F 轴，与握持朝向无关；
					// 动画/朝向/记录帧仍按场景帧实际转动推进，仅文本按体帧换算
					var baseM = this.gyroFollow ? this.gyroRecordM : this.orientationMatrix;
					var bodyDelta = deltaMatrix;
					if (baseM) {
						bodyDelta = this.matrixMultiply(this.matrixTranspose(baseM), this.matrixMultiply(deltaMatrix, baseM));
					}
					var bodyParts = this.rotDecompose(bodyDelta, ["R", "U", "F"]).reverse();
					parts.forEach(function(part) {
						if (!self.gyroFollow) {
							// 关闭跟随：播放整体转动动画并推进朝向矩阵（只检测 XYZ 的普通模式）；
							// 开启跟随：姿态由陀螺仪直接呈现，不重复搬动视图
							self.twistyScene.addMoves([[1, self.cubeDimension, part.axis, part.pow]]);
							self.updateOrientation(part.axis, part.pow);
						}
						if (self.gyroRecordM) {
							self.gyroRecordM = self.matrixMultiply(self.rotationMatrix(part.axis, part.pow), self.gyroRecordM);
						}
					});
					bodyParts.forEach(function(part) {
						var text = { R: "x", U: "y", F: "z" }[part.axis] + (part.pow === 2 ? "2" : part.pow === -1 ? "'" : "");
						if (self.lastRotationCommit) {
							self.lastRotationCommit.texts.push(text);
						}
						self.orientationMoves.push(text);
						self.pushHistory(text, self.deviceName || "cube", Date.now());
						self.log("view", text + " · 转体");
					});
				},

				syncRotationFrame: function() {
					// 开启跟随瞬间：基准对齐当前实际姿态（重新认面）
					if (!this.gyroLastQ) {
						return;
					}
					var sceneM = this.gyroViewMatrix();
					var settled = this.rotNearestGroupElement(sceneM).matrix;
					this.rotSyncM = settled;
					this.rotAltM = null;
					this.rotRestRefM = settled;
					this.rotRestSince = Date.now();
					this.rotLastM = sceneM;
					this.rotCandidate = null;
					this.cancelRotFlush();
					this.gyroRecordM = settled;
				},

				connect: function() {
					var self = this;
					if (!window.GiikerCube) {
						this.setStatus("error", "蓝牙适配层未加载");
						return;
					}
					this.elements.connectBtn.disabled = true;
					this.ignoreMoves = true;
					this.hasValidCubeState = false;
					this.lastCubePrevMoves = [];
					this.lastCubeHistoryStamp = null;
					this.clearPendingCubeMove(false);
					this.hideMacHelp();
					this.setStatus("idle", "等待选择设备");
					GiikerCube.setCallback(function(facelet, prevMoves, lastTs, hardware) {
						self.onCubeCallback(facelet, prevMoves, lastTs, hardware);
					});
					GiikerCube.setGyroCallback(function(x, y, z, w, hardware) {
						self.onCubeGyro(x, y, z, w, hardware);
					});
					GiikerCube.setEventCallback(function(info) {
						if (info === "disconnect") {
							self.connected = false;
							self.lastCubePrevMoves = [];
							self.lastCubeHistoryStamp = null;
							self.clearPendingCubeMove(false);
							self.setConnectLabel("连接魔方");
							self.elements.connectBtn.classList.remove("isActive");
							self.setStatus("idle", "已断开");
							self.gyroFollow = false;
							if (self.elements.gyroToggleBtn) {
								self.elements.gyroToggleBtn.classList.remove("isActive");
							}
							self.clearGyroSession();
							self.stopGyroDisplay();
							self.log("bluetooth", "设备连接已断开");
						}
					});
					GiikerCube.init().then(function() {
						self.ignoreMoves = false;
						self.connected = true;
						self.setConnectLabel(self.deviceName ? self.deviceName : "已连接");
						self.elements.connectBtn.classList.add("isActive");
						self.hideMacHelp();
						self.setStatus("connected", "已连接" + (self.deviceName ? " · " + self.deviceName : ""));
						self.log("bluetooth", "连接成功");
						if (self.gyroFollow) {
							self.syncRotationFrame();
						}
					}).catch(function(error) {
						self.ignoreMoves = false;
						self.connected = false;
						self.showConnectionError(error);
					}).then(function() {
						self.elements.connectBtn.disabled = false;
					});
				},

				disconnect: function() {
					var self = this;
					this.elements.connectBtn.disabled = true;
					Promise.resolve(GiikerCube.stop()).catch(function(error) {
						self.log("error", String(error && error.message || error));
					}).then(function() {
						self.connected = false;
						self.hasValidCubeState = false;
						self.lastCubePrevMoves = [];
						self.lastCubeHistoryStamp = null;
						self.clearPendingCubeMove(false);
						self.setConnectLabel("连接魔方");
						self.elements.connectBtn.classList.remove("isActive");
						self.elements.connectBtn.disabled = false;
						self.setStatus("idle", "未连接");
						self.gyroFollow = false;
						if (self.elements.gyroToggleBtn) {
							self.elements.gyroToggleBtn.classList.remove("isActive");
						}
						self.clearGyroSession();
						self.stopGyroDisplay();
					});
				},

				setConnectLabel: function(text) {
				var btn = this.elements.connectBtn;
				if (!btn) return;
				var label = btn.querySelector(".connectLabel");
				if (label) { label.textContent = text; } else { btn.textContent = text; }
			},
			resetView: function() {
					// 只还原魔方状态：朝向（整体朝向矩阵 / 显示四元数 / 视线 / 视图旋转）保持不变
					var keepOrientation = this.orientationMatrix ? this.orientationMatrix.map(function(row) { return row.slice(); }) : null;
					var keepDisplayQ = this.currentDisplayQuat();
					var keepYaw = this.viewYaw || 0;
					var keepPitch = this.viewPitch || 0;
					var keepRoll = this.elements.cubeStage ? (this.elements.cubeStage.dataset.roll || "0") : "0";
					this.moveHistory = [];
					this.manualMoveHistory = [];
					this.moveCount = 0;
					this.hideMacHelp();
					this.initTwisty();
					// 场景重建会把朝向与视线清零，这里把重置前的朝向原样放回去
					this.orientationMatrix = keepOrientation || this.identityMatrix();
					this.viewYaw = keepYaw;
					this.viewPitch = keepPitch;
					this.setViewDrag(keepYaw, keepPitch);
					if (Number(keepRoll)) {
						this.elements.cubeStage.dataset.roll = String(Number(keepRoll));
						var inner = this.elements.cubeStage.firstElementChild;
						if (inner) {
							inner.style.transform = "rotate(" + Number(keepRoll) + "deg)";
							inner.style.transformOrigin = "50% 50%";
						}
					}
					if (this.twistyScene && this.twistyScene.applyMoves) {
						// 把重置前累积的整体朝向重新施加到新场景（立方体状态是新的，朝向沿用）
						var self = this;
						var applied = this.rotDecompose(this.orientationMatrix).reverse().map(function(part) {
							return [1, self.cubeDimension, part.axis, part.pow];
						});
						if (applied.length) {
							this.twistyScene.applyMoves(applied);
						}
					}
					if (this.gyroFollow) {
						// 跟随模式：显示四元数就是从手中姿态来的，直接续用同一姿态、不留跳变
						this.applyDisplayQuat(keepDisplayQ);
						this.gyroCurrentQ = keepDisplayQ.slice();
						if (this.gyroTargetQ) {
							this.startGyroAnimation();
						}
					}
					this.renderMoves();
					this.elements.moveCount.textContent = "0";
					this.elements.lastTs.textContent = "--:--";
					this.log("view", "视图已重置");
				},

				onCubeCallback: function(facelet, prevMoves, lastTs, hardware) {
					this.hasValidCubeState = true;
					this.currentFacelet = String(facelet || "").toUpperCase();
					this.hideMacHelp();
					if (hardware) {
						this.setDevice(hardware, this.batteryLevel);
					}
					if (this.ignoreMoves) {
						this.saveCubeHistory(prevMoves, lastTs);
						this.log("state", "已读取设备初始状态");
						return;
					}
					var movesToPlay = this.getNewCubeMoves(prevMoves, lastTs);
					var hasMoves = movesToPlay.length > 0;
					if (hasMoves) {
						var timestamp = lastTs && (lastTs[1] || lastTs[0]) || Date.now();
						this.processCubeMoveBatch(movesToPlay, hardware || "cube", timestamp, facelet);
					} else {
						this.flushPendingCubeMove();
						this.log("state", "收到状态");
						this.updateSolveDetection(facelet, false);
					}
				},

				processCubeMoveBatch: function(movesToPlay, source, timestamp, facelet) {
					for (var i = 0; i < movesToPlay.length; i++) {
						this.processCubeMove(movesToPlay[i], source, timestamp, facelet);
					}
				},

				processCubeMove: function(rawMove, source, timestamp, facelet) {
					var prepared = this.prepareCubeFaceMove(rawMove);
					if (!prepared) {
						this.flushPendingCubeMove();
						this.playMove(rawMove, source, timestamp, {
							fromCube: true
						});
						this.updateSolveDetection(facelet, true);
						return;
					}
					if (this.pendingCubeMove && this.isCloseCubeMove(timestamp, this.pendingCubeMove.timestamp)) {
						var slice = this.getSliceFromCubePair(this.pendingCubeMove.prepared.cubeText || this.pendingCubeMove.prepared.text, prepared.cubeText || prepared.text);
						if (slice) {
							var pending = this.pendingCubeMove;
							this.clearPendingCubeMove(false);
							this.playCubeSliceMove(slice, [pending.rawMove, rawMove], source, timestamp, facelet);
							return;
						}
					}
					this.flushPendingCubeMove();
					if (this.canStartSlicePair(prepared.cubeText || prepared.text)) {
						this.holdCubeMove(rawMove, prepared, source, timestamp, facelet);
						return;
					}
					this.playMove(rawMove, source, timestamp, {
						fromCube: true
					});
					this.updateSolveDetection(facelet, true);
				},

				prepareCubeFaceMove: function(rawMove) {
					var move = this.normalizeMove(rawMove);
					if (!move || move.type !== "face") {
						return null;
					}
					return this.transformCubeMove(move);
				},

				isCloseCubeMove: function(currentTimestamp, previousTimestamp) {
					if (currentTimestamp == null || previousTimestamp == null) {
						return true;
					}
					return Math.abs(currentTimestamp - previousTimestamp) <= this.cubeSliceWindowMs;
				},

				holdCubeMove: function(rawMove, prepared, source, timestamp, facelet) {
					var self = this;
					this.clearPendingCubeMove(false);
					this.pendingCubeMove = {
						rawMove: rawMove,
						prepared: prepared,
						source: source,
						timestamp: timestamp,
						facelet: facelet
					};
					this.pendingCubeMoveTimer = setTimeout(function() {
						self.flushPendingCubeMove();
					}, this.cubeSliceWindowMs);
				},

				flushPendingCubeMove: function() {
					if (!this.pendingCubeMove) {
						return;
					}
					var pending = this.pendingCubeMove;
					this.clearPendingCubeMove(false);
					this.playMove(pending.rawMove, pending.source, pending.timestamp, {
						fromCube: true
					});
					this.updateSolveDetection(pending.facelet, true);
				},

				clearPendingCubeMove: function(flush) {
					if (flush) {
						this.flushPendingCubeMove();
						return;
					}
					if (this.pendingCubeMoveTimer) {
						clearTimeout(this.pendingCubeMoveTimer);
						this.pendingCubeMoveTimer = null;
					}
					this.pendingCubeMove = null;
				},

				canStartSlicePair: function(moveText) {
					var candidates = ["R", "R'", "L", "L'", "U", "U'", "D", "D'", "F", "F'", "B", "B'"];
					return candidates.indexOf(moveText) >= 0;
				},

				getSliceFromCubePair: function(firstText, secondText) {
					var candidates = ["M", "M'", "E", "E'", "S", "S'"];
					for (var i = 0; i < candidates.length; i++) {
						var parts = this.expandSliceMoveToken(candidates[i]);
						if (!parts || parts.length !== 3) {
							continue;
						}
						var firstManualFace = this.facePartToCube(parts[0]);
						var secondManualFace = this.facePartToCube(parts[1]);
						if (firstManualFace && secondManualFace && this.isSameTwoMoveSet(firstText, secondText, firstManualFace, secondManualFace)) {
							return {
								text: candidates[i],
								parts: parts.slice(),
								manualMove: parts[2]
							};
						}
					}
					return null;
				},

				facePartToCube: function(token) {
					var move = this.normalizeMove(token);
					if (!move || move.type !== "face") {
						return "";
					}
					move = this.mapManualMove(move);
					return this.formatMoveText(move.face, move.pow);
				},

				isSameTwoMoveSet: function(a, b, x, y) {
					return a === x && b === y || a === y && b === x;
				},

				playCubeSliceMove: function(slice, rawMoves, source, timestamp, facelet) {
					// 陀螺仪跟随下：整体转体由陀螺仪呈现，动画按两个外层转动播放，
					// 与陀螺仪转体合成完整的中层效果（记录仍为中层 M/S/E）；普通模式播中层动画不变
					var sliceAnimation = !this.gyroFollow;
					// 物理中层的核心（中轴）随中层一起转，陀螺仪必然读到这一次"整台转体"。
					// 中层效果已由中层动画（普通模式）或手中姿态（跟随模式）呈现，这次转动只能
					// 作记账用：先看它是否已被判定过（撤掉多出来的动画与记录），否则把参考帧推
					// 进到中轴新朝向，避免再被当成一次整台转体。
					this.absorbSliceCoreRotation();
					for (var i = 0; i < rawMoves.length; i++) {
						this.playMove(rawMoves[i], source, timestamp, {
							fromCube: true,
							silent: true,
							noAnimation: sliceAnimation,
							noHistory: true,
							noFormula: true,
							noCount: true
						});
					}
					this.playMove(slice.manualMove, "manual", timestamp, {
						silent: true,
						noAnimation: true,
						noHistory: true,
						noFormula: true,
						noCount: true
					});
					this.displaySliceMove(this.normalizeMove(slice.text), source, timestamp, {
						fromCube: true,
						noAnimation: this.gyroFollow
					});
					this.updateSolveDetection(facelet, true);
				},

				getNewCubeMoves: function(prevMoves, lastTs) {
					var current = this.normCubeHistory(prevMoves);
					if (!current.length) {
						this.lastCubeHistoryStamp = this.getCubeHistoryStamp(lastTs);
						return [];
					}
					var previous = this.lastCubePrevMoves || [];
					var stamp = this.getCubeHistoryStamp(lastTs);
					if (previous.length && this.areMoveHistoriesEqual(current, previous) && stamp !== null && stamp === this.lastCubeHistoryStamp) {
						return [];
					}
					var newCount = 1;
					if (previous.length) {
						var overlap = this.findHistoryOverlap(current, previous);
						if (overlap > 0) {
							newCount = overlap;
						}
					}
					this.lastCubePrevMoves = current.slice(0, 12);
					this.lastCubeHistoryStamp = stamp;
					return current.slice(0, Math.min(newCount, current.length)).reverse();
				},

				saveCubeHistory: function(prevMoves, lastTs) {
					var current = this.normCubeHistory(prevMoves);
					if (current.length) {
						this.lastCubePrevMoves = current.slice(0, 12);
					}
					this.lastCubeHistoryStamp = this.getCubeHistoryStamp(lastTs);
				},

				normCubeHistory: function(prevMoves) {
					var result = [];
					for (var i = 0; prevMoves && i < prevMoves.length; i++) {
						var move = this.normalizeMove(prevMoves[i]);
						if (move && move.type === "face") {
							result.push(move.text);
						}
					}
					return result;
				},

				findHistoryOverlap: function(current, previous) {
					var bestOffset = 0;
					var bestMatch = 0;
					for (var offset = 1; offset < current.length; offset++) {
						var match = 0;
						while (match < previous.length && offset + match < current.length && current[offset + match] === previous[match]) {
							match++;
						}
						if (match > bestMatch) {
							bestMatch = match;
							bestOffset = offset;
						}
					}
					return bestMatch > 0 ? bestOffset : 0;
				},

				areMoveHistoriesEqual: function(a, b) {
					if (a.length !== b.length) {
						return false;
					}
					for (var i = 0; i < a.length; i++) {
						if (a[i] !== b[i]) {
							return false;
						}
					}
					return true;
				},

				getCubeHistoryStamp: function(lastTs) {
					if (!lastTs) {
						return null;
					}
					if (lastTs[0] != null) {
						return lastTs[0];
					}
					if (lastTs[1] != null) {
						return lastTs[1];
					}
					return null;
				},

				playMove: function(rawMove, source, timestamp, options) {
					options = options || {};
					var move = this.normalizeMove(rawMove);
					if (!move) {
						if (!options.silent) {
							this.log("skip", "无法识别转动: " + rawMove);
						}
						return null;
					}
					if (move.type === "slice") {
						return this.playManualSliceMove(move, source, timestamp, options);
					}
					if (!options.fromCube) {
						move = this.mapManualMove(move);
					}
					if (move.type === "orientation") {
						if (this.gyroFollow || this.cubeHasGyro) {
							// 带陀螺仪的魔方：x/y/z 整体转动完全失效（无动画、无朝向、无记录），
							// 朝向只由陀螺仪/真实转动决定；跟随开启时同样失效
							return null;
						}
						this.applyOrientationMove(move, options);
						if (!options.noHistory && !options.silent) {
							this.pushHistory(move.text, source, timestamp);
							this.log("view", move.text + (source ? " · " + source : ""));
						}
						return move;
					}
						if (options.fromCube) {
							this.flushPendingRotation();
							move = this.transformCubeMove(move);
						}
					if (!options.noFormula) {
						this.recordFormulaMove(move);
					}
					this.applyVirtualMove(move);
					if (!options.noAnimation) {
						this.twistyScene.addMoves([move.twisty]);
					}
					if (!options.noCount) {
						this.moveCount += 1;
						if (options.fromCube) {
							this.movesSinceState += 1;
							if (this.isPracticeMode && this.practiceSolveStartTime === null) {
								this.practiceSolveStartTime = performance.now();
							}
						}
						this.elements.moveCount.textContent = String(this.moveCount);
					}
					if (!options.noHistory && !options.silent) {
						this.pushHistory(move.text, source, timestamp);
						this.log("move", move.text + (source ? " · " + source : ""));
					}
					if (!options.noHistory) {
						this.pushManualMoveHistory(move);
					}
					this.recordSolveMove(move, source, options);
					return move;
				},

				playManualSliceMove: function(move, source, timestamp, options) {
					var parts = this.expandSliceMoveToken(move.text);
					if (!parts || parts.length !== 3) {
						return null;
					}
					for (var i = 0; i < parts.length; i++) {
						this.playMove(parts[i], "manual", timestamp, {
							silent: true,
							noAnimation: true,
							noHistory: true,
							noFormula: true,
							noCount: true
						});
					}
					return this.displaySliceMove(move, source, timestamp, options);
				},

				displaySliceMove: function(move, source, timestamp, options) {
					options = options || {};
					if (!move || move.type !== "slice") {
						return null;
					}
					var visualMove = this.buildSliceVisualMove(move);
					if (!options.noFormula) {
						this.recordFormulaMove(move);
					}
					if (!options.noAnimation && visualMove) {
						this.twistyScene.addMoves([visualMove.twisty]);
					}
					if (!options.noCount) {
						this.moveCount += 1;
						if (options.fromCube) {
							this.movesSinceState += 1;
							if (this.isPracticeMode && this.practiceSolveStartTime === null) {
								this.practiceSolveStartTime = performance.now();
							}
						}
						this.elements.moveCount.textContent = String(this.moveCount);
					}
					if (!options.noHistory && !options.silent) {
						this.pushHistory(move.text, source, timestamp);
						this.log("move", move.text + (source ? " · " + source : ""));
					}
					if (!options.noHistory) {
						this.pushManualMoveHistory(move);
					}
					this.recordSolveMove(move, source, options);
					return move;
				},

				pushHistory: function(text, source, timestamp) {
					this.moveHistory.unshift({
						text: text,
						source: source || "",
						time: timestamp || Date.now()
					});
					if (this.moveHistory.length > 7) {
						this.moveHistory.length = 7;
					}
					this.elements.lastTs.textContent = this.formatTime(timestamp || Date.now());
					this.renderMoves();
				},

				pushManualMoveHistory: function(move) {
					if (!move) {
						return;
					}
					this.manualMoveHistory.push(move.type === "slice" ? move.text : move.text);
					if (this.manualMoveHistory.length > 100) {
						this.manualMoveHistory.shift();
					}
				},

				popManualMoveHistory: function() {
					while (this.manualMoveHistory.length) {
						var last = this.manualMoveHistory.pop();
						if (last) {
							return last;
						}
					}
					return null;
				},

				playLastMoveInverse: function(source) {
				var last = this.popManualMoveHistory();
				if (!last) {
					return;
				}
				var inverse = this.invertFormulaToken(last);
				if (!inverse) {
					return;
				}
				if (this.moveHistory.length) {
					this.moveHistory.shift();
				}
				this.renderMoves();
				if (this.moveCount > 0) {
					this.moveCount -= 1;
					this.elements.moveCount.textContent = String(this.moveCount);
				}
				this.playMove(inverse, source || "manual", Date.now(), { noHistory: true, noCount: true });
			},

				normalizeMove: function(rawMove) {
					if (!rawMove) {
						return null;
					}
					var text = String(rawMove).replace(/[’‘`]/g, "'").replace(/\s+/g, "");
					var match = /^([URFDLBurfdlb])('?)([23]?)$/i.exec(text);
					if (match) {
						var isWide = /[urfdlb]/.test(match[1]);
						var face = match[1].toUpperCase();
						var displayFace = isWide ? match[1].toLowerCase() : face;
						var count = match[3] ? Number(match[3]) : 1;
						var facePow = match[2] ? -count : count;
						return {
							text: displayFace + (match[2] || "") + (match[3] || ""),
							type: "face",
							face: face,
							wide: isWide,
							pow: facePow,
							twisty: [1, isWide ? 2 : 1, face, facePow]
						};
					}
					match = /^([MES])('?)$/i.exec(text);
					if (match) {
						var slice = match[1].toUpperCase();
						var suffix = match[2] || "";
						return {
							text: slice + suffix,
							type: "slice",
							slice: slice,
							pow: suffix === "'" ? -1 : 1,
							parts: this.expandSliceMoveToken(slice + suffix) || []
						};
					}
					match = /^([XYZ])([2']?)$/i.exec(text);
					if (!match) {
						return null;
					}
					var axis = {
						X: "R",
						Y: "U",
						Z: "F"
					}[match[1].toUpperCase()];
					var pow = match[2] === "2" ? 2 : match[2] === "'" ? -1 : 1;
					return {
						text: match[1].toLowerCase() + match[2],
						type: "orientation",
						axis: axis,
						pow: pow,
						twisty: [1, this.cubeDimension, axis, pow]
					};
				},

				mapManualMove: function(move) {
					if (!move) {
						return move;
					}
					if (move.type === "face") {
						var face = this.mapUiFace(move.face);
						var layerEnd = move.wide ? 2 : 1;
						return {
							text: move.text,
							type: "face",
							face: face,
							uiFace: move.face,
							wide: move.wide,
							pow: move.pow,
							twisty: [1, layerEnd, face, move.pow]
						};
					}
					if (move.type === "orientation") {
						var axis = this.mapUiFace(move.axis);
						return {
							text: move.text,
							type: "orientation",
							axis: axis,
							uiAxis: move.axis,
							pow: move.pow,
							twisty: [1, this.cubeDimension, axis, move.pow]
						};
					}
					return move;
				},

				buildSliceVisualMove: function(move) {
					var parts = this.expandSliceMoveToken(move && move.text);
					if (!parts || parts.length !== 3) {
						return null;
					}
					var orientation = this.normalizeMove(parts[2]);
					if (!orientation || orientation.type !== "orientation") {
						return null;
					}
					orientation = this.mapManualMove(orientation);
					return {
						text: move.text,
						type: "slice",
						axis: orientation.axis,
						pow: orientation.pow,
						twisty: [2, 2, orientation.axis, orientation.pow]
					};
				},

				mapUiFace: function(face) {
					return {
						U: "U",
						R: "B",
						F: "R",
						D: "D",
						L: "F",
						B: "L"
					}[face] || face;
				},

				unmapUiFace: function(face) {
					return {
						U: "U",
						B: "R",
						R: "F",
						D: "D",
						F: "L",
						L: "B"
					}[face] || face;
				},

				applyOrientationMove: function(move, options) {
					options = options || {};
					if (!options.noAnimation) {
						this.twistyScene.addMoves([move.twisty]);
					}
					this.updateOrientation(move.axis, move.pow);
					this.orientationMoves.push(move.text);
				},

				rollView: function(direction) {
					var current = Number(this.elements.cubeStage.dataset.roll || "0");
					current = (current + direction * 90) % 360;
					this.elements.cubeStage.dataset.roll = String(current);
					var inner = this.elements.cubeStage.firstElementChild;
					if (inner) {
						inner.style.transform = "rotate(" + current + "deg)";
						inner.style.transformOrigin = "50% 50%";
					}
				},

				transformCubeMoveFollow: function(move) {
					// 跟随模式：动画与虚拟状态保持蓝牙体帧（陀螺仪四元数承担整体朝向），
					// 记录文本按 gyroRecordM 重映射到当前实际朝向（转体识别的自检链路）
					var recordFace = move.face;
					var sign = 1;
					if (this.gyroRecordM) {
						var vector = this.matrixVectorMultiply(this.gyroRecordM, this.faceNormal(move.face));
						var hit = this.faceFromNormal(vector);
						if (!hit) {
							hit = this.faceFromNormal([-vector[0], -vector[1], -vector[2]]);
							sign = -1;
						}
						if (hit) {
							recordFace = hit;
						}
					}
					var uiFace = this.unmapUiFace(recordFace);
					return {
						text: this.formatMoveText(move.wide ? uiFace.toLowerCase() : uiFace, sign * move.pow),
						cubeText: this.formatMoveText(move.face, move.pow),
						type: "face",
						face: move.face,
						wide: move.wide,
						pow: move.pow,
						twisty: [1, move.wide ? 2 : 1, move.face, move.pow]
					};
				},

				transformCubeMove: function(move) {
					if (!move || move.type !== "face") {
						return move;
					}
					if (this.gyroFollow) {
						return this.transformCubeMoveFollow(move);
					}
					if (!this.orientationMatrix) {
						this.orientationMatrix = this.identityMatrix();
					}
					var targetFace = this.faceFromNormal(this.matrixVectorMultiply(this.orientationMatrix, this.faceNormal(move.face)));
					if (!targetFace) {
						move.cubeText = move.text;
						return move;
					}
					var transformed = this.matrixMultiply(
						this.matrixMultiply(this.orientationMatrix, this.rotationMatrix(move.face, move.pow)),
						this.matrixTranspose(this.orientationMatrix)
					);
					var pows = Math.abs(move.pow) === 2 ? [2] : [move.pow, -move.pow];
					var layerEnd = move.wide ? 2 : 1;
					var uiFace = this.unmapUiFace(targetFace);
					var displayFace = move.wide ? uiFace.toLowerCase() : uiFace;
					for (var i = 0; i < pows.length; i++) {
						if (this.matrixEquals(transformed, this.rotationMatrix(targetFace, pows[i]))) {
							return {
								text: this.formatMoveText(displayFace, pows[i]),
								cubeText: this.formatMoveText(targetFace, pows[i]),
								type: "face",
								face: targetFace,
								wide: move.wide,
								pow: pows[i],
								twisty: [1, layerEnd, targetFace, pows[i]]
							};
						}
					}
					return {
						text: this.formatMoveText(displayFace, move.pow),
						cubeText: this.formatMoveText(targetFace, move.pow),
						type: "face",
						face: targetFace,
						wide: move.wide,
						pow: move.pow,
						twisty: [1, layerEnd, targetFace, move.pow]
					};
				},

				updateOrientation: function(axis, pow) {
					if (!this.orientationMatrix) {
						this.orientationMatrix = this.identityMatrix();
					}
					this.orientationMatrix = this.matrixMultiply(this.rotationMatrix(axis, pow), this.orientationMatrix);
				},

				formatMoveText: function(face, pow) {
					if (!face) return "";
					var abs = Math.abs(pow);
					if (abs === 0 || abs === 4) return "";
					var suffix = abs === 1 ? "" : String(abs);
					return face + (pow < 0 ? "'" : "") + suffix;
				},

				identityMatrix: function() {
					return [
						[1, 0, 0],
						[0, 1, 0],
						[0, 0, 1]
					];
				},

				rotationMatrix: function(face, pow) {
					var base = {
						U: [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
						R: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
						F: [[0, 1, 0], [-1, 0, 0], [0, 0, 1]],
						D: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
						L: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
						B: [[0, -1, 0], [1, 0, 0], [0, 0, 1]]
					}[face];
					var turns = ((pow % 4) + 4) % 4;
					var result = this.identityMatrix();
					for (var i = 0; i < turns; i++) {
						result = this.matrixMultiply(result, base);
					}
					return result;
				},

				matrixMultiply: function(a, b) {
					var result = this.identityMatrix();
					for (var row = 0; row < 3; row++) {
						for (var col = 0; col < 3; col++) {
							result[row][col] = a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col];
						}
					}
					return result;
				},

				matrixTranspose: function(matrix) {
					return [
						[matrix[0][0], matrix[1][0], matrix[2][0]],
						[matrix[0][1], matrix[1][1], matrix[2][1]],
						[matrix[0][2], matrix[1][2], matrix[2][2]]
					];
				},

				faceNormal: function(face) {
					return {
						U: [0, 1, 0],
						R: [1, 0, 0],
						F: [0, 0, 1],
						D: [0, -1, 0],
						L: [-1, 0, 0],
						B: [0, 0, -1]
					}[face];
				},

				faceFromNormal: function(normal) {
					var key = normal.join(",");
					return {
						"0,1,0": "U",
						"1,0,0": "R",
						"0,0,1": "F",
						"0,-1,0": "D",
						"-1,0,0": "L",
						"0,0,-1": "B"
					}[key];
				},

				matrixVectorMultiply: function(matrix, vector) {
					return [
						matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
						matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
						matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2]
					];
				},

				matrixEquals: function(a, b) {
					for (var row = 0; row < 3; row++) {
						for (var col = 0; col < 3; col++) {
							if (a[row][col] !== b[row][col]) {
								return false;
							}
						}
					}
					return true;
				},

				renderMoves: function() {
					if (!this.elements.moveList) {
						return;
					}
					this.elements.moveList.innerHTML = "";
					var frag = document.createDocumentFragment();
					this.moveHistory.slice(0, 7).forEach(function(item) {
						var chip = document.createElement("span");
						chip.className = "moveChip";
						chip.textContent = item.text;
						frag.appendChild(chip);
					});
					this.elements.moveList.appendChild(frag);
					this.syncMobileMetrics();
				},

				syncMobileMetrics: function() {
					var device = document.getElementById("mobileDeviceName");
					var count = document.getElementById("mobileMoveCount");
					if (device) device.textContent = this.deviceName || "-";
					if (count) count.textContent = String(this.moveCount || 0);
				},

				setDevice: function(name, battery) {
					if (name) {
						this.deviceName = name;
					}
					if (typeof battery === "number") {
						this.batteryLevel = battery;
					}
					var label = this.deviceName || "-";
					if (typeof this.batteryLevel === "number" && this.batteryLevel > 0) {
						label += " · " + this.batteryLevel + "%";
					}
					this.elements.deviceName.textContent = label;
					var mobileDevice = document.getElementById("mobileDeviceName");
					if (mobileDevice) mobileDevice.textContent = label;
					if (this.connected && this.elements.connectBtn) {
						this.setConnectLabel(label);
						this.elements.connectBtn.classList.add("isActive");
					}
					if (this.connected) {
						this.setStatus("connected", "已连接" + (this.deviceName ? " · " + this.deviceName : ""));
					}
				},

				setStatus: function(state, text) {
					this.elements.statusPill.dataset.state = state;
					this.elements.statusPill.textContent = text;
					var effectiveState = state;
					if (this.elements.connectBtn) {
						this.elements.connectBtn.dataset.state = state;
						if (state === "error") {
							var label = this.simplifyError(text);
							if (label === "cancel") {
								effectiveState = "idle";
								this.elements.connectBtn.dataset.state = "idle";
								this.setConnectLabel("连接魔方");
								this.elements.connectBtn.classList.remove("isActive");
							} else {
								this.setConnectLabel(label);
								this.elements.connectBtn.title = text;
								this.elements.connectBtn.classList.remove("isActive");
							}
						} else if (state === "idle") {
							this.setConnectLabel("连接魔方");
							this.elements.connectBtn.classList.remove("isActive");
						}
					}
					document.querySelectorAll("[data-action-panel-toggle]").forEach(function(operation) {
						operation.dataset.state = effectiveState;
						operation.title = text;
					});
				},

				simplifyError: function(text) {
					var t = String(text || "");
					if (/cancel|chooser|用户取消/i.test(t)) return "cancel";
					if (/格式不正确|格式错误|格式非法/.test(t)) return "MAC格式错";
					if (/浏览器不支持|web bluetooth|不支持蓝牙/.test(t)) return "不支持蓝牙";
					if (/蓝牙适配层|适配层未加载/.test(t)) return "蓝牙未就绪";
					if (/mac 地址错误|可能是 mac|解密|校验|verify error|invalid magic|invalid data|invalid axis|crc|wrong key|decrypt/i.test(t)) return "MAC解密错";
					return "连接失败";
				},

				showConnectionError: function(error) {
					var message = String(error && error.message || error || "连接失败");
					this.setStatus("error", message);
					this.log("error", String(error && error.stack || error || message));
					if (!/cancel|chooser|user cancelled|用户取消/i.test(message)) {
						this.showMacHelp("连接失败。如果设备需要解密，MAC 地址错误或浏览器未开启蓝牙广播权限都会导致失败。");
					}
				},

				showMacHelp: function(reason) {
					if (!this.elements.macHelp || !this.elements.macHelpReason) {
						return;
					}
					this.macWarningVisible = true;
					this.elements.macHelp.classList.add("isVisible");
					this.elements.macHelpReason.textContent = reason || "";
				},

				hideMacHelp: function() {
					if (!this.elements.macHelp || !this.elements.macHelpReason) {
						return;
					}
					this.macWarningVisible = false;
					this.elements.macHelp.classList.remove("isVisible");
					this.elements.macHelpReason.textContent = "";
				},

				log: function() {
					var parts = Array.prototype.slice.call(arguments).map(function(item) {
						if (item instanceof DataView) {
							return "[DataView " + item.byteLength + "]";
						}
						if (item && item.buffer instanceof ArrayBuffer && typeof item.byteLength === "number") {
							return "[DataView " + item.byteLength + "]";
						}
						if (typeof item === "object") {
							try {
								return JSON.stringify(item);
							} catch (error) {
								return String(item);
							}
						}
						return String(item);
					});
					var line = "[" + new Date().toLocaleTimeString() + "] " + parts.join(" ");
					var joined = parts.join(" ");
					if (!this.hasValidCubeState && /verify error|invalid magic|invalid data|invalid axis|crc checked error|wrong key|decrypt/i.test(joined)) {
						this.setStatus("error", "可能是 MAC 地址错误");
						this.showMacHelp("收到的数据无法正确解密或校验，MAC 地址可能不正确。");
					}
					var oldLines = this.elements.log.textContent ? this.elements.log.textContent.split("\n") : [];
					oldLines.push(line);
					if (oldLines.length > 90) {
						oldLines = oldLines.slice(oldLines.length - 90);
					}
					this.elements.log.textContent = oldLines.join("\n");
					this.elements.log.scrollTop = this.elements.log.scrollHeight;
					console.log.apply(console, arguments);
				},

				formatTime: function(value) {
					var date = new Date(value);
					return date.toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
						second: "2-digit"
					});
				},

				closeInlineExpansion: function(expansion, anchor, onClosed) {
					if (!expansion) { return; }
					expansion.classList.remove("isOpen");
					if (anchor) { anchor.setAttribute("aria-expanded", "false"); }
					setTimeout(function() {
						if (expansion.parentNode) { expansion.remove(); }
						if (typeof onClosed === "function") { onClosed(); }
					}, 260);
				},

				openNoticePrompt: function(options) {
					options = options || {};
					var old = document.querySelector(".appNoticeOverlay");
					if (old) { old.remove(); }
					var overlay = document.createElement("div");
					overlay.className = "appNoticeOverlay";
					overlay.innerHTML = '<section class="appNoticeCard' + (options.warning ? ' isWarning' : '') + '" role="alertdialog" aria-modal="true"><div class="appNoticeIcon" aria-hidden="true"></div><div class="appNoticeContent"><strong class="appNoticeTitle">' + this.escapeHtml(options.title || "请确认") + '</strong><p class="appNoticeMessage">' + this.escapeHtml(options.message || "") + '</p><div class="appNoticeActions"><button class="button secondary appNoticeCancel" type="button">' + this.escapeHtml(options.cancelText || "取消") + '</button><button class="button appNoticeConfirm" type="button">' + this.escapeHtml(options.confirmText || "确认") + '</button></div></div></section>';
					document.body.appendChild(overlay);
					var closed = false;
					var close = function(callback) {
						if (closed) { return; }
						closed = true;
						document.removeEventListener("keydown", onKeyDown, true);
						overlay.classList.remove("isOpen");
						setTimeout(function() {
							if (overlay.parentNode) { overlay.remove(); }
							if (typeof callback === "function") { callback(); }
						}, 180);
					};
					var onKeyDown = function(event) {
						if (event.key === "Escape") { close(options.onCancel); }
					};
					overlay.querySelector(".appNoticeCancel").addEventListener("click", function() { close(options.onCancel); });
					overlay.querySelector(".appNoticeConfirm").addEventListener("click", function() { close(options.onConfirm); });
					overlay.addEventListener("click", function(event) {
						if (event.target === overlay) { close(options.onCancel); }
					});
					document.addEventListener("keydown", onKeyDown, true);
					requestAnimationFrame(function() {
						overlay.classList.add("isOpen");
						overlay.querySelector(".appNoticeConfirm").focus();
					});
					return close;
				},
				showToast: function(message, duration) {
					var el = document.getElementById("toastNotify");
					if (!el) {
						el = document.createElement("div");
						el.id = "toastNotify";
						el.className = "toastNotify";
						document.body.appendChild(el);
					}
					el.textContent = message;
					el.classList.add("isVisible");
					clearTimeout(el._toastTimer);
					el._toastTimer = setTimeout(function() {
						el.classList.remove("isVisible");
					}, duration || 2000);
				}
			};

			window.smartCubeApp = app;
			$(function() {
				app.init();
			});
		})();

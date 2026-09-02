// High-level controller for runtime font analysis and interactive patch workflow.

class DynamicCracker {
	constructor(gba) {
		this.gba = gba;
		this.state = "IDLE";
		this.vramTracer = new VRAMWriteTracer(gba);
		this.romReadTracer = new ROMReadTracer(gba);
		this.textContext = new TextContext();
		this.functionFinder = null;
		this.expansionAnalyzer = null;
		this.patchPlanner = null;
		this.fontInferencer = null;
		this.glyphStateInferencer = null;
		this.decoderPatcher = new DecoderPatcher(gba);
		this.chineseRenderer = new ChineseRenderer(gba);
		this.widthPatcher = new WidthPatcher(this.textContext);
		this.analysisResults = null;
		this.patchPlan = null;
		this.fontInfo = null;
		this.glyphStateInfo = null;
		this.loadedFontFile = null;
		this.loadedCodeTableFile = null;
		this.chineseFontLoaded = false;
		this.originalROMBuffer = null;
		this.patchedROMBuffer = null;
		this.patchGenerator = null;
		this.titleMenuPatchInfo = null;
		this._menuValidationTimers = [];
		this._menuValidationIntervalId = null;
		this._savedMenuValidationRomReadCallback = null;
		this.runtimeReplacementInstalled = false;
		this.runtimeReplacementCount = 0;
		this.runtimeObservationInstalled = false;
		this.widthHookInstalled = false;
		this.widthHookCount = 0;
		this.legacyRuntimeHooksSuppressed = true;
		this._savedRuntimeVramCallback = null;
		this._lastGlyphWrite = null;
		this._runtimeObservationActivationQueued = false;
		this.callbacks = {
			stateChange: null,
			log: null,
			stats: null
		};
		this.NEW_GAME_SEQUENCE = new Uint8Array([0xC8, 0xBF, 0xD1, 0x00, 0xC1, 0xBB, 0xC7, 0xBF]);
		this.NEW_GAME_REPLACEMENT_TEXT = "\u65b0\u7684\u6e38\u620f";
	}

	onStateChange(callback) {
		this.callbacks.stateChange = callback;
	}

	onLog(callback) {
		this.callbacks.log = callback;
	}

	onStats(callback) {
		this.callbacks.stats = callback;
	}

	setState(nextState) {
		this.state = nextState;
		if (this.callbacks.stateChange) {
			this.callbacks.stateChange(nextState);
		}
		this._emitStats();
	}

	log(message, level) {
		if (this.callbacks.log) {
			this.callbacks.log(message, level || "info");
		}
	}

	_emitStats() {
		if (this.callbacks.stats) {
			this.callbacks.stats(this.getStats());
		}
	}

	_runWithFrozenState(work) {
		var snapshot = null;
		this.gba.pause();
		if (typeof this.gba.freeze === "function") {
			snapshot = this.gba.freeze();
		}
		try {
			return work();
		} finally {
			this.gba.pause();
			if (snapshot && typeof this.gba.defrost === "function") {
				this.gba.defrost(snapshot);
			}
			this.gba.cpu.instruction = null;
		}
	}

	resetRuntimeState(reloadRom) {
		var shouldReloadRom = !!reloadRom;
		var romBuffer = this.originalROMBuffer;

		this.gba.pause();
		this.vramTracer.stop();
		this.romReadTracer.stop();
		this.decoderPatcher.remove();
		this._clearMenuValidationAutomation();
		this._stopMenuValidationProbe();

		if (this._savedRuntimeVramCallback !== null) {
			this.gba.mmu.vramStoreCallback = this._savedRuntimeVramCallback;
		}
		this._savedRuntimeVramCallback = null;
		this._lastGlyphWrite = null;

		this.textContext.reset();
		this.runtimeReplacementInstalled = false;
		this.runtimeReplacementCount = 0;
		this.runtimeObservationInstalled = false;
		this.widthHookInstalled = false;
		this.widthHookCount = 0;
		this.legacyRuntimeHooksSuppressed = true;
		this._runtimeObservationActivationQueued = false;
		this.chineseFontLoaded = false;

		if (!shouldReloadRom) {
			this._emitStats();
			return true;
		}

		if (!romBuffer) {
			return false;
		}

		if (!this.gba.setRom(romBuffer.slice(0))) {
			throw new Error("ROM reload failed");
		}
		this._emitStats();
		return true;
	}

	loadROM(arrayBuffer) {
		this.resetRuntimeState(false);
		const loaded = this.gba.setRom(arrayBuffer);
		if (!loaded) {
			throw new Error("ROM 加载失败");
		}
		this.analysisResults = null;
		this.fontInfo = null;
		this.functionFinder = null;
		this.expansionAnalyzer = null;
		this.patchPlanner = null;
		this.fontInferencer = null;
		this.glyphStateInferencer = null;
		this.patchPlan = null;
		this.glyphStateInfo = null;
		this.originalROMBuffer = arrayBuffer.slice(0);
		this.patchedROMBuffer = null;
		this.patchGenerator = null;
		this.titleMenuPatchInfo = null;
		this.runtimeReplacementCount = 0;
		this.runtimeReplacementInstalled = false;
		this.runtimeObservationInstalled = false;
		this.widthHookInstalled = false;
		this.widthHookCount = 0;
		this.legacyRuntimeHooksSuppressed = true;
		this._runtimeObservationActivationQueued = false;
		this.vramTracer.clear();
		this.romReadTracer.clear();
		this.textContext.reset();
		this.setState("ROM_LOADED");
		this.log("ROM loaded: " + (this.gba.rom ? this.gba.rom.title : "unknown"), "success");
	}

	reloadROM() {
		if (!this.originalROMBuffer) {
			throw new Error("No ROM has been loaded");
		}

		this.resetRuntimeState(true);
		this.analysisResults = null;
		this.fontInfo = null;
		this.functionFinder = null;
		this.expansionAnalyzer = null;
		this.patchPlanner = null;
		this.fontInferencer = null;
		this.glyphStateInferencer = null;
		this.patchPlan = null;
		this.glyphStateInfo = null;
		this.patchedROMBuffer = null;
		this.patchGenerator = null;
		this.titleMenuPatchInfo = null;
		this.vramTracer.clear();
		this.romReadTracer.clear();
		this.runtimeObservationInstalled = false;
		this._runtimeObservationActivationQueued = false;
		this.setState("ROM_LOADED");
		this.log("ROM reloaded. Runtime hooks and transient state were cleared.", "success");
		return true;
	}

	setFontFile(file) {
		this.loadedFontFile = file || null;
	}

	setCodeTableFile(file) {
		this.loadedCodeTableFile = file || null;
	}

	startAnalysis() {
		if (this.state !== "ROM_LOADED" && this.state !== "ANALYSIS_COMPLETE") {
			return false;
		}

		this.vramTracer.clear();
		this.vramTracer.start();
		this.setState("ANALYZING");
		this.gba.runStable();
		this.log("Runtime analysis started. Navigate through menus to trigger text rendering.", "info");
		return true;
	}

	stopAnalysis() {
		if (this.state !== "ANALYZING") {
			return false;
		}

		this.gba.pause();
		this.vramTracer.stop();

		const traces = this.vramTracer.getTraces();
		if (traces.length < 32) {
			this.setState("ROM_LOADED");
			this.log("Captured traces are insufficient. Trigger more in-game text and retry.", "warn");
			return false;
		}

		this.functionFinder = new FunctionFinder(traces, this.gba);
		this.analysisResults = this.functionFinder.find();
		this.expansionAnalyzer = new ExpansionTextAnalyzer(this.gba, {
			renderCandidates: this.analysisResults.renderTextCandidates || [],
			widthCandidates: this.analysisResults.getStringWidthCandidates || [],
			drawCandidates: this.analysisResults.drawGlyphTilesCandidates || []
		});
		this.analysisResults.expansionSemantics = this.expansionAnalyzer.analyze();
		this.fontInferencer = null;
		this.fontInfo = null;
		if (this.analysisResults.drawGlyphTilesAddr || this.analysisResults.renderTextAddr) {
			this.glyphStateInferencer = new GlyphStateInferencer(this.gba, {
				drawGlyphTilesPC: this.analysisResults.drawGlyphTilesAddr,
				renderTextPC: this.analysisResults.renderTextAddr,
				charLoopAddr: this.analysisResults.expansionSemantics
					? this.analysisResults.expansionSemantics.charLoopAddr
					: 0
			});
			this.glyphStateInfo = this._runWithFrozenState(() => {
				return this.glyphStateInferencer.infer();
			});
		} else {
			this.glyphStateInferencer = null;
			this.glyphStateInfo = null;
		}
		this.analysisResults.glyphStateInfo = this.glyphStateInfo;
		if (
			(this.analysisResults.expansionSemantics &&
				this.analysisResults.expansionSemantics.decompressGlyphTileAddr) ||
			this.analysisResults.drawGlyphTilesAddr ||
			this.analysisResults.renderTextAddr
		) {
			this.fontInferencer = new FontInferencer(this.gba, {
				drawGlyphTilesPC: this.analysisResults.drawGlyphTilesAddr,
				renderTextPC: this.analysisResults.renderTextAddr,
				charDispatchAddr: this.analysisResults.charDispatchAddr,
				glyphDecodePC: this.analysisResults.expansionSemantics
					? this.analysisResults.expansionSemantics.decompressGlyphTileAddr
					: 0
			});
			this.fontInfo = this._runWithFrozenState(() => {
				return this.fontInferencer.infer();
			});
		}
		this.analysisResults.fontInfo = this.fontInfo;
		var patchPlannerOptions = {};
		if (this.chineseRenderer && this.chineseRenderer.fontData && this.chineseRenderer.fontData.length) {
			patchPlannerOptions.fontAssetSize = this.chineseRenderer.fontData.length >>> 0;
		}
		this.patchPlanner = new ExpansionPatchPlanner(
			this.gba,
			new Uint8Array(this.originalROMBuffer || new ArrayBuffer(0)),
			this.analysisResults,
			patchPlannerOptions
		);
		this.patchPlan = this.patchPlanner.analyze();
		this.analysisResults.patchPlan = this.patchPlan;
		if (
			this.patchPlan &&
			this.glyphStateInfo &&
			this.glyphStateInfo.glyphStateBaseAddress &&
			this.patchPlan.unresolvedSymbols
		) {
			this.patchPlan.unresolvedSymbols = this.patchPlan.unresolvedSymbols.filter(function(item) {
				return item.name !== "G_CUR_GLYPH";
			});
			if (this.patchPlan.helperParams) {
				this.patchPlan.helperParams.gCurGlyphAddrCandidate = this.glyphStateInfo.glyphStateBaseAddress >>> 0;
			}
			this.analysisResults.patchPlan = this.patchPlan;
		}

		this.setState("ANALYSIS_COMPLETE");
		this.log("Runtime analysis complete.", "success");
		this._emitTopFindings();
		return true;
	}

	_emitTopFindings() {
		if (!this.analysisResults) {
			return;
		}
		if (this.analysisResults.drawGlyphTilesCandidates && this.analysisResults.drawGlyphTilesCandidates.length) {
			var bestDraw = this.analysisResults.drawGlyphTilesCandidates[0];
			this.log(
				"Top draw candidate: 0x" + (bestDraw.pc >>> 0).toString(16) +
				" score=" + bestDraw.score.toFixed(3),
				"info"
			);
		}
		if (this.analysisResults.renderTextCandidates && this.analysisResults.renderTextCandidates.length) {
			var bestRender = this.analysisResults.renderTextCandidates[0];
			this.log(
				"Top render candidate: 0x" + (bestRender.functionStart >>> 0).toString(16) +
				" score=" + bestRender.score.toFixed(3),
				"info"
			);
		}
		if (this.analysisResults.charDispatchAddr) {
			this.log(
				"Char dispatch candidate: 0x" + (this.analysisResults.charDispatchAddr >>> 0).toString(16),
				"info"
			);
		}
		if (
			this.analysisResults.expansionSemantics &&
			this.analysisResults.expansionSemantics.charLoopCandidates &&
			this.analysisResults.expansionSemantics.charLoopCandidates.length
		) {
			var bestCharLoop = this.analysisResults.expansionSemantics.charLoopCandidates[0];
			this.log(
				"Expansion char-loop candidate: 0x" + (bestCharLoop.addr >>> 0).toString(16) +
				" score=" + bestCharLoop.score.toFixed(3),
				"info"
			);
		}
		if (
			this.analysisResults.expansionSemantics &&
			this.analysisResults.expansionSemantics.widthLoopCandidates &&
			this.analysisResults.expansionSemantics.widthLoopCandidates.length
		) {
			var bestWidthLoop = this.analysisResults.expansionSemantics.widthLoopCandidates[0];
			this.log(
				"Expansion width-loop candidate: 0x" + (bestWidthLoop.addr >>> 0).toString(16) +
				" score=" + bestWidthLoop.score.toFixed(3),
				"info"
			);
		}
		if (
			this.analysisResults.expansionSemantics &&
			this.analysisResults.expansionSemantics.fontDispatchCandidates &&
			this.analysisResults.expansionSemantics.fontDispatchCandidates.length
		) {
			var bestFontDispatch = this.analysisResults.expansionSemantics.fontDispatchCandidates[0];
			this.log(
				"Expansion font-dispatch candidate: 0x" + (bestFontDispatch.addr >>> 0).toString(16) +
				" score=" + bestFontDispatch.score.toFixed(3),
				"info"
			);
		}
		if (
			this.analysisResults.expansionSemantics &&
			this.analysisResults.expansionSemantics.decompressGlyphTileCandidates &&
			this.analysisResults.expansionSemantics.decompressGlyphTileCandidates.length
		) {
			var bestDecompressTile = this.analysisResults.expansionSemantics.decompressGlyphTileCandidates[0];
			this.log(
				"Glyph-tile decompressor candidate: 0x" + (bestDecompressTile.targetAddr >>> 0).toString(16) +
				" score=" + bestDecompressTile.score.toFixed(3),
				"info"
			);
		}
		if (this.patchPlan && this.patchPlan.semanticAnchors) {
			if (this.patchPlan.semanticAnchors.textEntryAddr) {
				this.log(
					"Patch text-entry anchor: 0x" + (this.patchPlan.semanticAnchors.textEntryAddr >>> 0).toString(16) +
					" source=" + this.patchPlan.semanticAnchors.textEntrySource,
					"info"
				);
			}
			if (this.patchPlan.injectionLayout && this.patchPlan.injectionLayout.normalFontBase) {
				this.log(
					"Planned font injection: normal=0x" +
						(this.patchPlan.injectionLayout.normalFontBase >>> 0).toString(16) +
						" small=0x" +
						(this.patchPlan.injectionLayout.smallFontBase >>> 0).toString(16) +
						" mode=" + this.patchPlan.injectionLayout.layoutMode,
					"info"
				);
			}
			if (this.patchPlan.helperParams && this.patchPlan.helperParams.fontCodepointStride) {
				this.log(
					"Font blob layout: direct-code32 stride=" +
						(this.patchPlan.helperParams.fontCodepointStride >>> 0) +
						" normalMax=0x" +
						(this.patchPlan.helperParams.fontNormalMaxCode >>> 0).toString(16) +
						" smallMax=0x" +
						(this.patchPlan.helperParams.fontSmallMaxCode >>> 0).toString(16),
					"info"
				);
			}
		}
		if (this.glyphStateInfo && this.glyphStateInfo.glyphStateBaseAddress) {
			this.log(
				"Glyph-state candidate: 0x" +
					(this.glyphStateInfo.glyphStateBaseAddress >>> 0).toString(16) +
					" region=" + this.glyphStateInfo.glyphStateRegion,
				"info"
			);
		}
		if (this.fontInfo && this.fontInfo.fontBaseAddress) {
			this.log(
				"Font block candidate: 0x" + (this.fontInfo.fontBaseAddress >>> 0).toString(16) +
				" stride=" + (this.fontInfo.glyphSizeBytes || "?"),
				"info"
			);
		}
	}

	async applyPatches() {
		if (
			this.state !== "ANALYSIS_COMPLETE" &&
			this.state !== "ROM_LOADED" &&
			this.state !== "ACTIVE"
		) {
			return false;
		}

		if (!this.loadedFontFile) {
			throw new Error("请先选择字库文件");
		}

		this.setState("PATCHING");
		const fontBuffer = await this._readFileAsArrayBuffer(this.loadedFontFile);
		await this.chineseRenderer.loadFontFromBuffer(fontBuffer);
		this.chineseFontLoaded = true;

		const codeTableText = await this._loadCodeTableText();
		if (codeTableText) {
			const entryCount = this.chineseRenderer.loadCodeTable(codeTableText);
			this.log("Code table loaded: " + entryCount + " entries", "info");
		}

		if (this.titleMenuPatchInfo && this.titleMenuPatchInfo.validationPassed) {
			this._activateRuntimeObservationStage();
			this.setState("ACTIVE");
			this.gba.runStable();
			this._emitStats();
			return true;
		}

		this._patchTitleMenuRomText();
		if (this.titleMenuPatchInfo && this.titleMenuPatchInfo.matchCount > 0) {
			this._restartPatchedROMForMenuValidation();
			this.setState("ACTIVE");
			this.log(
				"Main-menu ROM patch validation is active. Runtime hooks were deferred to avoid lockup during validation.",
				"warn"
			);
			this.gba.keypad.currentDown = 0x03ff;
			this.gba.runStable();
			this._emitStats();
			return true;
		}

		this._installRuntimeCharacterObservationHook();

		this.legacyRuntimeHooksSuppressed = true;
		if (this.patchPlan && this.patchPlan.readiness && this.patchPlan.readiness.readyForPatchPlan) {
			this.log(
				"Semantic patch plan is ready. Legacy runtime width/glyph takeover stays disabled to avoid lockup; use exported metadata or IPS as the next step.",
				"warn"
			);
		} else {
			this.log(
				"Legacy runtime width/glyph takeover remains disabled because the old VRAM overwrite path is unstable.",
				"warn"
			);
		}

		this.setState("ACTIVE");
		this.gba.keypad.currentDown = 0x03ff;
		this.gba.runStable();
		this._emitStats();
		return true;
	}

	_installRuntimeCharacterObservationHook() {
		if (this.runtimeObservationInstalled) {
			return true;
		}
		if (!(this.analysisResults && this.analysisResults.charDispatchAddr)) {
			this.log("Character dispatch hook was not discovered. Font is loaded, but no runtime hook was installed.", "warn");
			return false;
		}

		this.decoderPatcher.remove();
		this.decoderPatcher.registerPatch(this.analysisResults.charDispatchAddr, cpu => {
			const regs = this.analysisResults.charDispatchRegs;
			if (!regs) {
				return false;
			}

			let currChar = null;
			let nextChar = null;
			let charAddr = null;
			if (regs.hookMode === "memory-preload" && typeof regs.charLoadBaseReg === "number") {
				try {
					charAddr =
						(cpu.gprs[regs.charLoadBaseReg] + (regs.charLoadImm || 0)) >>> 0;
					currChar = this.gba.mmu.loadU8(charAddr);
					nextChar = this.gba.mmu.loadU8((charAddr + 1) >>> 0);
				} catch (error) {
					currChar = null;
					nextChar = null;
				}
			}
			if (currChar === null && typeof regs.currCharReg === "number") {
				currChar = cpu.gprs[regs.currCharReg] & 0xff;
			}
			if (currChar === null) {
				this.textContext.reset();
				return false;
			}

			if (
				ChineseRenderer.isChinesePunctuation(currChar, 0, false) &&
				this.chineseRenderer.hasCode(currChar)
			) {
				var punctuationMetrics = this.chineseRenderer.getMetrics
					? this.chineseRenderer.getMetrics(0, true, currChar)
					: { width: 11, height: 15 };
				this.textContext.setChinese({
					charCode: currChar >>> 0,
					isPunctuation: true,
					fontId: 0,
					width: punctuationMetrics.width,
					height: punctuationMetrics.height,
					textPtr: charAddr || 0,
					dispatchAddr: this.analysisResults.charDispatchAddr
				});
				this.log(
					"Chinese punctuation observed @ 0x" +
						(this.analysisResults.charDispatchAddr >>> 0).toString(16) +
						" char=0x" + currChar.toString(16),
					"info"
				);
			} else if (ChineseRenderer.isChineseChar(currChar, nextChar, 0, false) && nextChar !== null) {
				var charCode = ((currChar & 0xff) << 8) | (nextChar & 0xff);
				if (
					nextChar === 0 ||
					nextChar >= 0xf7 ||
					!this.chineseRenderer.hasCode(charCode)
				) {
					this.textContext.reset();
					return false;
				}
				var metrics = this.chineseRenderer.getMetrics
					? this.chineseRenderer.getMetrics(0, false, charCode)
					: { width: 12, height: 15 };
				this.textContext.setChinese({
					charCode: charCode >>> 0,
					isPunctuation: false,
					fontId: 0,
					width: metrics.width,
					height: metrics.height,
					textPtr: charAddr || 0,
					dispatchAddr: this.analysisResults.charDispatchAddr
				});
				this.log(
					"Chinese pair observed @ 0x" +
						(this.analysisResults.charDispatchAddr >>> 0).toString(16) +
						" code=0x" + charCode.toString(16),
					"info"
				);
			} else {
				this.textContext.reset();
			}
			this._emitStats();
			return false;
		});
		this.decoderPatcher.apply();
		this.runtimeObservationInstalled = true;
		this.log("Installed runtime character observation hook at discovered text decode point.", "success");
		return true;
	}

	_activateRuntimeObservationStage() {
		if (this.runtimeObservationInstalled || this._runtimeObservationActivationQueued) {
			return;
		}
		this._runtimeObservationActivationQueued = true;
		window.setTimeout(() => {
			this._runtimeObservationActivationQueued = false;
			if (!this.chineseFontLoaded) {
				return;
			}
			var wasPaused = !!this.gba.paused;
			this.gba.pause();
			var installed = this._installRuntimeCharacterObservationHook();
			this.legacyRuntimeHooksSuppressed = true;
			if (this.titleMenuPatchInfo && this.titleMenuPatchInfo.validationPassed) {
				this.titleMenuPatchInfo.validationState = installed
					? "runtime-observation-active"
					: "main-menu-render-confirmed";
			}
			if (installed) {
				this.log(
					"Menu validation passed. Safe runtime observation is now active; width/glyph takeover remains disabled.",
					"success"
				);
			}
			if (!wasPaused) {
				this.gba.runStable();
			}
			this._emitStats();
		}, 0);
	}

	_finishMenuValidationSuccess() {
		if (!this.titleMenuPatchInfo) {
			return;
		}
		var info = this.titleMenuPatchInfo;
		if (info.validationPassed) {
			return;
		}
		info.validationState = "main-menu-render-confirmed";
		info.validationPassed = true;
		info.armedForValidation = false;
		this.log("Main-menu validation confirmed patched text reached the active render path.", "success");
		this._stopMenuValidationProbe();
		this._clearMenuValidationAutomation();
		this._activateRuntimeObservationStage();
	}

	async _loadCodeTableText() {
		if (this.loadedCodeTableFile) {
			return this._readFileAsText(this.loadedCodeTableFile);
		}

		try {
			var response = await fetch("../fonts/wholewords.txt");
			if (!response.ok) {
				throw new Error("HTTP " + response.status);
			}
			this.log("Using default code table: ../fonts/wholewords.txt", "info");
			return await response.text();
		} catch (error) {
			this.log("Failed to load default code table from ../fonts/wholewords.txt: " + error.message, "warn");
			return null;
		}
	}

	_patchTitleMenuRomText() {
		this.titleMenuPatchInfo = null;
		this.patchedROMBuffer = null;

		if (!this.originalROMBuffer) {
			return false;
		}

		var replacementBytes = this.chineseRenderer.encodeTextToBytes(this.NEW_GAME_REPLACEMENT_TEXT);
		if (!replacementBytes) {
			this.log("Failed to encode replacement text with current code table: " + this.NEW_GAME_REPLACEMENT_TEXT, "warn");
			return false;
		}
		if (replacementBytes.length !== this.NEW_GAME_SEQUENCE.length) {
			this.log(
				"Replacement byte length mismatch: expected " + this.NEW_GAME_SEQUENCE.length +
				", got " + replacementBytes.length,
				"warn"
			);
			return false;
		}

		var patched = new Uint8Array(this.originalROMBuffer.slice(0));
		var offsets = this._findPatternOffsets(patched, this.NEW_GAME_SEQUENCE);
		if (!offsets.length) {
			this.log("Did not find NEW GAME byte sequence inside ROM image.", "warn");
			return false;
		}

		for (var i = 0; i < offsets.length; i++) {
			patched.set(replacementBytes, offsets[i]);
		}

		this.patchedROMBuffer = patched.buffer;
		this.titleMenuPatchInfo = {
			searchText: "NEW GAME",
			replacementText: this.NEW_GAME_REPLACEMENT_TEXT,
			matchCount: offsets.length,
			offsets: offsets.slice(0, 16),
			armedForValidation: true,
			validationTarget: "main-menu",
			validationState: "booting",
			romAddresses: offsets.slice(0, 16).map(function(offset) {
				return (0x08000000 + (offset >>> 0)) >>> 0;
			}),
			romReadHits: 0,
			romReadHitAddrs: [],
			romReadHitPCs: [],
			ramHits: [],
			validationPassed: false,
			replacementHex: Array.from(replacementBytes).map(function(byte) {
				return byte.toString(16).padStart(2, "0");
			}).join(" ")
		};
		this.log(
			"Patched " + offsets.length + " ROM occurrence(s) of NEW GAME -> " + this.NEW_GAME_REPLACEMENT_TEXT,
			"success"
		);
		return true;
	}

	_findPatternOffsets(bytes, pattern) {
		var offsets = [];
		if (!bytes || !pattern || !pattern.length || bytes.length < pattern.length) {
			return offsets;
		}

		for (var i = 0; i <= bytes.length - pattern.length; i++) {
			var matched = true;
			for (var j = 0; j < pattern.length; j++) {
				if (bytes[i + j] !== pattern[j]) {
					matched = false;
					break;
				}
			}
			if (matched) {
				offsets.push(i >>> 0);
			}
		}
		return offsets;
	}

	_restartPatchedROMForMenuValidation() {
		if (!this.patchedROMBuffer) {
			return false;
		}

		this.gba.pause();
		this.textContext.reset();
		this._lastGlyphWrite = null;
		this.gba.keypad.currentDown = 0x03ff;

		if (!this.gba.setRom(this.patchedROMBuffer.slice(0))) {
			throw new Error("Failed to boot patched ROM image");
		}

		if (this.titleMenuPatchInfo) {
			this.titleMenuPatchInfo.validationState = "advancing-to-main-menu";
		}
		this._startMenuValidationProbe();
		this._scheduleMainMenuValidationAutomation();
		this.log("Patched ROM image booted. Advancing to main menu for validation.", "success");
		return true;
	}

	_scheduleMainMenuValidationAutomation() {
		this._clearMenuValidationAutomation();
		var attempts = [2200, 3400, 4600, 5800, 7000, 8200];
		for (var i = 0; i < attempts.length; i++) {
			this._queueMenuValidationPress("START", attempts[i], 180);
		}
	}

	_queueMenuValidationPress(buttonName, delayMs, holdMs) {
		var pressTimer = window.setTimeout(() => {
			this._pressVirtualButton(buttonName, true);
		}, delayMs);
		var releaseTimer = window.setTimeout(() => {
			this._pressVirtualButton(buttonName, false);
			if (this.titleMenuPatchInfo) {
				this.titleMenuPatchInfo.validationState = "awaiting-main-menu-text";
			}
			this._emitStats();
		}, delayMs + holdMs);
		this._menuValidationTimers.push(pressTimer, releaseTimer);
	}

	_clearMenuValidationAutomation() {
		for (var i = 0; i < this._menuValidationTimers.length; i++) {
			window.clearTimeout(this._menuValidationTimers[i]);
		}
		this._menuValidationTimers = [];
	}

	_startMenuValidationProbe() {
		if (!this.titleMenuPatchInfo) {
			return false;
		}

		this._stopMenuValidationProbe();

		this._savedMenuValidationRomReadCallback = this.gba.mmu.romReadCallback;
		this.gba.mmu.romReadCallback = (addr, size) => {
			if (this._savedMenuValidationRomReadCallback) {
				this._savedMenuValidationRomReadCallback(addr, size);
			}
			this._observeMenuValidationRomRead(addr, size);
		};

		this._menuValidationIntervalId = window.setInterval(() => {
			this._scanMenuValidationMemory();
		}, 1200);
		this._menuValidationTimers.push(this._menuValidationIntervalId);

		var initialScanTimer = window.setTimeout(() => {
			this._scanMenuValidationMemory();
		}, 2600);
		var timeoutTimer = window.setTimeout(() => {
			this._finishMenuValidationIfTimedOut();
		}, 14000);
		this._menuValidationTimers.push(initialScanTimer, timeoutTimer);
		this._emitStats();
		return true;
	}

	_stopMenuValidationProbe() {
		if (this._savedMenuValidationRomReadCallback !== null) {
			this.gba.mmu.romReadCallback = this._savedMenuValidationRomReadCallback;
		}
		this._savedMenuValidationRomReadCallback = null;
		if (this._menuValidationIntervalId !== null) {
			window.clearInterval(this._menuValidationIntervalId);
		}
		this._menuValidationIntervalId = null;
	}

	_observeMenuValidationRomRead(addr, size) {
		if (!this.titleMenuPatchInfo || !this.titleMenuPatchInfo.armedForValidation) {
			return;
		}

		var hit = this._matchMenuPatchedRomRange(addr >>> 0, size >>> 0);
		if (!hit) {
			return;
		}

		var info = this.titleMenuPatchInfo;
		info.romReadHits = (info.romReadHits || 0) + 1;
		if (info.romReadHitAddrs.indexOf(hit.baseAddr) < 0) {
			info.romReadHitAddrs.push(hit.baseAddr);
		}

		var pc = this.gba.cpu.gprs[this.gba.cpu.PC] >>> 0;
		if (info.romReadHitPCs.indexOf(pc) < 0) {
			info.romReadHitPCs.push(pc);
		}

		if (info.validationState === "booting" || info.validationState === "advancing-to-main-menu" || info.validationState === "awaiting-main-menu-text") {
			info.validationState = "main-menu-rom-read";
			this.log(
				"Menu validation observed patched ROM read at 0x" +
					hit.baseAddr.toString(16) +
					" from PC 0x" + pc.toString(16),
				"success"
			);
		}
		if (info.ramHits && info.ramHits.length > 0) {
			this._finishMenuValidationSuccess();
		}
		this._emitStats();
	}

	_matchMenuPatchedRomRange(addr, size) {
		if (!this.titleMenuPatchInfo || !this.titleMenuPatchInfo.romAddresses) {
			return null;
		}

		var readStart = addr >>> 0;
		var readEnd = (readStart + Math.max(size >>> 0, 1) - 1) >>> 0;
		for (var i = 0; i < this.titleMenuPatchInfo.romAddresses.length; i++) {
			var baseAddr = this.titleMenuPatchInfo.romAddresses[i] >>> 0;
			var patchEnd = (baseAddr + this.NEW_GAME_SEQUENCE.length - 1) >>> 0;
			if (readStart <= patchEnd && readEnd >= baseAddr) {
				return { baseAddr: baseAddr, patchEnd: patchEnd };
			}
		}
		return null;
	}

	_scanMenuValidationMemory() {
		if (!this.titleMenuPatchInfo || !this.titleMenuPatchInfo.armedForValidation) {
			return false;
		}

		var replacementBytes = this._hexToBytes(this.titleMenuPatchInfo.replacementHex);
		if (!replacementBytes || !replacementBytes.length) {
			return false;
		}

		var ewramHits = this._scanMemoryBlockForSequence(
			0x02000000,
			this.gba.mmu.memory[this.gba.mmu.REGION_WORKING_RAM],
			replacementBytes,
			2
		);
		var iwramHits = this._scanMemoryBlockForSequence(
			0x03000000,
			this.gba.mmu.memory[this.gba.mmu.REGION_WORKING_IRAM],
			replacementBytes,
			2
		);
		var hits = ewramHits.concat(iwramHits);
		if (!hits.length) {
			return false;
		}

		var info = this.titleMenuPatchInfo;
		var added = 0;
		for (var i = 0; i < hits.length; i++) {
			var key = hits[i].region + ":" + hits[i].addr.toString(16);
			var duplicate = false;
			for (var j = 0; j < info.ramHits.length; j++) {
				if (info.ramHits[j].key === key) {
					duplicate = true;
					break;
				}
			}
			if (!duplicate) {
				hits[i].key = key;
				info.ramHits.push(hits[i]);
				added++;
			}
		}

		if (added > 0) {
			this.log(
				"Menu validation observed replacement bytes in " +
					hits.map(function(hit) {
						return hit.region + "@0x" + hit.addr.toString(16);
					}).join(", "),
				"success"
			);
		}

		if (info.romReadHits > 0) {
			this._finishMenuValidationSuccess();
		} else {
			info.validationState = "main-menu-bytes-seen";
		}

		this._emitStats();
		return true;
	}

	_scanMemoryBlockForSequence(baseAddr, memoryBlock, pattern, limit) {
		var hits = [];
		if (!memoryBlock || !memoryBlock.buffer || !pattern || !pattern.length) {
			return hits;
		}

		var bytes = new Uint8Array(memoryBlock.buffer);
		var maxHits = typeof limit === "number" ? limit : 1;
		for (var i = 0; i <= bytes.length - pattern.length; i++) {
			var matched = true;
			for (var j = 0; j < pattern.length; j++) {
				if (bytes[i + j] !== pattern[j]) {
					matched = false;
					break;
				}
			}
			if (!matched) {
				continue;
			}
			hits.push({
				region: baseAddr === 0x02000000 ? "EWRAM" : "IWRAM",
				addr: (baseAddr + i) >>> 0
			});
			if (hits.length >= maxHits) {
				break;
			}
		}
		return hits;
	}

	_finishMenuValidationIfTimedOut() {
		if (!this.titleMenuPatchInfo || !this.titleMenuPatchInfo.armedForValidation) {
			return;
		}
		if (this.titleMenuPatchInfo.validationPassed) {
			return;
		}
		this.titleMenuPatchInfo.validationState = "timed-out";
		this.titleMenuPatchInfo.armedForValidation = false;
		this.log(
			"Menu validation timed out before the patched bytes were confirmed in the active text path.",
			"warn"
		);
		this._stopMenuValidationProbe();
		this._clearMenuValidationAutomation();
		this._emitStats();
	}

	_hexToBytes(text) {
		if (!text) {
			return null;
		}
		var parts = text.trim().split(/\s+/);
		var bytes = new Uint8Array(parts.length);
		for (var i = 0; i < parts.length; i++) {
			var value = parseInt(parts[i], 16);
			if (Number.isNaN(value)) {
				return null;
			}
			bytes[i] = value & 0xff;
		}
		return bytes;
	}

	_pressVirtualButton(buttonName, pressed) {
		if (!this.gba || !this.gba.keypad) {
			return;
		}
		var keypad = this.gba.keypad;
		var bitIndex = keypad[buttonName];
		if (typeof bitIndex !== "number") {
			return;
		}
		var mask = 1 << bitIndex;
		if (pressed) {
			keypad.currentDown &= ~mask;
		} else {
			keypad.currentDown |= mask;
		}
	}

	_installWidthHook() {
		if (!this.analysisResults || !this.analysisResults.getStringWidthAddr) {
			return false;
		}

		var widthAddr = this.analysisResults.getStringWidthAddr >>> 0;
		this.widthHookInstalled = true;

		this.decoderPatcher.registerPatch(widthAddr, {
			writesPC: true,
			fixedJump: false,
			callback: (cpu) => {
				if (!this.textContext.active || !this.textContext.isChinese) {
					return null;
				}

				var patchedWidth = this.widthPatcher.getPatchedWidth(cpu.gprs[0] >>> 0) >>> 0;
				cpu.gprs[0] = patchedWidth;
				cpu.gprs[cpu.PC] = (cpu.gprs[cpu.LR] - cpu.instructionWidth) >>> 0;
				this.widthHookCount++;
				this.log(
					"Width hook return @ 0x" + widthAddr.toString(16) +
					" width=" + patchedWidth,
					"success"
				);
				this._emitStats();
				return { skipOriginal: true };
			}
		});
		this.decoderPatcher.apply();
		this.log("Installed runtime width hook at GetStringWidth candidate.", "success");
		return true;
	}

	_installRuntimeGlyphReplacement() {
		if (!this.analysisResults || !this.analysisResults.drawGlyphTilesAddr) {
			return false;
		}

		this._savedRuntimeVramCallback = this.gba.mmu.vramStoreCallback;
		this._lastGlyphWrite = null;
		this.runtimeReplacementInstalled = true;

		this.gba.mmu.vramStoreCallback = (addr, value, size) => {
			if (this._savedRuntimeVramCallback) {
				this._savedRuntimeVramCallback(addr, value, size);
			}

			if (!this.textContext.active || !this.chineseFontLoaded) {
				return;
			}

			var pc = this.gba.cpu.gprs[this.gba.cpu.PC] >>> 0;
			var drawAddr = this.analysisResults.drawGlyphTilesAddr >>> 0;
			if (
				pc !== drawAddr &&
				pc !== ((drawAddr + 2) >>> 0) &&
				pc !== ((drawAddr + 4) >>> 0) &&
				pc !== ((drawAddr + 6) >>> 0)
			) {
				return;
			}

			if (!this._lastGlyphWrite || Math.abs((addr >>> 0) - this._lastGlyphWrite.base) > 0x80) {
				this._lastGlyphWrite = {
					base: (addr >>> 0) & ~0x1f,
					bytesSeen: 0,
					charCode: this.textContext.charCode >>> 0
				};
			}

			this._lastGlyphWrite.bytesSeen += size;
			if (this._lastGlyphWrite.bytesSeen >= 0x40) {
				var rendered = this.chineseRenderer.renderGlyphToVram(
					this.textContext.charCode,
					this.textContext.fontId,
					this._lastGlyphWrite.base
				);
				if (rendered) {
					this.runtimeReplacementCount++;
					this.log(
						"Runtime glyph overwrite at " + "0x" + this._lastGlyphWrite.base.toString(16) +
						" code=0x" + this.textContext.charCode.toString(16),
						"success"
					);
					this.textContext.reset();
					this._lastGlyphWrite = null;
					this._emitStats();
				}
			}
		};

		this.log("Installed runtime glyph overwrite path at DrawGlyphTiles candidate.", "success");
		return true;
	}

	exportAnalysis() {
		var payload = {
			gameTitle: this.gba.rom ? this.gba.rom.title : "",
			state: this.state,
			analysisResults: this.analysisResults,
			patchPlan: this.patchPlan,
			fontInfo: this.fontInfo,
			glyphStateInfo: this.glyphStateInfo,
			width: this.widthPatcher.getSnapshot(),
			titleMenuPatchInfo: this.titleMenuPatchInfo
		};
		return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	}

	exportIPS() {
		if (!this.originalROMBuffer || !this.analysisResults) {
			throw new Error("ROM or analysis results are missing");
		}
		var romBytes = new Uint8Array(this.originalROMBuffer);
		this.patchGenerator = new PatchGenerator(romBytes, this._buildPatchGeneratorResults());
		var fontData = this.chineseRenderer.fontData || null;
		var ips = this.patchGenerator.generateFullIPS(fontData);
		if (!ips) {
			throw new Error("Failed to generate IPS");
		}
		return new Blob([ips], { type: "application/octet-stream" });
	}

	exportArmipsMetadata() {
		if (!this.analysisResults) {
			throw new Error("Analysis results are missing");
		}
		var romBytes = this.originalROMBuffer ? new Uint8Array(this.originalROMBuffer) : new Uint8Array(0);
		this.patchGenerator = new PatchGenerator(romBytes, this._buildPatchGeneratorResults());
		var metadata = this.patchGenerator.generateArmipsMetadata(this.chineseRenderer.fontData || null);
		return new Blob([metadata], { type: "text/plain" });
	}

	_buildPatchGeneratorResults() {
		var results = Object.assign({}, this.analysisResults || {});
		results.patchPlan = this.patchPlan || results.patchPlan || null;
		results.glyphStateInfo = this.glyphStateInfo || results.glyphStateInfo || null;
		results.fontInfo = this.fontInfo || results.fontInfo || null;
		return results;
	}

	renderTestText() {
		if (!this.chineseFontLoaded) {
			throw new Error("请先加载中文字体");
		}
		const rendered = this.chineseRenderer.renderPreviewToVram();
		if (!rendered) {
			throw new Error("测试渲染失败");
		}
		this.log("Rendered Chinese preview tiles into VRAM.", "success");
		return true;
	}

	getStats() {
		return {
			state: this.state,
			gameTitle: this.gba.rom ? this.gba.rom.title : "",
			tracer: this.vramTracer.getStats(),
			romTracer: this.romReadTracer.getStats(),
			findings: this.analysisResults,
			patchPlan: this.patchPlan,
			fontInfo: this.fontInfo,
			glyphStateInfo: this.glyphStateInfo,
			titleMenuPatchInfo: this.titleMenuPatchInfo,
			chineseFontLoaded: this.chineseFontLoaded,
			textContext: this.textContext.getSnapshot(),
			width: this.widthPatcher.getSnapshot(),
			runtimeObservationInstalled: this.runtimeObservationInstalled,
			runtimeReplacementInstalled: this.runtimeReplacementInstalled,
			runtimeReplacementCount: this.runtimeReplacementCount,
			lastRender: this.chineseRenderer.lastRender,
			widthHookInstalled: this.widthHookInstalled,
			widthHookCount: this.widthHookCount,
			legacyRuntimeHooksSuppressed: this.legacyRuntimeHooksSuppressed
		};
	}

	_readFileAsArrayBuffer(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = event => resolve(event.target.result);
			reader.onerror = reject;
			reader.readAsArrayBuffer(file);
		});
	}

	_readFileAsText(file) {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = event => resolve(event.target.result);
			reader.onerror = reject;
			reader.readAsText(file);
		});
	}
}

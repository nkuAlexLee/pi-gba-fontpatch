// Semantic patch planner for pokeemerald-expansion based ROM hacks.
// Converts discovered text semantics into stable patch anchors plus
// suggested helper/font injection layout inside free ROM space.

class ExpansionPatchPlanner {
	constructor(gba, romBytes, analysisResults, options) {
		this.gba = gba;
		this.romBytes = romBytes instanceof Uint8Array ? romBytes : new Uint8Array(romBytes || 0);
		this.results = analysisResults || {};
		this.options = Object.assign({
			searchStartOffset: 0x200000,
			helperReserveSize: 0x1000,
			widthTableReserveSize: 0x100,
			fontAssetSize: 0xED780,
			fontSmallOffset: 0x80000,
			maxFreeRuns: 8
		}, options || {});
	}

	analyze() {
		var semantics = this.results.expansionSemantics || {};
		var selectedCharLoop = this._getSelectedCharLoopCandidate(semantics);
		var selectedWidthLoop = this._getSelectedWidthLoopCandidate(semantics);
		var selectedWidthPrepare = this._getSelectedWidthPrepareCandidate(semantics, selectedWidthLoop);
		var textEntry = this._selectTextEntryAnchor(semantics);
		var widthEntry = this._selectWidthEntryAnchor(semantics);
		var widthPrepare = this._selectWidthPrepareAnchor(semantics, selectedWidthPrepare);
		var fontDispatch = semantics.fontDispatchAddr || 0;
		var helperParams = this._buildHelperParams(semantics);
		var freeRuns = this._findFreeRuns();
		var layout = this._buildInjectionLayout(freeRuns);
		var textHookBytes = this._getAnchorHookByteCount(selectedCharLoop, textEntry.addr, 8);
		var widthHookBytes = this._getAnchorHookByteCount(selectedWidthLoop, widthEntry.addr, 8);
		var widthPrepareHookBytes = this._getAnchorHookByteCount(selectedWidthPrepare, widthPrepare.addr, 8);
		var textEntryInfo = this._describeHookWindow(textEntry.addr, textHookBytes);
		var widthEntryInfo = this._describeHookWindow(widthEntry.addr, widthHookBytes);
		var widthPrepareInfo = this._describeHookWindow(widthPrepare.addr, widthPrepareHookBytes);
		var textReplayInfo = this._describeReplayWindow(selectedCharLoop, textEntry.addr, textHookBytes);
		var widthReplayInfo = this._describeReplayWindow(selectedWidthLoop, widthEntry.addr, widthHookBytes);
		var widthPrepareReplayInfo = this._describeReplayWindow(selectedWidthPrepare, widthPrepare.addr, widthPrepareHookBytes);
		var fontDispatchInfo = this._describeHookWindow(fontDispatch, 8);
		var readiness = {
			hasTextEntry: !!textEntry.addr,
			hasWidthEntry: !!widthEntry.addr,
			hasWidthPrepare: !!widthPrepare.addr,
			hasFontDispatch: !!fontDispatch,
			hasHelperSpace: !!layout.helperCodeBase,
			hasFontSpace: !!layout.normalFontBase,
			readyForPatchPlan: !!textEntry.addr && !!widthEntry.addr && !!layout.helperCodeBase && !!layout.normalFontBase
		};
		var notes = [];
		if (helperParams.layoutResolvedFromSource) {
			notes.push("TextPrinter family layout was resolved from pokeemerald-expansion include/text.h, so fontId/japanese do not depend on ROM-specific signatures.");
			notes.push("TextGlyph family layout was resolved from pokeemerald-expansion include/text.h, so gCurGlyph top/bottom/width/height offsets can be emitted directly.");
		}
		if (semantics.charLoopAddr && !selectedCharLoop) {
			notes.push("Expansion char-loop candidates were present, but the register contract was incomplete, so text-entry anchoring fell back to char-dispatch/render-text.");
		}
		if (semantics.widthLoopAddr && !selectedWidthLoop) {
			notes.push("Expansion width-loop candidates were present, but the top candidate looked too weak or too close to non-width helpers, so width anchoring fell back to GetStringWidth.");
		}

		if (!textEntry.addr) {
			notes.push("No semantic text-entry hook was confirmed. Fall back to RenderFont/char-dispatch review before patching.");
		} else if (textEntry.source === "char-dispatch") {
			notes.push("Text-entry anchoring fell back to char-dispatch. This is usually a later hook site, so pointer advancement and displaced-instruction replay still need manual review.");
		} else if (selectedCharLoop && selectedCharLoop.replayStartAddr && (selectedCharLoop.replayStartAddr >>> 0) < (selectedCharLoop.addr >>> 0)) {
			notes.push("The confirmed text hook lands after the currentChar pointer load, so the replay window starts earlier than PATCH_TEXT_ENTRY and should be replayed from the scaffold metadata.");
		}
		if (!widthEntry.addr) {
			notes.push("No semantic width-entry hook was confirmed. Width patching should remain disabled.");
		} else if (selectedWidthLoop && selectedWidthLoop.widthPattern && selectedWidthLoop.widthPattern.found) {
			notes.push("Width-entry anchoring is now based on the double-byte lookahead path inside GetStringWidth, not on coarse runtime call-count candidates.");
		}
		if (widthPrepare.addr) {
			notes.push("Width-prepare anchoring found the stack-frame setup that should preserve fontId before the later width hook runs.");
		} else if (widthEntry.addr) {
			notes.push("No width-prepare hook was confirmed. If the later width hook does not keep fontId live, helper wiring must preserve it manually.");
		}
		if (!fontDispatch) {
			notes.push("No normal/small font dispatch anchor was confirmed. Keep the rollout scoped to text entry and width first.");
		}
		if (!layout.helperCodeBase || !layout.normalFontBase) {
			notes.push("A large enough free ROM run was not found for helper code plus the full 绿宝石字库.bin payload.");
		}

		return {
			targetFamily: "pokeemerald-expansion",
			twoFontScope: {
				supportedFontKinds: ["normal", "small"],
				normalFontIds: semantics.fontModel ? semantics.fontModel.normalFontIds || [1] : [1],
				smallFontIds: semantics.fontModel ? semantics.fontModel.smallFontIds || [0, 8, 10] : [0, 8, 10]
			},
			semanticAnchors: {
				textEntryAddr: textEntry.addr,
				textEntrySource: textEntry.source,
				textEntryContinueAddr: this._getAnchorContinueAddr(selectedCharLoop, textEntry.addr, textHookBytes),
				textEntryHookSize: textHookBytes >>> 0,
				textEntryWindow: textEntryInfo,
				textEntryReplayWindow: textReplayInfo,
				widthEntryAddr: widthEntry.addr,
				widthEntrySource: widthEntry.source,
				widthEntryContinueAddr: this._getAnchorContinueAddr(selectedWidthLoop, widthEntry.addr, widthHookBytes),
				widthEntryHookSize: widthHookBytes >>> 0,
				widthEntryWindow: widthEntryInfo,
				widthEntryReplayWindow: widthReplayInfo,
				widthPrepareAddr: widthPrepare.addr,
				widthPrepareSource: widthPrepare.source,
				widthPrepareContinueAddr: this._getAnchorContinueAddr(selectedWidthPrepare, widthPrepare.addr, widthPrepareHookBytes),
				widthPrepareHookSize: widthPrepareHookBytes >>> 0,
				widthPrepareWindow: widthPrepareInfo,
				widthPrepareReplayWindow: widthPrepareReplayInfo,
				fontDispatchAddr: fontDispatch >>> 0,
				fontDispatchWindow: fontDispatchInfo,
				decompressGlyphTileAddr: semantics.decompressGlyphTileAddr || 0,
				gCurGlyphAddrCandidate: this.results.glyphStateInfo && this.results.glyphStateInfo.glyphStateBaseAddress
					? (this.results.glyphStateInfo.glyphStateBaseAddress >>> 0)
					: 0,
				renderTextAddr: this.results.renderTextAddr || 0,
				charDispatchAddr: this.results.charDispatchAddr || 0,
				charLoopAddr: semantics.charLoopAddr || 0,
				widthLoopAddr: semantics.widthLoopAddr || 0
			},
			helperParams: helperParams,
			unresolvedSymbols: this._buildUnresolvedSymbols(helperParams),
			injectionLayout: layout,
			freeSpace: {
				searchStartOffset: this.options.searchStartOffset >>> 0,
				candidates: freeRuns.slice(0, this.options.maxFreeRuns)
			},
			readiness: readiness,
			notes: notes
		};
	}

	_selectTextEntryAnchor(semantics) {
		var selected = this._getSelectedCharLoopCandidate(semantics);
		if (selected && selected.addr) {
			return {
				addr: selected.addr >>> 0,
				source: "expansion-char-loop"
			};
		}
		if (this.results.charDispatchAddr) {
			return {
				addr: this.results.charDispatchAddr >>> 0,
				source: "char-dispatch"
			};
		}
		if (this.results.renderTextAddr) {
			return {
				addr: this.results.renderTextAddr >>> 0,
				source: "render-text"
			};
		}
		return { addr: 0, source: "none" };
	}

	_selectWidthEntryAnchor(semantics) {
		var selected = this._getSelectedWidthLoopCandidate(semantics);
		if (selected && selected.addr) {
			return {
				addr: selected.addr >>> 0,
				source: "expansion-width-loop"
			};
		}
		if (this.results.getStringWidthAddr) {
			return {
				addr: this.results.getStringWidthAddr >>> 0,
				source: "get-string-width"
			};
		}
		return { addr: 0, source: "none" };
	}

	_selectWidthPrepareAnchor(semantics, selectedWidthPrepare) {
		if (selectedWidthPrepare && selectedWidthPrepare.addr) {
			return {
				addr: selectedWidthPrepare.addr >>> 0,
				source: "expansion-width-prepare"
			};
		}
		return {
			addr: 0,
			source: "none"
		};
	}

	_findFreeRuns() {
		var bytes = this.romBytes;
		var runs = [];
		if (!bytes || !bytes.length) {
			return runs;
		}

		var minStart = Math.min(this.options.searchStartOffset >>> 0, bytes.length);
		var runStart = -1;
		var runValue = 0;

		for (var i = minStart; i < bytes.length; i++) {
			var value = bytes[i];
			var isEmpty = value === 0xff || value === 0x00;
			if (isEmpty) {
				if (runStart < 0) {
					runStart = i;
					runValue = value;
				}
				continue;
			}
			if (runStart >= 0) {
				this._pushFreeRun(runs, runStart, i, runValue);
				runStart = -1;
			}
		}
		if (runStart >= 0) {
			this._pushFreeRun(runs, runStart, bytes.length, runValue);
		}

		runs.sort(function(left, right) {
			if (right.size !== left.size) {
				return right.size - left.size;
			}
			return right.startOffset - left.startOffset;
		});
		return runs;
	}

	_pushFreeRun(runs, start, end, fillValue) {
		var size = (end - start) >>> 0;
		if (size < 0x100) {
			return;
		}
		runs.push({
			startOffset: start >>> 0,
			endOffsetExclusive: end >>> 0,
			size: size >>> 0,
			fillValue: fillValue >>> 0,
			startAddr: (0x08000000 + (start >>> 0)) >>> 0,
			endAddrExclusive: (0x08000000 + (end >>> 0)) >>> 0
		});
	}

	_buildInjectionLayout(freeRuns) {
		var helperNeed = (this.options.helperReserveSize + this.options.widthTableReserveSize + 0x20) >>> 0;
		var fullNeed = (helperNeed + this.options.fontAssetSize + 0x20) >>> 0;
		var fontOnlyNeed = (this.options.fontAssetSize + 0x20) >>> 0;
		var helperRun = this._pickRun(freeRuns, helperNeed);
		var combinedRun = this._pickRun(freeRuns, fullNeed);
		var fontRun = combinedRun || this._pickRun(freeRuns, fontOnlyNeed);
		var helperOffset = 0;
		var widthOffset = 0;
		var fontOffset = 0;

		if (combinedRun) {
			helperOffset = this._alignOffset((combinedRun.startOffset + 4) >>> 0, 4);
			widthOffset = this._alignOffset((helperOffset + this.options.helperReserveSize) >>> 0, 4);
			fontOffset = this._alignOffset((widthOffset + this.options.widthTableReserveSize) >>> 0, 4);
			return {
				layoutMode: "single-run",
				helperCodeBase: (0x08000000 + helperOffset) >>> 0,
				helperReserveSize: this.options.helperReserveSize >>> 0,
				widthTableBase: (0x08000000 + widthOffset) >>> 0,
				widthTableReserveSize: this.options.widthTableReserveSize >>> 0,
				normalFontBase: (0x08000000 + fontOffset) >>> 0,
				smallFontBase: (0x08000000 + fontOffset + this.options.fontSmallOffset) >>> 0,
				fontAssetSize: this.options.fontAssetSize >>> 0,
				smallFontOffset: this.options.fontSmallOffset >>> 0,
				selectedRunStart: combinedRun.startAddr,
				selectedRunSize: combinedRun.size >>> 0
			};
		}

		if (helperRun) {
			helperOffset = this._alignOffset((helperRun.startOffset + 4) >>> 0, 4);
			widthOffset = this._alignOffset((helperOffset + this.options.helperReserveSize) >>> 0, 4);
		}
		if (fontRun) {
			fontOffset = this._alignOffset((fontRun.startOffset + 4) >>> 0, 4);
		}

		return {
			layoutMode: helperRun && fontRun ? "split-runs" : "incomplete",
			helperCodeBase: helperRun ? (0x08000000 + helperOffset) >>> 0 : 0,
			helperReserveSize: this.options.helperReserveSize >>> 0,
			widthTableBase: helperRun ? (0x08000000 + widthOffset) >>> 0 : 0,
			widthTableReserveSize: this.options.widthTableReserveSize >>> 0,
			normalFontBase: fontRun ? (0x08000000 + fontOffset) >>> 0 : 0,
			smallFontBase: fontRun ? (0x08000000 + fontOffset + this.options.fontSmallOffset) >>> 0 : 0,
			fontAssetSize: this.options.fontAssetSize >>> 0,
			smallFontOffset: this.options.fontSmallOffset >>> 0,
			selectedRunStart: fontRun ? fontRun.startAddr : (helperRun ? helperRun.startAddr : 0),
			selectedRunSize: fontRun ? fontRun.size >>> 0 : (helperRun ? helperRun.size >>> 0 : 0)
		};
	}

	_pickRun(runs, minSize) {
		for (var i = 0; i < runs.length; i++) {
			if (runs[i].size >= minSize) {
				return runs[i];
			}
		}
		return null;
	}

	_alignOffset(offset, alignment) {
		var mask = (alignment - 1) >>> 0;
		return ((offset + mask) & ~mask) >>> 0;
	}

	_buildHelperParams(semantics) {
		var regsInfo = this._getBestHookRegisterSource(semantics);
		var regs = regsInfo.regs || {};
		var familyLayout = this._getTargetFamilyLayout();
		return {
			targetFamily: familyLayout.targetFamily,
			layoutResolvedFromSource: true,
			hookRegisterSource: regsInfo.source,
			textPrinterReg: this._safeNum(regs.textPrinterReg),
			charPtrReg: this._safeNum(regs.charPtrReg),
			currCharReg: this._safeNum(regs.currCharReg),
			nextByteReg: this._safeNum(regs.nextByteReg),
			charPtrFieldOffset: this._safeNum(regs.textPointerLoadImm),
			charLoadImm: this._safeNum(regs.charLoadImm),
			nextByteImm: this._safeNum(regs.nextByteImm),
			charPtrStoreOffset: this._safeNum(regs.pointerStoreImm),
			charPtrLoadedBeforeHook: !!regs.charPtrLoadedBeforeHook,
			widthPrepareNeeded: !!(semantics && semantics.widthPrepareAddr),
			widthPrepareOriginalStackAlloc: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.originalStackAlloc),
			widthPrepareExpandedStackAlloc: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.expandedStackAlloc),
			widthPrepareFontIdStackOffset: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.fontIdStackOffset),
			widthPrepareFontIdEntryReg: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.regs && semantics.widthPrepareInfo.regs.fontIdEntryReg),
			widthPrepareStringPtrEntryReg: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.regs && semantics.widthPrepareInfo.regs.stringPtrEntryReg),
			widthPrepareWorkingFontIdReg: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.regs && semantics.widthPrepareInfo.regs.workingFontIdReg),
			widthPrepareStringPtrWorkReg: this._safeNum(semantics && semantics.widthPrepareInfo && semantics.widthPrepareInfo.regs && semantics.widthPrepareInfo.regs.stringPtrWorkReg),
			normalFontIds: semantics && semantics.fontModel ? (semantics.fontModel.normalFontIds || [1]).slice(0) : [1],
			smallFontIds: semantics && semantics.fontModel ? (semantics.fontModel.smallFontIds || [0, 8, 10]).slice(0) : [0, 8, 10],
			textPrinterTemplateCurrentCharOffset: familyLayout.textPrinterTemplateCurrentCharOffset,
			textPrinterTemplateFontIdOffset: familyLayout.textPrinterTemplateFontIdOffset,
			textPrinterTemplateSize: familyLayout.textPrinterTemplateSize,
			textPrinterAutoScrollDelayOffset: familyLayout.textPrinterAutoScrollDelayOffset,
			textPrinterFlagsByteOffset: familyLayout.textPrinterFlagsByteOffset,
			textPrinterFontIdByteOffset: familyLayout.textPrinterFontIdByteOffset,
			textPrinterFontIdMask: familyLayout.textPrinterFontIdMask,
			textPrinterFontIdShift: familyLayout.textPrinterFontIdShift,
			textPrinterJapaneseByteOffset: familyLayout.textPrinterJapaneseByteOffset,
			textPrinterJapaneseMask: familyLayout.textPrinterJapaneseMask,
			textPrinterJapaneseShift: familyLayout.textPrinterJapaneseShift,
			textPrinterStateOffset: familyLayout.textPrinterStateOffset,
			textPrinterSize: familyLayout.textPrinterSize,
			textGlyphTopOffset: familyLayout.textGlyphTopOffset,
			textGlyphTopRightOffset: familyLayout.textGlyphTopRightOffset,
			textGlyphBottomOffset: familyLayout.textGlyphBottomOffset,
			textGlyphBottomRightOffset: familyLayout.textGlyphBottomRightOffset,
			textGlyphWidthOffset: familyLayout.textGlyphWidthOffset,
			textGlyphHeightOffset: familyLayout.textGlyphHeightOffset,
			textGlyphSourceTileStride: familyLayout.textGlyphSourceTileStride,
			textGlyphSourceBottomTileOffset: familyLayout.textGlyphSourceBottomTileOffset,
			textGlyphSourceBottomRightTileOffset: familyLayout.textGlyphSourceBottomRightTileOffset,
			fontBlobLayoutMode: familyLayout.fontBlobLayoutMode,
			fontCodepointStride: familyLayout.fontCodepointStride,
			fontNormalSegmentSize: familyLayout.fontNormalSegmentSize,
			fontSmallSegmentSize: familyLayout.fontSmallSegmentSize,
			fontNormalMaxCode: familyLayout.fontNormalMaxCode,
			fontSmallMaxCode: familyLayout.fontSmallMaxCode,
			chinesePairHiMin: familyLayout.chinesePairHiMin,
			chinesePairHiMax: familyLayout.chinesePairHiMax,
			chinesePairHiExcluded: familyLayout.chinesePairHiExcluded.slice(0),
			chinesePairLoMax: familyLayout.chinesePairLoMax,
			chinesePunctuationSingles: familyLayout.chinesePunctuationSingles.slice(0),
			chinesePunctuationRangeStart: familyLayout.chinesePunctuationRangeStart,
			chinesePunctuationRangeEnd: familyLayout.chinesePunctuationRangeEnd,
			chinesePunctuationExcluded: familyLayout.chinesePunctuationExcluded.slice(0),
			chineseNormalWidth: familyLayout.chineseNormalWidth,
			chineseSmallWidth: familyLayout.chineseSmallWidth,
			chineseNormalHeight: familyLayout.chineseNormalHeight,
			chineseSmallHeight: familyLayout.chineseSmallHeight,
			decompressGlyphTileAddr: this._safeNum(semantics.decompressGlyphTileAddr),
			gCurGlyphAddrCandidate: this.results.glyphStateInfo && this.results.glyphStateInfo.glyphStateBaseAddress
				? (this.results.glyphStateInfo.glyphStateBaseAddress >>> 0)
				: 0,
			normalPunctuationWidths: familyLayout.normalPunctuationWidths.map(function(item) {
				return { code: item.code >>> 0, width: item.width >>> 0 };
			}),
			smallPunctuationWidths: familyLayout.smallPunctuationWidths.map(function(item) {
				return { code: item.code >>> 0, width: item.width >>> 0 };
			})
		};
	}

	_buildUnresolvedSymbols(helperParams) {
		var unresolved = [];
		if (!helperParams || !helperParams.gCurGlyphAddrCandidate) {
			unresolved.push({
				name: "G_CUR_GLYPH",
				kind: "required-runtime-symbol",
				reason: "Chinese helper code needs the current glyph buffer/global, and this address is not yet discovered dynamically."
			});
		}
		if (!helperParams || !helperParams.decompressGlyphTileAddr) {
			unresolved.push({
				name: "DECOMPRESS_GLYPH_TILE",
				kind: "required-runtime-symbol",
				reason: "The helper body must call the game-specific glyph decompressor, which is not yet resolved from semantic analysis."
			});
		}
		if (!this._hasResolvedFontFlags(helperParams)) {
			unresolved.push({
				name: "TEXT_PRINTER_FONT_FLAGS",
				kind: "required-struct-layout",
				reason: "The helper still needs the byte offset/masks for TextPrinter.fontId and TextPrinter.japanese."
			});
		}
		return unresolved;
	}

	_hasResolvedFontFlags(helperParams) {
		if (!helperParams) {
			return false;
		}
		return (
			typeof helperParams.textPrinterFontIdByteOffset === "number" &&
			typeof helperParams.textPrinterFontIdMask === "number" &&
			helperParams.textPrinterFontIdMask !== 0 &&
			typeof helperParams.textPrinterJapaneseByteOffset === "number" &&
			typeof helperParams.textPrinterJapaneseMask === "number" &&
			helperParams.textPrinterJapaneseMask !== 0
		);
	}

	_getTargetFamilyLayout() {
		return {
			targetFamily: "pokeemerald-expansion",
			textPrinterTemplateCurrentCharOffset: 0x00,
			textPrinterTemplateFontIdOffset: 0x06,
			textPrinterTemplateSize: 0x14,
			textPrinterAutoScrollDelayOffset: 0x1a,
			textPrinterFlagsByteOffset: 0x1b,
			textPrinterFontIdByteOffset: 0x1b,
			textPrinterFontIdMask: 0x0f,
			textPrinterFontIdShift: 0,
			textPrinterJapaneseByteOffset: 0x1b,
			textPrinterJapaneseMask: 0x20,
			textPrinterJapaneseShift: 5,
			textPrinterStateOffset: 0x1c,
			textPrinterSize: 0x28,
			textGlyphTopOffset: 0x00,
			textGlyphTopRightOffset: 0x20,
			textGlyphBottomOffset: 0x40,
			textGlyphBottomRightOffset: 0x60,
			textGlyphWidthOffset: 0x80,
			textGlyphHeightOffset: 0x81,
			textGlyphSourceTileStride: 0x10,
			textGlyphSourceBottomTileOffset: 0x20,
			textGlyphSourceBottomRightTileOffset: 0x30,
			fontBlobLayoutMode: 1,
			fontCodepointStride: 0x20,
			fontNormalSegmentSize: this.options.fontSmallOffset >>> 0,
			fontSmallSegmentSize: (this.options.fontAssetSize - this.options.fontSmallOffset) >>> 0,
			fontNormalMaxCode: (((this.options.fontSmallOffset >>> 0) / 0x20) - 1) >>> 0,
			fontSmallMaxCode: ((((this.options.fontAssetSize - this.options.fontSmallOffset) >>> 0) / 0x20) - 1) >>> 0,
			chinesePairHiMin: 0x01,
			chinesePairHiMax: 0x1e,
			chinesePairHiExcluded: [0x06, 0x1b],
			chinesePairLoMax: 0xf6,
			chinesePunctuationSingles: [0x30],
			chinesePunctuationRangeStart: 0x36,
			chinesePunctuationRangeEnd: 0x3f,
			chinesePunctuationExcluded: [0x38],
			chineseNormalWidth: 12,
			chineseSmallWidth: 10,
			chineseNormalHeight: 15,
			chineseSmallHeight: 13,
			normalPunctuationWidths: [
				{ code: 0x30, width: 7 }
			],
			smallPunctuationWidths: [
				{ code: 0x30, width: 5 },
				{ code: 0x37, width: 6 },
				{ code: 0x39, width: 7 },
				{ code: 0x3a, width: 5 },
				{ code: 0x3b, width: 5 },
				{ code: 0x3c, width: 5 },
				{ code: 0x3d, width: 5 },
				{ code: 0x3e, width: 5 },
				{ code: 0x3f, width: 7 }
			]
		};
	}

	_describeHookWindow(addr, byteCount) {
		var result = {
			addr: addr >>> 0,
			size: byteCount >>> 0,
			bytesHex: "",
			halfwords: []
		};
		if (!addr || !this.romBytes || !this.romBytes.length) {
			return result;
		}

		var offset = ((addr >>> 0) - 0x08000000) >>> 0;
		if (offset >= this.romBytes.length) {
			return result;
		}

		var count = Math.min(byteCount >>> 0, this.romBytes.length - offset);
		var bytes = this.romBytes.slice(offset, offset + count);
		result.bytesHex = Array.from(bytes).map(function(value) {
			return value.toString(16).padStart(2, "0");
		}).join(" ");
		for (var i = 0; i + 1 < bytes.length; i += 2) {
			result.halfwords.push(((bytes[i + 1] << 8) | bytes[i]) >>> 0);
		}
		return result;
	}

	_describeReplayWindow(candidate, addr, fallbackByteCount) {
		var replayAddr = addr >>> 0;
		var replayBytes = fallbackByteCount >>> 0;
		if (candidate) {
			replayAddr = this._safeNum(candidate.replayStartAddr) || replayAddr;
			if (candidate.replayHalfwordCount) {
				replayBytes = ((candidate.replayHalfwordCount >>> 0) * 2) >>> 0;
			}
		}
		var info = this._describeHookWindow(replayAddr, replayBytes);
		info.continueAddr = this._getAnchorContinueAddr(candidate, addr, fallbackByteCount);
		return info;
	}

	_getAnchorHookByteCount(candidate, addr, fallbackByteCount) {
		if (!addr) {
			return 0;
		}
		if (candidate && candidate.hookHalfwordCount) {
			return ((candidate.hookHalfwordCount >>> 0) * 2) >>> 0;
		}
		return fallbackByteCount >>> 0;
	}

	_getAnchorContinueAddr(candidate, addr, fallbackByteCount) {
		if (candidate && candidate.continueAddr) {
			return candidate.continueAddr >>> 0;
		}
		return addr ? ((addr + (fallbackByteCount >>> 0)) >>> 0) : 0;
	}

	_safeNum(value) {
		return typeof value === "number" && isFinite(value) ? (value >>> 0) : 0;
	}

	_getSelectedCharLoopCandidate(semantics) {
		var candidate = this._findCandidateByAddr(
			semantics && semantics.charLoopCandidates,
			semantics && semantics.charLoopAddr,
			"addr"
		);
		return this._isUsableCharLoopCandidate(candidate) ? candidate : null;
	}

	_getSelectedWidthLoopCandidate(semantics) {
		var candidate = this._findCandidateByAddr(
			semantics && semantics.widthLoopCandidates,
			semantics && semantics.widthLoopAddr,
			"addr"
		);
		return this._isUsableWidthLoopCandidate(candidate, semantics) ? candidate : null;
	}

	_getSelectedWidthPrepareCandidate(semantics, selectedWidthLoop) {
		var candidate = this._findCandidateByAddr(
			semantics && semantics.widthPrepareCandidates,
			semantics && semantics.widthPrepareAddr,
			"addr"
		);
		return this._isUsableWidthPrepareCandidate(candidate, selectedWidthLoop) ? candidate : null;
	}

	_getBestHookRegisterSource(semantics) {
		var selectedCharLoop = this._getSelectedCharLoopCandidate(semantics);
		if (selectedCharLoop && selectedCharLoop.regs) {
			return {
				source: "expansion-char-loop",
				regs: selectedCharLoop.regs
			};
		}
		if (this.results && this.results.charDispatchRegs) {
			return {
				source: "char-dispatch",
				regs: this.results.charDispatchRegs
			};
		}
		return {
			source: "none",
			regs: {}
		};
	}

	_findCandidateByAddr(candidates, addr, addrKey) {
		if (!candidates || !candidates.length || !addr) {
			return null;
		}
		for (var i = 0; i < candidates.length; i++) {
			if (((candidates[i][addrKey] || 0) >>> 0) === (addr >>> 0)) {
				return candidates[i];
			}
		}
		return candidates[0] || null;
	}

	_isUsableCharLoopCandidate(candidate) {
		if (!candidate || !candidate.regs) {
			return false;
		}
		var regs = candidate.regs;
		if (typeof regs.textPrinterReg !== "number" || typeof regs.charPtrReg !== "number" || typeof regs.currCharReg !== "number") {
			return false;
		}
		if (regs.textPrinterReg === regs.charPtrReg) {
			return false;
		}
		if (candidate.pointerStore && !candidate.pointerStore.found) {
			return false;
		}
		if (!candidate.pointerAdvance) {
			return false;
		}
		if (!candidate.controlCodeGate || !candidate.controlCodeGate.found) {
			return false;
		}
		return (candidate.score || 0) >= 7.0;
	}

	_isUsableWidthLoopCandidate(candidate, semantics) {
		if (!candidate || !candidate.firstCharLoad || !candidate.widthPattern || !candidate.widthPattern.found) {
			return false;
		}
		if ((candidate.addr >>> 0) === this._safeNum(semantics && semantics.decompressGlyphTileAddr)) {
			return false;
		}
		if ((candidate.score || 0) < 8.0) {
			return false;
		}
		if (!candidate.pointerAdvance) {
			return false;
		}
		return (candidate.branchCount || 0) >= 2;
	}

	_isUsableWidthPrepareCandidate(candidate, selectedWidthLoop) {
		if (!candidate || !candidate.firstBl || !candidate.originalStackAlloc) {
			return false;
		}
		if ((candidate.score || 0) < 6.5) {
			return false;
		}
		if (selectedWidthLoop && candidate.functionStart && ((candidate.functionStart >>> 0) !== (selectedWidthLoop.functionStart >>> 0))) {
			return false;
		}
		return !!candidate.hookHalfwordCount;
	}
}

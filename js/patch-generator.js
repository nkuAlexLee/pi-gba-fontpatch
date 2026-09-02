// js/patch-generator.js
// Phase 3: Generate IPS/UPS binary patch files from dynamically discovered addresses

class PatchGenerator {
	constructor(originalROM, analysisResults) {
		this.originalROM = originalROM;
		this.results = analysisResults;
	}

	// Convert 0x08xxxxxx address to ROM file offset (subtract 0x08000000)
	static toROMOffset(addr) {
		return addr - 0x08000000;
	}

	// Build a THUMB BL (Branch with Link) instruction pair
	static buildThumbBL(fromAddr, toAddr) {
		const offset = toAddr - fromAddr - 4; // pipeline adjustment
		const upper = ((offset >> 12) & 0x7FF) | 0xF000;
		const lower = ((offset >> 1) & 0x7FF) | 0xF800;
		return new Uint8Array([
			upper & 0xFF, (upper >> 8) & 0xFF,
			lower & 0xFF, (lower >> 8) & 0xFF
		]);
	}

	// Find empty space in ROM (sequences of 0xFF or 0x00)
	findEmptySpace(minSize, startSearch) {
		const rom = this.originalROM;
		const start = startSearch || 0;
		const end = Math.min(rom.length - minSize, start + 0x2000000);
		let emptyStart = -1;
		let emptyLen = 0;

		for (let i = start; i < end; i++) {
			if (rom[i] === 0xFF || rom[i] === 0x00) {
				if (emptyStart === -1) emptyStart = i;
				emptyLen++;
				if (emptyLen >= minSize) return emptyStart;
			} else {
				emptyStart = -1;
				emptyLen = 0;
			}
		}
		return -1;
	}

	// Generate complete IPS patch using ONLY dynamically discovered addresses
	generateFullIPS(fontData) {
	try {
		const records = [];
		const rom = this.originalROM;
		const results = this.results;
		const patchPlan = results ? results.patchPlan || null : null;
		const layout = patchPlan ? patchPlan.injectionLayout || null : null;

		if (patchPlan && patchPlan.readiness && patchPlan.readiness.readyForPatchPlan) {
			throw new Error(
				"Semantic IPS synthesis is not implemented yet. Export armips metadata instead of a placeholder IPS."
			);
		}

		if (!results || !results.drawGlyphTilesAddr) {
			console.error('No dynamically discovered addresses available');
			return null;
		}

		// 1. Determine hook targets from dynamic analysis
		const dgtAddr = results.drawGlyphTilesAddr;
		let renderTextAddr = null;
		let getStringWidthAddr = null;
		let renderTextCallSite = null;

		if (results.renderTextCandidates && results.renderTextCandidates.length > 0) {
			const best = results.renderTextCandidates[0];
			renderTextAddr = best.functionStart || best.armCandidate || best.thumbCandidate || null;
			renderTextCallSite = best.callSiteAddr || null;
		}

		if (results.getStringWidthCandidates && results.getStringWidthCandidates.length > 0) {
			const best = results.getStringWidthCandidates[0];
			getStringWidthAddr = best.functionStart || best.armCandidate || best.thumbCandidate || null;
		}

		// 2. Find empty space for hack code + font data, or reuse the semantic patch plan.
		const stubSize = 256;
		let hackBaseAddr = layout && layout.helperCodeBase ? layout.helperCodeBase >>> 0 : 0;
		let hackROMOffset = hackBaseAddr ? PatchGenerator.toROMOffset(hackBaseAddr) : -1;
		if (hackROMOffset < 0) {
			const totalSize = stubSize + (fontData ? fontData.length : 0);
			hackROMOffset = this.findEmptySpace(totalSize, 0x200000);
			if (hackROMOffset === -1) {
				hackROMOffset = this.findEmptySpace(totalSize, 0);
			}
			if (hackROMOffset === -1) {
				console.error('Cannot find empty space for hack code');
				return null;
			}
			hackBaseAddr = hackROMOffset + 0x08000000;
		}

		// 3. Build and write the trampoline stub
		const stub = this._buildTrampolineStub(hackBaseAddr, dgtAddr, renderTextAddr);
		records.push({ offset: hackROMOffset, data: stub });

		// 4. Write font data after stub
		let fontBaseAddr = layout && layout.normalFontBase ? layout.normalFontBase >>> 0 : null;
		if (fontData && fontData.length > 0) {
			const fontROMOffset = fontBaseAddr
				? PatchGenerator.toROMOffset(fontBaseAddr)
				: (hackROMOffset + stubSize);
			fontBaseAddr = fontROMOffset + 0x08000000;
			records.push({ offset: fontROMOffset, data: fontData });
		}

		// 5. Insert BL hooks at dynamically discovered function addresses
		//    BL at DrawGlyphTiles → hack stub
		const dgtROMOffset = PatchGenerator.toROMOffset(dgtAddr);
		if (dgtROMOffset >= 0 && dgtROMOffset < rom.length) {
			const bl = PatchGenerator.buildThumbBL(dgtAddr, hackBaseAddr);
			records.push({ offset: dgtROMOffset, data: bl });
			console.log('Hook: DrawGlyphTiles at 0x' + dgtAddr.toString(16) + ' → 0x' + hackBaseAddr.toString(16));
		}

		//    BL at RenderText call site → hack stub
		if (renderTextCallSite) {
			const csROMOffset = PatchGenerator.toROMOffset(renderTextCallSite);
			if (csROMOffset >= 0 && csROMOffset < rom.length) {
				const bl = PatchGenerator.buildThumbBL(renderTextCallSite, hackBaseAddr + stubSize - 16);
				records.push({ offset: csROMOffset, data: bl });
				console.log('Hook: RenderText call at 0x' + renderTextCallSite.toString(16) + ' → 0x' + (hackBaseAddr + stubSize - 16).toString(16));
			}
		}

		// 6. Log all addresses used
		console.log('Dynamic IPS addresses:');
		console.log('  DrawGlyphTiles: 0x' + dgtAddr.toString(16));
		console.log('  RenderText: ' + (renderTextAddr ? '0x' + renderTextAddr.toString(16) : 'not found'));
		console.log('  RenderText call site: ' + (renderTextCallSite ? '0x' + renderTextCallSite.toString(16) : 'not found'));
		console.log('  GetStringWidth: ' + (getStringWidthAddr ? '0x' + getStringWidthAddr.toString(16) : 'not found'));
		console.log('  Hack base (ROM offset): 0x' + hackROMOffset.toString(16));
		console.log('  Font base: ' + (fontBaseAddr ? '0x' + fontBaseAddr.toString(16) : 'none'));
		console.log('  Records: ' + records.length);

		// 7. Generate IPS
		return this.generateIPS(records);
	} catch (e) {
		console.error('generateFullIPS error:', e);
		console.error('Stack:', e.stack);
		console.error('results:', JSON.stringify(this.results, function(k, v) {
			if (v && typeof v === 'object' && v.length > 5) return v.slice(0, 3);
			return v;
		}));
		throw e;
	}
	}

	// Build a minimal trampoline stub that the BL hook jumps to
	// In a real implementation, this would contain the full Chinese rendering logic
	// For now, it's a placeholder that returns to the caller
	_buildTrampolineStub(baseAddr, dgtAddr, rtAddr) {
		const stub = new Uint8Array(256);
		let i = 0;

		// PUSH {r4-r7, lr}
		stub[i++] = 0xF0; stub[i++] = 0xB5;

		// Store original address info for debugging
		// NOP placeholder - real code would go here
		stub[i++] = 0x00; stub[i++] = 0xBF; // NOP

		// POP {r4-r7, pc}
		stub[i++] = 0xF0; stub[i++] = 0xBD;

		return stub;
	}

	generateIPS(records) {
		if (!records || records.length === 0) {
			return new Uint8Array([
				0x50, 0x41, 0x54, 0x43, 0x48,  // PATCH
				0x45, 0x4F, 0x46                  // EOF
			]);
		}

		const parts = [];
		parts.push(new Uint8Array([0x50, 0x41, 0x54, 0x43, 0x48]));

		for (const record of records) {
			// Offset: 3 bytes big-endian
			const offset = new Uint8Array(3);
			offset[0] = (record.offset >> 16) & 0xFF;
			offset[1] = (record.offset >> 8) & 0xFF;
			offset[2] = record.offset & 0xFF;
			parts.push(offset);

			// Size: 2 bytes big-endian
			const size = new Uint8Array(2);
			size[0] = (record.data.length >> 8) & 0xFF;
			size[1] = record.data.length & 0xFF;
			parts.push(size);

			parts.push(record.data);
		}

		parts.push(new Uint8Array([0x45, 0x4F, 0x46]));
		return this._concatArrays(parts);
	}

	_concatArrays(arrays) {
		let totalLen = 0;
		for (const a of arrays) totalLen += a.length;
		const result = new Uint8Array(totalLen);
		let offset = 0;
		for (const a of arrays) {
			result.set(a, offset);
			offset += a.length;
		}
		return result;
	}

	downloadBlob(blob, filename) {
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	generateArmipsMetadata(fontData) {
		var results = this.results || {};
		var lines = [];
		lines.push("; Dynamic font cracker armips scaffold");
		lines.push("; Generated from semantic runtime analysis.");
		lines.push("; Review all hook sites before uncommenting patch directives.");
		lines.push("");
		lines.push(".gba");
		lines.push("; Replace these placeholders before assembling.");
		lines.push('; .open "__INPUT_ROM__.gba","__OUTPUT_ROM__.gba",0x08000000');
		lines.push(".thumb");
		lines.push("");
		lines.push(".equ DRAW_GLYPH_TILES, " + this._fmtAddr(results.drawGlyphTilesAddr));
		lines.push(".equ RENDER_TEXT, " + this._fmtAddr(results.renderTextAddr));
		lines.push(".equ CHAR_DISPATCH, " + this._fmtAddr(results.charDispatchAddr));
		lines.push(".equ GET_STRING_WIDTH, " + this._fmtAddr(results.getStringWidthAddr));
		if (results.patchPlan && results.patchPlan.semanticAnchors) {
			lines.push(".equ PATCH_TEXT_ENTRY, " + this._fmtAddr(results.patchPlan.semanticAnchors.textEntryAddr));
			lines.push(".equ PATCH_TEXT_HOOK_SIZE, " + this._fmtNum(results.patchPlan.semanticAnchors.textEntryHookSize));
			lines.push(".equ PATCH_TEXT_CONTINUE, " + this._fmtAddr(results.patchPlan.semanticAnchors.textEntryContinueAddr));
			lines.push(".equ PATCH_TEXT_CONTINUE_THUMB, PATCH_TEXT_CONTINUE + 1");
			if (results.patchPlan.semanticAnchors.textEntryReplayWindow) {
				lines.push(".equ PATCH_TEXT_REPLAY_START, " + this._fmtAddr(results.patchPlan.semanticAnchors.textEntryReplayWindow.addr));
				lines.push(".equ PATCH_TEXT_REPLAY_SIZE, " + this._fmtNum(results.patchPlan.semanticAnchors.textEntryReplayWindow.size));
			}
			lines.push(".equ PATCH_WIDTH_ENTRY, " + this._fmtAddr(results.patchPlan.semanticAnchors.widthEntryAddr));
			lines.push(".equ PATCH_WIDTH_HOOK_SIZE, " + this._fmtNum(results.patchPlan.semanticAnchors.widthEntryHookSize));
			lines.push(".equ PATCH_WIDTH_CONTINUE, " + this._fmtAddr(results.patchPlan.semanticAnchors.widthEntryContinueAddr));
			lines.push(".equ PATCH_WIDTH_CONTINUE_THUMB, PATCH_WIDTH_CONTINUE + 1");
			if (results.patchPlan.semanticAnchors.widthEntryReplayWindow) {
				lines.push(".equ PATCH_WIDTH_REPLAY_START, " + this._fmtAddr(results.patchPlan.semanticAnchors.widthEntryReplayWindow.addr));
				lines.push(".equ PATCH_WIDTH_REPLAY_SIZE, " + this._fmtNum(results.patchPlan.semanticAnchors.widthEntryReplayWindow.size));
			}
			lines.push(".equ PATCH_WIDTH_PREPARE_ENTRY, " + this._fmtAddr(results.patchPlan.semanticAnchors.widthPrepareAddr));
			lines.push(".equ PATCH_WIDTH_PREPARE_HOOK_SIZE, " + this._fmtNum(results.patchPlan.semanticAnchors.widthPrepareHookSize));
			lines.push(".equ PATCH_WIDTH_PREPARE_CONTINUE, " + this._fmtAddr(results.patchPlan.semanticAnchors.widthPrepareContinueAddr));
			lines.push(".equ PATCH_WIDTH_PREPARE_CONTINUE_THUMB, PATCH_WIDTH_PREPARE_CONTINUE + 1");
			if (results.patchPlan.semanticAnchors.widthPrepareReplayWindow) {
				lines.push(".equ PATCH_WIDTH_PREPARE_REPLAY_START, " + this._fmtAddr(results.patchPlan.semanticAnchors.widthPrepareReplayWindow.addr));
				lines.push(".equ PATCH_WIDTH_PREPARE_REPLAY_SIZE, " + this._fmtNum(results.patchPlan.semanticAnchors.widthPrepareReplayWindow.size));
			}
			lines.push(".equ PATCH_FONT_DISPATCH, " + this._fmtAddr(results.patchPlan.semanticAnchors.fontDispatchAddr));
		}
		if (results.patchPlan && results.patchPlan.injectionLayout) {
			lines.push(".equ HELPER_CODE_BASE, " + this._fmtAddr(results.patchPlan.injectionLayout.helperCodeBase));
			lines.push(".equ HELPER_WIDTH_TABLE, " + this._fmtAddr(results.patchPlan.injectionLayout.widthTableBase));
			lines.push(".equ FONT_NORMAL_BASE, " + this._fmtAddr(results.patchPlan.injectionLayout.normalFontBase));
			lines.push(".equ FONT_SMALL_BASE, " + this._fmtAddr(results.patchPlan.injectionLayout.smallFontBase));
			lines.push(".equ FONT_SMALL_OFFSET, " + this._fmtNum(results.patchPlan.injectionLayout.smallFontOffset));
			lines.push(".equ FONT_DATA_FILE_OFFSET, " + this._fmtNum(PatchGenerator.toROMOffset(results.patchPlan.injectionLayout.normalFontBase)));
		}
		if (
			results.patchPlan &&
			results.patchPlan.helperParams &&
			results.patchPlan.helperParams.gCurGlyphAddrCandidate
		) {
			lines.push(".equ G_CUR_GLYPH_CANDIDATE, " + this._fmtAddr(results.patchPlan.helperParams.gCurGlyphAddrCandidate));
		} else if (results.glyphStateInfo && results.glyphStateInfo.glyphStateBaseAddress) {
			lines.push(".equ G_CUR_GLYPH_CANDIDATE, " + this._fmtAddr(results.glyphStateInfo.glyphStateBaseAddress));
		}
		if (results.patchPlan && results.patchPlan.helperParams) {
			lines.push(".equ DECOMPRESS_GLYPH_TILE, " + this._fmtAddr(results.patchPlan.helperParams.decompressGlyphTileAddr));
			lines.push(".equ HELPER_TEXT_PRINTER_REG, " + this._fmtNum(results.patchPlan.helperParams.textPrinterReg));
			lines.push(".equ HELPER_CHAR_PTR_REG, " + this._fmtNum(results.patchPlan.helperParams.charPtrReg));
			lines.push(".equ HELPER_CURR_CHAR_REG, " + this._fmtNum(results.patchPlan.helperParams.currCharReg));
			lines.push(".equ HELPER_NEXT_CHAR_REG, " + this._fmtNum(results.patchPlan.helperParams.nextByteReg));
			lines.push(".equ HELPER_CHAR_PTR_FIELD_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.charPtrFieldOffset));
			lines.push(".equ HELPER_CHAR_PTR_STORE_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.charPtrStoreOffset));
			lines.push(".equ HELPER_CHAR_LOAD_IMM, " + this._fmtNum(results.patchPlan.helperParams.charLoadImm));
			lines.push(".equ HELPER_NEXT_CHAR_IMM, " + this._fmtNum(results.patchPlan.helperParams.nextByteImm));
			lines.push(".equ WIDTH_PREPARE_NEEDED, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareNeeded ? 1 : 0));
			lines.push(".equ WIDTH_PREPARE_ORIGINAL_STACK_ALLOC, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareOriginalStackAlloc));
			lines.push(".equ WIDTH_PREPARE_EXPANDED_STACK_ALLOC, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareExpandedStackAlloc));
			lines.push(".equ WIDTH_PREPARE_FONTID_STACK_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareFontIdStackOffset));
			lines.push(".equ WIDTH_PREPARE_FONTID_ENTRY_REG, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareFontIdEntryReg));
			lines.push(".equ WIDTH_PREPARE_STRING_ENTRY_REG, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareStringPtrEntryReg));
			lines.push(".equ WIDTH_PREPARE_FONTID_WORK_REG, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareWorkingFontIdReg));
			lines.push(".equ WIDTH_PREPARE_STRING_WORK_REG, " + this._fmtNum(results.patchPlan.helperParams.widthPrepareStringPtrWorkReg));
			lines.push(".equ TEXT_PRINTER_TEMPLATE_CURRENT_CHAR_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterTemplateCurrentCharOffset));
			lines.push(".equ TEXT_PRINTER_TEMPLATE_FONT_ID_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterTemplateFontIdOffset));
			lines.push(".equ TEXT_PRINTER_TEMPLATE_SIZE, " + this._fmtNum(results.patchPlan.helperParams.textPrinterTemplateSize));
			lines.push(".equ TEXT_PRINTER_AUTO_SCROLL_DELAY_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterAutoScrollDelayOffset));
			lines.push(".equ TEXT_PRINTER_FLAGS_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterFlagsByteOffset));
			lines.push(".equ TEXT_PRINTER_FONT_ID_BYTE_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterFontIdByteOffset));
			lines.push(".equ TEXT_PRINTER_FONT_ID_MASK, " + this._fmtNum(results.patchPlan.helperParams.textPrinterFontIdMask));
			lines.push(".equ TEXT_PRINTER_FONT_ID_SHIFT, " + this._fmtNum(results.patchPlan.helperParams.textPrinterFontIdShift));
			lines.push(".equ TEXT_PRINTER_JAPANESE_BYTE_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterJapaneseByteOffset));
			lines.push(".equ TEXT_PRINTER_JAPANESE_MASK, " + this._fmtNum(results.patchPlan.helperParams.textPrinterJapaneseMask));
			lines.push(".equ TEXT_PRINTER_JAPANESE_SHIFT, " + this._fmtNum(results.patchPlan.helperParams.textPrinterJapaneseShift));
			lines.push(".equ TEXT_PRINTER_STATE_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textPrinterStateOffset));
			lines.push(".equ TEXT_PRINTER_SIZE, " + this._fmtNum(results.patchPlan.helperParams.textPrinterSize));
			lines.push(".equ G_CUR_GLYPH_TOP_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphTopOffset));
			lines.push(".equ G_CUR_GLYPH_TOP_RIGHT_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphTopRightOffset));
			lines.push(".equ G_CUR_GLYPH_BOTTOM_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphBottomOffset));
			lines.push(".equ G_CUR_GLYPH_BOTTOM_RIGHT_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphBottomRightOffset));
			lines.push(".equ G_CUR_GLYPH_WIDTH_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphWidthOffset));
			lines.push(".equ G_CUR_GLYPH_HEIGHT_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphHeightOffset));
			lines.push(".equ TEXT_GLYPH_SOURCE_TILE_STRIDE, " + this._fmtNum(results.patchPlan.helperParams.textGlyphSourceTileStride));
			lines.push(".equ TEXT_GLYPH_SOURCE_BOTTOM_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphSourceBottomTileOffset));
			lines.push(".equ TEXT_GLYPH_SOURCE_BOTTOM_RIGHT_OFFSET, " + this._fmtNum(results.patchPlan.helperParams.textGlyphSourceBottomRightTileOffset));
			lines.push(".equ FONT_BLOB_LAYOUT_DIRECT_CODE32, " + this._fmtNum(results.patchPlan.helperParams.fontBlobLayoutMode));
			lines.push(".equ FONT_CODEPOINT_STRIDE, " + this._fmtNum(results.patchPlan.helperParams.fontCodepointStride));
			lines.push(".equ FONT_NORMAL_SEGMENT_SIZE, " + this._fmtNum(results.patchPlan.helperParams.fontNormalSegmentSize));
			lines.push(".equ FONT_SMALL_SEGMENT_SIZE, " + this._fmtNum(results.patchPlan.helperParams.fontSmallSegmentSize));
			lines.push(".equ FONT_NORMAL_MAX_CODE, " + this._fmtNum(results.patchPlan.helperParams.fontNormalMaxCode));
			lines.push(".equ FONT_SMALL_MAX_CODE, " + this._fmtNum(results.patchPlan.helperParams.fontSmallMaxCode));
			lines.push(".equ CHINESE_PAIR_HI_MIN, " + this._fmtNum(results.patchPlan.helperParams.chinesePairHiMin));
			lines.push(".equ CHINESE_PAIR_HI_MAX, " + this._fmtNum(results.patchPlan.helperParams.chinesePairHiMax));
			lines.push(".equ CHINESE_PAIR_HI_EXCLUDED_0, " + this._fmtNum((results.patchPlan.helperParams.chinesePairHiExcluded || [0])[0]));
			lines.push(".equ CHINESE_PAIR_HI_EXCLUDED_1, " + this._fmtNum((results.patchPlan.helperParams.chinesePairHiExcluded || [0, 0])[1]));
			lines.push(".equ CHINESE_PAIR_LO_MAX, " + this._fmtNum(results.patchPlan.helperParams.chinesePairLoMax));
			lines.push(".equ CHINESE_PUNCT_SINGLE_0, " + this._fmtNum((results.patchPlan.helperParams.chinesePunctuationSingles || [0])[0]));
			lines.push(".equ CHINESE_PUNCT_RANGE_START, " + this._fmtNum(results.patchPlan.helperParams.chinesePunctuationRangeStart));
			lines.push(".equ CHINESE_PUNCT_RANGE_END, " + this._fmtNum(results.patchPlan.helperParams.chinesePunctuationRangeEnd));
			lines.push(".equ CHINESE_PUNCT_EXCLUDED_0, " + this._fmtNum((results.patchPlan.helperParams.chinesePunctuationExcluded || [0])[0]));
			lines.push(".equ CHINESE_NORMAL_WIDTH, " + this._fmtNum(results.patchPlan.helperParams.chineseNormalWidth));
			lines.push(".equ CHINESE_SMALL_WIDTH, " + this._fmtNum(results.patchPlan.helperParams.chineseSmallWidth));
			lines.push(".equ CHINESE_NORMAL_HEIGHT, " + this._fmtNum(results.patchPlan.helperParams.chineseNormalHeight));
			lines.push(".equ CHINESE_SMALL_HEIGHT, " + this._fmtNum(results.patchPlan.helperParams.chineseSmallHeight));
			lines.push(".equ FONT_SMALL, 0");
			lines.push(".equ FONT_NORMAL, 1");
			lines.push(".equ FONT_BRAILLE, 6");
			lines.push(".equ FONT_SMALL_NARROW, 8");
			lines.push(".equ FONT_SMALL_NARROWER, 10");
			lines.push(".equ TRUE, 1");
			lines.push(".equ FALSE, 0");
		}
		if (results.charDispatchRegs) {
			lines.push(".equ CHAR_PTR_REG, " + this._fmtNum(results.charDispatchRegs.charPtrReg));
			lines.push(".equ CURR_CHAR_REG, " + this._fmtNum(results.charDispatchRegs.currCharReg));
			lines.push(".equ TEXT_PRINTER_REG, " + this._fmtNum(results.charDispatchRegs.textPrinterReg));
		}
		if (fontData && fontData.length) {
			lines.push(".equ FONT_DATA_SIZE, " + this._fmtNum(fontData.length));
		}
		lines.push("");
		if (results.patchPlan && results.patchPlan.notes && results.patchPlan.notes.length) {
			lines.push("; Patch-plan notes");
			for (var n = 0; n < results.patchPlan.notes.length; n++) {
				lines.push("; " + results.patchPlan.notes[n]);
			}
			lines.push("");
		}
		if (results.patchPlan && results.patchPlan.unresolvedSymbols && results.patchPlan.unresolvedSymbols.length) {
			lines.push("; Unresolved helper symbols");
			for (var u = 0; u < results.patchPlan.unresolvedSymbols.length; u++) {
				lines.push("; " + results.patchPlan.unresolvedSymbols[u].name + ": " + results.patchPlan.unresolvedSymbols[u].reason);
			}
			lines.push("");
		}
		if (results.glyphStateInfo && results.glyphStateInfo.blocks && results.glyphStateInfo.blocks.length) {
			lines.push("; Glyph-state candidates");
			for (var g = 0; g < Math.min(4, results.glyphStateInfo.blocks.length); g++) {
				var block = results.glyphStateInfo.blocks[g];
				lines.push(
					"; " + g + ": " + this._fmtAddr(block.start) +
					" region=" + block.regionName +
					" size=" + this._fmtNum(block.size) +
					" score=" + block.score
				);
			}
			lines.push("");
		}
		if (
			results.expansionSemantics &&
			results.expansionSemantics.decompressGlyphTileCandidates &&
			results.expansionSemantics.decompressGlyphTileCandidates.length
		) {
			lines.push("; Glyph-tile decompressor candidates");
			for (var d = 0; d < Math.min(3, results.expansionSemantics.decompressGlyphTileCandidates.length); d++) {
				var decomp = results.expansionSemantics.decompressGlyphTileCandidates[d];
				lines.push(
					"; " + d + ": " + this._fmtAddr(decomp.targetAddr) +
					" score=" + decomp.score.toFixed(3) +
					" parents=" + this._fmtNum(decomp.parentFunctionCount) +
					" repeats=" + this._fmtNum(decomp.totalRepeatCount)
				);
			}
			if (
				results.expansionSemantics.glyphDecompressParentCandidates &&
				results.expansionSemantics.glyphDecompressParentCandidates.length
			) {
				lines.push("; Top glyph-decompress parents");
				for (var p = 0; p < Math.min(3, results.expansionSemantics.glyphDecompressParentCandidates.length); p++) {
					var parent = results.expansionSemantics.glyphDecompressParentCandidates[p];
					var bestTarget = parent.repeatedTargets && parent.repeatedTargets.length
						? parent.repeatedTargets[0]
						: null;
					lines.push(
						"; " + p + ": " + this._fmtAddr(parent.functionStart) +
						" calls=" + this._fmtNum(parent.callSiteCount) +
						(bestTarget
							? " target=" + this._fmtAddr(bestTarget.targetAddr) + " x" + this._fmtNum(bestTarget.repeatCount)
							: "")
					);
				}
			}
			lines.push("");
		}
		if (results.patchPlan && results.patchPlan.semanticAnchors) {
			lines.push("; Hook windows");
			this._appendHookWindow(lines, "TEXT_ENTRY", results.patchPlan.semanticAnchors.textEntryWindow);
			this._appendHookWindow(lines, "TEXT_REPLAY", results.patchPlan.semanticAnchors.textEntryReplayWindow);
			this._appendHookWindow(lines, "WIDTH_PREPARE", results.patchPlan.semanticAnchors.widthPrepareWindow);
			this._appendHookWindow(lines, "WIDTH_PREPARE_REPLAY", results.patchPlan.semanticAnchors.widthPrepareReplayWindow);
			this._appendHookWindow(lines, "WIDTH_ENTRY", results.patchPlan.semanticAnchors.widthEntryWindow);
			this._appendHookWindow(lines, "WIDTH_REPLAY", results.patchPlan.semanticAnchors.widthEntryReplayWindow);
			this._appendHookWindow(lines, "FONT_DISPATCH", results.patchPlan.semanticAnchors.fontDispatchWindow);
			lines.push("");
			this._appendArmipsScaffold(lines, results, fontData);
		}
		lines.push("; Top draw candidates");
		if (results.drawGlyphTilesCandidates) {
			for (var i = 0; i < Math.min(5, results.drawGlyphTilesCandidates.length); i++) {
				var c = results.drawGlyphTilesCandidates[i];
				lines.push("; " + i + ": " + this._fmtAddr(c.pc) + " score=" + c.score.toFixed(3));
			}
		}
		lines.push("");
		lines.push("; Top render candidates");
		if (results.renderTextCandidates) {
			for (var j = 0; j < Math.min(5, results.renderTextCandidates.length); j++) {
				var r = results.renderTextCandidates[j];
				lines.push("; " + j + ": " + this._fmtAddr(r.functionStart) + " score=" + r.score.toFixed(3));
			}
		}
		return lines.join("\n");
	}

	_fmtAddr(value) {
		if (typeof value !== "number" || !isFinite(value) || value <= 0) {
			return "0";
		}
		return "0x" + (value >>> 0).toString(16);
	}

	_fmtNum(value) {
		if (typeof value !== "number" || !isFinite(value)) {
			return "0";
		}
		return String(value >>> 0);
	}

	_appendHookWindow(lines, label, windowInfo) {
		if (!windowInfo || !windowInfo.addr) {
			lines.push("; " + label + ": unavailable");
			return;
		}
		lines.push("; " + label + " @ " + this._fmtAddr(windowInfo.addr) + " size=" + this._fmtNum(windowInfo.size));
		if (windowInfo.continueAddr) {
			lines.push("; continue: " + this._fmtAddr(windowInfo.continueAddr));
		}
		if (windowInfo.bytesHex) {
			lines.push("; bytes: " + windowInfo.bytesHex);
		}
		if (windowInfo.halfwords && windowInfo.halfwords.length) {
			lines.push("; halfwords: " + windowInfo.halfwords.map(function(value) {
				return "0x" + (value >>> 0).toString(16);
			}).join(", "));
		}
	}

	_appendArmipsScaffold(lines, results, fontData) {
		var semanticAnchors = results.patchPlan ? results.patchPlan.semanticAnchors || {} : {};
		var replayBlocks = {
			text: this._buildReplayBlockSpec("ReplayTextWindow_Dynamic", semanticAnchors.textEntryReplayWindow),
			widthPrepare: this._buildReplayBlockSpec("ReplayWidthPrepareWindow_Dynamic", semanticAnchors.widthPrepareReplayWindow),
			width: this._buildReplayBlockSpec("ReplayWidthWindow_Dynamic", semanticAnchors.widthEntryReplayWindow)
		};
		lines.push("; Armips scaffold");
		lines.push("; This section is emitted as a working template, not as a ready-to-apply final patch.");
		lines.push("; Fill in the helper bodies first, then uncomment the hook directives.");
		if (results.patchPlan && results.patchPlan.helperParams) {
			lines.push("; Helper parameter hints:");
			lines.push(
				";   textPrinterReg=" + this._fmtNum(results.patchPlan.helperParams.textPrinterReg) +
				", charPtrReg=" + this._fmtNum(results.patchPlan.helperParams.charPtrReg) +
				", currCharReg=" + this._fmtNum(results.patchPlan.helperParams.currCharReg) +
				", nextByteReg=" + this._fmtNum(results.patchPlan.helperParams.nextByteReg) +
				", source=" + (results.patchPlan.helperParams.hookRegisterSource || "none")
			);
			lines.push(
				";   charPtrLoadedBeforeHook=" +
				(results.patchPlan.helperParams.charPtrLoadedBeforeHook ? "true" : "false")
			);
			lines.push(
				";   widthPrepareNeeded=" +
				(results.patchPlan.helperParams.widthPrepareNeeded ? "true" : "false") +
				", prepareStack=" + this._fmtNum(results.patchPlan.helperParams.widthPrepareOriginalStackAlloc) +
				"->" + this._fmtNum(results.patchPlan.helperParams.widthPrepareExpandedStackAlloc) +
				", fontIdStackOffset=" + this._fmtNum(results.patchPlan.helperParams.widthPrepareFontIdStackOffset)
			);
			lines.push(
				";   charPtrFieldOffset=" + this._fmtNum(results.patchPlan.helperParams.charPtrFieldOffset) +
				", charPtrStoreOffset=" + this._fmtNum(results.patchPlan.helperParams.charPtrStoreOffset) +
				", charLoadImm=" + this._fmtNum(results.patchPlan.helperParams.charLoadImm) +
				", nextByteImm=" + this._fmtNum(results.patchPlan.helperParams.nextByteImm)
			);
			lines.push(
				";   normalFontIds=" + (results.patchPlan.helperParams.normalFontIds || []).join(",") +
				" smallFontIds=" + (results.patchPlan.helperParams.smallFontIds || []).join(",")
			);
			lines.push(
				";   flagsByteOffset=" + this._fmtNum(results.patchPlan.helperParams.textPrinterFlagsByteOffset) +
				", fontMask=" + this._fmtNum(results.patchPlan.helperParams.textPrinterFontIdMask) +
				", japaneseMask=" + this._fmtNum(results.patchPlan.helperParams.textPrinterJapaneseMask)
			);
			lines.push(
				";   widths(normal/small)=" + this._fmtNum(results.patchPlan.helperParams.chineseNormalWidth) +
				"/" + this._fmtNum(results.patchPlan.helperParams.chineseSmallWidth) +
				" heights=" + this._fmtNum(results.patchPlan.helperParams.chineseNormalHeight) +
				"/" + this._fmtNum(results.patchPlan.helperParams.chineseSmallHeight)
			);
			lines.push(
				";   gCurGlyph(top/topRight/bottom/bottomRight/width/height)=" +
				this._fmtNum(results.patchPlan.helperParams.textGlyphTopOffset) + "/" +
				this._fmtNum(results.patchPlan.helperParams.textGlyphTopRightOffset) + "/" +
				this._fmtNum(results.patchPlan.helperParams.textGlyphBottomOffset) + "/" +
				this._fmtNum(results.patchPlan.helperParams.textGlyphBottomRightOffset) + "/" +
				this._fmtNum(results.patchPlan.helperParams.textGlyphWidthOffset) + "/" +
				this._fmtNum(results.patchPlan.helperParams.textGlyphHeightOffset)
			);
			lines.push(
				";   fontBlob=direct-code32 stride=" + this._fmtNum(results.patchPlan.helperParams.fontCodepointStride) +
				" normalMax=0x" + (results.patchPlan.helperParams.fontNormalMaxCode >>> 0).toString(16) +
				" smallMax=0x" + (results.patchPlan.helperParams.fontSmallMaxCode >>> 0).toString(16)
			);
		}
		lines.push("");
		lines.push("; Reference source patterns:");
		lines.push(";   Pokemon_GBA_Font_Patch-main/pokeE/src/HookInOrigin/text.s");
		lines.push(";   Pokemon_GBA_Font_Patch-main/pokeE/src/HackFunction/text.s");
		lines.push("");
		lines.push("; Hook directives");
		this._appendCommentedHook(lines, "PATCH_TEXT_ENTRY", "RenderTextChinese_Dynamic");
		this._appendCommentedHook(lines, "PATCH_WIDTH_PREPARE_ENTRY", "GetStringWidthPrepare_Dynamic");
		this._appendCommentedHook(lines, "PATCH_WIDTH_ENTRY", "GetStringWidthChinese_Dynamic");
		lines.push("");
		lines.push("; Helper code region");
		lines.push(".org HELPER_CODE_BASE");
		lines.push(".thumb");
		lines.push("");
		lines.push("; Replay-window helpers");
		this._appendReplayBlock(lines, replayBlocks.text);
		this._appendReplayBlock(lines, replayBlocks.widthPrepare);
		this._appendReplayBlock(lines, replayBlocks.width);
		lines.push("");
		lines.push("RenderTextChinese_Dynamic:");
		lines.push("    ; Replay the displaced instructions from TEXT_REPLAY before branching back.");
		if (replayBlocks.text.available && replayBlocks.text.relocatable) {
			lines.push("    bl " + replayBlocks.text.label);
		} else if (replayBlocks.text.available) {
			lines.push("    ; TEXT_REPLAY was exported below, but it contains PC-relative or branch opcodes and must stay manual.");
		} else {
			lines.push("    ; TEXT_REPLAY metadata is unavailable, so no automatic replay stub was emitted.");
		}
		lines.push("    ; No registers are saved here yet. Add a prologue only after the hook-site register contract is confirmed.");
		lines.push("    ; Hook-specific register ownership still needs to be filled from the hook window.");
		lines.push("    ; Suggested flow:");
		lines.push("    ; 1. recover textPrinter/currentChar pointer from the discovered hook registers");
		lines.push("    ; 2. read current byte and optional next byte");
		lines.push("    ; 3. call ExtractFontId_Dynamic / ExtractJapaneseFlag_Dynamic");
		lines.push("    ; 4. call IsChinesePair_Dynamic or IsChinesePunctuation_Dynamic");
		lines.push("    ; 5. compose code, call SetChineseGlyphMetrics_Dynamic");
		lines.push("    ; 6. call ResolveChineseGlyphAddr_Dynamic");
		lines.push("    ; 7. call CallDecompressGlyph4_Dynamic");
		lines.push("    ; 8. commit pointer advancement and branch to PATCH_TEXT_CONTINUE_THUMB");
		lines.push("    ; Reusable helpers emitted below:");
		lines.push("    ;   ExtractFontId_Dynamic");
		lines.push("    ;   ExtractJapaneseFlag_Dynamic");
		lines.push("    ;   IsFontSmall_Dynamic");
		lines.push("    ;   IsChinesePair_Dynamic");
		lines.push("    ;   IsChinesePunctuation_Dynamic");
		lines.push("    ;   MapChineseGlyphId_Dynamic");
		lines.push("    ;   GetChineseWidth_Dynamic");
		lines.push("    ;   SetChineseGlyphMetrics_Dynamic");
		lines.push("    ;   ResolveChineseGlyphAddr_Dynamic");
		lines.push("    ;   CallDecompressGlyph4_Dynamic");
		lines.push("    ; Remaining ROM-specific task:");
		lines.push("    ;   wire this body to the hook-site registers and displaced halfwords.");
		lines.push("    ;   PATCH_TEXT_HOOK_SIZE and TEXT_REPLAY metadata describe the exact window to replay.");
		lines.push("    ; TODO unresolved symbols to wire:");
		if (
			!(
				(results.patchPlan && results.patchPlan.helperParams && results.patchPlan.helperParams.gCurGlyphAddrCandidate) ||
				(results.glyphStateInfo && results.glyphStateInfo.glyphStateBaseAddress)
			)
		) {
			lines.push("    ;   G_CUR_GLYPH");
		}
		if (!(results.patchPlan && results.patchPlan.helperParams && results.patchPlan.helperParams.decompressGlyphTileAddr)) {
			lines.push("    ;   DECOMPRESS_GLYPH_TILE");
		}
		lines.push("    ldr r0,=PATCH_TEXT_CONTINUE_THUMB");
		lines.push("    bx r0");
		lines.push("");
		lines.push("GetStringWidthPrepare_Dynamic:");
		lines.push("    ; Width prepare hook should extend the local stack frame and preserve fontId.");
		lines.push("    ; Replay WIDTH_PREPARE_REPLAY, store the sanitized/current fontId at WIDTH_PREPARE_FONTID_STACK_OFFSET,");
		lines.push("    ; then branch to PATCH_WIDTH_PREPARE_CONTINUE_THUMB.");
		lines.push("    ; This hook is only needed when WIDTH_PREPARE_NEEDED == 1.");
		if (replayBlocks.widthPrepare.available && replayBlocks.widthPrepare.relocatable) {
			lines.push("    bl " + replayBlocks.widthPrepare.label);
		} else if (replayBlocks.widthPrepare.available) {
			lines.push("    ; WIDTH_PREPARE_REPLAY was exported below, but it contains PC-relative or branch opcodes and must stay manual.");
		} else {
			lines.push("    ; WIDTH_PREPARE_REPLAY metadata is unavailable, so no automatic replay stub was emitted.");
		}
		lines.push("    ldr r0,=PATCH_WIDTH_PREPARE_CONTINUE_THUMB");
		lines.push("    bx r0");
		lines.push("");
		lines.push("GetStringWidthChinese_Dynamic:");
		lines.push("    ; Width-loop integration is still hook-specific, but the detection logic is now concrete:");
		lines.push("    ; Keep this stub stack-neutral until the final hook body is wired.");
		if (replayBlocks.width.available && replayBlocks.width.relocatable) {
			lines.push("    bl " + replayBlocks.width.label);
		} else if (replayBlocks.width.available) {
			lines.push("    ; WIDTH_REPLAY was exported below, but it contains PC-relative or branch opcodes and must stay manual.");
		} else {
			lines.push("    ; WIDTH_REPLAY metadata is unavailable, so no automatic replay stub was emitted.");
		}
		lines.push("    ;   - ExtractFontId_Dynamic / ExtractJapaneseFlag_Dynamic");
		lines.push("    ;   - IsChinesePair_Dynamic / IsChinesePunctuation_Dynamic");
		lines.push("    ;   - GetChineseWidth_Dynamic");
		lines.push("    ;   - load preserved fontId from the width-prepare stack slot when WIDTH_PREPARE_NEEDED == 1");
		lines.push("    ;   - use WIDTH_REPLAY metadata to replay the lookahead window before continuing");
		lines.push("    ; Return to PATCH_WIDTH_CONTINUE_THUMB when the current site should fall through.");
		lines.push("    ldr r0,=PATCH_WIDTH_CONTINUE_THUMB");
		lines.push("    bx r0");
		lines.push("    .pool");
		lines.push("");
		this._appendDynamicHelperRoutines(lines, results.patchPlan ? results.patchPlan.helperParams : null);
		lines.push("");
		lines.push("; Optional helper-local width data");
		lines.push(".org HELPER_WIDTH_TABLE");
		this._appendPunctuationWidthTables(lines, results.patchPlan ? results.patchPlan.helperParams : null);
		lines.push("");
		if (fontData && fontData.length) {
			lines.push("; Font injection layout");
			lines.push("; The current planner expects a single combined font binary at FONT_NORMAL_BASE.");
			lines.push("; FONT_SMALL_BASE is derived by FONT_SMALL_OFFSET bytes from FONT_NORMAL_BASE.");
			lines.push(".org FONT_NORMAL_BASE");
			lines.push('; .incbin "__FONT_BIN__.bin"');
			lines.push("");
		}
		lines.push("; .close");
		lines.push("");
	}

	_buildReplayBlockSpec(label, windowInfo) {
		if (!windowInfo || !windowInfo.addr || !windowInfo.halfwords || !windowInfo.halfwords.length) {
			return {
				label: label,
				available: false,
				relocatable: false,
				reasons: ["unavailable"],
				windowInfo: windowInfo || null
			};
		}
		var safety = this._assessThumbReplayWindow(windowInfo.halfwords);
		return {
			label: label,
			available: true,
			relocatable: safety.relocatable,
			reasons: safety.reasons,
			windowInfo: windowInfo
		};
	}

	_assessThumbReplayWindow(halfwords) {
		var reasons = [];
		if (!halfwords || !halfwords.length) {
			return {
				relocatable: false,
				reasons: ["empty-window"]
			};
		}
		for (var i = 0; i < halfwords.length; i++) {
			var reason = this._classifyUnsafeThumbHalfword(halfwords[i] >>> 0);
			if (reason && reasons.indexOf(reason) < 0) {
				reasons.push(reason);
			}
		}
		return {
			relocatable: reasons.length === 0,
			reasons: reasons
		};
	}

	_classifyUnsafeThumbHalfword(halfword) {
		var hw = halfword & 0xffff;
		if ((hw & 0xf000) === 0xd000) {
			return "conditional-branch-or-swi";
		}
		if ((hw & 0xf800) === 0xe000) {
			return "unconditional-branch";
		}
		if ((hw & 0xf000) === 0xf000) {
			return "long-branch";
		}
		if ((hw & 0xf800) === 0x4800) {
			return "pc-relative-ldr";
		}
		if ((hw & 0xf800) === 0xa000) {
			return "pc-relative-add";
		}
		if ((hw & 0xfc00) === 0x4400) {
			return "high-register-or-bx";
		}
		return null;
	}

	_appendReplayBlock(lines, replayBlock) {
		if (!replayBlock || !replayBlock.available) {
			return;
		}
		var windowInfo = replayBlock.windowInfo;
		lines.push("; " + replayBlock.label + " source=" + this._fmtAddr(windowInfo.addr));
		if (!replayBlock.relocatable) {
			lines.push("; " + replayBlock.label + " was not emitted as executable code.");
			lines.push("; Reasons: " + replayBlock.reasons.join(", "));
			lines.push("; Halfwords: " + windowInfo.halfwords.map(function(value) {
				return "0x" + (value >>> 0).toString(16);
			}).join(", "));
			return;
		}
		lines.push(replayBlock.label + ":");
		for (var i = 0; i < windowInfo.halfwords.length; i += 4) {
			var row = windowInfo.halfwords.slice(i, i + 4).map(function(value) {
				return "0x" + (value >>> 0).toString(16);
			});
			lines.push("    .dh " + row.join(", "));
		}
		lines.push("    bx lr");
	}

	_appendDynamicHelperRoutines(lines, helperParams) {
		lines.push("; Helper subroutines");
		if (!helperParams || !helperParams.decompressGlyphTileAddr) {
			lines.push("; DECOMPRESS_GLYPH_TILE is still unresolved, so CallDecompressGlyph4_Dynamic is emitted as a template.");
		}
		if (!helperParams || !helperParams.gCurGlyphAddrCandidate) {
			lines.push("; G_CUR_GLYPH_CANDIDATE is still unresolved, so SetChineseGlyphMetrics_Dynamic can only be called after wiring the global.");
		}
		lines.push("ExtractFontId_Dynamic:");
		lines.push("    ldrb r0, [r0, TEXT_PRINTER_FONT_ID_BYTE_OFFSET]");
		lines.push("    mov r1, #TEXT_PRINTER_FONT_ID_MASK");
		lines.push("    and r0, r1");
		lines.push("    bx lr");
		lines.push("");
		lines.push("ExtractJapaneseFlag_Dynamic:");
		lines.push("    ldrb r0, [r0, TEXT_PRINTER_JAPANESE_BYTE_OFFSET]");
		lines.push("    mov r1, #TEXT_PRINTER_JAPANESE_MASK");
		lines.push("    and r0, r1");
		lines.push("    lsr r0, r0, #TEXT_PRINTER_JAPANESE_SHIFT");
		lines.push("    bx lr");
		lines.push("");
		lines.push("IsFontSmall_Dynamic:");
		lines.push("    cmp r0, #FONT_SMALL");
		lines.push("    beq @@small");
		lines.push("    cmp r0, #FONT_SMALL_NARROW");
		lines.push("    beq @@small");
		lines.push("    cmp r0, #FONT_SMALL_NARROWER");
		lines.push("    beq @@small");
		lines.push("    mov r0, #FALSE");
		lines.push("    bx lr");
		lines.push("@@small:");
		lines.push("    mov r0, #TRUE");
		lines.push("    bx lr");
		lines.push("");
		lines.push("IsChinesePair_Dynamic:");
		lines.push("    cmp r3, #TRUE");
		lines.push("    beq @@notPair");
		lines.push("    cmp r2, #FONT_BRAILLE");
		lines.push("    beq @@notPair");
		lines.push("    cmp r0, #CHINESE_PAIR_HI_MIN");
		lines.push("    blt @@notPair");
		lines.push("    cmp r0, #CHINESE_PAIR_HI_MAX");
		lines.push("    bgt @@notPair");
		lines.push("    cmp r0, #CHINESE_PAIR_HI_EXCLUDED_0");
		lines.push("    beq @@notPair");
		lines.push("    cmp r0, #CHINESE_PAIR_HI_EXCLUDED_1");
		lines.push("    beq @@notPair");
		lines.push("    cmp r1, #CHINESE_PAIR_LO_MAX");
		lines.push("    bhi @@notPair");
		lines.push("    mov r0, #TRUE");
		lines.push("    bx lr");
		lines.push("@@notPair:");
		lines.push("    mov r0, #FALSE");
		lines.push("    bx lr");
		lines.push("");
		lines.push("IsChinesePunctuation_Dynamic:");
		lines.push("    cmp r2, #TRUE");
		lines.push("    beq @@notPunct");
		lines.push("    cmp r1, #FONT_BRAILLE");
		lines.push("    beq @@notPunct");
		lines.push("    cmp r0, #CHINESE_PUNCT_SINGLE_0");
		lines.push("    beq @@isPunct");
		lines.push("    cmp r0, #CHINESE_PUNCT_RANGE_START");
		lines.push("    blt @@notPunct");
		lines.push("    cmp r0, #CHINESE_PUNCT_RANGE_END");
		lines.push("    bgt @@notPunct");
		lines.push("    cmp r0, #CHINESE_PUNCT_EXCLUDED_0");
		lines.push("    beq @@notPunct");
		lines.push("@@isPunct:");
		lines.push("    mov r0, #TRUE");
		lines.push("    bx lr");
		lines.push("@@notPunct:");
		lines.push("    mov r0, #FALSE");
		lines.push("    bx lr");
		lines.push("");
		lines.push("MapChineseGlyphId_Dynamic:");
		lines.push("    cmp r0, #CHINESE_PUNCT_RANGE_END");
		lines.push("    ble @@returnRaw");
		lines.push("    mov r1, r0");
		lines.push("    lsr r2, r1, #8");
		lines.push("    lsl r1, r1, #24");
		lines.push("    lsr r1, r1, #24");
		lines.push("    cmp r2, #CHINESE_PAIR_HI_EXCLUDED_1");
		lines.push("    bls @@skip1C");
		lines.push("    sub r2, #1");
		lines.push("@@skip1C:");
		lines.push("    cmp r2, #CHINESE_PAIR_HI_EXCLUDED_0");
		lines.push("    bls @@skip07");
		lines.push("    sub r2, #1");
		lines.push("@@skip07:");
		lines.push("    sub r2, #1");
		lines.push("    lsl r2, r2, #8");
		lines.push("    add r0, r1, r2");
		lines.push("@@returnRaw:");
		lines.push("    bx lr");
		lines.push("");
		lines.push("GetPunctuationWidthIndex_Dynamic:");
		lines.push("    cmp r0, #0x30");
		lines.push("    beq @@idx0");
		lines.push("    cmp r0, #0x36");
		lines.push("    beq @@idx1");
		lines.push("    cmp r0, #0x37");
		lines.push("    beq @@idx2");
		lines.push("    cmp r0, #0x39");
		lines.push("    beq @@idx3");
		lines.push("    cmp r0, #0x3a");
		lines.push("    beq @@idx4");
		lines.push("    cmp r0, #0x3b");
		lines.push("    beq @@idx5");
		lines.push("    cmp r0, #0x3c");
		lines.push("    beq @@idx6");
		lines.push("    cmp r0, #0x3d");
		lines.push("    beq @@idx7");
		lines.push("    cmp r0, #0x3e");
		lines.push("    beq @@idx8");
		lines.push("    cmp r0, #0x3f");
		lines.push("    beq @@idx9");
		lines.push("    mov r0, #0xff");
		lines.push("    bx lr");
		lines.push("@@idx0:");
		lines.push("    mov r0, #0");
		lines.push("    bx lr");
		lines.push("@@idx1:");
		lines.push("    mov r0, #1");
		lines.push("    bx lr");
		lines.push("@@idx2:");
		lines.push("    mov r0, #2");
		lines.push("    bx lr");
		lines.push("@@idx3:");
		lines.push("    mov r0, #3");
		lines.push("    bx lr");
		lines.push("@@idx4:");
		lines.push("    mov r0, #4");
		lines.push("    bx lr");
		lines.push("@@idx5:");
		lines.push("    mov r0, #5");
		lines.push("    bx lr");
		lines.push("@@idx6:");
		lines.push("    mov r0, #6");
		lines.push("    bx lr");
		lines.push("@@idx7:");
		lines.push("    mov r0, #7");
		lines.push("    bx lr");
		lines.push("@@idx8:");
		lines.push("    mov r0, #8");
		lines.push("    bx lr");
		lines.push("@@idx9:");
		lines.push("    mov r0, #9");
		lines.push("    bx lr");
		lines.push("");
		lines.push("GetChineseWidth_Dynamic:");
		lines.push("    push {r4, r5, lr}");
		lines.push("    mov r4, r0");
		lines.push("    mov r5, r1");
		lines.push("    mov r0, r5");
		lines.push("    bl IsFontSmall_Dynamic");
		lines.push("    mov r2, r0");
		lines.push("    mov r0, r4");
		lines.push("    bl GetPunctuationWidthIndex_Dynamic");
		lines.push("    cmp r0, #0xff");
		lines.push("    beq @@defaultWidth");
		lines.push("    cmp r2, #TRUE");
		lines.push("    beq @@smallWidth");
		lines.push("    ldr r1, =PunctWidthTableNormal");
		lines.push("    ldrb r0, [r1, r0]");
		lines.push("    pop {r4, r5, pc}");
		lines.push("@@smallWidth:");
		lines.push("    ldr r1, =PunctWidthTableSmall");
		lines.push("    ldrb r0, [r1, r0]");
		lines.push("    pop {r4, r5, pc}");
		lines.push("@@defaultWidth:");
		lines.push("    cmp r2, #TRUE");
		lines.push("    beq @@smallDefault");
		lines.push("    mov r0, #CHINESE_NORMAL_WIDTH");
		lines.push("    pop {r4, r5, pc}");
		lines.push("@@smallDefault:");
		lines.push("    mov r0, #CHINESE_SMALL_WIDTH");
		lines.push("    pop {r4, r5, pc}");
		lines.push("");
		lines.push("SetChineseGlyphMetrics_Dynamic:");
		lines.push("    push {r4, lr}");
		lines.push("    mov r4, r0");
		lines.push("    mov r0, r1");
		lines.push("    mov r1, r2");
		lines.push("    bl GetChineseWidth_Dynamic");
		lines.push("    mov r1, r4");
		lines.push("    add r1, #G_CUR_GLYPH_WIDTH_OFFSET");
		lines.push("    strb r0, [r1]");
		lines.push("    mov r0, r2");
		lines.push("    bl IsFontSmall_Dynamic");
		lines.push("    cmp r0, #TRUE");
		lines.push("    beq @@smallHeight");
		lines.push("    mov r0, #CHINESE_NORMAL_HEIGHT");
		lines.push("    b @@storeHeight");
		lines.push("@@smallHeight:");
		lines.push("    mov r0, #CHINESE_SMALL_HEIGHT");
		lines.push("@@storeHeight:");
		lines.push("    mov r1, r4");
		lines.push("    add r1, #G_CUR_GLYPH_HEIGHT_OFFSET");
		lines.push("    strb r0, [r1]");
		lines.push("    pop {r4, pc}");
		lines.push("");
		lines.push("ResolveChineseGlyphAddr_Dynamic:");
		lines.push("    push {r4, lr}");
		lines.push("    mov r4, r0");
		lines.push("    mov r0, r1");
		lines.push("    bl IsFontSmall_Dynamic");
		lines.push("    cmp r0, #TRUE");
		lines.push("    beq @@smallBase");
		lines.push("    ldr r0, =FONT_NORMAL_BASE");
		lines.push("    b @@scale");
		lines.push("@@smallBase:");
		lines.push("    ldr r0, =FONT_SMALL_BASE");
		lines.push("@@scale:");
		lines.push("    lsl r1, r4, #5");
		lines.push("    add r0, r0, r1");
		lines.push("    pop {r4, pc}");
		lines.push("");
		lines.push("CallDecompressGlyph4_Dynamic:");
		lines.push("    push {r4, r5, lr}");
		lines.push("    mov r4, r0");
		lines.push("    mov r5, r1");
		lines.push("    ldr r3, =(DECOMPRESS_GLYPH_TILE + 1)");
		lines.push("    mov r0, r4");
		lines.push("    mov r1, r5");
		lines.push("    bl @@call_r3");
		lines.push("    mov r0, r4");
		lines.push("    add r0, #TEXT_GLYPH_SOURCE_TILE_STRIDE");
		lines.push("    mov r1, r5");
		lines.push("    add r1, #G_CUR_GLYPH_TOP_RIGHT_OFFSET");
		lines.push("    bl @@call_r3");
		lines.push("    mov r0, r4");
		lines.push("    add r0, #TEXT_GLYPH_SOURCE_BOTTOM_OFFSET");
		lines.push("    mov r1, r5");
		lines.push("    add r1, #G_CUR_GLYPH_BOTTOM_OFFSET");
		lines.push("    bl @@call_r3");
		lines.push("    mov r0, r4");
		lines.push("    add r0, #TEXT_GLYPH_SOURCE_BOTTOM_RIGHT_OFFSET");
		lines.push("    mov r1, r5");
		lines.push("    add r1, #G_CUR_GLYPH_BOTTOM_RIGHT_OFFSET");
		lines.push("    bl @@call_r3");
		lines.push("    pop {r4, r5, pc}");
		lines.push("@@call_r3:");
		lines.push("    bx r3");
		lines.push("    .pool");
	}

	_appendPunctuationWidthTables(lines, helperParams) {
		var punctCodes = [0x30, 0x36, 0x37, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f];
		var smallDefaultWidth = helperParams && typeof helperParams.chineseSmallWidth === "number"
			? helperParams.chineseSmallWidth >>> 0
			: 10;
		var normalDefaultWidth = helperParams && typeof helperParams.chineseNormalWidth === "number"
			? helperParams.chineseNormalWidth >>> 0
			: 12;
		var smallTable = this._buildPunctuationWidthRow(
			punctCodes,
			helperParams ? helperParams.smallPunctuationWidths : null,
			smallDefaultWidth
		);
		var normalTable = this._buildPunctuationWidthRow(
			punctCodes,
			helperParams ? helperParams.normalPunctuationWidths : null,
			normalDefaultWidth
		);

		lines.push("; Code order: 0x30, 0x36, 0x37, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F");
		lines.push("PunctWidthTableSmall:");
		lines.push("    .db " + smallTable.join(", "));
		lines.push("PunctWidthTableNormal:");
		lines.push("    .db " + normalTable.join(", "));
	}

	_buildPunctuationWidthRow(codes, widthEntries, defaultWidth) {
		var overrides = new Map();
		if (widthEntries && widthEntries.length) {
			for (var i = 0; i < widthEntries.length; i++) {
				var entry = widthEntries[i];
				if (!entry || typeof entry.code !== "number" || typeof entry.width !== "number") {
					continue;
				}
				overrides.set(entry.code >>> 0, entry.width >>> 0);
			}
		}
		return codes.map(function(code) {
			return overrides.has(code >>> 0) ? overrides.get(code >>> 0) : (defaultWidth >>> 0);
		});
	}

	_appendCommentedHook(lines, hookAddrName, targetLabel) {
		lines.push("; .org " + hookAddrName);
		lines.push(";     ldr r0,=(" + targetLabel + "+1)");
		lines.push(";     mov pc,r0");
		lines.push("; .pool");
	}
}

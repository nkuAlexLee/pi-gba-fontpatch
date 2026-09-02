// Semantic analyzer for expansion-based text loops and two-font helper logic.

class ExpansionTextAnalyzer {
	constructor(gba, options) {
		this.gba = gba;
		this.options = options || {};
		this.thumb = new ThumbAnalyzer(gba);
		this.renderCandidates = this.options.renderCandidates || [];
		this.widthCandidates = this.options.widthCandidates || [];
		this.drawCandidates = this.options.drawCandidates || [];
		this.charLoopCandidates = [];
		this.widthLoopCandidates = [];
		this.widthPrepareCandidates = [];
		this.fontDispatchCandidates = [];
		this.decompressGlyphTileCandidates = [];
		this.glyphDecompressParentCandidates = [];
		this.charLoopAddr = null;
		this.widthLoopAddr = null;
		this.widthPrepareAddr = null;
		this.fontDispatchAddr = null;
		this.decompressGlyphTileAddr = null;
		this.charLoopRegs = null;
		this.widthPrepareInfo = null;
		this.fontModel = {
			supportedFontKinds: ["normal", "small"],
			normalFontIds: [1],
			smallFontIds: [0, 8, 10]
		};
	}

	analyze() {
		var searchStarts = this._collectSearchStarts();
		this._findCharLoops(searchStarts);
		this._findWidthLoops(searchStarts);
		this._findWidthPrepareHooks(searchStarts);
		this._findFontDispatch(searchStarts);
		this._findDecompressGlyphTile(searchStarts);
		return this.getResults();
	}

	_collectSearchStarts() {
		var starts = new Map();
		var addStart = (addr) => {
			addr = addr >>> 0;
			if (addr < 0x08000000 || addr >= 0x0a000000) {
				return;
			}
			starts.set(addr, true);
		};
		var addNearbyPrologues = (center, radius) => {
			center = center >>> 0;
			var start = Math.max(0x08000000, center - radius) >>> 0;
			var end = Math.min(0x0a000000, center + radius) >>> 0;
			for (var addr = start; addr < end; addr += 2) {
				var inst = this.thumb.decode(addr);
				if (inst.type === "push" && inst.includesLR) {
					addStart(addr);
				}
			}
		};

		for (var i = 0; i < this.renderCandidates.length && i < 6; i++) {
			addStart(this.renderCandidates[i].functionStart || 0);
			addNearbyPrologues(this.renderCandidates[i].functionStart || 0, 0x180);
		}
		for (var j = 0; j < this.widthCandidates.length && j < 6; j++) {
			addStart(this.widthCandidates[j].addr || 0);
			addNearbyPrologues(this.widthCandidates[j].addr || 0, 0x100);
		}
		return Array.from(starts.keys()).sort(function(left, right) {
			return left - right;
		});
	}

	_findCharLoops(searchStarts) {
		var candidates = [];
		for (var i = 0; i < searchStarts.length; i++) {
			var candidate = this._scoreCharLoopFunction(searchStarts[i]);
			if (candidate && candidate.score >= 6.0) {
				candidates.push(candidate);
			}
		}
		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.charLoopCandidates = this._dedupeByAddr(candidates, "addr").slice(0, 8);
		if (this.charLoopCandidates.length) {
			this.charLoopAddr = this.charLoopCandidates[0].addr >>> 0;
			this.charLoopRegs = this.charLoopCandidates[0].regs;
		}
	}

	_scoreCharLoopFunction(functionStart) {
		var best = null;
		for (var offset = 0; offset < 0x180; offset += 2) {
			var addr = (functionStart + offset) >>> 0;
			var inst0 = this.thumb.decode(addr);
			var inst1 = this.thumb.decode(addr + 2);
			var inst2 = this.thumb.decode(addr + 4);

			if (offset > 0 && inst0.type === "push" && inst0.includesLR) {
				break;
			}

			if (inst0.type !== "ldr_imm" || inst1.type !== "ldrb_imm") {
				continue;
			}
			if (inst0.rd !== inst1.rb) {
				continue;
			}

			var score = 2.5;
			var charPtrReg = inst1.rb;
			var currCharReg = inst1.rd;
			var textPrinterReg = inst0.rb;
			var nextByteLoad = this._findNextByteLoad(addr + 2, charPtrReg, currCharReg);
			var chineseCmp = this._findChineseCmpProfile(addr + 2, currCharReg);
			var punctuationCmp = this._findPunctuationCmpProfile(addr + 2, currCharReg);
			var pointerAdvance = this._findPointerAdvance(addr + 2, charPtrReg);
			var pointerStore = this._findPointerStore(addr + 2, charPtrReg, textPrinterReg);
			var controlCodeGate = this._findControlCodeGate(
				pointerStore.found ? pointerStore.addr : (addr + 2),
				currCharReg
			);
			var branchCount = this._countConditionalBranches(addr + 2, 0x40);
			var hookAddr = (addr + 2) >>> 0;
			var continueAddr = controlCodeGate.found
				? controlCodeGate.cmpAddr >>> 0
				: (pointerStore.found ? ((pointerStore.addr + 2) >>> 0) : ((hookAddr + 6) >>> 0));
			var replayStartAddr = addr >>> 0;
			var hookHalfwordCount = Math.max(1, ((continueAddr - hookAddr) >>> 1)) >>> 0;
			var replayHalfwordCount = Math.max(1, ((continueAddr - replayStartAddr) >>> 1)) >>> 0;

			if (pointerAdvance) {
				score += 1.5;
			}
			if (pointerStore.found) {
				score += 2.0;
			}
			if (nextByteLoad.found) {
				score += 0.75;
			}
			score += controlCodeGate.score;
			score += chineseCmp.score;
			score += punctuationCmp.score;
			score += Math.min(branchCount * 0.25, 1.5);

			var candidate = {
				addr: hookAddr,
				functionStart: functionStart >>> 0,
				score: score,
				pointerLoadAddr: addr >>> 0,
				pointerAdvance: !!pointerAdvance,
				controlCodeGate: controlCodeGate,
				continueAddr: continueAddr,
				hookHalfwordCount: hookHalfwordCount,
				replayStartAddr: replayStartAddr,
				replayHalfwordCount: replayHalfwordCount,
				nextByteLoad: nextByteLoad,
				chineseCmp: chineseCmp,
				punctuationCmp: punctuationCmp,
				pointerStore: pointerStore,
				branchCount: branchCount,
				regs: {
					textPrinterReg: textPrinterReg,
					charPtrReg: charPtrReg,
					currCharReg: currCharReg,
					textPointerLoadImm: inst0.imm,
					charLoadImm: inst1.imm,
					charPtrLoadedBeforeHook: true,
					nextByteReg: nextByteLoad.reg,
					nextByteImm: nextByteLoad.imm,
					pointerStoreImm: pointerStore.imm
				}
			};

			if (!best || candidate.score > best.score) {
				best = candidate;
			}
		}
		return best;
	}

	_findWidthLoops(searchStarts) {
		var starts = new Map();
		for (var i = 0; i < searchStarts.length; i++) {
			starts.set(searchStarts[i] >>> 0, true);
		}
		if (this.charLoopCandidates.length) {
			for (var j = 0; j < this.charLoopCandidates.length; j++) {
				var fn = this.charLoopCandidates[j].functionStart >>> 0;
				var begin = Math.max(0x08000000, fn - 0x200) >>> 0;
				var end = (fn + 0x0a00) >>> 0;
				for (var addr = begin; addr < end; addr += 2) {
					var inst = this.thumb.decode(addr);
					if (inst.type === "push" && inst.includesLR) {
						starts.set(addr >>> 0, true);
					}
				}
			}
		}

		var candidates = [];
		var allStarts = Array.from(starts.keys()).sort(function(left, right) {
			return left - right;
		});
		for (var k = 0; k < allStarts.length; k++) {
			var candidate = this._scoreWidthLoopFunction(allStarts[k]);
			if (candidate && candidate.score >= 5.5) {
				candidates.push(candidate);
			}
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.widthLoopCandidates = this._dedupeByAddr(candidates, "addr").slice(0, 8);
		if (this.widthLoopCandidates.length) {
			this.widthLoopAddr = this.widthLoopCandidates[0].addr >>> 0;
		}
	}

	_scoreWidthLoopFunction(functionStart) {
		var best = null;

		for (var offset = 0; offset < 0x280; offset += 2) {
			var addr = (functionStart + offset) >>> 0;
			var inst = this.thumb.decode(addr);
			if (offset > 0 && inst.type === "push" && inst.includesLR) {
				break;
			}
			if (inst.type !== "ldrb_imm" || inst.imm !== 1) {
				continue;
			}

			var widthPattern = this._findWidthDoubleBytePattern(addr);
			if (!widthPattern.found) {
				continue;
			}

			var zeroCmp = this._findNearbyZeroCmp(addr, inst.rd);
			var branchCount = this._countConditionalBranches(addr - 2, 0x12);
			var score = 5.0 + widthPattern.score;
			if (zeroCmp.found) {
				score += 1.25;
			}
			score += Math.min(branchCount * 0.2, 1.25);

			var candidate = {
				addr: addr >>> 0,
				functionStart: functionStart >>> 0,
				score: score,
				firstCharLoad: {
					addr: widthPattern.currCharLoadAddr >>> 0,
					baseReg: inst.rb,
					charReg: widthPattern.currCharReg
				},
				nextByteLoad: {
					addr: addr >>> 0,
					baseReg: inst.rb,
					charReg: inst.rd
				},
				zeroCmp: zeroCmp.found,
				zeroCmpInfo: zeroCmp,
				chineseCmp: false,
				punctuationCmp: false,
				pointerAdvance: true,
				addCount: 1,
				branchCount: branchCount >>> 0,
				widthPattern: widthPattern,
				continueAddr: widthPattern.continueAddr >>> 0,
				hookHalfwordCount: widthPattern.hookHalfwordCount >>> 0,
				replayStartAddr: addr >>> 0,
				replayHalfwordCount: widthPattern.hookHalfwordCount >>> 0,
				regs: {
					charPtrReg: inst.rb,
					nextByteReg: inst.rd,
					currCharReg: widthPattern.currCharReg
				}
			};

			if (!best || candidate.score > best.score) {
				best = candidate;
			}
		}

		return best;
	}

	_findWidthPrepareHooks(searchStarts) {
		var starts = new Map();
		for (var i = 0; i < searchStarts.length; i++) {
			starts.set(searchStarts[i] >>> 0, true);
		}
		for (var j = 0; j < this.widthLoopCandidates.length; j++) {
			starts.set(this.widthLoopCandidates[j].functionStart >>> 0, true);
		}

		var candidates = [];
		var uniqueStarts = Array.from(starts.keys()).sort(function(left, right) {
			return left - right;
		});
		for (var k = 0; k < uniqueStarts.length; k++) {
			var candidate = this._scoreWidthPrepareFunction(uniqueStarts[k]);
			if (candidate && candidate.score >= 6.0) {
				candidates.push(candidate);
			}
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.widthPrepareCandidates = this._dedupeByAddr(candidates, "addr").slice(0, 6);
		if (this.widthPrepareCandidates.length) {
			this.widthPrepareAddr = this.widthPrepareCandidates[0].addr >>> 0;
			this.widthPrepareInfo = this.widthPrepareCandidates[0];
		}
	}

	_scoreWidthPrepareFunction(functionStart) {
		var subSp = null;
		var strPtrCopy = null;
		var fontSanitize = null;
		var workingFontCopy = null;
		var movArg0 = null;
		var firstBl = null;
		var highRegSaveCount = 0;
		var score = 0;

		for (var offset = 0; offset < 0x28; offset += 2) {
			var addr = (functionStart + offset) >>> 0;
			var inst = this.thumb.decode(addr);
			if (offset === 0 && inst.type !== "push") {
				return null;
			}
			if (!subSp && inst.type === "mov_hi" && inst.rd <= 7 && inst.rm >= 8) {
				highRegSaveCount++;
				continue;
			}
			if (!subSp && inst.type === "sub_sp_imm" && inst.imm >= 4 && inst.imm <= 0x20) {
				subSp = {
					addr: addr >>> 0,
					imm: inst.imm >>> 0
				};
				score += 2.0;
				continue;
			}
			if (!subSp) {
				continue;
			}
			if (!strPtrCopy && inst.type === "add_imm3" && inst.imm === 0 && inst.rn === 1) {
				strPtrCopy = {
					addr: addr >>> 0,
					rd: inst.rd >>> 0
				};
				score += 1.0;
				continue;
			}
			if (
				!fontSanitize &&
				inst.type === "lsl_imm" &&
				inst.rd === 0 &&
				inst.rm === 0 &&
				inst.imm === 24
			) {
				var nextInst = this.thumb.decode(addr + 2);
				if (nextInst.type === "lsr_imm" && nextInst.rd === 0 && nextInst.rm === 0 && nextInst.imm === 24) {
					fontSanitize = {
						addr: addr >>> 0,
						endAddr: (addr + 2) >>> 0
					};
					score += 1.5;
					continue;
				}
			}
			if (!workingFontCopy && inst.type === "add_imm3" && inst.imm === 0 && inst.rn === 0 && inst.rd !== 0) {
				workingFontCopy = {
					addr: addr >>> 0,
					rd: inst.rd >>> 0
				};
				score += 1.25;
				continue;
			}
			if (
				!movArg0 &&
				inst.type === "add_imm3" &&
				inst.imm === 0 &&
				inst.rd === 0 &&
				workingFontCopy &&
				inst.rn === workingFontCopy.rd
			) {
				movArg0 = {
					addr: addr >>> 0,
					rn: inst.rn >>> 0
				};
				score += 1.25;
				continue;
			}
			if (inst.type === "bl") {
				firstBl = {
					addr: addr >>> 0,
					targetAddr: inst.targetAddr >>> 0
				};
				score += 1.0;
				break;
			}
		}

		if (!subSp || !firstBl) {
			return null;
		}

		score += Math.min(highRegSaveCount * 0.2, 0.6);
		var continueAddr = firstBl.addr >>> 0;
		var hookHalfwordCount = (((continueAddr - subSp.addr) >>> 1) >>> 0);
		if (hookHalfwordCount < 2) {
			return null;
		}

		return {
			addr: subSp.addr >>> 0,
			functionStart: functionStart >>> 0,
			score: score,
			highRegSaveCount: highRegSaveCount >>> 0,
			subSpAddr: subSp.addr >>> 0,
			originalStackAlloc: subSp.imm >>> 0,
			expandedStackAlloc: ((subSp.imm + 4) >>> 0),
			fontIdStackOffset: subSp.imm >>> 0,
			strPtrCopy: strPtrCopy,
			fontSanitize: fontSanitize,
			workingFontCopy: workingFontCopy,
			movArg0: movArg0,
			firstBl: firstBl,
			continueAddr: continueAddr,
			hookHalfwordCount: hookHalfwordCount >>> 0,
			replayStartAddr: subSp.addr >>> 0,
			replayHalfwordCount: hookHalfwordCount >>> 0,
			regs: {
				fontIdEntryReg: 0,
				stringPtrEntryReg: 1,
				workingFontIdReg: workingFontCopy ? (workingFontCopy.rd >>> 0) : 0,
				stringPtrWorkReg: strPtrCopy ? (strPtrCopy.rd >>> 0) : 0
			}
		};
	}

	_findFontDispatch(searchStarts) {
		var candidates = [];
		var starts = searchStarts.slice(0);
		if (this.charLoopCandidates.length) {
			for (var i = 0; i < this.charLoopCandidates.length; i++) {
				starts.push(this.charLoopCandidates[i].functionStart >>> 0);
			}
		}

		var uniqueStarts = Array.from(new Set(starts)).sort(function(left, right) {
			return left - right;
		});
		for (var j = 0; j < uniqueStarts.length; j++) {
			var candidate = this._scoreFontDispatchFunction(uniqueStarts[j]);
			if (candidate && candidate.score >= 3.5) {
				candidates.push(candidate);
			}
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.fontDispatchCandidates = this._dedupeByAddr(candidates, "addr").slice(0, 8);
		if (this.fontDispatchCandidates.length) {
			this.fontDispatchAddr = this.fontDispatchCandidates[0].addr >>> 0;
		}
	}

	_scoreFontDispatchFunction(functionStart) {
		var best = null;
		for (var offset = 0; offset < 0xc0; offset += 2) {
			var addr = functionStart + offset;
			var inst0 = this.thumb.decode(addr);
			var inst1 = this.thumb.decode(addr + 2);
			var inst2 = this.thumb.decode(addr + 4);
			var inst3 = this.thumb.decode(addr + 6);
			var inst4 = this.thumb.decode(addr + 8);
			var inst5 = this.thumb.decode(addr + 10);

			var score = 0;
			var fontIdReg = null;
			var literals = [];
			var cmpValues = [];

			var window = [inst0, inst1, inst2, inst3, inst4, inst5];
			for (var i = 0; i < window.length; i++) {
				if (window[i].type === "cmp_imm8") {
					cmpValues.push(window[i].imm);
					fontIdReg = window[i].rn;
					if (window[i].imm <= 0x0a) {
						score += 0.6;
					}
				}
				if (window[i].type === "b_cond") {
					score += 0.35;
				}
				if (window[i].type === "ldr_pc") {
					literals.push(window[i].literalAddr >>> 0);
				}
			}

			if (literals.length >= 2) {
				score += 1.8;
			}
			if (cmpValues.indexOf(0) >= 0 || cmpValues.indexOf(1) >= 0) {
				score += 0.8;
			}
			if (cmpValues.indexOf(8) >= 0 || cmpValues.indexOf(10) >= 0) {
				score += 0.8;
			}

			if (score <= 0) {
				continue;
			}

			var candidate = {
				addr: addr >>> 0,
				functionStart: functionStart >>> 0,
				score: score,
				fontIdReg: fontIdReg,
				cmpValues: cmpValues,
				literals: literals.slice(0, 6)
			};
			if (!best || candidate.score > best.score) {
				best = candidate;
			}
		}
		return best;
	}

	_findDecompressGlyphTile(searchStarts) {
		var starts = new Map();
		for (var i = 0; i < searchStarts.length; i++) {
			starts.set(searchStarts[i] >>> 0, true);
		}
		for (var j = 0; j < this.renderCandidates.length && j < 6; j++) {
			this._collectNearbyFunctionStarts(starts, this.renderCandidates[j].functionStart || 0, 0x1200);
		}
		if (this.charLoopCandidates.length) {
			for (var c = 0; c < Math.min(4, this.charLoopCandidates.length); c++) {
				this._collectNearbyFunctionStarts(starts, this.charLoopCandidates[c].functionStart || 0, 0x1200);
			}
		}
		if (this.fontDispatchCandidates.length) {
			for (var f = 0; f < Math.min(4, this.fontDispatchCandidates.length); f++) {
				this._collectNearbyFunctionStarts(starts, this.fontDispatchCandidates[f].functionStart || 0, 0x800);
			}
		}

		var aggregate = new Map();
		var parentCandidates = [];
		var uniqueStarts = Array.from(starts.keys()).sort(function(left, right) {
			return left - right;
		});

		for (var s = 0; s < uniqueStarts.length; s++) {
			var parent = this._scoreGlyphDecompressParent(uniqueStarts[s]);
			if (!parent || !parent.repeatedTargets.length) {
				continue;
			}
			parentCandidates.push(parent);
			for (var r = 0; r < parent.repeatedTargets.length; r++) {
				var repeated = parent.repeatedTargets[r];
				var entry = aggregate.get(repeated.targetAddr);
				if (!entry) {
					entry = {
						targetAddr: repeated.targetAddr >>> 0,
						targetInfo: repeated.targetInfo,
						parentFunctions: [],
						totalRepeatCount: 0
					};
					aggregate.set(repeated.targetAddr, entry);
				}
				entry.parentFunctions.push({
					functionStart: parent.functionStart >>> 0,
					score: parent.score,
					repeatCount: repeated.repeatCount >>> 0,
					callSiteCount: parent.callSiteCount >>> 0
				});
				entry.totalRepeatCount += repeated.repeatCount >>> 0;
			}
		}

		var candidates = [];
		for (const entry of aggregate.values()) {
			var targetInfo = entry.targetInfo || this._inspectCalleeTarget(entry.targetAddr);
			var score = 0;
			score += entry.parentFunctions.length * 3.0;
			score += entry.totalRepeatCount * 0.6;
			score += targetInfo.score || 0;
			if (targetInfo.hasPushPrologue) {
				score += 1.0;
			}
			if (targetInfo.innerCallCount === 0) {
				score += 2.0;
			}
			if (targetInfo.sizeBytes >= 0x20 && targetInfo.sizeBytes <= 0x180) {
				score += 1.0;
			}
			if (targetInfo.sizeBytes < 0x10) {
				score -= 2.5;
			}
			if (entry.parentFunctions.length === 1) {
				score -= 1.0;
			}

			candidates.push({
				targetAddr: entry.targetAddr >>> 0,
				score: score,
				totalRepeatCount: entry.totalRepeatCount >>> 0,
				parentFunctionCount: entry.parentFunctions.length >>> 0,
				parentFunctions: entry.parentFunctions.slice(0, 8),
				targetInfo: targetInfo
			});
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		parentCandidates.sort(function(left, right) {
			return right.score - left.score;
		});

		this.glyphDecompressParentCandidates = parentCandidates.slice(0, 8);
		this.decompressGlyphTileCandidates = this._dedupeByAddr(candidates, "targetAddr").slice(0, 8);
		if (this.decompressGlyphTileCandidates.length) {
			this.decompressGlyphTileAddr = this.decompressGlyphTileCandidates[0].targetAddr >>> 0;
		}
	}

	_collectNearbyFunctionStarts(starts, center, radius) {
		center = center >>> 0;
		if (!center) {
			return;
		}
		var begin = Math.max(0x08000000, center - radius) >>> 0;
		var end = Math.min(0x0a000000, center + radius) >>> 0;
		for (var addr = begin; addr < end; addr += 2) {
			var inst = this.thumb.decode(addr);
			if (inst.type === "push" && inst.includesLR) {
				starts.set(addr >>> 0, true);
			}
		}
	}

	_scoreGlyphDecompressParent(functionStart) {
		var summary = this._scanFunctionSummary(functionStart, 0x220);
		if (!summary.hasPushPrologue || summary.callSites.length < 2 || summary.callSites.length > 16) {
			return null;
		}

		var byTarget = new Map();
		for (var i = 0; i < summary.callSites.length; i++) {
			var target = summary.callSites[i].targetAddr >>> 0;
			byTarget.set(target, (byTarget.get(target) || 0) + 1);
		}

		var repeatedTargets = [];
		for (const item of byTarget.entries()) {
			var targetAddr = item[0] >>> 0;
			var repeatCount = item[1] >>> 0;
			if (repeatCount < 2 || repeatCount > 12) {
				continue;
			}
			var targetInfo = this._inspectCalleeTarget(targetAddr);
			if (!targetInfo.hasPushPrologue || targetInfo.innerCallCount !== 0) {
				continue;
			}
			var repeatScore = repeatCount * 1.25 + (targetInfo.score || 0);
			repeatScore += 1.0;
			repeatedTargets.push({
				targetAddr: targetAddr,
				repeatCount: repeatCount,
				score: repeatScore,
				targetInfo: targetInfo
			});
		}

		if (!repeatedTargets.length) {
			return null;
		}

		repeatedTargets.sort(function(left, right) {
			return right.score - left.score;
		});
		var best = repeatedTargets[0];
		var dominantRatio = best.repeatCount / Math.max(summary.callSites.length, 1);
		if (dominantRatio < 0.45) {
			return null;
		}
		return {
			functionStart: functionStart >>> 0,
			score: best.score + dominantRatio * 4.0 + Math.min(summary.callSites.length * 0.15, 1.5),
			callSiteCount: summary.callSites.length >>> 0,
			repeatedTargets: repeatedTargets.slice(0, 4)
		};
	}

	_inspectCalleeTarget(targetAddr) {
		var functionStart = this._findFunctionStartNear(targetAddr);
		var summary = this._scanFunctionSummary(functionStart, 0x180);
		var score = 0;
		if (summary.hasPushPrologue) {
			score += 1.0;
		}
		if (summary.innerCallCount === 0) {
			score += 2.0;
		} else {
			score -= Math.min(summary.innerCallCount, 3) * 0.75;
		}
		if (summary.sizeBytes >= 0x20 && summary.sizeBytes <= 0x180) {
			score += 1.0;
		}
		if (summary.memoryOpCount >= 8) {
			score += 1.5;
		}
		if (summary.literalLoadCount >= 1) {
			score += 0.5;
		}
		if (summary.sizeBytes < 0x10) {
			score -= 2.0;
		}
		return {
			functionStart: functionStart >>> 0,
			score: score,
			hasPushPrologue: summary.hasPushPrologue,
			sizeBytes: summary.sizeBytes >>> 0,
			innerCallCount: summary.innerCallCount >>> 0,
			memoryOpCount: summary.memoryOpCount >>> 0,
			literalLoadCount: summary.literalLoadCount >>> 0
		};
	}

	_findFunctionStartNear(addr) {
		addr = addr >>> 0;
		for (var delta = 0; delta <= 0x40; delta += 2) {
			var candidate = (addr - delta) >>> 0;
			var inst = this.thumb.decode(candidate);
			if (inst.type === "push" && inst.includesLR) {
				return candidate >>> 0;
			}
		}
		return addr >>> 0;
	}

	_scanFunctionSummary(functionStart, maxBytes) {
		var hasPushPrologue = false;
		var callSites = [];
		var memoryOpCount = 0;
		var literalLoadCount = 0;
		var sizeBytes = 0;
		for (var offset = 0; offset < maxBytes; offset += 2) {
			var addr = (functionStart + offset) >>> 0;
			var inst = this.thumb.decode(addr);
			if (offset === 0 && inst.type === "push" && inst.includesLR) {
				hasPushPrologue = true;
			}
			if (offset > 0 && inst.type === "push" && inst.includesLR) {
				break;
			}
			if (
				inst.type === "ldr_imm" ||
				inst.type === "ldrb_imm" ||
				inst.type === "str_imm" ||
				inst.type === "strb_imm"
			) {
				memoryOpCount++;
			}
			if (inst.type === "ldr_pc") {
				literalLoadCount++;
			}
			if (inst.type === "bl") {
				callSites.push({
					addr: addr >>> 0,
					targetAddr: inst.targetAddr >>> 0
				});
			}
			sizeBytes = (offset + 2) >>> 0;
			if (inst.type === "pop" && inst.includesPC) {
				break;
			}
		}
		return {
			hasPushPrologue: hasPushPrologue,
			callSites: callSites,
			innerCallCount: callSites.length >>> 0,
			memoryOpCount: memoryOpCount >>> 0,
			literalLoadCount: literalLoadCount >>> 0,
			sizeBytes: sizeBytes >>> 0
		};
	}

	_findNextByteLoad(startAddr, baseReg, currCharReg) {
		for (var offset = 2; offset <= 0x14; offset += 2) {
			var inst = this.thumb.decode(startAddr + offset);
			if (
				inst.type === "ldrb_imm" &&
				inst.rb === baseReg &&
				inst.rd !== currCharReg &&
				inst.imm <= 1
			) {
				return {
					found: true,
					addr: (startAddr + offset) >>> 0,
					reg: inst.rd,
					imm: inst.imm
				};
			}
		}
		return {
			found: false,
			addr: 0,
			reg: null,
			imm: 0
		};
	}

	_findPointerStore(startAddr, ptrReg, textPrinterReg) {
		for (var offset = 2; offset <= 0x16; offset += 2) {
			var inst = this.thumb.decode(startAddr + offset);
			if (inst.type === "str_imm" && inst.rd === ptrReg && inst.rb === textPrinterReg) {
				return {
					found: true,
					addr: (startAddr + offset) >>> 0,
					imm: inst.imm
				};
			}
		}
		return {
			found: false,
			addr: 0,
			imm: 0
		};
	}

	_findChineseCmpProfile(startAddr, currCharReg) {
		var values = [];
		for (var offset = 0; offset <= 0x20; offset += 2) {
			var inst = this.thumb.decode(startAddr + offset);
			if (inst.type === "cmp_imm8" && inst.rn === currCharReg) {
				if (inst.imm === 0x1e || inst.imm === 0x06 || inst.imm === 0x1b) {
					values.push(inst.imm);
				}
			}
		}
		return {
			score: values.length ? Math.min(values.length * 0.8, 2.4) : 0,
			values: values
		};
	}

	_findPunctuationCmpProfile(startAddr, currCharReg) {
		var values = [];
		for (var offset = 0; offset <= 0x20; offset += 2) {
			var inst = this.thumb.decode(startAddr + offset);
			if (inst.type === "cmp_imm8" && inst.rn === currCharReg) {
				if (inst.imm === 0x30 || inst.imm === 0x36 || inst.imm === 0x38 || inst.imm === 0x3f) {
					values.push(inst.imm);
				}
			}
		}
		return {
			score: values.length ? Math.min(values.length * 0.4, 1.2) : 0,
			values: values
		};
	}

	_countConditionalBranches(startAddr, windowSize) {
		var count = 0;
		for (var offset = 0; offset <= windowSize; offset += 2) {
			var addr = (startAddr + offset) >>> 0;
			if (addr < 0x08000000) {
				continue;
			}
			if (this.thumb.decode(addr).type === "b_cond") {
				count++;
			}
		}
		return count;
	}

	_findPointerAdvance(startAddr, baseReg) {
		for (var offset = 2; offset <= 0x10; offset += 2) {
			var inst = this.thumb.decode(startAddr + offset);
			if (inst.type === "add_imm8" && inst.rd === baseReg && inst.imm >= 1 && inst.imm <= 2) {
				return true;
			}
		}
		return false;
	}

	_findControlCodeGate(startAddr, currCharReg) {
		for (var offset = 0; offset <= 0x10; offset += 2) {
			var subAddr = (startAddr + offset) >>> 0;
			var subInst = this.thumb.decode(subAddr);
			var cmpInst = this.thumb.decode(subAddr + 2);
			var branchInst = this.thumb.decode(subAddr + 4);
			if (subInst.type !== "sub_imm8" || subInst.imm < 0xf0) {
				continue;
			}
			if (cmpInst.type !== "cmp_imm8" || cmpInst.rn !== subInst.rd || cmpInst.imm > 0x10) {
				continue;
			}
			if (branchInst.type !== "b_cond") {
				continue;
			}
			var score = 2.0;
			if (cmpInst.imm === 0x07 || cmpInst.imm === 0x08) {
				score += 0.75;
			}
			if (subInst.rd === currCharReg) {
				score += 0.5;
			}
			return {
				found: true,
				subAddr: subAddr >>> 0,
				cmpAddr: (subAddr + 2) >>> 0,
				branchAddr: (subAddr + 4) >>> 0,
				continueAddr: (subAddr + 6) >>> 0,
				charTestReg: subInst.rd,
				subImm: subInst.imm >>> 0,
				cmpImm: cmpInst.imm >>> 0,
				score: score
			};
		}
		return {
			found: false,
			subAddr: 0,
			cmpAddr: 0,
			branchAddr: 0,
			continueAddr: 0,
			charTestReg: null,
			subImm: 0,
			cmpImm: 0,
			score: 0
		};
	}

	_findWidthDoubleBytePattern(startAddr) {
		var firstLoad = this.thumb.decode(startAddr);
		var firstCmp = this.thumb.decode(startAddr + 2);
		if (firstLoad.type !== "ldrb_imm" || firstLoad.imm !== 1) {
			return {
				found: false,
				score: 0
			};
		}
		if (firstCmp.type !== "cmp_imm8" || firstCmp.rn !== firstLoad.rd || firstCmp.imm !== 0xff) {
			return {
				found: false,
				score: 0
			};
		}

		var addAddr = 0;
		var currCharLoadAddr = 0;
		var currCharCmpAddr = 0;
		var exitBranchAddr = 0;

		for (var offset = 4; offset <= 0x12; offset += 2) {
			var addr = (startAddr + offset) >>> 0;
			var inst = this.thumb.decode(addr);
			if (!addAddr && inst.type === "add_imm8" && inst.rd === firstLoad.rb && inst.imm === 1) {
				addAddr = addr >>> 0;
				continue;
			}
			if (addAddr && !currCharLoadAddr && inst.type === "ldrb_imm" && inst.rb === firstLoad.rb && inst.imm === 0) {
				currCharLoadAddr = addr >>> 0;
				continue;
			}
			if (currCharLoadAddr && !currCharCmpAddr && inst.type === "cmp_imm8" && inst.imm === 0xff) {
				var currLoad = this.thumb.decode(currCharLoadAddr);
				if (inst.rn === currLoad.rd) {
					currCharCmpAddr = addr >>> 0;
					continue;
				}
			}
			if (currCharCmpAddr && !exitBranchAddr && inst.type === "b_cond") {
				exitBranchAddr = addr >>> 0;
				break;
			}
		}

		if (!addAddr || !currCharLoadAddr || !currCharCmpAddr || !exitBranchAddr) {
			return {
				found: false,
				score: 0
			};
		}

		return {
			found: true,
			score: 3.5,
			nextByteLoadAddr: startAddr >>> 0,
			nextByteReg: firstLoad.rd,
			charPtrReg: firstLoad.rb,
			addAddr: addAddr >>> 0,
			currCharLoadAddr: currCharLoadAddr >>> 0,
			currCharReg: this.thumb.decode(currCharLoadAddr).rd,
			currCharCmpAddr: currCharCmpAddr >>> 0,
			exitBranchAddr: exitBranchAddr >>> 0,
			continueAddr: (exitBranchAddr + 2) >>> 0,
			hookHalfwordCount: (((exitBranchAddr + 2) - startAddr) >>> 1) >>> 0
		};
	}

	_findNearbyZeroCmp(startAddr, reg) {
		for (var offset = -4; offset <= 0; offset += 2) {
			var addr = (startAddr + offset) >>> 0;
			if (addr < 0x08000000) {
				continue;
			}
			var inst = this.thumb.decode(addr);
			if (inst.type === "cmp_imm8" && inst.imm === 0 && (typeof reg !== "number" || inst.rn === reg)) {
				return {
					found: true,
					addr: addr >>> 0,
					reg: inst.rn
				};
			}
		}
		return {
			found: false,
			addr: 0,
			reg: null
		};
	}

	_dedupeByAddr(candidates, key) {
		var seen = new Map();
		for (var i = 0; i < candidates.length; i++) {
			var candidate = candidates[i];
			var value = candidate[key] >>> 0;
			var current = seen.get(value);
			if (!current || candidate.score > current.score) {
				seen.set(value, candidate);
			}
		}
		return Array.from(seen.values());
	}

	getResults() {
		return {
			charLoopAddr: this.charLoopAddr,
			charLoopRegs: this.charLoopRegs,
			charLoopCandidates: this.charLoopCandidates,
			widthLoopAddr: this.widthLoopAddr,
			widthLoopCandidates: this.widthLoopCandidates,
			widthPrepareAddr: this.widthPrepareAddr,
			widthPrepareInfo: this.widthPrepareInfo,
			widthPrepareCandidates: this.widthPrepareCandidates,
			fontDispatchAddr: this.fontDispatchAddr,
			fontDispatchCandidates: this.fontDispatchCandidates,
			decompressGlyphTileAddr: this.decompressGlyphTileAddr,
			decompressGlyphTileCandidates: this.decompressGlyphTileCandidates,
			glyphDecompressParentCandidates: this.glyphDecompressParentCandidates,
			fontModel: this.fontModel
		};
	}
}

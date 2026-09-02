// Runtime function discovery from VRAM write behavior and local THUMB semantics.

class FunctionFinder {
	constructor(traces, gba) {
		this.traces = traces || [];
		this.gba = gba;
		this.thumb = new ThumbAnalyzer(gba);
		this.pcClusters = new Map();
		this.drawGlyphTilesCandidates = [];
		this.drawGlyphTilesAddr = null;
		this.renderTextCandidates = [];
		this.renderTextAddr = null;
		this.charDispatchCandidates = [];
		this.charDispatchAddr = null;
		this.charDispatchRegs = null;
		this.getStringWidthCandidates = [];
		this.getStringWidthAddr = null;
	}

	find() {
		this._clusterByPC();
		this._identifyDrawGlyphTiles();
		this._identifyRenderText();
		this._identifyCharDispatch();
		this._identifyGetStringWidth();
		return this.getResults();
	}

	_clusterByPC() {
		for (var i = 0; i < this.traces.length; i++) {
			var trace = this.traces[i];
			var cluster = this.pcClusters.get(trace.pc);
			if (!cluster) {
				cluster = {
					pc: trace.pc >>> 0,
					count: 0,
					addresses: [],
					sizes: [],
					frames: [],
					lrCounts: new Map()
				};
				this.pcClusters.set(trace.pc, cluster);
			}
			cluster.count++;
			cluster.addresses.push((trace.addr || trace.vramAddr || 0) & 0x00ffffff);
			cluster.sizes.push(trace.size >>> 0);
			cluster.frames.push(typeof trace.frame === "number" ? trace.frame : 0);
			cluster.lrCounts.set(trace.lr >>> 0, (cluster.lrCounts.get(trace.lr >>> 0) || 0) + 1);
		}
	}

	_identifyDrawGlyphTiles() {
		var candidates = [];
		for (const cluster of this.pcClusters.values()) {
			if (cluster.count < 32) {
				continue;
			}

			var sequentialRatio = this._computeSequentialRatio(cluster.addresses);
			var halfwordOrWordRatio = this._computeHalfwordOrWordRatio(cluster.sizes);
			var uniqueLRCount = cluster.lrCounts.size;
			var lrFocus = 1 - Math.min(uniqueLRCount / Math.max(cluster.count, 1), 1);
			var density = Math.min(cluster.count / 1024, 1);
			var frameBurstScore = this._computeFrameBurstScore(cluster.frames);
			var genericPenalty = this._computeGenericCopyPenalty(cluster.count, uniqueLRCount);
			var score =
				sequentialRatio * 0.35 +
				halfwordOrWordRatio * 0.2 +
				lrFocus * 0.2 +
				density * 0.15 +
				frameBurstScore * 0.1 -
				genericPenalty;

			candidates.push({
				pc: cluster.pc,
				score: score,
				count: cluster.count,
				sequentialRatio: sequentialRatio,
				halfwordOrWordRatio: halfwordOrWordRatio,
				uniqueLRCount: uniqueLRCount,
				frameBurstScore: frameBurstScore,
				genericPenalty: genericPenalty,
				topLRs: this._mapToSortedEntries(cluster.lrCounts, 8)
			});
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.drawGlyphTilesCandidates = candidates.slice(0, 8);
		this.drawGlyphTilesAddr = this.drawGlyphTilesCandidates.length
			? this.drawGlyphTilesCandidates[0].pc
			: null;
	}

	_identifyRenderText() {
		if (!this.drawGlyphTilesCandidates.length) {
			return;
		}
		var candidates = [];
		for (var d = 0; d < this.drawGlyphTilesCandidates.length; d++) {
			var draw = this.drawGlyphTilesCandidates[d];
			var cluster = this.pcClusters.get(draw.pc);
			if (!cluster) {
				continue;
			}
			var sortedLRs = this._mapToSortedEntries(cluster.lrCounts, 16);
			for (var i = 0; i < sortedLRs.length; i++) {
				var lr = sortedLRs[i][0];
				var count = sortedLRs[i][1];
				var callSite = this._decodeCallSiteFromLR(lr);
				if (!callSite) {
					continue;
				}

				var functionStart = this._findFunctionStart(callSite.callSiteAddr, callSite.mode);
				var semantics = this._scoreRenderTextSemantics(functionStart);
				candidates.push({
					drawPc: draw.pc >>> 0,
					returnAddr: lr >>> 0,
					callCount: count,
					callSiteAddr: callSite.callSiteAddr >>> 0,
					mode: callSite.mode,
					functionStart: functionStart >>> 0,
					score: count * 0.4 + semantics.score + Math.max(draw.score, 0) * 0.2,
					semantics: semantics
				});
			}
		}

		candidates = this._dedupeRenderCandidates(candidates);
		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.renderTextCandidates = candidates.slice(0, 8);
		this.renderTextAddr = this.renderTextCandidates.length
			? this.renderTextCandidates[0].functionStart
			: null;
	}

	_identifyCharDispatch() {
		if (!this.renderTextAddr) {
			return;
		}

		var candidates = [];
		for (var offset = 0; offset < 0x200; offset += 2) {
			var baseAddr = this.renderTextAddr + offset;
			var inst0 = this.thumb.decode(baseAddr);
			var inst1 = this.thumb.decode(baseAddr + 2);
			var inst2 = this.thumb.decode(baseAddr + 4);
			var inst3 = this.thumb.decode(baseAddr + 6);

			if (inst1.type !== "ldrb_imm") {
				continue;
			}

			var candidate = {
				hookAddr: (baseAddr + 2) >>> 0,
				score: 0.5,
				textPrinterReg: null,
				charPtrReg: inst1.rb,
				currCharReg: inst1.rd,
				charLoadBaseReg: inst1.rb,
				charLoadImm: inst1.imm,
				hookMode: "memory-preload"
			};

			if (inst0.type === "ldr_imm" && inst0.rd === inst1.rb) {
				candidate.textPrinterReg = inst0.rb;
				candidate.score += 2.0;
				if (inst2.type === "add_imm8" && inst2.rd === inst1.rb && inst2.imm >= 1 && inst2.imm <= 4) {
					candidate.score += 1.5;
				}
				if (inst3.type === "str_imm" && inst3.rd === inst1.rb && inst3.rb === inst0.rb) {
					candidate.score += 2.0;
				}
			}

			candidate.score += this._scoreCharDispatchNeighborhood(baseAddr + 2, candidate.charPtrReg, candidate.currCharReg);
			candidates.push(candidate);
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.charDispatchCandidates = candidates.slice(0, 8);
		if (this.charDispatchCandidates.length) {
			var best = this.charDispatchCandidates[0];
			this.charDispatchAddr = best.hookAddr;
			this.charDispatchRegs = {
				textPrinterReg: best.textPrinterReg,
				charPtrReg: best.charPtrReg,
				currCharReg: best.currCharReg,
				charLoadBaseReg: best.charLoadBaseReg,
				charLoadImm: best.charLoadImm,
				hookMode: best.hookMode,
				score: best.score
			};
		}
	}

	_identifyGetStringWidth() {
		if (!this.renderTextAddr) {
			return;
		}

		var start = Math.max(0x08000000, this.renderTextAddr - 0x3000);
		var end = Math.min(0x0a000000, this.renderTextAddr + 0x3000);
		var candidates = [];

		for (var addr = start; addr < end; addr += 2) {
			var first = this.thumb.decode(addr);
			if (first.type !== "unknown" && (first.raw & 0xff00) !== 0xb500) {
				continue;
			}
			if ((first.raw & 0xff00) !== 0xb500) {
				continue;
			}

			var semantics = this._scoreWidthFunction(addr);
			if (semantics.score >= 2.0) {
				candidates.push({
					addr: addr >>> 0,
					score: semantics.score,
					semantics: semantics
				});
			}
		}

		candidates.sort(function(left, right) {
			return right.score - left.score;
		});
		this.getStringWidthCandidates = candidates.slice(0, 8);
		this.getStringWidthAddr = this.getStringWidthCandidates.length
			? this.getStringWidthCandidates[0].addr
			: null;
	}

	_scoreRenderTextSemantics(functionStart) {
		var score = 0;
		var foundPointerLoad = false;
		var foundCharLoad = false;
		var foundPointerStore = false;
		var foundConditionalBranch = false;

		for (var offset = 0; offset < 0x60; offset += 2) {
			var addr = functionStart + offset;
			var inst0 = this.thumb.decode(addr);
			var inst1 = this.thumb.decode(addr + 2);
			var inst2 = this.thumb.decode(addr + 4);
			var inst3 = this.thumb.decode(addr + 6);

			if (inst0.type === "ldr_imm" && inst1.type === "ldrb_imm" && inst0.rd === inst1.rb) {
				foundPointerLoad = true;
				foundCharLoad = true;
				score += 2.5;
				if (inst2.type === "add_imm8" && inst2.rd === inst1.rb) {
					score += 1.0;
				}
				if (inst3.type === "str_imm" && inst3.rd === inst1.rb && inst3.rb === inst0.rb) {
					foundPointerStore = true;
					score += 1.5;
				}
			}
			if (inst0.type === "b_cond" || inst1.type === "b_cond" || inst2.type === "b_cond" || inst3.type === "b_cond") {
				foundConditionalBranch = true;
				score += 0.25;
			}
		}

		return {
			score: score,
			foundPointerLoad: foundPointerLoad,
			foundCharLoad: foundCharLoad,
			foundPointerStore: foundPointerStore,
			foundConditionalBranch: foundConditionalBranch
		};
	}

	_scoreCharDispatchNeighborhood(addr, baseReg, currCharReg) {
		var score = 0;
		for (var offset = 2; offset <= 0x18; offset += 2) {
			var inst = this.thumb.decode(addr + offset);
			if (inst.type === "add_imm8" && inst.rd === baseReg && inst.imm >= 1 && inst.imm <= 4) {
				score += 1.25;
			}
			if (inst.type === "cmp_imm8" && inst.rn === currCharReg) {
				score += 1.0;
				if (inst.imm === 0x00) {
					score += 0.5;
				}
			}
			if (inst.type === "b_cond") {
				score += 0.35;
			}
			if (inst.type === "str_imm" && inst.rd === baseReg) {
				score += 0.75;
			}
		}
		return score;
	}

	_scoreWidthFunction(addr) {
		var score = 0;
		var hasLdrb = false;
		var hasZeroCmp = false;
		var hasAdd = false;

		for (var offset = 2; offset < 0x180; offset += 2) {
			var inst = this.thumb.decode(addr + offset);
			if (offset > 4 && (inst.raw & 0xff00) === 0xb500) {
				break;
			}
			if ((inst.raw & 0xff00) === 0xbd00) {
				break;
			}

			if (inst.type === "ldrb_imm") {
				hasLdrb = true;
				score += 0.4;
			}
			if (inst.type === "cmp_imm8" && inst.imm === 0) {
				hasZeroCmp = true;
				score += 0.75;
			}
			if (inst.type === "add_imm8" || inst.type === "add_reg") {
				hasAdd = true;
				score += 0.25;
			}
		}

		score -= Math.min(Math.abs(addr - this.renderTextAddr) / 0x800, 2);
		return {
			score: score,
			hasLdrb: hasLdrb,
			hasZeroCmp: hasZeroCmp,
			hasAdd: hasAdd
		};
	}

	_computeSequentialRatio(addresses) {
		if (addresses.length < 2) {
			return 0;
		}
		var sorted = addresses.slice().sort(function(left, right) {
			return left - right;
		});
		var sequentialPairs = 0;
		for (var i = 1; i < sorted.length; i++) {
			var delta = sorted[i] - sorted[i - 1];
			if (delta >= 0 && delta <= 0x40) {
				sequentialPairs++;
			}
		}
		return sequentialPairs / (sorted.length - 1);
	}

	_computeHalfwordOrWordRatio(sizes) {
		if (!sizes.length) {
			return 0;
		}
		var count = 0;
		for (var i = 0; i < sizes.length; i++) {
			if (sizes[i] === 2 || sizes[i] === 4) {
				count++;
			}
		}
		return count / sizes.length;
	}

	_computeFrameBurstScore(frames) {
		if (!frames.length) {
			return 0;
		}
		var counts = new Map();
		for (var i = 0; i < frames.length; i++) {
			counts.set(frames[i], (counts.get(frames[i]) || 0) + 1);
		}
		var peak = 0;
		for (const value of counts.values()) {
			if (value > peak) {
				peak = value;
			}
		}
		return Math.min(peak / 64, 1);
	}

	_computeGenericCopyPenalty(count, uniqueLRCount) {
		if (count < 8000) {
			return 0;
		}
		if (uniqueLRCount <= 3) {
			return 0.2;
		}
		if (uniqueLRCount <= 6) {
			return 0.1;
		}
		return 0;
	}

	_decodeCallSiteFromLR(lr) {
		try {
			var thumbLR = lr & 0xfffffffe;
			var thumbHi = this.gba.mmu.loadU16((thumbLR - 4) >>> 0);
			var thumbLo = this.gba.mmu.loadU16((thumbLR - 2) >>> 0);
			if ((thumbHi & 0xf800) === 0xf000 && (thumbLo & 0xf800) === 0xf800) {
				return {
					mode: "thumb",
					callSiteAddr: (thumbLR - 4) >>> 0
				};
			}

			var armInst = this.gba.mmu.load32((lr - 4) >>> 0) >>> 0;
			if ((armInst & 0x0f000000) === 0x0b000000) {
				return {
					mode: "arm",
					callSiteAddr: (lr - 4) >>> 0
				};
			}
		} catch (error) {
			return null;
		}

		return null;
	}

	_dedupeRenderCandidates(candidates) {
		var byStart = new Map();
		for (var i = 0; i < candidates.length; i++) {
			var candidate = candidates[i];
			var current = byStart.get(candidate.functionStart);
			if (!current || candidate.score > current.score) {
				byStart.set(candidate.functionStart, candidate);
			}
		}
		return Array.from(byStart.values());
	}

	_findFunctionStart(addr, mode) {
		var step = mode === "arm" ? 4 : 2;
		var limit = mode === "arm" ? 0x200 : 0x400;
		for (var delta = 0; delta <= limit; delta += step) {
			var candidate = (addr - delta) >>> 0;
			try {
				if (mode === "thumb") {
					var hw = this.gba.mmu.loadU16(candidate);
					if ((hw & 0xff00) === 0xb500) {
						return candidate;
					}
				} else {
					var w = this.gba.mmu.load32(candidate) >>> 0;
					if ((w & 0xffff0000) === 0xe92d0000) {
						return candidate;
					}
				}
			} catch (error) {
				break;
			}
		}
		return addr >>> 0;
	}

	_mapToSortedEntries(map, limit) {
		return Array.from(map.entries())
			.sort(function(left, right) {
				return right[1] - left[1];
			})
			.slice(0, limit);
	}

	getResults() {
		return {
			drawGlyphTilesAddr: this.drawGlyphTilesAddr,
			drawGlyphTilesCandidates: this.drawGlyphTilesCandidates,
			renderTextAddr: this.renderTextAddr,
			renderTextCandidates: this.renderTextCandidates,
			charDispatchAddr: this.charDispatchAddr,
			charDispatchRegs: this.charDispatchRegs,
			charDispatchCandidates: this.charDispatchCandidates,
			getStringWidthAddr: this.getStringWidthAddr,
			getStringWidthCandidates: this.getStringWidthCandidates,
			totalClusters: this.pcClusters.size
		};
	}
}

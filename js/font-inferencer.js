// Runtime ROM-read analysis to infer font location, layout and likely encoding path.

class FontInferencer {
	constructor(gba, options) {
		this.VALID_GLYPH_GAPS = {
			0x80: true,
			0x40: true,
			0x10: true,
			0x0b: true
		};
		this.gba = gba;
		this.options = options || {};
		this.drawGlyphTilesPC = this.options.drawGlyphTilesPC || 0;
		this.renderTextPC = this.options.renderTextPC || 0;
		this.charDispatchAddr = this.options.charDispatchAddr || 0;
		this.glyphDecodePC = this.options.glyphDecodePC || 0;
		this.windowRadius = this.options.windowRadius || 0x100;
		this.captureInstructionBudget = this.options.captureInstructionBudget || 256;
		this.maxSteps = this.options.maxSteps || 60000;
		this.romTracer = new ROMReadTracer(gba);
		this.romReads = [];
		this.fontBaseAddress = null;
		this.glyphSizeBytes = null;
		this.fontFormat = null;
		this.encodingScheme = null;
		this.fontBlocks = [];
	}

	infer() {
		this._captureReadsAroundGlyphPath();
		this._analyzeBlocks();
		this._classifyEncoding();
		return this.getResults();
	}

	_captureReadsAroundGlyphPath() {
		var cpu = this.gba.cpu;
		var originalStep = cpu.step.bind(cpu);
		var armed = false;
		var remainingWindow = 0;
		var captureInstructionBudget = this.captureInstructionBudget >>> 0;
		var targetPC = this._chooseTargetPC();
		if (!targetPC) {
			return;
		}
		var tracerStart = Math.max(0x08000000, targetPC - this.windowRadius) >>> 0;
		var tracerEnd = (targetPC + this.windowRadius) >>> 0;

		this.romTracer.clear();
		this.romTracer.start(tracerStart, tracerEnd, {
			capturePredicate: function() {
				return armed;
			}
		});

		cpu.step = function() {
			var pc = cpu.gprs[cpu.PC] >>> 0;
			if (
				pc === targetPC ||
				pc === ((targetPC + 2) >>> 0) ||
				pc === ((targetPC + 4) >>> 0)
			) {
				armed = true;
				remainingWindow = captureInstructionBudget;
			}

			var result = originalStep();

			if (armed) {
				remainingWindow--;
				if (remainingWindow <= 0) {
					armed = false;
				}
			}
			return result;
		};

		try {
			for (var i = 0; i < this.maxSteps && this.romTracer.getReads().length < 512; i++) {
				cpu.step();
			}
		} finally {
			cpu.step = originalStep;
			this.romTracer.stop();
		}

		this.romReads = this.romTracer.getReads();
	}

	_chooseTargetPC() {
		if (this.glyphDecodePC) {
			return this.glyphDecodePC >>> 0;
		}
		if (this.drawGlyphTilesPC) {
			return this.drawGlyphTilesPC >>> 0;
		}
		if (this.renderTextPC) {
			return this.renderTextPC >>> 0;
		}
		if (this.charDispatchAddr) {
			return this.charDispatchAddr >>> 0;
		}
		return 0;
	}

	_analyzeBlocks() {
		if (!this.romReads.length) {
			return;
		}

		var sorted = this.romReads
			.map(function(read) { return read.addr >>> 0; })
			.sort(function(left, right) { return left - right; });

		var blocks = [];
		var block = {
			start: sorted[0],
			end: sorted[0],
			count: 1,
			reads: [sorted[0]]
		};

		for (var i = 1; i < sorted.length; i++) {
			var current = sorted[i];
			if (current - block.end <= 0x100) {
				block.end = current;
				block.count++;
				block.reads.push(current);
			} else {
				blocks.push(this._summarizeBlock(block));
				block = {
					start: current,
					end: current,
					count: 1,
					reads: [current]
				};
			}
		}
		blocks.push(this._summarizeBlock(block));
		blocks.sort(function(left, right) {
			return right.count - left.count;
		});
		this.fontBlocks = blocks.slice(0, 8);

		var best = this.fontBlocks[0];
		if (!best) {
			return;
		}

		if (!best.dominantGap || !this.VALID_GLYPH_GAPS[best.dominantGap]) {
			this.fontBaseAddress = null;
			this.glyphSizeBytes = null;
			this.fontFormat = null;
			return;
		}

		this.fontBaseAddress = best.start >>> 0;
		this.glyphSizeBytes = best.dominantGap || null;
		this.fontFormat = this._classifyFormatFromGap(best.dominantGap);
	}

	_summarizeBlock(block) {
		var uniqueSorted = Array.from(new Set(block.reads)).sort(function(left, right) {
			return left - right;
		});
		var gapCounts = new Map();
		for (var i = 1; i < uniqueSorted.length; i++) {
			var gap = uniqueSorted[i] - uniqueSorted[i - 1];
			if (gap > 0 && gap <= 0x200) {
				gapCounts.set(gap, (gapCounts.get(gap) || 0) + 1);
			}
		}
		var dominantGapEntry = Array.from(gapCounts.entries()).sort(function(left, right) {
			return right[1] - left[1];
		})[0];

		return {
			start: block.start >>> 0,
			end: block.end >>> 0,
			count: block.count,
			uniqueReads: uniqueSorted.length,
			dominantGap: dominantGapEntry ? dominantGapEntry[0] : null,
			dominantGapCount: dominantGapEntry ? dominantGapEntry[1] : 0
		};
	}

	_classifyFormatFromGap(gap) {
		if (gap === 0x80 || gap === 0x40) {
			return "4bpp-pre-rendered";
		}
		if (gap === 0x10) {
			return "1bpp-normal";
		}
		if (gap === 0x0b) {
			return "1bpp-small";
		}
		if (gap) {
			return "unknown";
		}
		return null;
	}

	_classifyEncoding() {
		if (!this.romReads.length) {
			return;
		}

		var byteReads = 0;
		var halfwordReads = 0;
		var wordReads = 0;

		for (var i = 0; i < this.romReads.length; i++) {
			var size = this.romReads[i].size;
			if (size === 1) {
				byteReads++;
			} else if (size === 2) {
				halfwordReads++;
			} else if (size === 4) {
				wordReads++;
			}
		}

		if (wordReads >= halfwordReads && wordReads >= byteReads) {
			this.encodingScheme = "word-heavy";
		} else if (halfwordReads >= byteReads) {
			this.encodingScheme = "halfword-heavy";
		} else {
			this.encodingScheme = "byte-heavy";
		}
	}

	getResults() {
		return {
			fontBaseAddress: this.fontBaseAddress,
			glyphSizeBytes: this.glyphSizeBytes,
			fontFormat: this.fontFormat,
			encodingScheme: this.encodingScheme,
			romReadCount: this.romReads.length,
			fontBlocks: this.fontBlocks,
			tracer: this.romTracer.getStats()
		};
	}
}

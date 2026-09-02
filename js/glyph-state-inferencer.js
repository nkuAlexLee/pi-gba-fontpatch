// Infer likely glyph-state buffers such as gCurGlyph from WRAM writes
// observed near the active draw/render helper path.

class GlyphStateInferencer {
	constructor(gba, options) {
		this.gba = gba;
		this.options = options || {};
		this.drawGlyphTilesPC = this.options.drawGlyphTilesPC || 0;
		this.renderTextPC = this.options.renderTextPC || 0;
		this.charLoopAddr = this.options.charLoopAddr || 0;
		this.windowRadius = this.options.windowRadius || 0x200;
		this.wramTracer = new WRAMWriteTracer(gba);
		this.writes = [];
		this.blocks = [];
		this.glyphStateBaseAddress = 0;
		this.glyphStateRegion = "";
	}

	infer() {
		this._captureWrites();
		this._analyzeBlocks();
		return this.getResults();
	}

	_captureWrites() {
		var cpu = this.gba.cpu;
		var originalStep = cpu.step.bind(cpu);
		var targetPC = this._chooseTargetPC();
		if (!targetPC) {
			return;
		}
		var start = Math.max(0x08000000, (targetPC - this.windowRadius) >>> 0) >>> 0;
		var end = (targetPC + this.windowRadius) >>> 0;

		this.wramTracer.clear();
		this.wramTracer.start(start, end);

		try {
			for (var i = 0; i < 80000 && this.wramTracer.getWrites().length < 4096; i++) {
				cpu.step();
			}
		} finally {
			cpu.step = originalStep;
			this.wramTracer.stop();
		}

		this.writes = this.wramTracer.getWrites();
	}

	_chooseTargetPC() {
		if (this.drawGlyphTilesPC) {
			return this.drawGlyphTilesPC >>> 0;
		}
		if (this.renderTextPC) {
			return this.renderTextPC >>> 0;
		}
		if (this.charLoopAddr) {
			return this.charLoopAddr >>> 0;
		}
		return 0;
	}

	_analyzeBlocks() {
		if (!this.writes.length) {
			return;
		}

		var groups = new Map();
		for (var i = 0; i < this.writes.length; i++) {
			var write = this.writes[i];
			var key = (write.region >>> 0) + ":" + (((write.addr >>> 0) & ~0x0f) >>> 0);
			var group = groups.get(key);
			if (!group) {
				group = {
					region: write.region >>> 0,
					start: ((write.addr >>> 0) & ~0x0f) >>> 0,
					end: (((write.addr >>> 0) & ~0x0f) + 0x10) >>> 0,
					count: 0,
					sizeScore: 0,
					addrs: []
				};
				groups.set(key, group);
			}
			group.count++;
			group.addrs.push(write.addr >>> 0);
			if ((write.addr >>> 0) + (write.size >>> 0) > group.end) {
				group.end = ((write.addr >>> 0) + (write.size >>> 0)) >>> 0;
			}
		}

		var merged = this._mergeGroups(Array.from(groups.values()));
		merged.sort(function(left, right) {
			if (right.score !== left.score) {
				return right.score - left.score;
			}
			return right.count - left.count;
		});
		this.blocks = merged.slice(0, 8);
		if (this.blocks.length) {
			this.glyphStateBaseAddress = this.blocks[0].start >>> 0;
			this.glyphStateRegion = this.blocks[0].regionName;
		}
	}

	_mergeGroups(groups) {
		groups.sort(function(left, right) {
			if (left.region !== right.region) {
				return left.region - right.region;
			}
			return left.start - right.start;
		});

		var merged = [];
		for (var i = 0; i < groups.length; i++) {
			var current = groups[i];
			var last = merged.length ? merged[merged.length - 1] : null;
			if (
				last &&
				last.region === current.region &&
				current.start <= (last.end + 0x20)
			) {
				last.end = Math.max(last.end, current.end) >>> 0;
				last.count += current.count;
				last.addrs = last.addrs.concat(current.addrs);
			} else {
				merged.push({
					region: current.region >>> 0,
					start: current.start >>> 0,
					end: current.end >>> 0,
					count: current.count >>> 0,
					addrs: current.addrs.slice(0)
				});
			}
		}

		for (var j = 0; j < merged.length; j++) {
			var block = merged[j];
			block.uniqueWrites = Array.from(new Set(block.addrs)).length;
			block.size = (block.end - block.start) >>> 0;
			block.regionName =
				block.region === this.gba.mmu.REGION_WORKING_IRAM ? "IWRAM" :
				(block.region === this.gba.mmu.REGION_WORKING_RAM ? "EWRAM" : "OTHER");
			block.score = this._scoreBlock(block);
			delete block.addrs;
		}
		return merged;
	}

	_scoreBlock(block) {
		var score = 0;
		score += Math.min(block.count / 8, 20);
		score += Math.min(block.uniqueWrites / 4, 12);
		if (block.regionName === "IWRAM") {
			score += 8;
		}
		if (block.size >= 0x80 && block.size <= 0xc0) {
			score += 10;
		} else if (block.size >= 0x40 && block.size <= 0x100) {
			score += 5;
		}
		if (block.start >= 0x03000000 && block.start < 0x03008000) {
			score += 4;
		}
		return score;
	}

	getResults() {
		return {
			glyphStateBaseAddress: this.glyphStateBaseAddress >>> 0,
			glyphStateRegion: this.glyphStateRegion || "",
			writeCount: this.writes.length,
			blocks: this.blocks,
			tracer: this.wramTracer.getStats()
		};
	}
}

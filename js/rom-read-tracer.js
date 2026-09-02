// Runtime ROM-read tracing for candidate font decode windows.

class ROMReadTracer {
	constructor(gba) {
		this.gba = gba;
		this.cpu = gba.cpu;
		this.mmu = gba.mmu;
		this.enabled = false;
		this.reads = [];
		this.maxReads = 300000;
		this.windowStart = 0;
		this.windowEnd = 0;
		this.capturePredicate = null;
		this._savedCallback = null;
	}

	start(windowStart, windowEnd, options) {
		this.windowStart = windowStart >>> 0;
		this.windowEnd = windowEnd >>> 0;
		this.reads = [];
		this.enabled = true;
		this.capturePredicate =
			options && typeof options.capturePredicate === "function"
				? options.capturePredicate
				: null;
		this._savedCallback = this.mmu.romReadCallback;
		this.mmu.romReadCallback = (addr, size) => {
			if (this._savedCallback) {
				this._savedCallback(addr, size);
			}
			if (!this.enabled) {
				return;
			}
			var pc = this.cpu.gprs[this.cpu.PC] >>> 0;
			if (pc < this.windowStart || pc >= this.windowEnd) {
				return;
			}
			if (
				this.capturePredicate &&
				!this.capturePredicate(pc >>> 0, addr >>> 0, size >>> 0, this.cpu)
			) {
				return;
			}
			if (this.reads.length >= this.maxReads) {
				return;
			}
			this.reads.push({
				pc: pc,
				lr: this.cpu.gprs[this.cpu.LR] >>> 0,
				addr: addr >>> 0,
				size: size
			});
		};
	}

	stop() {
		this.enabled = false;
		this.capturePredicate = null;
		this.mmu.romReadCallback = this._savedCallback;
		this._savedCallback = null;
	}

	clear() {
		this.reads = [];
	}

	getReads() {
		return this.reads.slice();
	}

	getStats() {
		var pcs = new Set();
		for (var i = 0; i < this.reads.length; i++) {
			pcs.add(this.reads[i].pc);
		}
		return {
			capturedReads: this.reads.length,
			uniquePCs: pcs.size,
			windowStart: this.windowStart,
			windowEnd: this.windowEnd
		};
	}
}

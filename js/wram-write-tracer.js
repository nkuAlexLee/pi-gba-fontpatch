// Runtime WRAM write tracer for semantic helper-state discovery.

class WRAMWriteTracer {
	constructor(gba) {
		this.gba = gba;
		this.cpu = gba.cpu;
		this.mmu = gba.mmu;
		this.enabled = false;
		this.writes = [];
		this.maxWrites = 50000;
		this.windowStart = 0;
		this.windowEnd = 0;
		this._savedCallback = null;
	}

	start(windowStart, windowEnd) {
		this.windowStart = windowStart >>> 0;
		this.windowEnd = windowEnd >>> 0;
		this.writes = [];
		this.enabled = true;
		this._savedCallback = this.mmu.storeCallback;
		this.mmu.storeCallback = (addr, value, size, region) => {
			if (this._savedCallback) {
				this._savedCallback(addr, value, size, region);
			}
			if (!this.enabled) {
				return;
			}
			if (
				region !== this.mmu.REGION_WORKING_RAM &&
				region !== this.mmu.REGION_WORKING_IRAM
			) {
				return;
			}
			var pc = this.cpu.gprs[this.cpu.PC] >>> 0;
			if (pc < this.windowStart || pc >= this.windowEnd) {
				return;
			}
			if (this.writes.length >= this.maxWrites) {
				return;
			}
			this.writes.push({
				pc: pc,
				lr: this.cpu.gprs[this.cpu.LR] >>> 0,
				addr: addr >>> 0,
				size: size >>> 0,
				region: region >>> 0
			});
		};
	}

	stop() {
		this.enabled = false;
		this.mmu.storeCallback = this._savedCallback;
		this._savedCallback = null;
	}

	clear() {
		this.writes = [];
	}

	getWrites() {
		return this.writes.slice();
	}

	getStats() {
		var pcs = new Set();
		for (var i = 0; i < this.writes.length; i++) {
			pcs.add(this.writes[i].pc);
		}
		return {
			capturedWrites: this.writes.length,
			uniquePCs: pcs.size,
			windowStart: this.windowStart,
			windowEnd: this.windowEnd
		};
	}
}

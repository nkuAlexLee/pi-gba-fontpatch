// js/vram-tracer.js
// Phase 1: Intercept VRAM writes and record PC/LR for behavioral analysis

class VRAMWriteTracer {
	constructor(gba) {
		this.gba = gba;
		this.mmu = gba.mmu;
		this.cpu = gba.cpu;
		this.enabled = false;
		this.frame = 0;
		this.traces = [];
		this.totalWrites = 0;
		this.maxTraces = 500000;
		this._savedCallback = null;
	}

	start() {
		this._savedCallback = this.mmu.vramStoreCallback;
		const self = this;
		this.mmu.vramStoreCallback = function(addr, value, size) {
			if ((addr >>> 24) !== 0x06) return;
			self.totalWrites++;
			if (self.traces.length < self.maxTraces) {
				self.traces.push({
					pc: self.cpu.gprs[self.cpu.PC] >>> 0,
					lr: self.cpu.gprs[self.cpu.LR] >>> 0,
					sp: self.cpu.gprs[self.cpu.SP] >>> 0,
					addr: addr >>> 0,
					vramAddr: addr & 0x00ffffff,
					size: size,
					frame: self.frame,
					mode: self.cpu.execMode === self.cpu.MODE_ARM ? "arm" : "thumb"
				});
			}
		};
		this.enabled = true;
	}

	stop() {
		this.enabled = false;
		this.mmu.vramStoreCallback = this._savedCallback;
		this._savedCallback = null;
	}

	clear() {
		this.frame = 0;
		this.traces = [];
		this.totalWrites = 0;
	}

	onFrame() {
		this.frame++;
	}

	getTraces() {
		return this.traces.slice();
	}

	getStats() {
		const pcSet = new Set();
		for (const t of this.traces) pcSet.add(t.pc);
		return {
			totalWrites: this.totalWrites,
			capturedTraces: this.traces.length,
			uniquePCs: pcSet.size,
			frame: this.frame
		};
	}
}

// js/decoder-patcher.js
// Phase 2: Inject zero-overhead callbacks into compiled instruction closures

class DecoderPatcher {
	constructor(gba) {
		this.gba = gba;
		this.cpu = gba.cpu;
		this.patches = new Map();
	}

	registerPatch(address, callback) {
		this.patches.set(address, typeof callback === "function" ? { callback: callback } : callback);
	}

	registerPatches(patches) {
		for (const [addr, patch] of patches) {
			this.patches.set(
				addr,
				typeof patch === "function" ? { callback: patch } : patch
			);
		}
	}

	apply() {
		if (!this.cpu.instructionCallbacks) {
			this.cpu.instructionCallbacks = new Map();
		}
		for (const [addr, patch] of this.patches) {
			this.cpu.instructionCallbacks.set(addr, patch);
		}
		this._invalidateCache();
	}

	remove() {
		this.cpu.instructionCallbacks = null;
		this.patches.clear();
		this._invalidateCache();
	}

	_invalidateCache() {
		// Clear the icache so instructions are recompiled (with or without callbacks)
		const mmu = this.gba.mmu;
		if (mmu.icache) {
			for (const page of mmu.icache) {
				if (page) {
					if (page.arm) page.arm.fill(null);
					if (page.thumb) page.thumb.fill(null);
				}
			}
		}
		// Also clear cached current instruction
		this.cpu.instruction = null;
	}
}

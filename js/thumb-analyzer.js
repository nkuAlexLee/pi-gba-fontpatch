// Lightweight THUMB analyzer for semantic matching around text render code.

class ThumbAnalyzer {
	constructor(gba) {
		this.gba = gba;
		this.mmu = gba.mmu;
	}

	read16(addr) {
		return this.mmu.loadU16(addr >>> 0) & 0xffff;
	}

	decode(addr) {
		var op = this.read16(addr);
		var nextOp = this.read16((addr + 2) >>> 0);
		var alignedPc = ((addr + 4) & ~3) >>> 0;

		if ((op & 0xf800) === 0x4800) {
			var literalImm = (op & 0xff) << 2;
			return {
				type: "ldr_pc",
				raw: op,
				rd: (op >> 8) & 0x7,
				imm: literalImm >>> 0,
				literalAddr: (alignedPc + literalImm) >>> 0
			};
		}

		if ((op & 0xf800) === 0x6800) {
			return {
				type: "ldr_imm",
				raw: op,
				rd: op & 0x7,
				rb: (op >> 3) & 0x7,
				imm: ((op >> 6) & 0x1f) << 2
			};
		}
		if ((op & 0xf800) === 0x7800) {
			return {
				type: "ldrb_imm",
				raw: op,
				rd: op & 0x7,
				rb: (op >> 3) & 0x7,
				imm: (op >> 6) & 0x1f
			};
		}
		if ((op & 0xf800) === 0x7000) {
			return {
				type: "strb_imm",
				raw: op,
				rd: op & 0x7,
				rb: (op >> 3) & 0x7,
				imm: (op >> 6) & 0x1f
			};
		}
		if ((op & 0xf800) === 0x6000) {
			return {
				type: "str_imm",
				raw: op,
				rd: op & 0x7,
				rb: (op >> 3) & 0x7,
				imm: ((op >> 6) & 0x1f) << 2
			};
		}
		if ((op & 0xf800) === 0x3000) {
			return {
				type: "add_imm8",
				raw: op,
				rd: (op >> 8) & 0x7,
				imm: op & 0xff
			};
		}
		if ((op & 0xfe00) === 0x1c00) {
			return {
				type: "add_imm3",
				raw: op,
				rd: op & 0x7,
				rn: (op >> 3) & 0x7,
				imm: (op >> 6) & 0x7
			};
		}
		if ((op & 0xfe00) === 0x1e00) {
			return {
				type: "sub_imm3",
				raw: op,
				rd: op & 0x7,
				rn: (op >> 3) & 0x7,
				imm: (op >> 6) & 0x7
			};
		}
		if ((op & 0xf800) === 0x3800) {
			return {
				type: "sub_imm8",
				raw: op,
				rd: (op >> 8) & 0x7,
				imm: op & 0xff
			};
		}
		if ((op & 0xf800) === 0x2800) {
			return {
				type: "cmp_imm8",
				raw: op,
				rn: (op >> 8) & 0x7,
				imm: op & 0xff
			};
		}
		if ((op & 0xfc00) === 0x1800) {
			return {
				type: "add_reg",
				raw: op,
				rd: op & 0x7,
				rn: (op >> 3) & 0x7,
				rm: (op >> 6) & 0x7
			};
		}
		if ((op & 0xffc0) === 0x4280) {
			return {
				type: "cmp_reg",
				raw: op,
				rn: op & 0x7,
				rm: (op >> 3) & 0x7
			};
		}
		if ((op & 0xf800) === 0x2000) {
			return {
				type: "mov_imm8",
				raw: op,
				rd: (op >> 8) & 0x7,
				imm: op & 0xff
			};
		}
		if ((op & 0xf800) === 0x0000) {
			return {
				type: "lsl_imm",
				raw: op,
				rd: op & 0x7,
				rm: (op >> 3) & 0x7,
				imm: (op >> 6) & 0x1f
			};
		}
		if ((op & 0xf800) === 0x0800) {
			return {
				type: "lsr_imm",
				raw: op,
				rd: op & 0x7,
				rm: (op >> 3) & 0x7,
				imm: (op >> 6) & 0x1f
			};
		}
		if ((op & 0xffc0) === 0x4340) {
			return {
				type: "mul",
				raw: op,
				rd: op & 0x7,
				rm: (op >> 3) & 0x7
			};
		}
		if ((op & 0xfc00) === 0x4400) {
			var highRd = (op & 0x7) | (((op >> 7) & 0x1) << 3);
			var highRm = (op >> 3) & 0xf;
			var hiOp = (op >> 8) & 0x3;
			if (hiOp === 0x0) {
				return {
					type: "add_hi",
					raw: op,
					rd: highRd,
					rm: highRm
				};
			}
			if (hiOp === 0x1) {
				return {
					type: "cmp_hi",
					raw: op,
					rn: highRd,
					rm: highRm
				};
			}
			if (hiOp === 0x2) {
				return {
					type: "mov_hi",
					raw: op,
					rd: highRd,
					rm: highRm
				};
			}
			if (hiOp === 0x3) {
				return {
					type: "bx",
					raw: op,
					rm: highRm
				};
			}
		}
		if ((op & 0xf000) === 0xd000 && (op & 0x0f00) !== 0x0f00) {
			return {
				type: "b_cond",
				raw: op,
				cond: (op >> 8) & 0xf,
				imm8: op & 0xff
			};
		}
		if ((op & 0xf800) === 0xe000) {
			return {
				type: "b",
				raw: op,
				imm11: op & 0x7ff
			};
		}
		if ((op & 0xf800) === 0xf000 && (nextOp & 0xf800) === 0xf800) {
			var branchOffset = ((op & 0x07ff) << 12) | ((nextOp & 0x07ff) << 1);
			if (branchOffset & 0x400000) {
				branchOffset |= ~0x7fffff;
			}
			return {
				type: "bl",
				raw: op,
				rawNext: nextOp,
				offset: branchOffset | 0,
				targetAddr: ((addr + 4 + branchOffset) >>> 0)
			};
		}
		if ((op & 0xfe00) === 0xb400) {
			return {
				type: "push",
				raw: op,
				registerMask: op & 0xff,
				includesLR: !!(op & 0x0100)
			};
		}
		if ((op & 0xfe00) === 0xbc00) {
			return {
				type: "pop",
				raw: op,
				registerMask: op & 0xff,
				includesPC: !!(op & 0x0100)
			};
		}
		// ADD/SUB SP,#imm7 uses bit7 as the add/sub selector, so mask only the top byte.
		if ((op & 0xff00) === 0xb000) {
			var spImm = (op & 0x7f) << 2;
			return {
				type: (op & 0x80) ? "sub_sp_imm" : "add_sp_imm",
				raw: op,
				imm: spImm >>> 0
			};
		}

		return {
			type: "unknown",
			raw: op
		};
	}

	scan(addr, count) {
		var instructions = [];
		for (var i = 0; i < count; i++) {
			instructions.push(this.decode(addr + i * 2));
		}
		return instructions;
	}
}

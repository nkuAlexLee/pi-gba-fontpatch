/**
 * ThumbDisassembler - Thumb (16-bit) / ARM (32-bit) instruction disassembler
 * for the ARM7TDMI (GBA CPU).
 *
 * Usage:
 *   const dis = new ThumbDisassembler(gba.mmu);
 *   dis.disassemble(0x08000000, 20);   // returns [{address, bytes, text}]
 *
 * Mode selection:
 *   GBA code runs in either ARM (32-bit) or Thumb (16-bit) mode. Use
 *   disAuto(address) to decode based on gba.cpu.execMode, or call
 *   disassemble() (Thumb) / disassembleARM() (ARM) directly.
 */
class ThumbDisassembler {
	constructor(mmu) {
		this.mmu = mmu;
		this.COND = ['EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC',
			'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL', 'NV'];
		this.REG = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7',
			'r8', 'r9', 'r10', 'fp', 'ip', 'sp', 'lr', 'pc'];
	}

	reg(n) {
		return this.REG[n & 0xf];
	}

	hex(v) {
		return '0x' + (v >>> 0).toString(16).toUpperCase();
	}

	read16(addr) {
		return this.mmu.loadU16(addr) & 0xffff;
	}

	read32(addr) {
		return this.mmu.load32(addr) >>> 0;
	}

	/**
	 * Disassemble `count` instructions starting at `addr`.
	 * mode: 'thumb' or 'arm'. Returns array of {address, bytes, text, target}
	 */
	disassemble(addr, count, mode) {
		mode = mode || 'thumb';
		var out = [];
		for (var i = 0; i < count; i++) {
			try {
				if (mode === 'thumb') {
					var item = this.disassembleThumb(addr);
					out.push(item);
					// BL 占两个半字，跳过第二个半字
					addr += item.bytes.split(' ').length > 1 ? 4 : 2;
				} else {
					out.push(this.disassembleARM(addr));
					addr += 4;
				}
			} catch (e) {
				out.push({ address: addr, bytes: '?', text: '<unreadable>' });
				addr += mode === 'thumb' ? 2 : 4;
			}
		}
		return out;
	}

	/** Auto-select mode from CPU state (uses current execMode). */
	get currentMode() {
		if (this.mmu && this.mmu.cpu) {
			return this.mmu.cpu.execMode === this.mmu.cpu.MODE_THUMB ? 'thumb' : 'arm';
		}
		return 'thumb';
	}

	/* ------------------------------------------------------------------ */
	/* THUMB                                                              */
	/* ------------------------------------------------------------------ */

	disassembleThumb(addr) {
		var hw = this.read16(addr);
		var r = { address: addr, bytes: hw.toString(16).toUpperCase().padStart(4, '0'), text: '', target: 0 };
		var op = (hw >> 11) & 0x1f;

		// Format 1: shift by immediate (000)
		// bits[15:11]: 00000=LSL, 00001=LSR, 00010=ASR (op = (hw>>11)&0x1f)
		if (op < 0x02 || (op === 0x02 && (hw & 0x1800) !== 0x1800)) {
			var off = (hw >> 6) & 0x1f;
			var rs = (hw >> 3) & 7, rd = hw & 7;
			if (op === 0) {
				r.text = 'lsl ' + this.reg(rd) + ', ' + this.reg(rs) + ', #' + off;
			} else {
				if (off === 0) off = 32;
				r.text = (op === 1 ? 'lsr ' : 'asr ') + this.reg(rd) + ', ' + this.reg(rs) + ', #' + off;
			}
			return r;
		}

		// Format 2: add/sub register or 3-bit immediate (00011)
		if ((hw & 0xf800) === 0x1800) {
			var imm = (hw >> 10) & 1;      // 0 = register, 1 = imm3
			var sub = (hw >> 9) & 1;       // 0 = ADD, 1 = SUB
			var rn = (hw >> 6) & 7;
			var rs2 = (hw >> 3) & 7;
			var rd2 = hw & 7;
			var operand = imm ? '#' + rn : this.reg(rn);
			r.text = (sub ? 'sub ' : 'add ') + this.reg(rd2) + ', ' + this.reg(rs2) + ', ' + operand;
			return r;
		}

		// Format 3: mov/cmp/add/sub immediate (001)
		if ((hw & 0xe000) === 0x2000) {
			var op3 = (hw >> 11) & 3;
			var rd3 = (hw >> 8) & 7;
			var imm3 = hw & 0xff;
			var names = ['mov', 'cmp', 'add', 'sub'];
			r.text = names[op3] + ' ' + this.reg(rd3) + ', #' + imm3;
			return r;
		}

		// Format 4: ALU operations (010000)
		if ((hw & 0xfc00) === 0x4000) {
			var op4 = (hw >> 6) & 0xf;
			var rs4 = (hw >> 3) & 7;
			var rd4 = hw & 7;
			var names4 = ['and', 'eor', 'lsl', 'lsr', 'asr', 'adc', 'sbc', 'ror',
				'tst', 'neg', 'cmp', 'cmn', 'orr', 'mul', 'bic', 'mvn'];
			var isCmp = (op4 === 8 || op4 === 10 || op4 === 11);
			r.text = names4[op4] + ' ' + this.reg(rd4) + (isCmp ? '' : ', ') + this.reg(rs4);
			return r;
		}

		// Format 5: Hi register ops / BX (010001)
		if ((hw & 0xff00) === 0x4700) {
			// BX: 0100 0111 0 H2 Rm
			var rsBx = ((hw >> 3) & 7) | (((hw >> 6) & 1) << 3);
			r.text = 'bx ' + this.reg(rsBx);
			return r;
		}
		if ((hw & 0xfc00) === 0x4400) {
			var op5 = (hw >> 8) & 3;
			var h1 = (hw >> 7) & 1, h2 = (hw >> 6) & 1;
			var rs5 = ((hw >> 3) & 7) | (h2 << 3);
			var rd5 = (hw & 7) | (h1 << 3);
			if (op5 === 3) {
				r.text = 'bx ' + this.reg(rs5);
			} else {
				var names5 = ['add', 'cmp', 'mov'];
				var isCmp5 = op5 === 1;
				r.text = names5[op5] + ' ' + this.reg(rd5) + (isCmp5 ? '' : ', ') + this.reg(rs5);
			}
			return r;
		}

		// Format 6: PC-relative load (01001)
		if ((hw & 0xf800) === 0x4800) {
			var rd6 = (hw >> 8) & 7;
			var imm6 = (hw & 0xff) * 4;
			var pc6 = ((addr + 4) & ~3) + imm6;
			r.text = 'ldr ' + this.reg(rd6) + ', [pc, #' + imm6 + ']  ; =' + this.hex(pc6);
			return r;
		}

		// Format 7/8: load/store register offset (0101)
		if ((hw & 0xf000) === 0x5000) {
			var l = (hw >> 11) & 1;
			var b = (hw >> 10) & 1;
			var s = (hw >> 9) & 1;
			var one = (hw >> 9) & 1; // bit9 == 1 -> halfword/sign-extended forms
			var rm = (hw >> 6) & 7;
			var rb = (hw >> 3) & 7;
			var rd7 = hw & 7;
			if ((hw & 0x0200) === 0) {
				// Format 7: STR/LDR/STRB/LDRB Rd, [Rb, Ro]
				var mn = l ? (b ? 'ldrb' : 'ldr') : (b ? 'strb' : 'str');
				r.text = mn + ' ' + this.reg(rd7) + ', [' + this.reg(rb) + ', ' + this.reg(rm) + ']';
			} else {
				// Format 8: STRH/LDRH/LDRSB/LDRSH
				var mn8;
				if (!s && !b) mn8 = 'strh';
				else if (!s && b) mn8 = 'ldrh';
				else if (s && !b) mn8 = 'ldrsb';
				else mn8 = 'ldrsh';
				r.text = mn8 + ' ' + this.reg(rd7) + ', [' + this.reg(rb) + ', ' + this.reg(rm) + ']';
			}
			return r;
		}

		// Format 9: load/store with immediate offset (011)
		if ((hw & 0xe000) === 0x6000) {
			var b9 = (hw >> 12) & 1;
			var l9 = (hw >> 11) & 1;
			var off9 = (hw >> 6) & 0x1f;
			var rb9 = (hw >> 3) & 7;
			var rd9 = hw & 7;
			var mn9 = l9 ? (b9 ? 'ldrb' : 'ldr') : (b9 ? 'strb' : 'str');
			var scale = b9 ? 1 : 4;
			r.text = mn9 + ' ' + this.reg(rd9) + ', [' + this.reg(rb9) + (off9 ? (b9 ? ', #' : ', #' ) + (off9 * scale) : '') + ']';
			return r;
		}

		// Format 10: load/store halfword (1000)
		if ((hw & 0xf000) === 0x8000) {
			var l10 = (hw >> 11) & 1;
			var off10 = ((hw >> 6) & 0x1f) * 2;
			var rb10 = (hw >> 3) & 7;
			var rd10 = hw & 7;
			r.text = (l10 ? 'ldrh' : 'strh') + ' ' + this.reg(rd10) + ', [' + this.reg(rb10) + ', #' + off10 + ']';
			return r;
		}

		// Format 11: SP-relative load/store (1001)
		if ((hw & 0xf000) === 0x9000) {
			var l11 = (hw >> 11) & 1;
			var rd11 = (hw >> 8) & 7;
			var imm11 = (hw & 0xff) * 4;
			r.text = (l11 ? 'ldr' : 'str') + ' ' + this.reg(rd11) + ', [sp, #' + imm11 + ']';
			return r;
		}

		// Format 12: load address (1010): ADD Rd, PC/SP, #imm
		if ((hw & 0xf000) === 0xa000) {
			var sp12 = (hw >> 11) & 1;
			var rd12 = (hw >> 8) & 7;
			var imm12 = (hw & 0xff) * 4;
			if (sp12) {
				r.text = 'add ' + this.reg(rd12) + ', sp, #' + imm12;
			} else {
				var pc12 = (addr + 4) & ~3;
				r.text = 'add ' + this.reg(rd12) + ', pc, #' + imm12 + '  ; =' + this.hex(pc12 + imm12);
			}
			return r;
		}

		// Format 13/14: misc (1011): ADD SP imm, PUSH, POP
		if ((hw & 0xf600) === 0xb000) {
			// ADD SP, #imm (1011 0000 0/1)
			var off13 = hw & 0x7f;
			var sub13 = (hw >> 7) & 1;
			r.text = (sub13 ? 'sub sp, #' : 'add sp, #') + (off13 * 4);
			return r;
		}
		if ((hw & 0xfe00) === 0xb400) {
			// PUSH {rlist}, maybe LR
			var list14 = hw & 0xff;
			var lr = (hw >> 8) & 1;
			r.text = 'push {' + this.rlistInner(list14) + (lr ? (list14 ? ', ' : '') + 'lr' : '') + '}';
			return r;
		}
		if ((hw & 0xfe00) === 0xbc00) {
			// POP {rlist}, maybe PC
			var list15 = hw & 0xff;
			var pcFlag = (hw >> 8) & 1;
			r.text = 'pop {' + this.rlistInner(list15) + (pcFlag ? (list15 ? ', ' : '') + 'pc' : '') + '}';
			return r;
		}

		// Format 15: STMIA/LDMIA (1100)
		if ((hw & 0xf000) === 0xc000) {
			var l15 = (hw >> 11) & 1;
			var rb15 = (hw >> 8) & 7;
			var list15b = hw & 0xff;
			r.text = (l15 ? 'ldmia' : 'stmia') + ' ' + this.reg(rb15) + '!, ' + this.rlist(list15b);
			return r;
		}

		// Format 16: conditional branch (1101, cond != 1111)
		if ((hw & 0xf000) === 0xd000 && ((hw >> 8) & 0xf) !== 0xf) {
			var cond = (hw >> 8) & 0xf;
			var off16 = (hw & 0xff);
			if (off16 & 0x80) off16 -= 0x100;
			var target16 = addr + 4 + (off16 << 1);
			r.text = 'b' + this.COND[cond].toLowerCase() + ' ' + this.hex(target16);
			r.target = target16;
			return r;
		}
		// SWI (1101 1111)
		if ((hw & 0xff00) === 0xdf00) {
			r.text = 'swi ' + this.hex(hw & 0xff);
			return r;
		}

		// Format 18: unconditional branch (11100)
		if ((hw & 0xf800) === 0xe000) {
			var off18 = hw & 0x7ff;
			if (off18 & 0x400) off18 -= 0x800;
			var target18 = addr + 4 + (off18 << 1);
			r.text = 'b ' + this.hex(target18);
			r.target = target18;
			return r;
		}

		// Format 19: BL long branch (1111) - first halfword
		if ((hw & 0xf800) === 0xf000) {
			var offHi = hw & 0x7ff;
			var hw2 = this.read16(addr + 2);
			if ((hw2 & 0xf800) === 0xf800) {
				var offLo = hw2 & 0x7ff;
				var off23 = (offHi << 12) | (offLo << 1);
				if (off23 & 0x400000) off23 -= 0x800000; // 23 位符号扩展
				var target19 = addr + 4 + off23;
				r.text = 'bl ' + this.hex(target19 >>> 0);
				r.target = target19 >>> 0;
				r.bytes = r.bytes + ' ' + hw2.toString(16).toUpperCase().padStart(4, '0');
				return r;
			}
			r.text = 'bl (incomplete)';
			return r;
		}

		r.text = 'unk(0x' + r.bytes + ')';
		return r;
	}

	rlistInner(mask) {
		var regs = [];
		for (var i = 0; i < 8; i++) {
			if (mask & (1 << i)) regs.push(this.reg(i));
		}
		return regs.join(', ');
	}

	rlist(mask) {
		return '{' + this.rlistInner(mask) + '}';
	}

	/* ------------------------------------------------------------------ */
	/* ARM                                                                */
	/* ------------------------------------------------------------------ */

	disassembleARM(addr) {
		var w = this.read32(addr);
		var r = { address: addr, bytes: w.toString(16).toUpperCase().padStart(8, '0'), text: '', target: 0 };
		var cond = w >>> 28;
		var condStr = cond === 0xe ? '' : this.COND[cond].toLowerCase();
		var rest = w & 0x0fffffff;

		// SWI
		if (cond !== 0xf && rest >>> 24 === 0xf) {
			r.text = 'swi' + condStr + ' ' + this.hex(w & 0x00ffffff);
			return r;
		}
		// BX
		if ((w & 0x0ffffff0) === 0x012fff10) {
			r.text = 'bx' + condStr + ' ' + this.reg(w & 0xf);
			return r;
		}
		// Branch / Branch with link (101L)
		if ((w & 0x0e000000) === 0x0a000000) {
			var l = (w >> 24) & 1;
			var off = w & 0x00ffffff;
			if (off & 0x800000) off -= 0x01000000;
			var target = addr + 8 + (off << 2);
			r.text = (l ? 'bl' : 'b') + condStr + ' ' + this.hex(target >>> 0);
			r.target = target >>> 0;
			return r;
		}
		// Block data transfer (LDM/STM)
		if ((w & 0x0e000000) === 0x08000000) {
			var l2 = (w >> 20) & 1;
			var p = (w >> 24) & 1;
			var u = (w >> 23) & 1;
			var wb = (w >> 21) & 1;
			var rn = (w >> 16) & 0xf;
			var list = [];
			for (var i = 0; i < 16; i++) {
				if (w & (1 << i)) list.push(this.reg(i));
			}
			var dir = (p ? (u ? 'ib' : 'db') : (u ? 'ia' : 'da'));
			r.text = (l2 ? 'ldm' : 'stm') + dir + condStr + ' ' + this.reg(rn) +
				(wb ? '!' : '') + ' {' + list.join(', ') + '}' + ((w & 0x400000) ? '^' : '');
			return r;
		}
		// Single data transfer (LDR/STR)
		if ((w & 0x0c000000) === 0x04000000) {
			var l3 = (w >> 20) & 1;
			var b3 = (w >> 22) & 1;
			var rn3 = (w >> 16) & 0xf;
			var rd3 = (w >> 12) & 0xf;
			var pre = (w >> 24) & 1;  // P bit: pre/post-indexed
			var up = (w >> 23) & 1;   // U bit: add/subtract offset
			var wb = (w >> 21) & 1;   // W bit: writeback
			var offset;
			if (!(w & (1 << 25))) {
				offset = '#' + (up ? (w & 0xfff) : '-' + (w & 0xfff));
			} else {
				var rm = w & 0xf;
				var shiftName = ['lsl', 'lsr', 'asr', 'ror'][(w >> 5) & 3];
				var amt = (w >> 7) & 0x1f;
				offset = this.reg(rm) + (amt ? (', ' + shiftName + ' #' + amt) : '');
				if (!up) offset = '-' + offset;
			}
			var mn3 = (l3 ? 'ldr' : 'str') + (b3 ? 'b' : '') + condStr;
			if (pre) {
				r.text = mn3 + ' ' + this.reg(rd3) + ', [' + this.reg(rn3) + ', ' + offset + ']' + (wb ? '!' : '');
			} else {
				r.text = mn3 + ' ' + this.reg(rd3) + ', [' + this.reg(rn3) + '], ' + offset;
			}
			return r;
		}
		// Multiply (0000 0000 xxxx 1001)
		if ((w & 0x0f000000) === 0x00000000 && (w & 0x90) === 0x90 && ((w >> 20) & 0x1b) !== 0x11) {
			var op = (w >> 21) & 3;
			var s4 = (w >> 20) & 1;
			var rd4 = (w >> 16) & 0xf;
			var rn4 = (w >> 12) & 0xf;
			var rs4 = (w >> 8) & 0xf;
			var rm4 = w & 0xf;
			if (op === 0) r.text = 'mul' + (s4 ? 's' : '') + condStr + ' ' + this.reg(rd4) + ', ' + this.reg(rm4) + ', ' + this.reg(rs4);
			else r.text = 'mla' + (s4 ? 's' : '') + condStr + ' ' + this.reg(rd4) + ', ' + this.reg(rm4) + ', ' + this.reg(rs4) + ', ' + this.reg(rn4);
			return r;
		}
		// Data processing
		if ((w & 0x0c000000) === 0x00000000) {
			var opcode = (w >> 21) & 0xf;
			var s5 = (w >> 20) & 1;
			var rn5 = (w >> 16) & 0xf;
			var rd5 = (w >> 12) & 0xf;
			var names = ['and', 'eor', 'sub', 'rsb', 'add', 'adc', 'sbc', 'rsc',
				'tst', 'teq', 'cmp', 'cmn', 'orr', 'mov', 'bic', 'mvn'];
			var isCmp5 = (opcode >= 8 && opcode <= 11) || opcode === 13 || opcode === 15;
			// SHIFTER OPERAND
			var operand;
			if (w & (1 << 25)) {
				// immediate: rotate_imm(11-8) imm8(7-0)
				var rot = (w >> 8) & 0xf;
				var imm = w & 0xff;
				var val = ((imm >>> 0) | 0) >>> 0;
				if (rot) val = ((imm >>> rot) | (imm << (32 - rot))) >>> 0;
				operand = '#' + val;
			} else {
				var rm5 = w & 0xf;
				var shiftType = (w >> 5) & 3;
				var shiftNames = ['lsl', 'lsr', 'asr', 'ror'];
				if (!(w & (1 << 4))) {
					var amt5 = (w >> 7) & 0x1f;
					operand = this.reg(rm5) + (amt5 ? (', ' + shiftNames[shiftType] + ' #' + amt5) : '');
				} else {
					var rsx = (w >> 8) & 0xf;
					operand = this.reg(rm5) + ', ' + shiftNames[shiftType] + ' ' + this.reg(rsx);
				}
			}
			var mn = names[opcode];
			var txt;
			if (opcode === 13 || opcode === 15) {
				txt = mn + (s5 ? 's' : '') + condStr + ' ' + this.reg(rd5) + ', ' + operand;
			} else if (opcode >= 8 && opcode <= 11) {
				txt = mn + condStr + ' ' + this.reg(rn5) + ', ' + operand;
			} else {
				txt = mn + (s5 ? 's' : '') + condStr + ' ' + this.reg(rd5) + ', ' + this.reg(rn5) + ', ' + operand;
			}
			r.text = txt;
			return r;
		}

		r.text = 'unk(w:' + r.bytes + ')';
		return r;
	}
}

window.ThumbDisassembler = ThumbDisassembler;

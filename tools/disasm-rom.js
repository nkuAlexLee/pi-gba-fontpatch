// 独立反汇编 ROM 指定区域（不依赖 serve 状态）
// 用法: node tools/disasm-rom.js <start> <count> [thumb|arm] [romfile]
const fs = require('fs');
const path = require('path');
const start = parseInt(process.argv[2], 16);
const count = parseInt(process.argv[3], 10);
const mode = process.argv[4] || 'thumb';
const romPath = process.argv[5] || 'roms/pker.gba';
const rom = fs.readFileSync(path.join(__dirname, '..', romPath));

// 32MB ROM: 0x08000000-0x09FFFFFF
const mockMMU = {
	loadU16: (a) => rom.readUInt16LE((a - 0x08000000) & 0x1FFFFFF),
	load32: (a) => rom.readUInt32LE((a - 0x08000000) & 0x1FFFFFF),
};
// thumb-disassembler.js 依赖 window
global.window = {};
require(path.join(__dirname, '..', 'js', 'thumb-disassembler.js'));
const dis = new global.window.ThumbDisassembler(mockMMU);
const rows = dis.disassemble(start, count, mode);
for (const r of rows) console.log('0x' + (r.address >>> 0).toString(16).toUpperCase() + '  ' + r.bytes.padEnd(9) + r.text);

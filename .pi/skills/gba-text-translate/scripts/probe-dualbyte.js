'use strict';
/**
 * probe-dualbyte.js — 探测 ROM 文本引擎是否支持双字节取字（汉化基座选型的第一步）
 *
 * 原理：Emerald 家族引擎的 RenderText 取字处，若支持双字节汉字，
 *   必然存在"窥视下一字节"指令 `ldrb rX, [rY, #1]`（读完当前字符后偷看 lo），
 *   且随后有 (hi修正)<<8 + lo 的合成模式（lsl rX,#8 + add）。
 *   不支持者（如 XTREME）取字后直接进控制码跳表，无窥视。
 *
 * 用法:
 *   node probe-dualbyte.js <rom.gba> <renderTextAddrHex> [扫描指令数=200]
 *
 * RenderText 地址来源：gba-font-crack 案例 / trace 法 / watch-read 法
 * 输出：窥视指令列表 + 双字节判定（支持 / 不支持 / 需人工复核）
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {};
require(path.join(__dirname, '../../../..', 'js/thumb-disassembler.js'));
const ThumbDisassembler = global.window.ThumbDisassembler;

const romPath = process.argv[2];
const addr = parseInt(process.argv[3], 16);
const count = parseInt(process.argv[4] || '200', 10);
if (!romPath || isNaN(addr)) {
	console.error('用法: node probe-dualbyte.js <rom.gba> <renderTextAddrHex> [扫描指令数=200]');
	process.exit(1);
}

const rom = fs.readFileSync(romPath);
const d = new ThumbDisassembler({
	loadU16: a => rom.readUInt16LE(a & 0x1FFFFFF),
	loadU32: a => rom.readUInt32LE(a & 0x1FFFFFF),
	load32: a => rom.readUInt32LE(a & 0x1FFFFFF),
});
const ins = d.disassemble(addr, count, 'thumb').map(t => typeof t === 'string' ? t : `0x${t.address.toString(16)} ${t.bytes} ${t.text}`);

// 特征 1：窥视指令 ldrb rX, [rY, #1]
const peek = ins.filter(t => /ldrb r\d+, \[r\d+, #1\]/.test(t));
// 特征 2：双字节合成（lsl #8 后跟 add 合成，或直接 add rX, rY, rX 组合）
const synth = ins.filter(t => /lsl r\d+, r\d+, #8/.test(t));

console.log(`ROM: ${romPath}`);
console.log(`扫描起点: 0x${addr.toString(16)}（${count} 条指令）`);
console.log(`窥视指令 (ldrb rX,[rY,#1]): ${peek.length} 处`);
peek.slice(0, 5).forEach(t => console.log('  ' + t));
console.log(`合成特征 (lsl rX,rX,#8): ${synth.length} 处`);
synth.slice(0, 5).forEach(t => console.log('  ' + t));

console.log();
// 判定逻辑（四 ROM 实测校准）：
//   窥视(peek)是双字节取字的必要特征：支持者（RY/EliteRedux/Quetzal）必有，XTREME 类完全无
//   合成特征(lsl #8)是充分补充（Quetzal 跳板为“先移指针再读”变体，无 #1 窥视但有合成）
if (peek.length >= 1) {
	console.log('✔ 判定: 支持双字节取字（发现窥视指令 ' + peek.length + ' 处）→ 可作整句汉化基座');
	console.log('  建议: 用 romctl hook 窥视处 + 写入双字节测试串（如 0E 4D 03 0B FF = "新的"）做渲染实证');
} else if (synth.length >= 1) {
	console.log('◐ 判定: 未见 #1 窥视但有合成特征（疑似“先移指针再读”变体）→ 人工复核合成处指令流');
} else {
	console.log('✘ 判定: 不支持双字节取字（无窥视/合成）→ 单字节槽位方案，整句汉化需换基座或引擎改造');
}

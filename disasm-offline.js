#!/usr/bin/env node
/**
 * 离线 Thumb/ARM 反汇编器（不启模拟器）
 * 用法: node disasm-offline.js <rom.gba> <gba地址hex> [指令数] [--arm]
 */
'use strict';
const fs = require('fs');
const path = require('path');

global.window = {}; // mock，绕过浏览器依赖
require(path.join(__dirname, 'js/thumb-disassembler.js'));
const ThumbDisassembler = global.window.ThumbDisassembler;

const rom = fs.readFileSync(process.argv[2]);
const start = parseInt(process.argv[3], 16);
const count = parseInt(process.argv[4] || '40', 10);
const mode = process.argv.includes('--arm') ? 'arm' : 'thumb';

const d = new ThumbDisassembler({
	loadU16: a => rom.readUInt16LE(a & 0x1FFFFFF),
	loadU32: a => rom.readUInt32LE(a & 0x1FFFFFF),
	load32: a => rom.readUInt32LE(a & 0x1FFFFFF),
});

for (const l of d.disassemble(start, count, mode)) {
	console.log('0x' + (l.address >>> 0).toString(16).padStart(8, '0'), (l.bytes || '').padEnd(10), l.text);
}

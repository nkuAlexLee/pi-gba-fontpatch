#!/usr/bin/env node
/**
 * patch-ry-chs.js — Recharged Yellow v1.9.4 中文字符串替换
 *
 * 背景（详见 cases/RechargedYellow-自带中文引擎实录.md）：
 * 该改版（BPRE 头，FireRed 重编译布局）**自带完整中文引擎与字库**，编码与
 * fonts/wholewords.txt 完全一致（如 新=0E4D 的=030B 游=0F7C 戏=0DDB），
 * 无需注入任何代码/字形——直接按码表改字符串即可上屏。
 *
 * 用法: node patch-ry-chs.js <in.gba> <out.gba>
 *
 * 关键地址：
 *   主菜单字符串区 @文件 0x8F3350（"New Game"），指针表 @0x8F354C
 *   双字节编码: [hi][lo]，hi∈0x01-0x1B，即 charId=(hi<<8)|lo，与 wholewords.txt 一致
 */
'use strict';
const fs = require('fs');

const CODES = {}; // 汉字 -> hex 码
for (const line of fs.readFileSync(__dirname + '/../../../../../fonts/wholewords.txt', 'utf8').split(/\r?\n/)) {
	const i = line.indexOf('=');
	if (i > 0) CODES[line.slice(i + 1).trim()] = line.slice(0, i).trim().toLowerCase();
}
function enc(str) { // 汉字按双字节、ASCII 按 charmap 单字节（A=0xBB 起连续大写、0xD5 起小写）
	const out = [];
	for (const ch of str) {
		if (CODES[ch]) { out.push(CODES[ch]); continue; }
		const c = ch.codePointAt(0);
		if (c >= 0x41 && c <= 0x5a) out.push((0xbb + c - 0x41).toString(16).padStart(2, '0'));
		else if (c >= 0x61 && c <= 0x7a) out.push((0xd5 + c - 0x61).toString(16).padStart(2, '0'));
		else if (ch === ' ') out.push('00');
		else throw new Error('无编码: ' + ch);
	}
	return out;
}

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) { console.error('用法: node patch-ry-chs.js <in.gba> <out.gba>'); process.exit(2); }

// 等长或缩短替换表（缩短用 FF 截断 + 00 填充，不越下一字符串边界）
const REPLACEMENTS = [
	{ off: 0x8F3350, orig: 'New Game', cn: '新的游戏' },
	{ off: 0x8F3368, orig: 'Option', cn: '选项' },
];

const rom = fs.readFileSync(inFile);
let diff = 0;
for (const r of REPLACEMENTS) {
	const origHex = enc(r.orig).join('');
	const orig = Buffer.from(origHex, 'hex');
	const cur = rom.slice(r.off, r.off + orig.length + 1);
	if (!cur.slice(0, orig.length).equals(orig)) throw new Error(`0x${r.off.toString(16)} 现场不符: ${[...cur].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
	const bytes = Buffer.from(enc(r.cn).join('') + 'ff', 'hex');
	if (bytes.length > orig.length + 1) throw new Error(`${r.cn} 比原串长，拒绝覆盖`);
	rom.slice(r.off, r.off + orig.length + 1).fill(0);
	bytes.copy(rom, r.off);
	diff += orig.length + 1;
	console.log(`0x${r.off.toString(16)}: "${r.orig}" -> "${r.cn}" (${bytes.length}B)`);
}
fs.writeFileSync(outFile, rom);
console.log(`完成: ${outFile} (改动 ${diff} 字节)`);

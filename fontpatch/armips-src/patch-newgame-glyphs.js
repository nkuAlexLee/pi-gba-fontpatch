#!/usr/bin/env node
/**
 * patch-newgame.js — 把 Quetzal 测试版主菜单 "NEW GAME" 替换为 "新的游戏"
 *
 * 方案（字库位置选取 + 写入，无副作用）：
 * 1. 菜单字体数组基址 0x1400BF4（文件偏移），字形记录 64B/编码：
 *    记录地址 = 0x1400BF4 + code*64，布局 = [主体字形 32B][阴影层 32B]
 *    （公式已用 空格/A/E/G/M/N 六个编码交叉验证）
 * 2. 主菜单 "NEW GAME" 使用编码 N=0xC8 E=0xBF W=0xD1 G=0xC1 A=0xBB M=0xC7,
 *    空格=0x00；经扫描，编码 0x40-0x47 的 64B 记录全部为空（未使用字形）→ 空位
 * 3. 汉字字模来自 pokeE 的 gba_chs_font_11x11.bin（11x11 1bpp 连续位流）：
 *    glyphId = (hi修正)*0xF7 + lo，hi修正: 1-5→-1, 7-1A→-2, 1C-1E→-3
 * 4. 每个汉字 11x11 拆为左右两个整 8 像素对齐的字形（左=列0-7 右=列8-10补空），
 *    写入 0x40-0x47 空槽（主体 32B + 全透明阴影 32B）
 * 5. 字符串 "NEW GAME"(C8 BF D1 00 C1 BB C7 BF) 改为 [40 41 42 43 44 45 46 47]
 *
 * 零副作用：不覆盖任何原有字形。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_ROM = process.argv[2] || '../testfiles/PokemonQuetzalAlpha7v0测试.gba';
const OUT_ROM = process.argv[3] || 'tmp/PokemonQuetzalAlpha7v0测试_chs.gba';
const FONT_11 = 'D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeE/graphics/fonts/gba_chs_font_11x11.bin';

const rom = fs.readFileSync(path.resolve(__dirname, SRC_ROM));
const FONT_BASE = 0x1400BF4;   // 菜单字体数组基址（code 0x00 空格的字形）

/* ---------- 字形 LUT（来自 ROM 0x08369CF4 + 运行时 IWRAM dump） ---------- */
const LUT4 = rom.slice(0x369CF4, 0x369CF4 + 256);
const lut5 = (() => {
	const bytes = [];
	for (const line of fs.readFileSync(path.join(__dirname, 'tmp/lut5.hex'), 'utf8').split('\n')) {
		const m = line.match(/^([0-9A-F]{8}): ((?:[0-9a-f]{2} ?)+)/);
		if (m) for (const b of m[2].trim().split(/ /)) bytes.push(parseInt(b, 16));
	}
	return Buffer.from(bytes);
})();

function decodeRow(u16) {   // 行 u16 → 8 个 4bpp 像素 (0xA透明 0xB前景 0xC阴影)
	const w0 = lut5.readUInt16LE(LUT4[(u16 >> 8) & 0xFF] * 2);   // hi 字节 = 左 4 像素
	const w1 = lut5.readUInt16LE(LUT4[u16 & 0xFF] * 2);          // lo 字节 = 右 4 像素
	const px = [];
	for (const w of [w0, w1]) for (let p = 0; p < 4; p++) px.push((w >> (p * 4)) & 0xF);
	return px;
}

const encMap = new Map();    // 4 像素展开值 → 2bpp 源字节
for (let b = 0; b < 256; b++) {
	const w = lut5.readUInt16LE(LUT4[b] * 2);
	if (!encMap.has(w)) encMap.set(w, b);
}
function encodeRow(px) {     // 8 像素 → 行 u16
	let lv = 0, rv = 0;
	for (let i = 0; i < 4; i++) { lv |= px[i] << (i * 4); rv |= px[4 + i] << (i * 4); }
	const bHi = encMap.get(lv), bLo = encMap.get(rv);
	if (bHi === undefined || bLo === undefined) throw new Error('编码失败 ' + lv.toString(16) + '/' + rv.toString(16));
	return (bHi << 8) | bLo;
}

const BG = 0xA, FG = 0xB;

/* ---------- 编码器自测: 原版 N 字形像素级往返 ---------- */
const N_ADDR = FONT_BASE + 0xC8 * 64;
for (let r = 0; r < 16; r++) {
	const orig = rom.readUInt16LE(N_ADDR + r * 2);
	const px = decodeRow(orig);
	const re = encodeRow(px);
	if (JSON.stringify(px) !== JSON.stringify(decodeRow(re))) throw new Error('编码器自测失败 row ' + r);
}
console.log('编码器自测通过');

/* ---------- 汉字字模 (1bpp 11x11 连续位流, 16B/字) ---------- */
const cnFont = fs.readFileSync(FONT_11);
function glyphId(code) {
	let hi = code >> 8, lo = code & 0xFF;
	if (hi >= 0x1C) hi -= 3; else if (hi >= 0x07) hi -= 2; else hi -= 1;
	return hi * 0xF7 + lo;
}
function extractChar(code) {
	const base = glyphId(code) * 16;
	const m = [];
	for (let row = 0; row < 11; row++) {
		const line = [];
		for (let col = 0; col < 11; col++) line.push(getBit(base + row * 11 + col));
		m.push(line);
	}
	return m;
	function getBit(bitIdx) { return (cnFont[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1; }
}

/* ---------- 汉字半字 → 32B 字形 (整 8 像素对齐) ---------- */
// 每个汉字 11x11 → 左半(列0-7) + 右半(列8-10补空)，11 行垂直放在行 2-12
function makeHalf(matrix, leftHalf) {
	const data = Buffer.alloc(32, 0xF0);   // 透明行 (u16 = 0xFFF0)
	for (let r = 0; r < 11; r++) {
		const destRow = r + 2;
		const px = [];
		for (let i = 0; i < 8; i++) {
			const col = leftHalf ? i : 8 + i;          // 整 8 位: 左=列0-7 右=列8-15
			px.push(col < 11 && matrix[r][col] ? FG : BG);
		}
		data.writeUInt16LE(encodeRow(px), destRow * 2);
	}
	return data;
}

/* ---------- 主流程 ---------- */
// 1. 汉字提取
const chars = { '新': 0x0E4D, '的': 0x030B, '游': 0x0F7C, '戏': 0x0DDB };
const matrices = {};
for (const [ch, code] of Object.entries(chars)) {
	matrices[ch] = extractChar(code);
	console.log(ch + ' 字模提取 (glyphId=' + glyphId(code) + ')');
}

// 2. 扫描空槽（64B 全空），取 8 个连续的
function isFree(code) {
	const d = rom.slice(FONT_BASE + code * 64, FONT_BASE + code * 64 + 64);
	for (let j = 0; j < 64; j++) if (d[j] !== 0x00 && d[j] !== 0xFF) return false;
	return true;
}
const freeCodes = [];
for (let code = 0x40; code <= 0xFF - 8; code++) {
	let all = true;
	for (let k = 0; k < 8; k++) if (!isFree(code + k)) { all = false; code += k; break; }
	if (all) { for (let k = 0; k < 8; k++) freeCodes.push(code + k); break; }
}
if (freeCodes.length !== 8) throw new Error('未找到 8 个连续空槽');
console.log('空槽: 0x' + freeCodes.map(c => c.toString(16).padStart(2, '0')).join(' 0x') +
	' (记录地址 0x08' + (FONT_BASE + freeCodes[0] * 64).toString(16).toUpperCase() + ')');

// 3. 写入字形（主体 32B + 全透明阴影 32B）
const halves = [
	[matrices['新'], true], [matrices['新'], false],
	[matrices['的'], true], [matrices['的'], false],
	[matrices['游'], true], [matrices['游'], false],
	[matrices['戏'], true], [matrices['戏'], false],
];
freeCodes.forEach((code, i) => {
	const addr = FONT_BASE + code * 64;
	makeHalf(halves[i][0], halves[i][1]).copy(rom, addr);                 // 主体
	const transparent = Buffer.alloc(32, 0xF0);
	transparent.copy(rom, addr + 32);                                     // 阴影层 = 透明
	console.log('字形写入 0x' + (FONT_BASE + code * 64).toString(16).toUpperCase() + ' (code 0x' + code.toString(16) + ')');
});

// 4. 修改字符串 "NEW GAME" → 8 个新编码
const pattern = Buffer.from([0xC8, 0xBF, 0xD1, 0x00, 0xC1, 0xBB, 0xC7, 0xBF, 0xFF]);
const hits = [];
for (let i = 0; i <= rom.length - pattern.length; i++) {
	let ok = true;
	for (let j = 0; j < pattern.length; j++) {
		if (rom[i + j] !== pattern[j]) { ok = false; break; }
	}
	if (ok) hits.push(i);
}
console.log('"NEW GAME" 字符串位置:', hits.map(h => '0x08' + h.toString(16).toUpperCase()));
if (hits.length === 0) throw new Error('未找到 NEW GAME 字符串');
for (const h of hits) {
	for (let k = 0; k < 8; k++) rom[h + k] = freeCodes[k];
	// 末尾 0xFF 终止符保持不变
}

// 5. 保存
fs.mkdirSync(path.dirname(path.resolve(__dirname, OUT_ROM)), { recursive: true });
fs.writeFileSync(path.resolve(__dirname, OUT_ROM), rom);
console.log('OK 补丁完成 →', OUT_ROM);

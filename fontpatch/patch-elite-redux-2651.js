#!/usr/bin/env node
/**
 * patch-elite-redux-2651.js — 给 Elite Redux 2.65.1 主菜单打中文（字体数组槽位注入，方案 B）
 *
 * 用法: node patch-elite-redux-2651.js [源ROM] [输出ROM] [汉字1 汉字2 汉字3]
 * 默认: testfiles 的 2.65.1 ROM → tmp/EliteRedux_chs_v3.gba, "新游戏"
 *
 * 原理（正向分析确定，全部经 romctl 探针实证）:
 * 1. FONT_NORMAL（菜单字体）字形数组 @0x09067D18（文件 0x1067D18）：
 *    直接按 charmap 码索引，64B/字 = [左上16B][右上16B][左下16B][右下16B]
 *    每 tile 8 行 u16：高字节 = px0-3（每像素 2bpp，MSB pair first），低字节 = px4-7
 *    2bpp 值：1=前景 2=阴影 0/3=透明
 * 2. 宽度表 @文件 0x106FD18
 * 3. 空槽：码 0x0A / 0x18 / 0x1F（字形全零、宽度 0，引擎正常路径直接可用）
 * 4. 主菜单 "New Game" @文件 0xEFB11C → 3 个单字节码 + FF
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'D:/vibecoding/gba-font-cracker-js/testfiles/Pokémon Elite Redux (2.65.1 beta reupload).gba';
const OUT = process.argv[3] || path.join(__dirname, '../tmp/EliteRedux_chs_v3.gba');
const FONT_11 = 'D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeE/graphics/fonts/gba_chs_font_11x11.bin';
const wholewords = fs.readFileSync('D:/vibecoding/gba-font-cracker-js/fonts/wholewords.txt', 'utf8');

// 码表：汉字 -> 双字节编码
const codeMap = new Map();
for (const line of wholewords.split('\n')) {
	const m = line.match(/^([0-9A-Fa-f]{4})=(.+)$/);
	if (m) codeMap.set(m[2], parseInt(m[1], 16));
}

const rom = fs.readFileSync(SRC);
const FONT = 0x1067D18, WIDTH = 0x106FD18, STR = 0xEFB11C;
const cnf = fs.readFileSync(FONT_11);
const chars = process.argv.slice(4).length ? process.argv.slice(4) : ['新', '游', '戏'];
const freeSlots = [0x0A, 0x18, 0x1F];
if (chars.length > freeSlots.length) throw new Error('空闲码只有 3 个: 0x0A/0x18/0x1F');

// ---- 1. 字模提取（11x11 1bpp, 16B/字）----
function extract(cnCode) {
	const hi = cnCode >> 8, lo = cnCode & 0xFF;
	const gid = (hi >= 0x1C ? hi - 3 : hi >= 0x07 ? hi - 2 : hi - 1) * 0xF7 + lo;
	const o = gid * 16;
	const m = [];
	for (let r = 0; r < 11; r++) {
		const row = [];
		for (let c = 0; c < 11; c++) {
			const bit = r * 11 + c;
			row.push((cnf[o + (bit >> 3)] >> (7 - (bit & 7))) & 1);
		}
		m.push(row);
	}
	return m;
}

// ---- 2. 编码为引擎字形（4 个 8x8 tile, 每像素 2bpp, 1=前景）----
function packTileRow(px8) {
	// ⚠ 每像素 2 位: px0 在 bits7:6 ... px3 在 bits1:0
	return ((px8[0] << 6 | px8[1] << 4 | px8[2] << 2 | px8[3]) << 8)
	     | (px8[4] << 6 | px8[5] << 4 | px8[6] << 2 | px8[7]);
}
function buildGlyph(matrix) {
  // 16x16 画布: 1=前景 2=阴影 0=透明; V_OFF=2 垂直居中
  const H_OFF = 1, V_OFF = 2;
  const px = Array.from({length: 16}, () => new Array(16).fill(0));
  for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++)
    if (matrix[r][c]) px[r + V_OFF][c + H_OFF] = 1;
  // 右下阴影（与拉丁字形风格一致，N 字形实证 shadow=(r+1,c+1)）
  for (let r = 15; r >= 0; r--) for (let c = 15; c >= 0; c--)
    if (px[r][c] === 1 && r+1 < 16 && c+1 < 16 && px[r+1][c+1] === 0) px[r+1][c+1] = 2;
  const g = Buffer.alloc(64);
  for (let r = 0; r < 16; r++) {
    const qRow = r < 8 ? r : r - 8, top = r < 8 ? 0 : 32;
    g.writeUInt16LE(packTileRow(px[r].slice(0, 8)),  top + qRow * 2);
    g.writeUInt16LE(packTileRow(px[r].slice(8, 16)), top + 16 + qRow * 2);
  }
  return g;
}

// ---- 3. 写入空槽 ----
const codes = [];
for (let i = 0; i < chars.length; i++) {
	const cnCode = codeMap.get(chars[i]);
	if (cnCode === undefined) throw new Error('码表中无此字: ' + chars[i]);
	const code = freeSlots[i];
	buildGlyph(extract(cnCode)).copy(rom, FONT + code * 64);
	rom[WIDTH + code] = 12;   // 11px 字形 + 1px 间距
	codes.push(code);
	console.log(`${chars[i]} (0x${cnCode.toString(16)}) -> 码 0x${code.toString(16)} @0x${(FONT + code * 64).toString(16)}`);
}

// ---- 4. 改菜单字符串（等长内改短 + 00 填充）----
rom[STR] = codes[0];
for (let i = 1; i < codes.length; i++) rom[STR + i] = codes[i];
rom[STR + codes.length] = 0xFF;
for (let i = codes.length + 1; i < 9; i++) rom[STR + i] = 0x00;
console.log('菜单字符串已替换 @0x' + STR.toString(16));

fs.writeFileSync(OUT, rom);
console.log('OK ->', OUT);

#!/usr/bin/env node
/**
 * Elite Redux 2.65.1 中文菜单注入（方案 B 字体数组槽位注入，skill 自带封装）
 *
 * 用法:
 *   node scripts/patch-elite-redux-2651.js [源ROM] [输出ROM] [汉字...]    # ≤3 个字
 * 默认: testfiles 的 2.65.1 ROM → gbajs2/tmp/EliteRedux_chs_v6.gba，"新游戏"
 *
 * 原理（正向分析 + 探针实证，详见 cases/EliteRedux-正向分析实录.md）:
 * - FONT_NORMAL 字形数组 @文件 0x1067D18：直接按 charmap 码索引，
 *   64B/字 = [左上16B][右上16B][左下16B][右下16B] 四个 8x8 tile，
 *   每行 u16：高字节 = px0-3（每像素 2bpp，MSB pair first），低字节 = px4-7
 *   2bpp 值：1=前景 2=阴影 0/3=透明
 * - 宽度表 @文件 0x106FD18；宽度 12 = 中文占两个英文字符位
 * - 空槽：0x0A/0x18/0x1F（0xF8-0xFF 是控制码，0x00 是空格，均不可用）
 * - 菜单字符串 "New Game" @文件 0xEFB11C → 单字节码 + FF + 00 填充
 * - 排版: H_OFF=1（11px 内容放 col1-11，防 12px 步进裁右列）、V_OFF=2（垂直居中）、
 *   右下阴影 shadow=(r+1,c+1)（与拉丁字形风格一致）
 *
 * 成功校验（NEW GAME 范式）:
 *   node romctl.js load <输出ROM> && node romctl.js run 3600 && node romctl.js run 1500
 *   node romctl.js key START 60 && node romctl.js run 600
 *   node romctl.js screenshot tmp/menu.bmp
 *   node scripts/bmp-ascii.js tmp/menu.bmp 8 4 120 26   # 应看到注入的汉字
 */
'use strict';
const fs = require('fs');
const path = require('path');

const GBAJS2 = path.join(__dirname, '../../../..');   // gbajs2/
const ROOT = path.join(GBAJS2, '..');             // 仓库根（含 testfiles/）
const SRC = process.argv[2] || path.join(ROOT, 'testfiles/Pokémon Elite Redux (2.65.1 beta reupload).gba');
const OUT = process.argv[3] || path.join(GBAJS2, 'tmp/EliteRedux_chs_v6.gba');
const FONT_11 = path.join(__dirname, '../assets/gba_chs_font_11x11.bin');
const wholewords = fs.readFileSync(path.join(__dirname, '../assets/wholewords.txt'), 'utf8');

// 码表：汉字 -> 双字节编码
const codeMap = new Map();
for (const line of wholewords.split('\n')) {
	const m = line.trim().match(/^([0-9A-Fa-f]{4})=(.+)$/);
	if (m && !m[2].startsWith('[')) codeMap.set(m[2].trim(), parseInt(m[1], 16));
}

const rom = fs.readFileSync(SRC);
const FONT = 0x1067D18, WIDTH = 0x106FD18, STR = 0xEFB11C;
const cnf = fs.readFileSync(FONT_11);
const chars = process.argv.slice(4).length ? process.argv.slice(4) : ['新', '游', '戏'];
const freeSlots = [0x0A, 0x18, 0x1F];
if (chars.length > freeSlots.length) throw new Error('空闲码只有 3 个: 0x0A/0x18/0x1F');

// ---- 1. 字模提取（11x11 1bpp, 16B/字, bit7=左）----
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

// ---- 2. 编码为引擎字形（每像素 2 位！自检回路见 main 尾部）----
function packTileRow(px8) {
	return ((px8[0] << 6 | px8[1] << 4 | px8[2] << 2 | px8[3]) << 8)
	     | (px8[4] << 6 | px8[5] << 4 | px8[6] << 2 | px8[7]);
}
function buildGlyph(matrix) {
	const H_OFF = 1, V_OFF = 2;
	const px = Array.from({ length: 16 }, () => new Array(16).fill(0));
	for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++)
		if (matrix[r][c]) px[r + V_OFF][c + H_OFF] = 1;
	// 右下阴影（与拉丁字形风格一致，'N' 字形实证 shadow=(r+1,c+1)）
	for (let r = 15; r >= 0; r--) for (let c = 15; c >= 0; c--)
		if (px[r][c] === 1 && r + 1 < 16 && c + 1 < 16 && px[r + 1][c + 1] === 0) px[r + 1][c + 1] = 2;
	const g = Buffer.alloc(64);
	for (let r = 0; r < 16; r++) {
		const qRow = r < 8 ? r : r - 8, top = r < 8 ? 0 : 32;
		g.writeUInt16LE(packTileRow(px[r].slice(0, 8)),  top + qRow * 2);       // 左半 tile
		g.writeUInt16LE(packTileRow(px[r].slice(8, 16)), top + 16 + qRow * 2);  // 右半 tile
	}
	return g;
}
// 解码（自检用，与引擎读法一致）
function decodeGlyph(g) {
	const out = [];
	for (let r = 0; r < 16; r++) {
		let line = '';
		for (let t = 0; t < 2; t++) {
			const w = g.readUInt16LE((r < 8 ? 0 : 32) + t * 16 + (r < 8 ? r : r - 8) * 2);
			const hi = w >> 8, lo = w & 0xFF;
			const pxs = [(hi >> 6) & 3, (hi >> 4) & 3, (hi >> 2) & 3, hi & 3, (lo >> 6) & 3, (lo >> 4) & 3, (lo >> 2) & 3, lo & 3];
			line += pxs.map(v => v === 1 ? '#' : (v === 2 ? 'o' : '.')).join('');
		}
		out.push(line);
	}
	return out;
}

// ---- 3. 写入空槽 ----
const codes = [];
const glyphs = [];
for (let i = 0; i < chars.length; i++) {
	const cnCode = codeMap.get(chars[i]);
	if (cnCode === undefined) throw new Error('码表中无此字: ' + chars[i] + '（检查 assets/wholewords.txt）');
	const code = freeSlots[i];
	const g = buildGlyph(extract(cnCode));
	g.copy(rom, FONT + code * 64);
	rom[WIDTH + code] = 12;
	codes.push(code);
	glyphs.push(g);
	console.log(`${chars[i]} (0x${cnCode.toString(16)}) -> 码 0x${code.toString(16)} @0x${(FONT + code * 64).toString(16)}`);
}

// ---- 4. 自检回路：前景像素必须逐一对上（阴影像素是刻意添加的，不算失败）----
for (let i = 0; i < chars.length; i++) {
	const src = extract(codeMap.get(chars[i]));
	const dec = decodeGlyph(glyphs[i]);
	for (let r = 0; r < 11; r++) for (let c = 0; c < 11; c++) {
		const v = dec[r + 2][c + 1];
		if (src[r][c] && v !== '#') throw new Error(`自检失败: ${chars[i]} row${r + 2} col${c + 1} 前景丢失 (解码=${v})`);
	}
}
console.log('自检通过: 源字模前景像素全部保留（含右下阴影）');

// ---- 5. 改菜单字符串（等长内改短 + 00 填充）----
rom[STR] = codes[0];
for (let i = 1; i < codes.length; i++) rom[STR + i] = codes[i];
rom[STR + codes.length] = 0xFF;
for (let i = codes.length + 1; i < 9; i++) rom[STR + i] = 0x00;
console.log('菜单字符串已替换 @0x' + STR.toString(16));

fs.writeFileSync(OUT, rom);
console.log('OK ->', OUT);

#!/usr/bin/env node
/**
 * patch-xtreme-chs.js — Pokemon Emerald XTREME (v100 rev-3) 中文字库注入（v2 槽位注入）
 *
 * 原理（方案 B，纯数据补丁，零代码注入，与原版渲染 100% 同路径）：
 *  - RenderText @0x08234AC0 → fontid 分发（window[0x23]&0xF）→ fontid1 主字体 handler
 *    @0x08234E28：字形槽 = charId(单字节)×64 @0x08C22508，槽 = [TL 16B][TR 16B][BL 16B][BR 16B]，
 *    每 tile = 8 行 × u16 LE，MSB-pair-first 2bpp：0=透明 1/2=影/AA 3=墨；
 *    宽度表 @0x08C22308（1B/码），width>8 走宽路径（4 tile 全用，16×16）。
 *  - 码位 0x87-0x9F：charmap 未定义、字形全零、宽度 3 —— 安全空槽（25 个）。
 *  - 注入汉字 11x11 居中（内容 12x13 含影），width=12。
 *  - 主菜单字符串 "NEW GAME"→"新的游戏"、"OPTION"→"选项"。
 *
 * 用法: node patch-xtreme-chs.js [in.gba] [out.gba]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const IN = process.argv[2] || ['../../testfiles/','../../../../../../testfiles/','../../../../../../../testfiles/'].map(p => path.join(__dirname, p, 'Pokemon Emerald XTREME (v100 rev-3).gba')).find(p => fs.existsSync(p));
let OUT = process.argv[3] || '../tmp/XTREME_chs.gba';
if (!process.argv[3] && !fs.existsSync(path.dirname(path.join(__dirname, OUT)))) {
	OUT = path.join(__dirname, 'XTREME_chs.gba'); // 归档副本无上级 tmp 时写到脚本旁
}

/* ---------- 配置 ---------- */
const FONT_ARRAY = 0xC22508; // fontid1 字形数组（槽 = code*64）
const WIDTH_TBL  = 0xC22308; // fontid1 宽度表（1B/码）
const STR_NEWWGAME = 0xBA9200; // "NEW GAME\0GAME..." 区域 12B
const STR_OPTION   = 0xBA9210; // "OPTION\0.." 区域 8B
const CH_WIDTH = 12;
const CODE_BASE = 0x87;
const CHARS = [ // [码表码, 显示用注释]
	[0x0E4D, '新'], [0x030B, '的'], [0x0F7C, '游'], [0x0DDB, '戏'],
	[0x0E8A, '选'], [0x0E1B, '项'],
];

/* ---------- 工具 ---------- */
const hex = v => '0x' + v.toString(16);
function fixHi(hi) {
	if (hi >= 0x01 && hi <= 0x05) return hi - 1;
	if (hi >= 0x07 && hi <= 0x1A) return hi - 2;
	if (hi >= 0x1C && hi <= 0x1E) return hi - 3;
	if (hi === 0x06 || hi === 0x1B) throw new Error('码表码含控制字节 0x' + hi.toString(16));
	return hi;
}
function glyph11(fontBuf, code) {
	// pokeE 官方索引：glyphId = (hi-修正)*0xF7 + lo（NOT ×256！×256 会定位到别的字）
	const id = (fixHi(code >> 8) * 0xF7 + (code & 0xFF)) >>> 0;
	// 11x11 点阵：每行 11bit 顺序打包（MSB first），16B/字
	let bits = '';
	for (let i = 0; i < 16; i++) bits += fontBuf[id * 16 + i].toString(2).padStart(8, '0');
	const g = [];
	for (let r = 0; r < 11; r++) {
		const row = [];
		for (let c = 0; c < 11; c++) row.push(bits[r * 11 + c] === '1' ? 1 : 0);
		g.push(row);
	}
	return g;
}

/* ---------- 主流程 ---------- */
const rom = Buffer.from(fs.readFileSync(IN));
if (rom.length !== 0x2000000) throw new Error('ROM 大小异常');

// 安全检查：目标码位字形必须全零
for (let k = 0; k < CHARS.length; k++) {
	const code = CODE_BASE + k;
	const slot = rom.slice(FONT_ARRAY + code * 64, FONT_ARRAY + code * 64 + 64);
	if (!slot.every(b => b === 0)) throw new Error(`码位 ${hex(code)} 字形非空，不可用`);
}

// 路径回退：工作副本(fontpatch/) 与归档副本(cases/*/scripts/) 均可独立运行
const fontPath = ['../.pi/skills/gba-font-crack/assets/gba_chs_font_11x11.bin',
                  '../../../../../assets/gba_chs_font_11x11.bin',
	                  '../../../../../../.pi/skills/gba-font-crack/assets/gba_chs_font_11x11.bin']
	.map(p => path.join(__dirname, p)).find(p => fs.existsSync(p));
if (!fontPath) throw new Error('找不到 gba_chs_font_11x11.bin');
const fontBuf = fs.readFileSync(fontPath);

CHARS.forEach(([code], k) => {
	const codeB = CODE_BASE + k;
	const mat = glyph11(fontBuf, code);

	// 16x16 网格：字形 11x11 居中 (col 0-10, row 2-12)，影=右下 1px（值 2）；墨=1（实证：1=深色，2/3=灰）
	const grid = Array.from({ length: 16 }, () => Array(16).fill(0));
	for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
		if (mat[y][x]) {
			grid[y + 2][x] = 1;
			if (grid[y + 3][x + 1] === 0) grid[y + 3][x + 1] = 2;
		}
	}
	// 4 tile：TL=行0-7列0-7, TR=行0-7列8-15, BL=行8-15列0-7, BR=行8-15列8-15
	const tile = (r0, c0) => {
		const b = Buffer.alloc(16);
		for (let r = 0; r < 8; r++) {
			let u = 0;
			for (let p = 0; p < 8; p++) u |= (grid[r0 + r][c0 + p] || 0) << (14 - 2 * p);
			b[r * 2] = u & 0xFF; b[r * 2 + 1] = u >> 8;
		}
		return b;
	};
	const TL = tile(0, 0), TR = tile(0, 8), BL = tile(8, 0), BR = tile(8, 8);

	// 自检：tile 解码 → 与网格逐像素比对
	const dec = b => Array.from({ length: 8 }, (_, r) => {
		const u = b[r * 2] | (b[r * 2 + 1] << 8);
		return Array.from({ length: 8 }, (_, p) => ((u >> (14 - 2 * p)) & 3));
	});
	const dTL = dec(TL), dTR = dec(TR), dBL = dec(BL), dBR = dec(BR);
	for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
		const dv = y < 8 ? (x < 8 ? dTL[y][x] : dTR[y][x - 8]) : (x < 8 ? dBL[y - 8][x] : dBR[y - 8][x - 8]);
		if (dv !== (grid[y][x] || 0)) {
			console.error(`自检失败 ${hex(code)} (${x},${y}) 期望 ${grid[y][x]} 实得 ${dv}`);
			process.exit(1);
		}
	}
	// 二级自检：网格墨点 ↔ 源字形
	for (let y = 0; y < 11; y++) for (let x = 0; x < 11; x++) {
		if (!!mat[y][x] !== (grid[y + 2][x] === 1)) {
			console.error(`网格对齐失败 ${hex(code)} (${x},${y})`);
			process.exit(1);
		}
	}

	// 写入
	const off = FONT_ARRAY + codeB * 64;
	TL.copy(rom, off); TR.copy(rom, off + 16); BL.copy(rom, off + 32); BR.copy(rom, off + 48);
	rom[WIDTH_TBL + codeB] = CH_WIDTH;
	console.log(`自检通过 code=${hex(codeB)} '${CHARS[k][1]}'`);
});

// 字符串替换（等长或缩短 + FF 截断 + 00 填充）
Buffer.from([CODE_BASE, CODE_BASE + 1, CODE_BASE + 2, CODE_BASE + 3, 0xFF, 0, 0, 0, 0, 0, 0, 0])
	.copy(rom, STR_NEWWGAME); // 新的游戏
Buffer.from([CODE_BASE + 4, CODE_BASE + 5, 0xFF, 0, 0, 0, 0, 0])
	.copy(rom, STR_OPTION);   // 选项

fs.writeFileSync(OUT, rom);
console.log('OK 已生成', OUT);

'use strict';
/**
 * merge-charmap.js — 合并码表：wholewords(Quetzal 优先) + pokeE 规范表补缺 → charmap-base.txt
 *
 * 数据源：
 *   A. gba-font-crack/assets/wholewords.txt   — Quetzal 实测码表（中文双字节 + 部分控制码）
 *   B. Pokemon_GBA_Font_Patch-main/pokeE/PMRSEFRLG_charmap.txt — pokeE 规范表（标点/符号/控制码更全）
 *
 * 规则：
 *   1. A 全部保留（优先）；B 仅补 A 缺失的条目
 *   2. B 的 {xx} 花括号统一转为 [xx]（与工程占位符约定一致）
 *   3. 已知但语义未知的控制码显式标 [unk:xx]（如 fd05），翻译时按 token 原样保留
 *   4. 汉字双字节条目照搬 A
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC_A = path.resolve(__dirname, '../../gba-font-crack/assets/wholewords.txt');
const SRC_B = 'D:/vibecoding/Pokemon_GBA_Font_Patch-main/pokeE/PMRSEFRLG_charmap.txt';
const OUT = path.resolve(__dirname, '../assets/charmap-base.txt');

function parseMap(file, toBracket) {
	const map = new Map();   // code -> text
	for (let line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
		line = line.replace(/^\uFEFF/, '');
		if (!line || line.startsWith('/') || line.startsWith('#') || line.startsWith(';')) continue;
		const eq = line.indexOf('=');
		if (eq < 1) continue;
		const code = line.slice(0, eq).trim().toLowerCase();
		let text = line.slice(eq + 1);
		if (!/^[0-9a-f]{2}$|^[0-9a-f]{4}$|^[0-9a-f]{6}$/.test(code)) continue;
		if (toBracket) text = text.replace(/\{([^}]*)\}/g, '[$1]');
		if (!map.has(code)) map.set(code, text);
	}
	return map;
}

const A = parseMap(SRC_A, false);
const B = parseMap(SRC_B, true);

// 已知但语义未定的控制码（Emerald 家族观察到、语义待实证）
const KNOWN_UNKNOWN = { fd05: '[unk:fd05]' };

let added = 0;
for (const [code, text] of B) {
	if (A.has(code)) continue;
	A.set(code, text);
	added++;
}
for (const [code, text] of Object.entries(KNOWN_UNKNOWN)) {
	if (!A.has(code)) { A.set(code, text); added++; }
}

const lines = [
	'/ charmap-base.txt — gba-text-translate 基准码表',
	'/ = wholewords(Quetzal 实测) + pokeE PMRSEFRLG 补缺（标点/符号/箭头/控制码）',
	'/ 占位符统一 [] 风格；fd05 语义未实证，标 [unk:fd05]，翻译时原样保留',
	'/ FF = 串终止符（不列入）',
	'',
];
for (const [code, text] of A) lines.push(code + '=' + text);
fs.writeFileSync(OUT, lines.join('\n') + '\n');
console.log(`✔ 基准码表 → ${OUT}`);
console.log(`  A(wholewords) ${A.size - added} 条 + B 补缺 ${added} 条 = ${A.size} 条`);

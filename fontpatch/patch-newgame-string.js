#!/usr/bin/env node
/**
 * patch-newgame-string.js — 把主菜单 "NEW GAME" 改为 "新的游戏"
 *
 * 基座: roms/PokemonQuetzalAlpha7v0(字库).gba（已实现中文引擎的 Quetzal）
 *
 * 原理: 中文采用双字节编码（高位在前），编码与 fonts/wholewords.txt 码表一致：
 *   新 = 0x0E4D → 文本字节 0E 4D
 *   的 = 0x030B → 03 0B
 *   游 = 0x0F7C → 0F 7C
 *   戏 = 0x0DDB → 0D DB
 * 字库版引擎的中文判断: RenderText+0xBA 处 hook，currChar ∈ 0x01-0x1E
 * （排除 0/6）即中文高位字节，低位 < 0xF7。
 *
 * ⚠ 不要用 armips 移植 pokeE 补丁到 Quetzal 原版：Quetzal 是 decomp 重编译，
 *   函数地址虽与 stock Emerald 一致，但指令排布不同，hook 跳转会错乱（实测崩溃）。
 *   fontpatch/armips-src/ 里保留了那次移植的资料供研究。
 *
 * 用法: node patch-newgame-string.js [输入ROM] [输出ROM]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '../roms/PokemonQuetzalAlpha7v0(字库).gba');
const OUT = process.argv[3] || path.join(__dirname, '../tmp/PokemonQuetzal字库版_新的游戏.gba');
const STR_OFF = 0x137E070;   // 主菜单 "NEW GAME" 字符串（原版实测）

const rom = fs.readFileSync(path.resolve(__dirname, SRC));

const oldStr = rom.slice(STR_OFF, STR_OFF + 9);
const expected = Buffer.from([0xC8, 0xBF, 0xD1, 0x00, 0xC1, 0xBB, 0xC7, 0xBF, 0xFF]);  // "NEW GAME"+FF
if (!oldStr.equals(expected)) {
	console.error('字符串不匹配 @0x' + STR_OFF.toString(16) + ': ' + oldStr.toString('hex') +
		'\n（基座 ROM 是否已包含中文字库引擎？）');
	process.exit(1);
}

// 新的游戏 = 0E4D 030B 0F7C 0DDB + 终止符 FF
Buffer.from([0x0E, 0x4D, 0x03, 0x0B, 0x0F, 0x7C, 0x0D, 0xDB, 0xFF]).copy(rom, STR_OFF);
fs.writeFileSync(path.resolve(OUT), rom);
console.log('OK 主菜单已改为 "新的游戏" →', path.resolve(OUT));

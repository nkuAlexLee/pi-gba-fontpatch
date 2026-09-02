#!/usr/bin/env node
/**
 * NEW GAME 截图校验工具（skill 自带）
 * 把 romctl 截出的 24bpp BMP 渲染成 ASCII，用于像素级核对菜单文字。
 *
 * 用法:
 *   node scripts/bmp-ascii.js <screenshot.bmp>                 # 全屏 ASCII
 *   node scripts/bmp-ascii.js <screenshot.bmp> x y w h         # 指定区域
 *   node scripts/bmp-ascii.js <screenshot.bmp> --bbox          # 只输出墨迹包围盒
 *
 * 阈值: 亮度 <100 = '#'(前景墨), <180 = '+'(中间调/阴影), 其余 = '.'
 */
'use strict';
const fs = require('fs');

const buf = fs.readFileSync(process.argv[2]);
if (buf.toString('ascii', 0, 2) !== 'BM') { console.error('不是 BMP'); process.exit(1); }
const off = buf.readUInt32LE(10);
const w = buf.readInt32LE(18), h = buf.readInt32LE(22);
const rowSize = Math.floor((24 * w + 31) / 32) * 4;
const lum = (x, y) => {
	const o = off + (h - 1 - y) * rowSize + x * 3;
	return (buf[o] + buf[o + 1] + buf[o + 2]) / 3;
};
const ch = l => l < 100 ? '#' : l < 180 ? '+' : '.';

if (process.argv.includes('--bbox')) {
	let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1;
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
		if (lum(x, y) < 100) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
	console.log(`ink bbox: x ${minX}-${maxX}, y ${minY}-${maxY} (${maxX - minX + 1}x${maxY - minY + 1})`);
	process.exit(0);
}

const hasRegion = process.argv.length >= 7 && !isNaN(parseInt(process.argv[3], 10));
const x0 = hasRegion ? parseInt(process.argv[3], 10) : 0;
const y0 = hasRegion ? parseInt(process.argv[4], 10) : 0;
const x1 = hasRegion ? Math.min(w, x0 + parseInt(process.argv[5], 10)) : w;
const y1 = hasRegion ? Math.min(h, y0 + parseInt(process.argv[6], 10)) : h;

for (let y = y0; y < y1; y++) {
	let line = '';
	for (let x = x0; x < x1; x++) line += ch(lum(x, y));
	console.log(line);
}

// 在 VRAM 中搜索 新 的窗口瓦片，指纹化 scramble 方式
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const ROOT = __dirname + '/..';

function rd(addr, len) {
	const out = execSync(`node romctl.js memread ${addr} ${len}`, {
		cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore']
	}).toString();
	const bytes = [];
	for (const l of out.split('\n')) {
		const m = l.match(/[0-9a-fA-F]{8}: ((?:[0-9a-fA-F]{2} )+)/);
		if (m) for (const b of m[1].trim().split(' ')) bytes.push(parseInt(b, 16));
	}
	return bytes;
}

const LUT4 = [...fs.readFileSync(ROOT + '/tmp/lut4.bin')];
const LUT3b = [...fs.readFileSync(ROOT + '/tmp/lut3.bin')];
const LUT3hw = [];
for (let i = 0; i + 1 < LUT3b.length; i += 2) LUT3hw.push(LUT3b[i] | (LUT3b[i + 1] << 8));

const rom = fs.readFileSync(ROOT + '/fontpatch/er_probe.gba');
const FONTSRC = 0x168A4D8; // er_probe 里字库文件偏移
const rec = 0x0C4D;        // 新

// LDRH 展开单行: u32 = (LUT3hw[LUT4[lo]]<<16)|LUT3hw[LUT4[hi]]
function expandRow(v) {
	const hi = (v >> 8) & 0xFF, lo = v & 0xFF;
	return ((LUT3hw[LUT4[lo]] << 16) | LUT3hw[LUT4[hi]]) >>> 0;
}

// chunk k = 16B = 8 行 → tile 32B (8×u32)
const tiles = [];
for (let k = 0; k < 4; k++) {
	const t = [];
	for (let r = 0; r < 8; r++) {
		const v = rom.readUInt16LE(FONTSRC + rec * 64 + k * 16 + r * 2);
		t.push(...[
			(expandRow(v) >>> 0) & 0xFF,
			(expandRow(v) >>> 8) & 0xFF,
			(expandRow(v) >>> 16) & 0xFF,
			(expandRow(v) >>> 24) & 0xFF
		]);
	}
	tiles.push(Buffer.from(t));
}
console.log('期望 tile0 前16B:', tiles[0].slice(0, 16).toString('hex'));

// scramble 变体
const variants = {
	'TL/TR/BL/BR(行主序·预期)': [tiles[0], tiles[1], tiles[2], tiles[3]],
	'TL/BL/TR/BR(列主序)': [tiles[0], tiles[2], tiles[1], tiles[3]],
	'TR/TL/BR/BL(half交换)': [tiles[1], tiles[0], tiles[3], tiles[2]],
	'BL/BR/TL/TR(块对调)': [tiles[2], tiles[3], tiles[0], tiles[1]],
};
for (const [name, tt] of Object.entries(variants)) {
	const full = Buffer.concat(tt);
	console.log(name, '前16B:', full.slice(0, 16).toString('hex'));
}
fs.writeFileSync(ROOT + '/tmp/vwant.txt', Object.entries(variants).map(([n, t]) => n + ':' + Buffer.concat(t).toString('hex')).join('\n'));

// 扫 VRAM 0x06000000-0x0600C000，每块 512B
const vram = [];
for (let a = 0x06000000; a < 0x0600C000; a += 0x200) {
	const chunk = rd('0x' + a.toString(16), 0x200);
	vram.push({ addr: a, bytes: chunk });
}
const vbuf = Buffer.concat(vram.map(v => Buffer.from(v.bytes)));
console.log('VRAM 读出:', vbuf.length, 'B');

// 在 VRAM 中找各变体 tile0 的前 8B
for (const [name, tt] of Object.entries(variants)) {
	const pat = tt[0].slice(0, 8);
	const hits = [];
	for (let i = 0; i + 8 <= vbuf.length; i += 4) {
		if (vbuf[i] === pat[0] && vbuf[i + 1] === pat[1] && vbuf[i + 2] === pat[2] && vbuf[i + 3] === pat[3] &&
			vbuf[i + 4] === pat[4] && vbuf[i + 5] === pat[5] && vbuf[i + 6] === pat[6] && vbuf[i + 7] === pat[7]) {
			hits.push('0x' + (0x06000000 + i).toString(16));
			if (hits.length >= 4) break;
		}
	}
	console.log(name, '→ tile0 命中:', hits.length ? hits.join(' ') : '无');
}
// 额外: 搜 tile1..3 每个的独立命中(不受排列假设约束)
for (let k = 0; k < 4; k++) {
	const pat = tiles[k].slice(0, 8);
	const hits = [];
	for (let i = 0; i + 8 <= vbuf.length; i += 4) {
		let ok = true;
		for (let j = 0; j < 8; j++) if (vbuf[i + j] !== pat[j]) { ok = false; break; }
		if (ok) { hits.push('0x' + (0x06000000 + i).toString(16)); if (hits.length >= 4) break; }
	}
	console.log('chunk' + k, '独立命中:', hits.length ? hits.join(' ') : '无');
}

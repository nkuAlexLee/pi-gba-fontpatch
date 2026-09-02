#!/usr/bin/env node
/**
 * watch-read.js — 监视对指定内存区间的读取，记录读取者的 PC。
 * 用于定位"谁在读字符串/字形数据"，是异版本引擎定位的终极手段。
 *
 * 用法: node watch-read.js <lo> <hi> <frames> [out.json]
 *   lo/hi   监视的内存地址闭区间（支持 0x08xxxxxx ROM 或 RAM）
 *   frames  最多跑多少帧（读到即提前结束）
 *
 * 前置：tmp/romctl.state.json 已是目标画面状态（用 romctl 调好）。
 * 注意：首次命中后继续记录 N 条读取（含 PC），足够回溯调用者。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [loArg, hiArg, framesArg, outArg, keysArg] = process.argv.slice(2);
const KEYS = String(keysArg || '').toUpperCase().split(',').filter(Boolean);
if (!loArg || !hiArg) { console.error('用法: node watch-read.js <lo> <hi> <frames> [out.json]'); process.exit(2); }
const LO = parseInt(loArg, 16) >>> 0, HI = parseInt(hiArg, 16) >>> 0;
const MAX_FRAMES = parseInt(framesArg || '600', 10);
const OUT = outArg || path.join(__dirname, '../../../tmp/watch-read.json');
const MAX_HITS = 200;

const SCRIPTS = [
	'js/util.js', 'js/core.js', 'js/arm.js', 'js/thumb.js', 'js/mmu.js',
	'js/io.js', 'js/audio.js', 'js/video.js',
	'js/video/software.js',
	'js/irq.js', 'js/keypad.js', 'js/sio.js',
	'js/savedata.js', 'js/gpio.js', 'js/gba.js', 'resources/biosbin.js',
];
const BOOT = `
global.window = {
	setTimeout: (f) => setTimeout(f, 0), clearTimeout,
	localStorage: { getItem: () => null, setItem: () => {} },
	addEventListener: () => {},
	atob: (b64) => Buffer.from(b64, 'base64').toString('binary'),
	btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
};
global.document = { createElement: () => global.__makeCanvas(), addEventListener: () => {} };
global.FileReader = function () {};
global.XMLHttpRequest = function () {};
`;
function makeCanvasStub() {
	return {
		offsetWidth: 480, offsetHeight: 320, width: 480, height: 320,
		setAttribute() {},
		getContext() { return { createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {}, getImageData: () => null }; },
	};
}
const ROOT = path.join(__dirname, '../../../..');
const code = BOOT + '\n' + SCRIPTS.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n') +
	'\nglobal.__ctx = { GameBoyAdvance, biosBin };';
global.__makeCanvas = makeCanvasStub;
(0, eval)(code);
const { GameBoyAdvance, biosBin } = global.__ctx;

const gba = new GameBoyAdvance();
gba.setCanvas(makeCanvasStub());
gba.setBios(biosBin);
gba.setLogger(() => {});

const stateFile = path.join(ROOT, 'tmp/romctl.state.json');
const meta = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const romBuf = fs.readFileSync(meta.rom);
gba.setRom(romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength));

const unb64 = s => { const b = Buffer.from(s, 'base64'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
gba.cpu.defrost(meta.__snapshot.cpu);
gba.irq.defrost(meta.__snapshot.irq);
gba.video.defrost(meta.__snapshot.videoTiming);
gba.mmu.defrost({ ram: unb64(meta.__snapshot.wram), iram: unb64(meta.__snapshot.iwram) });
gba.io.defrost({ registers: meta.__snapshot.io });
const rp = gba.video.renderPath;
rp.palette.overwrite(meta.__snapshot.pal);
rp.vram.buffer.set(new Uint16Array(unb64(meta.__snapshot.vram)));
rp.oam.overwrite(new Uint16Array(unb64(meta.__snapshot.oam)));
if (rp.palette.rewrite) rp.palette.rewrite();

// ---- 关键：包装 mmu.loadU8 / loadU16 / loadU32，监视区间读取 ----
const mmu = gba.mmu;
const cpu = gba.cpu;
const hits = [];
function record(addr, width, reader) {
	if (hits.length < MAX_HITS) {
		hits.push({ pc: (cpu.gprs[15] - cpu.instructionWidth) >>> 0, addr: addr >>> 0, width, sp: cpu.gprs[13] >>> 0, lr: cpu.gprs[14] >>> 0, reader });
	} else if (!stopAt) { stopAt = meta.__snapshot.frames + 4; }
}
let stopAt = 0;
const wrap = (name) => {
	if (typeof mmu[name] !== 'function') { console.error('跳过不存在的方法:', name); return; }
	const orig = mmu[name];
	mmu[name] = function (offset) {
		const a = offset >>> 0;
		if (a >= LO && a <= HI) record(a, name);
		return orig.call(this, offset);
	};
};
wrap('loadU8'); wrap('loadU16'); wrap('loadU32'); wrap('load8'); wrap('load16'); wrap('load32');

const KEYMAP = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
let kmask = 0;
for (const k of KEYS) { if (!(k in KEYMAP)) throw new Error('未知按键: ' + k); kmask |= KEYMAP[k]; }
gba.paused = false;
let frames = 0;
const startFrame = meta.__snapshot.frames;
if (kmask) {
	gba.keypad.currentDown = ~kmask & 0x3ff;
	for (let i = 0; i < 30 && hits.length < MAX_HITS; i++) gba.advanceFrame();
	gba.keypad.currentDown = 0x3ff;
	frames = 30;
}
for (; frames < MAX_FRAMES; frames++) {
	gba.advanceFrame();
	if (stopAt && meta.__snapshot.frames + frames >= stopAt) break;
	if (hits.length >= MAX_HITS) break;
}
console.log(`监视 [0x${LO.toString(16)},0x${HI.toString(16)}] | 命中 ${hits.length} 条 | 跑了 ${frames} 帧`);
fs.writeFileSync(OUT, JSON.stringify(hits, null, 1));
const byPC = {};
for (const h of hits) byPC['0x' + h.pc.toString(16)] = (byPC['0x' + h.pc.toString(16)] || 0) + 1;
console.log('读取者 PC 分布:', JSON.stringify(byPC, null, 1));

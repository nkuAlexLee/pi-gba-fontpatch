#!/usr/bin/env node
/**
 * trace-after-hook.js — hook 命中后逐指令 trace (pc,r0-r3)，用于异版本引擎定位。
 *
 * 原理：romctl 状态接续 → 按键触发已知会命中 hook 的操作 → 命中后记录 N 步指令
 * → 存 JSON。拿到 trace 后用已知字符/参数序列匹配（如 r1=字形编码流）反查引擎函数地址。
 * 实战案例见《cases/红龙传说-西语蓝宝石改版-字库移植实录.md》§三。
 *
 * 用法:
 *   node trace-after-hook.js <hookAddr> <traceSteps> <key1,key2> <afterFrames> [out.json]
 *
 *   hookAddr    hook 点（函数入口），如 0x080653D8
 *   traceSteps  命中后 trace 的指令条数（ROM 指令才记录；建议 5万-20万）
 *   keys        触发重绘/调用的按键（逗号分隔，可空串 "" 表示不按键）
 *   afterFrames 按键后最多跑多少帧等待命中（等到 trace 满即提前结束）
 *   out.json    输出文件（默认 tmp/trace.json，扁平数组 [pc,r0,r1,r2,r3]*N）
 *
 * 例：hook 文本打印入口，按 B 触发菜单重绘并 trace 8 万步：
 *   node trace-after-hook.js 0x080653D8 80000 B 3600
 */
'use strict';
const fs = require('fs');
const path = require('path');

const [hookArg, stepsArg, keysArg, framesArg, outArg] = process.argv.slice(2);
if (!hookArg || !stepsArg) {
	console.error(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace('/*!r', ''));
	process.exit(2);
}
const HOOK_ADDR = parseInt(hookArg.replace(/^0x/i, ''), 16) >>> 0;
const TRACE_N = parseInt(stepsArg, 10);
const KEYS = String(keysArg || '').toUpperCase().split(',').filter(Boolean);
const MAX_FRAMES = parseInt(framesArg || '3600', 10);
const OUT = outArg || path.join(ROOT, 'tmp/trace.json');

const SCRIPTS = [
	'js/util.js', 'js/core.js', 'js/arm.js', 'js/thumb.js', 'js/mmu.js',
	'js/io.js', 'js/audio.js', 'js/video.js',
	'js/video/software.js', // 刻意不加载 video/proxy.js（Worker 渲染无头环境黑屏）
	'js/irq.js', 'js/keypad.js', 'js/sio.js',
	'js/savedata.js', 'js/gpio.js', 'js/gba.js', 'resources/biosbin.js',
	'js/thumb-disassembler.js',
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
		getContext() {
			return {
				createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
				putImageData() {}, drawImage() {}, getImageData() { return null; }, clearRect() {},
			};
		},
	};
}
const ROOT = path.join(__dirname, '../../../..');
const BOOTCODE = BOOT + '\n' + SCRIPTS.map(s => fs.readFileSync(path.join(ROOT, s), 'utf8')).join('\n;\n') + '\n' +
	'global.__ctx = { GameBoyAdvance, ThumbDisassembler, biosBin };';
global.__makeCanvas = makeCanvasStub;
(0, eval)(BOOTCODE);
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
function restoreSnapshot(s) {
	gba.cpu.defrost(s.cpu);
	gba.irq.defrost(s.irq);
	gba.video.defrost(s.videoTiming);
	gba.mmu.defrost({ ram: unb64(s.wram), iram: unb64(s.iwram) });
	gba.io.defrost({ registers: s.io });
	const rp = gba.video.renderPath;
	rp.palette.overwrite(s.pal);
	rp.vram.buffer.set(new Uint16Array(unb64(s.vram)));
	rp.oam.overwrite(new Uint16Array(unb64(s.oam)));
	if (rp.palette.rewrite) rp.palette.rewrite();
}
restoreSnapshot(meta.__snapshot);

let hit = false, traceCnt = 0;
const trace = [];
const cpu = gba.cpu;
const origStep = cpu.step.bind(cpu);
cpu.step = function () {
	const pc = (this.gprs[15] - this.instructionWidth) >>> 0;
	if (hit && traceCnt < TRACE_N) {
		traceCnt++;
		if (pc >= 0x08000000 && pc < 0x08800000) {
			trace.push(pc, this.gprs[0] >>> 0, this.gprs[1] >>> 0, this.gprs[2] >>> 0, this.gprs[3] >>> 0);
		}
	} else if (!hit && pc === HOOK_ADDR) hit = true;
	return origStep();
};

const KEYMAP = { A: 1, B: 2, SELECT: 4, START: 8, RIGHT: 16, LEFT: 32, UP: 64, DOWN: 128, R: 256, L: 512 };
function press(mask, hold, after) {
	gba.keypad.currentDown = ~mask & 0x3ff;
	for (let i = 0; i < hold; i++) gba.advanceFrame();
	gba.keypad.currentDown = 0x3ff;
	for (let i = 0; i < after; i++) gba.advanceFrame();
}

let frames = 0;
let mask = 0;
for (const k of KEYS) { if (!(k in KEYMAP)) throw new Error('未知按键: ' + k); mask |= KEYMAP[k]; }
if (mask) { press(mask, 30, 400); frames += 430; }
gba.paused = false;
for (; frames < MAX_FRAMES && traceCnt < TRACE_N; frames++) gba.advanceFrame();

console.log('hook 0x' + HOOK_ADDR.toString(16), '命中:', hit, '| trace 条目(x5):', trace.length / 5, '| 帧数:', frames);
if (trace.length) fs.writeFileSync(OUT, JSON.stringify(trace));
else process.exit(1);

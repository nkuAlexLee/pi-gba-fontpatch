#!/usr/bin/env node
/**
 * romctl.js — GBA headless 调试引擎（试点版）
 *
 * 用 Node 直接驱动 gbajs2 模拟器核心，供 AI（或人）通过 bash 调试分析游戏。
 * 模拟器状态通过 gba.freeze()/defrost() 持久化到 JSON，因此每条命令都是
 * 一次性进程，但状态跨命令连续。
 *
 * 用法:
 *   node romctl.js load <rom.gba>                       加载 ROM 并初始化状态
 *   node romctl.js run [frames]                         运行 N 帧（默认 1）
 *   node romctl.js key <KEYS> [frames]                  按住按键运行 N 帧后松开
 *                                                       KEYS: A,B,L,R,START,SELECT,UP,DOWN,LEFT,RIGHT 逗号分隔
 *   node romctl.js screenshot [out.bmp] [--noframe]     截图（默认先跑 1 帧保证画面新鲜）
 *   node romctl.js memread <addr> [len=64]              十六进制查看内存
 *   node romctl.js memwrite <addr> <hex...>             写内存
 *   node romctl.js disasm <addr> [count=24] [--arm]     反汇编（默认跟随 CPU 模式）
 *   node romctl.js regs                                 CPU 寄存器
 *   node romctl.js info                                 当前状态摘要
 *   node romctl.js snap <name>                          给可写区域拍快照（ewram/iwram/pal/vram/oam）
 *   node romctl.js diff <name> [--region X] [--max 40]  对比当前与快照，列出变化
 *   node romctl.js serve [port=8645]                    启动 HTTP 实时调试服务器（边跑边看，避免预录按键时序错误）
 *
 * 选项: --state <file> 指定状态文件（默认 tmp/romctl.state.json）；
 *       所有临时产物（状态/快照/截图/hook 事件）默认写入 tmp/ 目录，自动创建
 *
 * 示例（AI 典型调试循环）:
 *   node romctl.js load ../testfiles/PokemonQuetzalAlpha7v0.gba
 *   node romctl.js snap s1
 *   node romctl.js key START 120        # 打开菜单
 *   node romctl.js diff s1              # 看哪些内存被改了 → 定位菜单文本写入
 *   node romctl.js disasm 0x08006876    # 反汇编 DrawGlyphTiles
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ------------------------------------------------------------------ *
 * 参数解析
 * ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
const TMP_DIR = 'tmp';
fs.mkdirSync(TMP_DIR, { recursive: true });
const stateFile = (() => {
	const i = argv.indexOf('--state');
	if (i >= 0) { argv.splice(i, 2); return argv[i] ?? path.join(TMP_DIR, 'romctl.state.json'); }
	return path.join(TMP_DIR, 'romctl.state.json');
})();
const cmd = argv[0];
const args = argv.slice(1);

if (!cmd) {
	console.error(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace('/*!r', ''));
	process.exit(2);
}

/* ------------------------------------------------------------------ *
 * 模拟器上下文：所有 gbajs2 脚本拼进同一作用域 eval
 * ------------------------------------------------------------------ */
const SCRIPTS = [
	'js/util.js', 'js/core.js', 'js/arm.js', 'js/thumb.js', 'js/mmu.js',
	'js/io.js', 'js/audio.js', 'js/video.js',
	'js/video/software.js',   // 注意：刻意不加载 video/proxy.js（Worker 渲染在无头环境与监视场景均不适用，见 docs/memview开发经验与调试记录.md §3.1）
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

function buildContext() {
	const code = BOOT + '\n' + SCRIPTS.map(s => fs.readFileSync(path.join(__dirname, s), 'utf8')).join('\n;\n') + '\n' + `
global.__ctx = { GameBoyAdvance, ThumbDisassembler, biosBin };`;
	(0, eval)(code);
	return global.__ctx;
}

/* ------------------------------------------------------------------ *
 * BMP 截图（24bpp，无依赖）
 * ------------------------------------------------------------------ */
function writeBMP(file, rgba, w, h) {
	fs.writeFileSync(file, makeBMPBuffer(rgba, w, h));
}

function makeBMPBuffer(rgba, w, h) {
	const rowSize = Math.ceil(w * 3 / 4) * 4;
	const dataSize = rowSize * h;
	const buf = Buffer.alloc(54 + dataSize);
	buf.write('BM', 0);
	buf.writeUInt32LE(buf.length, 2);
	buf.writeUInt32LE(54, 10);
	buf.writeUInt32LE(40, 14);
	buf.writeInt32LE(w, 18);
	buf.writeInt32LE(h, 22);
	buf.writeUInt16LE(1, 26);
	buf.writeUInt16LE(24, 28);
	buf.writeUInt32LE(dataSize, 34);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const si = (y * w + x) * 4;         // RGBA, top-down
			const di = 54 + (h - 1 - y) * rowSize + x * 3; // BMP bottom-up
			buf[di] = rgba[si + 2];             // B
			buf[di + 1] = rgba[si + 1];         // G
			buf[di + 2] = rgba[si];             // R
		}
	}
	return buf;
}

/* ------------------------------------------------------------------ *
 * 工具函数
 * ------------------------------------------------------------------ */
function parseAddr(s) {
	s = String(s).trim().replace(/^0x/i, '');
	if (!/^[0-9a-f]+$/i.test(s)) throw new Error('非法地址: ' + s);
	return parseInt(s, 16) >>> 0;
}

const REGIONS = {
	ewram: { base: 0x02000000, size: 0x40000 },
	iwram: { base: 0x03000000, size: 0x8000 },
	io:    { base: 0x04000000, size: 0x400   },
	pal:   { base: 0x05000000, size: 0x400   },
	vram:  { base: 0x06000000, size: 0x18000 },
	oam:   { base: 0x07000000, size: 0x400   },
};

function hexdump(read, base, len) {
	const lines = [];
	for (let off = 0; off < len; off += 16) {
		let hex = '', asc = '';
		for (let c = 0; c < 16 && off + c < len; c++) {
			const v = read(base + off + c);
			hex += v.toString(16).padStart(2, '0') + ' ';
			asc += (v >= 0x20 && v < 0x7f) ? String.fromCharCode(v) : '.';
		}
		lines.push((base + off).toString(16).padStart(8, '0').toUpperCase() + ': ' + hex.padEnd(49) + asc);
	}
	return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * 主流程
 * ------------------------------------------------------------------ */
const { GameBoyAdvance, ThumbDisassembler, biosBin } = buildContext();
global.__makeCanvas = makeCanvasStub;

const gba = new GameBoyAdvance();
// Node 无 AudioContext：audio.js 的环形缓冲只在 context 存在时分配，
// 手动补齐，让 /audio 端点能取到样本（32768Hz，与浏览器播放端一致）
if (gba.audio && !gba.audio.buffers) {
	gba.audio.bufferSize = 4096;
	// 环形缓冲放大到 4×（65536 样本 ≈ 2s@32768Hz）：联机 /play 每次最多推 60 帧
	// ≈1s 音频，原始 0.5s 环会被大爆发覆盖丢样本
	gba.audio.maxSamples = gba.audio.bufferSize << 4;
	gba.audio.buffers = [new Float32Array(gba.audio.maxSamples), new Float32Array(gba.audio.maxSamples)];
	gba.audio.sampleMask = gba.audio.maxSamples - 1;
}
// 画布 stub：像素进 gba.video.renderPath.pixelData（software 渲染器直接持有）
gba.setCanvas(makeCanvasStub());
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

let lastError = null;
gba.setLogger((level, error) => {
	lastError = error instanceof Error ? error.message : String(error);
});
gba.setBios(biosBin);
gba.__swiLog = gba.__swiLog || [];
const dis = new ThumbDisassembler(gba.mmu);

const HOOK_FILE = path.join(TMP_DIR, 'hook-events.jsonl');
// 预设：函数入口地址（源自 Pokemon_GBA_Font_Patch pokeRS/OriginSymbols_R.s 与 pokeemerald.sym）
const PRESETS = {
	rs: {
		GetGlyphWidth: 0x080048e8,
		GetStringWidth: 0x08004bcc,
		DrawGlyphTiles: 0x08006874,
	},
	emerald: {
		GetStringWidth: 0x08005ed8,
		GetGlyphWidth_Normal: 0x08006908,
		GetGlyphWidth_Small: 0x08006540,
		DecompressGlyphTile: 0x08004c10,
	},
};
let hookMap = new Map();       // addr -> name
let hookEvents = [];           // 本次调用捕获的事件
let hookOverflow = false;
const HOOK_MAX = 50000;
let hookInstalled = false;

let meta = { frames: 0, hooks: [] };

/* ------------------------------------------------------------------
 * serve 单写者锁：serve 运行期间状态由 serve 独占（内存为最新），
 * CLI 变更类命令若并发执行会基于落盘旧快照改写状态文件，造成分叉。
 * 规则：变更类命令直接报错指引走 HTTP；只读命令放行（读到的可能
 * 滞后 ≤600 帧，见 /play 节流落盘）。
 * ------------------------------------------------------------------ */
const serveLockFile = path.join(TMP_DIR, 'serve.lock');
function readServeLock() {
	if (!fs.existsSync(serveLockFile)) return null;
	let lock = null;
	try { lock = JSON.parse(fs.readFileSync(serveLockFile, 'utf8')); } catch (e) { return null; }
	try { process.kill(lock.pid, 0); return lock; } catch (e) { return null; } // PID 已死 = 残留锁
}
const MUTATING_CMDS = ['load', 'run', 'key', 'memwrite', 'shot', 'hookadd', 'hookclear', 'rompatch'];
if (cmd !== 'serve') {
	const lock = readServeLock();
	if (lock) {
		if (MUTATING_CMDS.includes(cmd)) {
			throw new Error(`serve 正在运行（端口 ${lock.port}，PID ${lock.pid}），状态由 serve 独占管理。\n` +
				`  变更操作请走 HTTP: http://localhost:${lock.port}/run?frames=N 等，\n` +
				`  或先停止 serve（关闭其终端 / taskkill /PID ${lock.pid}）再使用 CLI。`);
		}
		console.warn(`[提示] serve 正在运行（端口 ${lock.port}），当前为只读访问，数据来自状态文件落盘快照（最多滞后 ~600 帧）`);
	}
}
if (cmd !== 'load' && fs.existsSync(stateFile)) {
	meta = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
	if (!meta.__snapshot) throw new Error('状态文件不存在或无效: ' + stateFile + '（先执行 load）');
	if (!fs.existsSync(meta.rom)) throw new Error('找不到 ROM: ' + meta.rom + '（请重新 load）');
	// 先加载 ROM（resetCPU + 内存映射），再覆盖快照状态
	const romBuf = fs.readFileSync(meta.rom);
	gba.setRom(romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength));
	restoreSnapshot(meta.__snapshot);
	meta.__snapshot = null;
	loadHooksFromMeta();
}

/*
 * 状态持久化：gbajs2 自带的 gba.freeze() 依赖浏览器 Blob 且 Serializer.prefix
 * 是实例方法却被静态调用，根本走不通；且软件渲染器的 freeze/defrost 是空实现
 * （调色板/VRAM/OAM 不会被保存）。因此这里自己实现快照，全部 JSON 化。
 * 恢复时各子系统都有可靠的 overwrite()/defrost() 入口（会同步内部缓存）。
 */
function takeSnapshot() {
	const rp = gba.video.renderPath; // software renderer
	const palWords = [];
	for (let i = 0; i < 256; i++) { palWords.push(rp.palette.colors[0][i], rp.palette.colors[1][i]); }
	return {
		frames: meta.frames || 0,
		cpu: Object.assign(gba.cpu.freeze(), {
			execMode: gba.cpu.execMode,           // ARM/Thumb 模式必须随快照保存（见 restoreSnapshot 注释）
			instructionWidth: gba.cpu.instructionWidth,
		}),
		irq: gba.irq.freeze(),
		videoTiming: gba.video.freeze(),
		wram: b64(gba.mmu.memory[gba.mmu.REGION_WORKING_RAM].buffer),
		iwram: b64(gba.mmu.memory[gba.mmu.REGION_WORKING_IRAM].buffer),
		io: Array.from(gba.io.registers),
		pal: palWords,
		vram: b64(rp.vram.buffer.buffer),
		oam: b64(rp.oam.buffer.buffer),
	};
}

function restoreSnapshot(s) {
	gba.cpu.defrost(s.cpu);
	// ⚠ cpu.defrost 不恢复 execMode/instructionWidth（freeze 也不保存），恢复后 CPU 默认 ARM，
	// 用 ARM 语义解码 Thumb 代码会直接跑飞卡死 → 此处补齐（兼容无此字段的旧快照）
	if (s.cpu.execMode !== undefined) {
		gba.cpu.execMode = s.cpu.execMode;
		gba.cpu.instructionWidth = s.cpu.instructionWidth;
	}
	gba.cpu.instruction = null;
	gba.irq.defrost(s.irq);
	gba.video.defrost(s.videoTiming);
	gba.mmu.defrost({ ram: unb64(s.wram), iram: unb64(s.iwram) });
	gba.io.defrost({ registers: s.io });                 // 内部会 new Uint16Array(数组)
	const rp = gba.video.renderPath;
	rp.palette.overwrite(s.pal);
	rp.vram.buffer.set(new Uint16Array(unb64(s.vram)));  // VRAM 无缓存，直接写 Uint16Array
	rp.oam.overwrite(new Uint16Array(unb64(s.oam)));     // OAM.overwrite 会同步 objs 缓存
	// palette overwriter 后需重算 passthrough 缓存
	if (rp.palette.rewrite) rp.palette.rewrite();
}

function b64(arrayBuffer) {
	return Buffer.from(arrayBuffer).toString('base64');
}
function unb64(s) {
	const b = Buffer.from(s, 'base64');
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

/* ------------------------------------------------------------------
 * Hook 机制：包装 cpu.step，逐指令检查 PC 命中
 * 当前指令地址 = gprs[15] - instructionWidth（step 入口时 PC 已指向下一条）
 * hook 点约定为函数入口，r0-r3 即参数，无需跳过指令
 * ------------------------------------------------------------------ */

function installHook() {
	if (hookInstalled) return;
	const cpu = gba.cpu;
	const origStep = cpu.step.bind(cpu);
	cpu.step = function () {
		if (hookMap.size) {
			const pc = (this.gprs[15] - this.instructionWidth) >>> 0;
			if ((pc >= 0x08000000 && pc < 0x0a000000) || (pc >= 0x02000000 && pc < 0x02040000)) {
				const name = hookMap.get(pc);
				if (name !== undefined) recordHookEvent(pc, name, this);
			}
		}
		return origStep();
	};
	hookInstalled = true;
}

function loadHooksFromMeta() {
	hookMap = new Map();
	for (const h of meta.hooks || []) hookMap.set(h.addr >>> 0, h.name);
	if (hookMap.size) installHook();
}

/* 窗口结构体解码（约定来自 Pokemon_GBA_Font_Patch 的逆向成果）
 * win+0x01 fontNum | win+0x02 language | win+0x0E spacing
 * win+0x1E textIndex(u16) | win+0x20 *text
 * 汉字码 = ((glyph-修正)<<8) | text[textIndex]，修正: 1-5→1, 7-1A→2, 1C-1E→3
 */
function decodeWin(cpu) {
	const win = cpu.gprs[0] >>> 0;
	const glyph = cpu.gprs[1] >>> 0;
	if (win < 0x02000000 || win > 0x03008000) return null; // 不像 win 指针
	const fontNum = gba.mmu.loadU8(win + 1) & 0xff;
	const lang = gba.mmu.loadU8(win + 2) & 0xff;
	const textPtr = gba.mmu.load32(win + 0x20) >>> 0;
	if ((textPtr < 0x02000000 || textPtr > 0x03008000) && (textPtr < 0x08000000 || textPtr > 0x09000000)) {
		return { win, glyph, fontNum, lang, charId: null };
	}
	const textIndex = gba.mmu.loadU16(win + 0x1e) & 0xffff;
	const nextByte = gba.mmu.loadU8(textPtr + textIndex) & 0xff;
	let corr = 0;
	if (glyph >= 0x01 && glyph <= 0x05) corr = 1;
	else if (glyph >= 0x07 && glyph <= 0x1a) corr = 2;
	else if (glyph >= 0x1c && glyph <= 0x1e) corr = 3;
	else if (glyph === 0x06 || glyph === 0x1b) corr = 0;
	const high = glyph - corr;
	const charId = ((high << 8) | nextByte) >>> 0;
	return { win, glyph, fontNum, lang, textIndex, nextByte, charId, isChinese: charId >= 0x0100 && charId <= 0x1ff6 };
}

function recordHookEvent(addr, name, cpu) {
	if (hookEvents.length >= HOOK_MAX) { hookOverflow = true; return; }
	const ev = { frame: meta.frames, addr: '0x' + addr.toString(16), name };
	for (let i = 0; i < 4; i++) ev['r' + i] = cpu.gprs[i] >>> 0;
	const d = decodeWin(cpu);
	if (d) ev.decoded = d;
	hookEvents.push(ev);
}

function flushHookEvents() {
	if (!hookEvents.length) return;
	fs.appendFileSync(HOOK_FILE, hookEvents.map(e => JSON.stringify(e)).join('\n') + '\n');
	hookEvents = [];
}

/* ------------------------------------------------------------------
 * 会话记录：联机模式下自动记录用户每个操作+截图，供 AI 通过
 * /session?op=steps 拉取。截图为 BMP（可直接用图像查看工具阅读）。
 * ------------------------------------------------------------------ */
const SESSION_DIR = path.join(TMP_DIR, 'session');
let sess = { on: false, seq: 0, lastShotFrame: -1 };
let heldMask = 0; // /pad 联机按键状态（KEYMAP 位掩码，取反后写 keypad）
let audioSentPtr = -1; // /audio 已发送到的音频环形缓冲位置（-1=待同步）
let audioSentByPid = new Map(); // 每标签独立音频流指针（cid → 环位置）
let activePlayer = null; // 当前播放权持有者（cid）：新标签自动接管，旧标签被 409 拒绝
let lastPlayAt = 0;
const AUDIO_CLIENT_TTL = 60000;
let lastPersistFrame = -1; // 状态文件最近落盘的帧号（联机节流用）

function sessionShot() {
	const pd = gba.video.renderPath.pixelData;
	if (!pd) return null;
	sess.seq += 1;
	const file = path.join(SESSION_DIR, 's-' + String(sess.seq).padStart(4, '0') + '.bmp');
	writeBMP(file, pd.data, pd.width, pd.height);
	return file;
}

function recordStep(action, params) {
	if (!sess.on) return null;
	// 自动补记自上一步以来的静默推帧段（扣除本步骤自身已消耗的帧数），
	// 保证重放帧流与录制完全对齐
	if (action !== 'run' && sess.lastStepFrame !== undefined) {
		let consumed = 0;
		if (action === 'key') consumed = (params.frames || 60) + 1; // 按住帧数 + 松开后 1 帧
		else consumed = (params && params.frames) || 0;
		const gap = meta.frames - sess.lastStepFrame - consumed;
		if (gap > 0) recordStep('run', { frames: gap });
	}
	const shot = sessionShot();
	sess.lastShotFrame = meta.frames;
	const step = { seq: sess.seq, time: new Date().toISOString(), frame: meta.frames, action, params: params || {}, shot };
	fs.appendFileSync(path.join(SESSION_DIR, 'steps.jsonl'), JSON.stringify(step) + '\n');
	sess.lastStepFrame = meta.frames;
	return step;
}

	/* 会话快照：录制开始/结束各存一份完整模拟器状态（覆盖式，只这两个文件），
	 * 配合 /session?op=replay 可从起始快照重放用户操作并与结束状态对比 */
	const SNAP_START = path.join(SESSION_DIR, 'snap-start.json');
	const SNAP_END = path.join(SESSION_DIR, 'snap-end.json');
	function writeSnap(file) {
		const pd = gba.video.renderPath.pixelData;
		fs.writeFileSync(file, JSON.stringify({
			frames: meta.frames, rom: meta.rom,
			__snapshot: takeSnapshot(),
			// 屏幕像素一并入快照：重放恢复后未推帧前也能截出与录制时一致的图
			screen: pd ? Buffer.from(pd.data.buffer, pd.byteOffset, pd.byteLength).toString('base64') : null,
		}));
	}

/* EliteRedux boot 修补: 异步拷贝引擎在 gbajs2 下不工作，EWRAM handler 区
 * (0x02027FC8+0xE64, 源 ROM 0x08004AB8) 需要守护式重注入 */
function guardianTick() {
	try {
		let zero = true;
		for (let i = 0x398; i < 0x3B0; i++) {
			if (gba.mmu.loadU8(0x02028398 + (i - 0x398)) !== 0) { zero = false; break; }
		}
		if (zero) {
			const romBase = 0x08000000;
			for (let i = 0; i < 0xE64; i++) {
				gba.mmu.store8(0x02027FC8 + i, gba.mmu.loadU8(romBase + 0x4AB8 + i));
			}
			global.__guardianFixes = (global.__guardianFixes || 0) + 1;
		}
		// IE 保活：引擎的流加载 worker 挂在 TM2 槽，但游戏/BIOS 每帧的 IE
		// 周期(0x4→0x5→0x0)会丢掉 TM2 位 → 队列请求永久冻结 → 转场黑屏。
		// 实测强制 IE|=0x25 (VBlank|VCOUNT|TM2) 后 180 帧内黑屏解除。
		try {
			const ieAddr = 0x04000200;
			const cur = gba.mmu.loadU16(ieAddr);
			if ((cur & 0x25) !== 0x25) {
				gba.mmu.store16(ieAddr, cur | 0x25);
			}
		} catch (e) {}
	} catch (e) {}
}

function saveState() {
	meta.frames = meta.frames || 0;
	meta.__snapshot = takeSnapshot();
	fs.writeFileSync(stateFile, JSON.stringify(meta));
	lastPersistFrame = meta.frames; // 联机节流落盘的基准
}

function runFrames(n) {
	gba.paused = false;
	for (let i = 0; i < n; i++) {
		try {
			gba.advanceFrame();
			if (global.__guardian && (i & 0x7f) === 0) guardianTick();
		} catch (e) {
			// 崩溃诊断: 打印 CPU 现场
			const r = gba.cpu.gprs;
			const names = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','fp','ip','sp','lr','pc'];
			console.error('=== CPU 崩溃现场 (帧 ' + meta.frames + ') ===');
			for (let k = 0; k < 16; k += 4) {
				console.error(names.slice(k, k + 4).map((nm, j) => `${nm.padEnd(4)}=0x${(r[k+j]>>>0).toString(16).padStart(8,'0')}`).join('  '));
			}
			console.error('mode = ' + (gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM'));
			if (e.stack) console.error('[JS stack] ' + e.stack.split('\n').slice(0, 14).join(' | '));
			throw e;
		}
	}
	meta.frames += n;
	flushHookEvents();
	if (lastError) console.error('[emulator warning] ' + lastError);
}

const KEYMAP = { A: 1 << 0, B: 1 << 1, SELECT: 1 << 2, START: 1 << 3, RIGHT: 1 << 4, LEFT: 1 << 5, UP: 1 << 6, DOWN: 1 << 7, R: 1 << 8, L: 1 << 9 };

switch (cmd) {
	case 'load': {
		const romPath = args[0];
		if (!romPath) throw new Error('用法: load <rom.gba>');
		const buf = fs.readFileSync(path.resolve(romPath));
		const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
		const ok = gba.setRom(ab);
		if (!ok) throw new Error('ROM 加载失败');
		meta = { frames: 0, rom: path.resolve(romPath) };
		runFrames(1);
		saveState();
		console.log('OK 已加载', meta.rom, '| 标题:', readTitle());
		break;
	}
	case 'run': {
		const n = Math.min(parseInt(args[0] || '1', 10), 3600);
		runFrames(n);
		saveState();
		console.log(`OK 运行 ${n} 帧 | 累计 ${meta.frames} 帧 | PC=0x${(gba.cpu.gprs[15] >>> 0).toString(16)}`);
		break;
	}
	case 'key': {
		const keys = String(args[0] || '').toUpperCase().split(',').filter(Boolean);
		const n = Math.min(parseInt(args[1] || '60', 10), 3600);
		let mask = 0;
		for (const k of keys) {
			if (!(k in KEYMAP)) throw new Error('未知按键: ' + k + '（可选: ' + Object.keys(KEYMAP).join(',') + '）');
			mask |= KEYMAP[k];
		}
		gba.keypad.currentDown = ~mask & 0x3ff;
		runFrames(n);
		gba.keypad.currentDown = 0x3ff; // 松开
		runFrames(1);
		saveState();
		console.log(`OK 按住 [${keys.join('+')}] ${n} 帧 | 累计 ${meta.frames} 帧 | PC=0x${(gba.cpu.gprs[15] >>> 0).toString(16)}`);
		break;
	}
	case 'screenshot': {
		const outFile = args[0] || path.join(TMP_DIR, `screenshot-f${meta.frames}.bmp`);
		if (!args.includes('--noframe')) runFrames(1);
		const pd = gba.video.renderPath.pixelData;
		if (!pd) throw new Error('renderPath 无 pixelData（是否误加载了 proxy 渲染器？）');
		writeBMP(outFile, pd.data, pd.width, pd.height);
		saveState();
		console.log(`OK 截图 ${outFile} (${pd.width}x${pd.height}, 第 ${meta.frames} 帧)`);
		break;
	}
	case 'memread': {
		const addr = parseAddr(args[0]);
		const len = parseInt(args[1] || '64', 10);
		console.log(hexdump(a => gba.mmu.loadU8(a) & 0xff, addr, len));
		break;
	}
	case 'memwrite': {
		const addr = parseAddr(args[0]);
		const bytes = args.slice(1).join('').replace(/0x/gi, '');
		for (let i = 0; i * 2 < bytes.length; i++) {
			gba.mmu.store8(addr + i, parseInt(bytes.substr(i * 2, 2), 16));
		}
		saveState();
		console.log(`OK 写入 ${Math.floor(bytes.length / 2)} 字节 @ 0x${addr.toString(16).toUpperCase()}`);
		break;
	}
	case 'disasm': {
		const addr = parseAddr(args[0]);
		const count = parseInt(args[1] || '24', 10);
		const mode = args.includes('--arm') ? 'arm' : (args.includes('--thumb') ? 'thumb' : dis.currentMode);
		for (const l of dis.disassemble(addr, count, mode)) {
			console.log('0x' + (l.address >>> 0).toString(16).padStart(8, '0'), l.bytes.padEnd(mode === 'arm' ? 9 : 10), l.text);
		}
		break;
	}
	case 'regs': {
		const r = gba.cpu.gprs;
		const names = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'fp', 'ip', 'sp', 'lr', 'pc'];
		for (let i = 0; i < 16; i += 4) {
			console.log(names.slice(i, i + 4).map((n, j) => `${n.padEnd(4)}=0x${(r[i + j] >>> 0).toString(16).padStart(8, '0')}`).join('  '));
		}
		console.log('mode  = ' + (gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM') +
			'  |  frames = ' + meta.frames);
		break;
	}
	case 'info': {
		console.log(JSON.stringify({
			rom: meta.rom, frames: meta.frames,
			pc: '0x' + (gba.cpu.gprs[15] >>> 0).toString(16),
			mode: gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM',
			romTitle: readTitle(),
			stateFile,
		}, null, 2));
		break;
	}
	case 'snap': {
		const name = args[0] || 'default';
		for (const [id, r] of Object.entries(REGIONS)) {
			const buf = Buffer.alloc(r.size);
			for (let i = 0; i < r.size; i++) buf[i] = gba.mmu.loadU8(r.base + i) & 0xff;
			fs.writeFileSync(path.join(TMP_DIR, `snap-${name}-${id}.bin`), buf);
		}
		console.log(`OK 快照 [${name}] 已保存 (${Object.keys(REGIONS).join(', ')}) @ 帧 ${meta.frames}`);
		break;
	}
	case 'diff': {
		const name = args[0] || 'default';
		const ri = args.indexOf('--region');
		const max = (() => { const i = args.indexOf('--max'); return i >= 0 ? parseInt(args[i + 1], 10) : 40; })();
		const regions = ri >= 0 ? [args[ri + 1]] : Object.keys(REGIONS);
		let totalChanges = 0;
		for (const id of regions) {
			const r = REGIONS[id];
			const f = path.join(TMP_DIR, `snap-${name}-${id}.bin`);
			if (!fs.existsSync(f)) throw new Error('快照不存在: ' + f);
			const old = fs.readFileSync(f);
			const runs = []; // {addr, old[], new[]}
			let cur = null;
			for (let i = 0; i < r.size; i++) {
				const v = gba.mmu.loadU8(r.base + i) & 0xff;
				if (v !== old[i]) {
					if (!cur) cur = { addr: r.base + i, oldBytes: [], newBytes: [] };
					cur.oldBytes.push(old[i]); cur.newBytes.push(v);
				} else if (cur && cur.newBytes.length >= 4) {
					runs.push(cur); cur = null;
				} else if (cur) {
					runs.push(cur); cur = null;
				}
			}
			if (cur) runs.push(cur);
			totalChanges += runs.length;
			console.log(`== ${id.toUpperCase()} (0x${r.base.toString(16).toUpperCase()}) : ${runs.length} 处变化段`);
			for (const run of runs.slice(0, max)) {
				console.log(`  0x${run.addr.toString(16).toUpperCase().padStart(8, '0')}  ${run.newBytes.length}B  ` +
					'old: ' + Buffer.from(run.oldBytes).toString('hex') + '  new: ' + Buffer.from(run.newBytes).toString('hex'));
			}
			if (runs.length > max) console.log(`  ... 还有 ${runs.length - max} 段`);
		}
		console.log(`共 ${totalChanges} 处变化段 | 快照帧 vs 当前帧 ${meta.frames}`);
		break;
	}
	case 'serve': {
		/* HTTP 实时调试服务器：状态常驻内存，每个请求立即执行并返回 JSON。
		 * 典型循环：/shot 看画面 → 决定按键 → /key → 再 /shot，逐步推进，
		 * 避免一次性预录长按键序列导致时序错位。
		 * GET /status                                   状态（rom/frames/pc/hooks）
		 * GET /run?frames=N                             跑 N 帧（≤3600，阻塞至完成）
		 * GET /key?keys=DOWN,A&frames=N                 按住键跑 N 帧后松开
		 * GET /shot?file=x.bmp&noframe=1                截图到 tmp/（默认先跑 1 帧）
		 * GET /memread?addr=0x...&len=64                读内存（hex 文本）
		 * GET /memwrite?addr=0x...&hex=AABB             写内存
		 * GET /disasm?addr=0x...&n=24&mode=thumb        反汇编
		 * GET /hookadd?addr=0x...&name=x | /hookclear | /hookevents?tail=50
		 * GET /load?rom=path.gba                        换 ROM（重置状态与 hook）
		 * GET /audio                                    音频流（float32 交错 L/R，32768Hz，二进制）
		 * GET /audiostate                              音频引擎内部状态（诊断用）
		 * 静态文件：/memview.html 及 js/、resources/ 由 serve 自身提供（同源免 CORS），
		 *           serve 启动时自动打开浏览器连接本页；页面为 serve-only（无本地模式）。
		 */
		const http = require('http');
		const port = parseInt(args[0] || '8645', 10);
		const cpuInfo = () => ({
			pc: '0x' + (gba.cpu.gprs[15] >>> 0).toString(16),
			mode: gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM',
			warn: lastError || undefined,
		});
		// 浏览器中途断开（关标签/刷新）会触发 ECONNRESET/EPIPE，若不接住会把整个 serve 进程带崩
		process.on('uncaughtException', (e) => { console.error('[serve] 未捕获异常(已忽略):', e.message); });
		process.on('unhandledRejection', (e) => { console.error('[serve] 未处理拒绝(已忽略):', e && e.message || e); });
		const server = http.createServer((req, res) => {
			res.on('error', () => {}); // 客户端断开时的写错误，忽略
			req.on('error', () => {});
			let out;
			try {
				const u = new URL(req.url, 'http://localhost');
				const q = u.searchParams;
				const j = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); out = JSON.stringify(obj); };
				const jbin = (buf, type) => { res.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' }); out = buf; };
				switch (u.pathname) {
					case '/status':
						j({ ok: true, rom: meta.rom, frames: meta.frames, held: heldMask, session: sess.on ? { seq: sess.seq } : null, hooks: (meta.hooks || []).map(h => ({ addr: '0x' + h.addr.toString(16), name: h.name })), ...cpuInfo() });
						break;
					case '/roms': {
						const dir = path.join(__dirname, 'roms');
						j({ ok: true, roms: fs.readdirSync(dir).filter(f => /\.gba$/i.test(f)) });
						break;
					}
					case '/pad': {
						const keys = String(q.get('keys') || '').toUpperCase().split(',').filter(Boolean);
						let mask = 0;
						for (const k of keys) { if (!(k in KEYMAP)) throw new Error('未知按键: ' + k); mask |= KEYMAP[k]; }
						const changed = mask !== heldMask;
						heldMask = mask;
						gba.keypad.currentDown = ~mask & 0x3ff;
						if (sess.on && changed) recordStep('pad', { keys });
						j({ ok: true, held: keys });
						break;
					}
					case '/play': {
						const cid = q.get('cid');
						if (cid) activePlayer = cid; // 仅记录（无 409 接管，多标签各自推帧）
						const n = Math.min(parseInt(q.get('frames') || '2', 10), 120);
						const before = meta.frames;
						gba.keypad.currentDown = ~heldMask & 0x3ff;
						runFrames(n);
						// 联机高频循环不做逐步 saveState（全内存 JSON 落盘太慢），
						// 但每 ≥600 帧节流落盘一次，保证状态文件与内存最终一致
						if (meta.frames - lastPersistFrame >= 600) {
							saveState();
							lastPersistFrame = meta.frames;
						}
						const pd = gba.video.renderPath.pixelData;
						if (!pd) throw new Error('renderPath 无 pixelData');
						if (sess.on && heldMask !== 0 && meta.frames - sess.lastShotFrame >= 300) recordStep('play', { held: heldMask, frames: n });
						const bmpBuf = makeBMPBuffer(pd.data, pd.width, pd.height);
						jbin(bmpBuf, 'image/bmp');
						break;
					}
					case '/audiostate': {
						const a = gba.audio;
						j({ ok: true, enabled: a.enabled, buffers: !!a.buffers, samplePtr: a.samplePointer, nextSample: a.nextSample, nextEvent: a.nextEvent, cpuCycles: gba.cpu.cycles, sampleInterval: a.sampleInterval, chA: a.enableChannelA, chB: a.enableChannelB, sq0: a.squareChannels && a.squareChannels[0] ? a.squareChannels[0].playing : null, fifoALen: a.fifoA ? a.fifoA.length : -1 });
						break;
					}
					case '/audio': {
						// 音频流：返回自上次拉取以来新产出的样本（float32 交错 L/R，原始二进制）。
						// Node 端无 Web Audio，样本由 gbajs2 照常写入环形缓冲（32768Hz），
						// 浏览器端轮询此端点经 Web Audio 播放。样本只在推帧时产出；
						// 客户端掉线太久导致环形覆盖时丢弃旧数据重新同步。
						const a = gba.audio;
						if (!a || !a.buffers) throw new Error('audio 不可用');
						const mask = a.sampleMask;
						const cur = a.samplePointer >>> 0;
						const cid = q.get('cid');
						let sent;
						if (cid) {
							sent = audioSentByPid.get(cid);
							if (sent === undefined || sent < 0 || sent > mask) { sent = cur; audioSentByPid.set(cid, sent); }
						} else {
							if (audioSentPtr < 0 || audioSentPtr > mask) audioSentPtr = cur;
							sent = audioSentPtr;
						}
						let n = (cur - sent) & mask;
						// 注：60 帧 /play 爆发 ≈ 32918 样本 > 半环，属正常量，不做覆盖同步；
						// 客户端真正掉线 >2s 时最多收到一次环内残留旧数据，随后自动跟上
						const f32 = new Float32Array(n * 2);
						let p = sent;
						for (let i = 0; i < n; i++) {
							f32[i * 2] = a.buffers[0][p];
							f32[i * 2 + 1] = a.buffers[1][p];
							p = (p + 1) & mask;
						}
						if (cid) audioSentByPid.set(cid, p); else audioSentPtr = p;
						jbin(Buffer.from(f32.buffer, 0, f32.byteLength), 'application/octet-stream');
						break;
					}
					case '/session': {
						const op = q.get('op');
						if (op === 'start') {
							fs.mkdirSync(SESSION_DIR, { recursive: true });
							writeSnap(SNAP_START); // 起始快照：录制前的完整状态
							sess = { on: true, seq: 0, lastShotFrame: -1 };
							fs.writeFileSync(path.join(SESSION_DIR, 'steps.jsonl'), '');
							recordStep('session-start', { rom: meta.rom, frame: meta.frames, snapshot: 'snap-start.json' });
							j({ ok: true, dir: SESSION_DIR, snapshot: 'snap-start.json' });
						} else if (op === 'stop') {
							if (sess.on) recordStep('session-stop', {});
							sess.on = false;
							writeSnap(SNAP_END); // 结束快照：录制后的完整状态
							saveState(); // 停止记录时强制落盘，保证状态文件同步
							j({ ok: true, steps: sess.seq, snapshot: 'snap-end.json' });
						} else if (op === 'status') {
							j({ ok: true, on: sess.on, seq: sess.seq, dir: SESSION_DIR });
						} else if (op === 'steps') {
							const after = parseInt(q.get('after') || '0', 10);
							const limit = Math.min(parseInt(q.get('limit') || '500', 10), 2000);
							const f = path.join(SESSION_DIR, 'steps.jsonl');
							const steps = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter(s => s.seq > after).slice(0, limit) : [];
							j({ ok: true, on: sess.on, total: sess.seq, steps });
						} else if (op === 'snapload') {
							// 加载会话快照恢复状态: which=start|end
							const which = q.get('which') || 'start';
							const f = which === 'end' ? SNAP_END : SNAP_START;
							if (!fs.existsSync(f)) throw new Error('快照不存在: ' + f);
							const snap = JSON.parse(fs.readFileSync(f, 'utf8'));
							if (path.resolve(snap.rom) !== path.resolve(meta.rom)) throw new Error('ROM 不一致: ' + snap.rom);
							restoreSnapshot(snap.__snapshot);
							meta.frames = snap.frames || 0;
							lastPersistFrame = meta.frames;
							saveState();
							j({ ok: true, restored: f, frames: meta.frames });
						} else if (op === 'replay') {
							/* 从 snap-start.json 恢复状态，按 steps.jsonl 重放用户操作。
							 * shot 步骤复刻为 replay-s-XXXX.bmp 便于与原截图逐像素对比；
							 * 结束后帧号与 snap-end.json 对比可验证确定性 */
							if (!fs.existsSync(SNAP_START) || !fs.existsSync(path.join(SESSION_DIR, 'steps.jsonl')))
								throw new Error('缺少 snap-start.json 或 steps.jsonl（先完整录制一次）');
							const snap = JSON.parse(fs.readFileSync(SNAP_START, 'utf8'));
							if (path.resolve(snap.rom) !== path.resolve(meta.rom))
								throw new Error('当前加载的 ROM 与录制时不一致: ' + snap.rom);
							restoreSnapshot(snap.__snapshot);
							meta.frames = snap.frames || 0;
							lastPersistFrame = meta.frames;
							const pd = gba.video.renderPath.pixelData;
							if (snap.screen && pd) pd.data.set(new Uint32Array(unb64(snap.screen))); // 恢复屏幕像素，未推帧前截图也与录制一致
							const steps = fs.readFileSync(path.join(SESSION_DIR, 'steps.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
							let executed = 0, skipped = 0, shots = 0;
							for (const st of steps) {
								try {
									if (st.action === 'key') {
										let mask = 0;
										for (const k of (st.params.keys || [])) mask |= KEYMAP[k] || 0;
										gba.keypad.currentDown = ~mask & 0x3ff;
										runFrames(st.params.frames || 60);
										gba.keypad.currentDown = 0x3ff;
										runFrames(1);
									} else if (st.action === 'run') {
										runFrames(st.params.frames || 1);
									} else if (st.action === 'pad') {
										// 联机 UI 的按按键状态（保持到下一个 pad 变化，由后续 run 步推进）
										let mask = 0;
										for (const k of (st.params.keys || [])) mask |= KEYMAP[k] || 0;
										heldMask = mask;
										gba.keypad.currentDown = ~mask & 0x3ff;
									} else if (st.action === 'play') {
										// held 为 KEYMAP 位掩码（数字）；play 是长按采样步骤，按录制帧数重放
										gba.keypad.currentDown = ~(st.params.held || 0) & 0x3ff;
										runFrames(st.params.frames || 300);
										gba.keypad.currentDown = 0x3ff;
									} else if (st.action === 'shot' && st.params.file) {
										const pd = gba.video.renderPath.pixelData;
										if (pd) { writeBMP(path.join(SESSION_DIR, 'replay-' + st.params.file), pd.data, pd.width, pd.height); shots++; }
									} else {
										skipped++; continue;
									}
									executed++;
								} catch (e) { skipped++; }
							}
							saveState();
							const endFrames = fs.existsSync(SNAP_END) ? (JSON.parse(fs.readFileSync(SNAP_END, 'utf8')).frames || null) : null;
							j({ ok: true, executed, skipped, replayShots: shots, frames: meta.frames, snapEndFrames: endFrames, deterministic: endFrames !== null ? (endFrames === meta.frames ? '帧号一致' : '帧号有差异') : '无结束快照' });
						} else throw new Error('op? start|stop|status|steps');
						break;
					}
					case '/loadsav': {
						// 加载 .sav 到 flash savedata（mGBA 格式 128K+16B 尾也兼容，replaceData 用 mask 截断）
						const savPath = q.get('sav') || path.join(__dirname, 'roms', 'pker.sav');
						const sbuf = fs.readFileSync(path.resolve(savPath));
						const ab = sbuf.buffer.slice(sbuf.byteOffset, sbuf.byteOffset + sbuf.byteLength);
						if (!gba.mmu.save) {
							// flash 尚未创建：根据大小猜类型（128K=Flash1M, 64K=Flash512, 8K=EEPROM, 32K=SRAM）
							const SavedataCtor = require('./js/savedata.js');
							throw new Error('flash savedata 未初始化，先跑几帧让游戏探测存档类型');
						}
						gba.mmu.loadSavedata(ab);
						j({ ok: true, file: savPath, size: sbuf.length, saveType: gba.mmu.save.constructor.name });
						break;
					}
					case '/load': {
						gba.__dmaLog = [];
						gba.__flashLog = [];
						gba.__swiLog = [];
						if (gba.mmu.save) gba.mmu.save.core = gba; // flash 协议日志挂钩
						const romPath = q.get('rom');
						const buf = fs.readFileSync(path.resolve(romPath));
						gba.setRom(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
						meta = { frames: 0, rom: path.resolve(romPath) };
						hookMap = new Map(); meta.hooks = []; hookInstalled = false;
						heldMask = 0; gba.keypad.currentDown = 0x3ff;
						audioSentPtr = -1; // 音频流重新同步
						audioSentByPid = new Map(); activePlayer = null;
						runFrames(1); saveState();
						if (sess.on) recordStep('load', { rom: meta.rom });
						j({ ok: true, rom: meta.rom, title: readTitle(), ...cpuInfo() });
						break;
					}
					case '/run': {
						const n = Math.min(parseInt(q.get('frames') || '1', 10), 3600);
						runFrames(n); saveState();
						if (sess.on && n >= 60) recordStep('run', { frames: n });
						j({ ok: true, ran: n, frames: meta.frames, ...cpuInfo() });
						break;
					}
					case '/key': {
						const keys = String(q.get('keys') || '').toUpperCase().split(',').filter(Boolean);
						const n = Math.min(parseInt(q.get('frames') || '60', 10), 3600);
						let mask = 0;
						for (const k of keys) { if (!(k in KEYMAP)) throw new Error('未知按键: ' + k); mask |= KEYMAP[k]; }
						gba.keypad.currentDown = ~mask & 0x3ff;
						runFrames(n);
						gba.keypad.currentDown = 0x3ff;
						runFrames(1); saveState();
						if (sess.on) recordStep('key', { keys, frames: n });
						j({ ok: true, keys, frames: meta.frames, ...cpuInfo() });
						break;
					}
					case '/shot': {
						const file = (q.get('file') || ('serve-f' + meta.frames + '.bmp')).replace(/[\\/]/g, '_');
						if (q.get('noframe') !== '1') runFrames(1);
						const pd = gba.video.renderPath.pixelData;
						if (!pd) throw new Error('renderPath 无 pixelData');
						writeBMP(path.join(TMP_DIR, file), pd.data, pd.width, pd.height);
						saveState();
						if (sess.on) recordStep('shot', { file, frames: q.get('noframe') === '1' ? 0 : 1 });
						j({ ok: true, file: path.join(TMP_DIR, file), frames: meta.frames });
						break;
					}
					case '/memread': {
						const addr = parseAddr(q.get('addr'));
						const len = Math.min(parseInt(q.get('len') || '64', 10), 4096);
						const buf = Buffer.alloc(len);
						for (let i = 0; i < len; i++) buf[i] = gba.mmu.loadU8(addr + i) & 0xff;
						j({ ok: true, addr: '0x' + addr.toString(16), len, hex: buf.toString('hex') });
						break;
					}
					case '/memwrite': {
						const addr = parseAddr(q.get('addr'));
						const bytes = (q.get('hex') || '').replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
						if ((addr >>> 24) === 0x04 && bytes.length % 4 === 0) {
							// IO 区：按 16 位写（io.store8 为空实现）
							for (let i = 0; i * 2 < bytes.length; i++) gba.mmu.store16(addr + i * 2, parseInt(bytes.substr(i * 4, 4), 16));
						} else {
							for (let i = 0; i * 2 < bytes.length; i++) gba.mmu.store8(addr + i, parseInt(bytes.substr(i * 2, 2), 16));
						}
						saveState();
						j({ ok: true, wrote: Math.floor(bytes.length / 2), addr: '0x' + addr.toString(16) });
						break;
					}
					case '/disasm': {
						const addr = parseAddr(q.get('addr'));
						const count = Math.min(parseInt(q.get('n') || '24', 10), 500);
						const mode = q.get('mode') || dis.currentMode;
						j({ ok: true, lines: dis.disassemble(addr, count, mode).map(l => ({ addr: '0x' + (l.address >>> 0).toString(16), bytes: l.bytes, text: l.text })) });
						break;
					}
					case '/irqcount': {
						if (!global.__irqCount) {
							global.__irqCount = { cpu: 0, irq: {}, swi: {} };
							const c3 = gba.cpu, i3 = c3.irq;
							const oc = c3.raiseIRQ.bind(c3), oi = i3.raiseIRQ.bind(i3);
							c3.raiseIRQ = function () { global.__irqCount.cpu++; return oc(); };
							i3.raiseIRQ = function (t) { global.__irqCount.irq[t] = (global.__irqCount.irq[t] || 0) + 1; return oi(t); };
						}
						const before = meta.frames;
						global.__irqCount.cpu = 0; global.__irqCount.irq = {};
						const n3 = Math.min(parseInt(q.get('frames') || '60', 10), 3600);
						runFrames(n3); saveState();
						j({ ok: true, frames: n3, cpuRaiseIRQ: global.__irqCount.cpu, byType: global.__irqCount.irq, now: meta.frames });
						break;
					}
					case '/iedetect': {
						if (!global.__ieDetect) {
							global.__ieDetect = [];
							const cpu2 = gba.cpu, io2 = gba.io, irq2 = cpu2.irq;
							const origStep2 = cpu2.step.bind(cpu2);
							cpu2.step = function () {
								if (global.__ieDetect.length < 10) {
									const reg = io2.registers[0x200 >> 1];
									if (reg !== (irq2.enabledIRQs & 0xffff)) {
										global.__ieDetect.push({ frame: meta.frames, pc: '0x' + ((this.gprs[15] - this.instructionWidth) >>> 0).toString(16), lr: '0x' + (this.gprs[14] >>> 0).toString(16), thumb: this.execMode === this.MODE_THUMB, ieReg: '0x' + reg.toString(16), en: '0x' + (irq2.enabledIRQs >>> 0).toString(16) });
									}
								}
								return origStep2();
							};
						}
						const n2 = Math.min(parseInt(q.get('frames') || '5', 10), 3600);
						runFrames(n2); saveState();
						j({ ok: true, ran: n2, hits: global.__ieDetect });
						break;
					}
					case '/callertrace': {
						const target = parseAddr(q.get('addr'));
						{
							// 修复: 每次调用重装 hook（旧实现只在第一次安装, 之后换目标无效）
							// 修复2: cpu 声明提到 TDZ 之前（否则第二次调用报 "Cannot access 'cpu' before initialization"）
							const cpu = gba.cpu;
							if (global.__callerTraceOrigStep) cpu.step = global.__callerTraceOrigStep;
							global.__callerTrace = [];
							const origStep = cpu.step.bind(cpu);
							global.__callerTraceOrigStep = origStep;
							cpu.step = function () {
								const pc = (this.gprs[15] - this.instructionWidth) >>> 0;
								if (pc === target && global.__callerTrace.length < 5000) {
									const sp = this.gprs[13] >>> 0;
									const stack = [];
									try {
										for (let i = 0; i < 24; i++) {
										const w = gba.mmu.load32(sp + i * 4) >>> 0;
											if (w >= 0x08000000 && w < 0x08800000) stack.push('0x' + w.toString(16));
										}
									} catch (e) {}
									global.__callerTrace.push({ frame: meta.frames, lr: '0x' + (this.gprs[14] >>> 0).toString(16), thumb: this.execMode === this.MODE_THUMB, stack });
								}
								return origStep();
							};
						}
						const n = Math.min(parseInt(q.get('frames') || '5', 10), 3600);
						runFrames(n); saveState();
						j({ ok: true, ran: n, hits: global.__callerTrace });
						break;
					}
					case '/watchdma': {
						if (!global.__watchDMA) {
							global.__watchDMA = [];
							const mmu = gba.mmu;
							const origService = mmu.serviceDma.bind(mmu);
							mmu.serviceDma = function (number, info) {
								try {
									const dst = (info.nextDest >>> 0);
									if (dst >= 0x02000000 && dst < 0x02040000 && global.__watchDMA.length < 4000) {
										global.__watchDMA.push({ frame: meta.frames, ch: number, src: '0x' + (info.nextSource >>> 0).toString(16), dst: '0x' + dst.toString(16), count: info.nextCount, width: info.width, timing: info.timing, pc: '0x' + ((gba.cpu.gprs[15] - gba.cpu.instructionWidth) >>> 0).toString(16) });
									}
								} catch (e) {}
								return origService(number, info);
							};
						}
						const n = Math.min(parseInt(q.get('frames') || '0', 10), 3600);
						if (n > 0) { runFrames(n); saveState(); }
						j({ ok: true, ran: n, count: global.__watchDMA.length, events: global.__watchDMA.slice(-40) });
						break;
					}
					case '/watchwrite': {
						const block = gba.mmu.memory[2];
						const blockIwram = gba.mmu.memory[3];
						const blockPal = gba.mmu.memory[5];
						if (!global.__watchWrite) {
							global.__watchWrite = [];
							global.__watchRanges = [];
							const cpu = gba.cpu;
							for (const blk of [block, blockIwram, blockPal]) {
								const regionBase = blk === block ? 0x02000000 : blk === blockIwram ? 0x03000000 : 0x05000000;
								for (const [fn, size] of [['store8', 1], ['store16', 2], ['store32', 4]]) {
								if (typeof blk[fn] !== 'function') continue; // 修复: palette 块缺 store8，跳过避免 bind 报错
								const orig = blk[fn].bind(blk);
								blk[fn] = function (offset, value) {
									try {
										const abs = regionBase + ((offset & 0xffffff) >>> 0);
										let hit = false;
										for (const [wa, wl] of global.__watchRanges) {
											if (abs < wa + wl && abs + size > wa) { hit = true; break; }
										}
										if (hit && global.__watchWrite.length < 4000) {
											global.__watchWrite.push({ frame: meta.frames, addr: '0x' + abs.toString(16), size, val: (value >>> 0).toString(16), pc: '0x' + ((cpu.gprs[15] - cpu.instructionWidth) >>> 0).toString(16), lr: '0x' + (cpu.gprs[14] >>> 0).toString(16) });
										}
									} catch (e) {}
									return orig(offset, value);
								};
								}
							}
						}
						if (q.get('reset') === '1') { global.__watchRanges = []; global.__watchWrite = []; }
						if (q.get('addr')) {
							const wa = parseAddr(q.get('addr'));
							const wl = parseInt(q.get('len') || '256', 10);
							global.__watchRanges.push([wa, wl]);
						}
						const n = Math.min(parseInt(q.get('frames') || '0', 10), 3600);
						if (n > 0) { runFrames(n); saveState(); }
						j({ ok: true, ran: n, count: global.__watchWrite.length, events: global.__watchWrite.slice(-40) });
						break;
					}
					case '/guardian': {
						global.__guardian = q.get('on') !== '0';
						j({ ok: true, guardian: !!global.__guardian, fixes: global.__guardianFixes || 0 });
						break;
					}
					case '/watchio': {
						if (!global.__watchIO) {
							const io = gba.io;
							const origs = ['store8','store16','store32'].map(fn => [fn, io[fn].bind(io)]);
							global.__watchIO = [];
							for (const [fn, orig] of origs) {
								const size = fn === 'store8' ? 1 : fn === 'store16' ? 2 : 4;
								io[fn] = function (offset, value) {
									try {
										const off = offset & 0x3ff;
										if ((off >= 0x1fe && off <= 0x209) || off === 0x050 || off === 0x054 || off === 0x000) {
											global.__watchIO.push({ frame: meta.frames, addr: '0x04' + off.toString(16).padStart(4, '0'), val: '0x' + (value >>> 0).toString(16), w: size, lr: '0x' + (gba.cpu.gprs[14] >>> 0).toString(16), thumb: gba.cpu.execMode === gba.cpu.MODE_THUMB });
											if (global.__watchIO.length > 6000) global.__watchIO.shift();
										}
									} catch (e) {}
									return orig(offset, value);
								};
							}
						}
						const n = Math.min(parseInt(q.get('frames') || '120', 10), 3600);
						runFrames(n); saveState();
						j({ ok: true, frames: n, events: global.__watchIO.slice(-80) });
						break;
					}
					case '/pchist': {
						const n = Math.min(parseInt(q.get('frames') || '60', 10), 3600);
						const cpu = gba.cpu;
						const hist = new Map();
						const origStep = cpu.step.bind(cpu);
						cpu.step = function () {
							const pc = (this.gprs[15] - this.instructionWidth) >>> 0;
							hist.set(pc, (hist.get(pc) || 0) + 1);
							return origStep();
						};
						try { runFrames(n); } finally { cpu.step = origStep; }
						saveState();
						const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, parseInt(q.get('top') || '30', 10))
							.map(([pc, c]) => ({ pc: '0x' + pc.toString(16), count: c,
								zone: pc < 0x4000 ? 'BIOS' : pc >= 0x08000000 && pc < 0x0a000000 ? 'ROM' : pc >= 0x02000000 && pc < 0x02040000 ? 'EWRAM' : pc >= 0x03000000 && pc < 0x03008000 ? 'IWRAM' : 'other' }));
						let total = 0; for (const c of hist.values()) total += c;
						j({ ok: true, frames: n, totalSteps: total, distinct: hist.size, top });
						break;
					}
					case '/swilog': {
						j({ ok: true, log: (gba.__swiLog || []).slice(-80) });
						break;
					}
					case '/flashlog': {
						j({ ok: true, log: (gba.__flashLog || []).slice(-100), saveType: gba.mmu.save ? gba.mmu.save.constructor.name : '(无)', size: gba.mmu.save ? gba.mmu.save.view.byteLength : 0 });
						break;
					}
					case '/dmalog': {
						j({ ok: true, log: (gba.__dmaLog || []).slice(-200) });
						break;
					}
					case '/ielog': {
						j({ ok: true, log: (gba.__ieLog || []).slice(-60) });
						break;
					}
					case '/regs': {
						const names = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','fp','ip','sp','lr','pc'];
						const gprs = {};
						gba.cpu.gprs.forEach((v, i) => { gprs[names[i]] = '0x' + (v >>> 0).toString(16).padStart(8, '0'); });
						const cpuD = gba.cpu, irqD = cpuD.irq;
						j({ ok: true, gprs, mode: cpuD.execMode === cpuD.MODE_THUMB ? 'THUMB' : 'ARM', cpsr: '0x' + (cpuD.cpsr >>> 0).toString(16),
							cpsrI: !!cpuD.cpsrI, cpuMode: cpuD.mode, springIRQ: !!irqD.springIRQ, irqEnable: !!irqD.enable,
							enabledIRQs: '0x' + (irqD.enabledIRQs >>> 0).toString(16), interruptFlags: '0x' + (irqD.interruptFlags >>> 0).toString(16),
							irqNextEvent: irqD.nextEvent, cpuCycles: cpuD.cycles, halted: !!cpuD.halted });
						break;
					}
					case '/rompatch': {
						// 运行时改写 ROM 缓冲（用于临时 NOP 掉指令），写后失效对应 icache 页
						const addr = parseAddr(q.get('addr'));
						const hexs = (q.get('hex') || '').replace(/[^0-9a-fA-F]/g, '');
						const region = gba.mmu.memory[addr >>> 24];
						if (!region || !region.view) throw new Error('非法区域 0x' + (addr >>> 24).toString(16));
						const off = addr & 0x00ffffff;
						for (let i = 0; i < hexs.length; i += 2) {
							region.view.setUint8(off + (i >> 1), parseInt(hexs.substr(i, 2), 16));
						}
						// ROMView.invalidatePage 是空操作，直接标脏对应 icache 页 (ROMView PAGE_BITS=10)
						if (region.icache && region.ICACHE_PAGE_BITS) {
							const pb = 1 << region.ICACHE_PAGE_BITS;
							const n = hexs.length >> 1;
							for (let p = (off & ~3) >> region.ICACHE_PAGE_BITS; p <= (off + n) >> region.ICACHE_PAGE_BITS; ++p) {
								const pg = region.icache[p];
								if (pg) pg.invalid = true;
							}
						}
						j({ ok: true, addr: '0x' + addr.toString(16), n: hexs.length >> 1 });
						break;
					}
					case '/hookadd': {
						const addr = parseAddr(q.get('addr'));
						const name = q.get('name') || ('hook0x' + addr.toString(16));
						hookMap.set(addr, name);
						meta.hooks = [...hookMap].map(([v, n]) => ({ addr: v, name: n }));
						installHook(); saveState();
						j({ ok: true, addr: '0x' + addr.toString(16), name });
						break;
					}
					case '/hookclear': {
						hookMap = new Map(); meta.hooks = []; saveState();
						j({ ok: true });
						break;
					}
					case '/hookevents': {
						const tail = Math.min(parseInt(q.get('tail') || '20', 10), 1000);
						let events = [];
						if (fs.existsSync(HOOK_FILE)) {
							const lines = fs.readFileSync(HOOK_FILE, 'utf8').split('\n').filter(Boolean);
							events = lines.slice(-tail).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
						}
						j({ ok: true, count: events.length, events });
						break;
					}
	default: {
					// 静态文件：页面与脚本由 serve 自身提供（同源，免 CORS/免 python http.server）
					let sp;
					try { sp = decodeURIComponent(u.pathname); } catch (e) { sp = null; }
					if (sp === '/') sp = '/memview.html';
					if (sp && /\.(html|js|css|png|jpg|jpeg|ico|bin|md|txt)$/i.test(sp)) {
						const fp = path.join(__dirname, sp);
						if (fp.startsWith(__dirname) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
							const type = (/\.html?$/i.test(sp) ? 'text/html; charset=utf-8'
								: /\.js$/i.test(sp) ? 'text/javascript; charset=utf-8'
								: /\.css$/i.test(sp) ? 'text/css; charset=utf-8' : 'application/octet-stream');
							jbin(fs.readFileSync(fp), type);
							break;
						}
					}
					res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
					out = JSON.stringify({ ok: false, error: '未知端点: ' + u.pathname });
				}
				}
			} catch (e) {
				res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
				out = JSON.stringify({ ok: false, error: String(e && e.message || e) });
			}
			res.end(out);
		});
		if (readServeLock()) {
			// 自动接管：杀掉旧 serve 进程后重启，避免手动找 PID/taskkill
			const oldLock = readServeLock();
			let killed = false;
			if (oldLock.pid && oldLock.pid !== process.pid) {
				try {
					const cp = require('child_process');
					if (process.platform === 'win32') {
						// 校验 PID 确实是 romctl serve，防止 PID 被复用时误杀无关进程
						const out = cp.execSync(
							`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${oldLock.pid}' -ErrorAction SilentlyContinue).CommandLine"`,
							{ encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
						if (/romctl/i.test(out)) {
							cp.execSync(`taskkill /F /PID ${oldLock.pid}`, { stdio: 'ignore' });
							killed = true;
						}
					} else {
						process.kill(oldLock.pid);
						killed = true;
					}
				} catch (e) { /* 旧进程已死或校验失败：当作残留锁清理 */ }
			}
			if (!killed) { try { fs.unlinkSync(serveLockFile); } catch (e) {} }
			// 等端口释放（旧进程退出 + 内核回收监听套接字）
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200);
			console.log('已终止旧 serve (PID ' + oldLock.pid + (killed ? '' : '，进程不存在，清理残留锁') + ')，重新启动...');
		}
		process.on('SIGINT', () => { try { fs.unlinkSync(serveLockFile); } catch (e) {} process.exit(0); });
		server.on('error', (e) => { console.error('serve 启动失败（端口被占用？）: ' + e.message); process.exit(1); });
		server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request'); } catch (e) {} }); // 浏览器异常断开的残留请求

		// guardian 默认关闭（2026-09-04 修订）：EliteRedux 转场调查证实 guardian 的 EWRAM 重注入
		// 会掩盖真问题（任务停摆后重注入重启引擎重新 spawn 任务，制造修复假象），见 docs/技术报告 §4.6。
		// 需要 battle 转场守护时用 /guardian?on=1 手动开启。
		global.__guardian = false;
		/* ==================== WebSocket 通道（2026-09-04）====================
		 * 手写最小 WS 实现（无 npm 依赖）。解决 HTTP 轮询架构的三个结构性卡顿：
		 * 1) 每请求 15-60ms 基础开销 → WS 每消息 <1ms；
		 * 2) 浏览器同域 6 连接池竞争（/play、/audio、面板互相排队）→ 1 个长连接；
		 * 3) 客户端拉模式（按键等下一批边界 ~400ms）→ 服务端推模式，帧好了就推。
		 * 协议：客户端→服务端 JSON 文本 {t:'hello'|'play'|'pad',...}；
		 *       服务端→客户端 二进制 [type,0,0,0]+payload（type1=BMP 帧、type2=float32 交错音频，
		 *       4 字节头保证 Float32Array 视图对齐）；文本=JSON 状态。
		 * HTTP 端点全部保留（CLI/工具继续用）；面板等低频请求仍走 HTTP。 */
		const crypto = require('crypto');
		const WS_CLIENTS = new Set();
		const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
		const wsAcceptKey = k => crypto.createHash('sha1').update(k + WS_GUID).digest('base64');
		server.on('upgrade', (req, sock) => {
			try {
				const key = req.headers['sec-websocket-key'];
				if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
				sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + wsAcceptKey(key) + '\r\n\r\n');
				sock.setNoDelay(true);
				const conn = { sock, buf: Buffer.alloc(0), frags: null, fragOp: 0, audioSent: -1, playing: false };
				WS_CLIENTS.add(conn);
				sock.on('data', d => wsOnData(conn, d));
				const gone = () => { WS_CLIENTS.delete(conn); try { sock.destroy(); } catch (e) {} };
				sock.on('close', gone); sock.on('error', gone);
			} catch (e) { try { sock.destroy(); } catch (e2) {} }
		});
		function wsSend(conn, opcode, payload) {
			if (!conn || conn.sock.destroyed) return false;
			const len = payload.length; let head;
			if (len < 126) head = Buffer.from([0x80 | opcode, len]);
			else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
			else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
			try { conn.sock.write(Buffer.concat([head, payload])); return true; } catch (e) { return false; }
		}
		const wsSendJson = (conn, o) => wsSend(conn, 1, Buffer.from(JSON.stringify(o)));
		function wsOnData(conn, d) {
			conn.buf = conn.buf.length ? Buffer.concat([conn.buf, d]) : d;
			for (;;) {
				const b = conn.buf;
				if (b.length < 2) return;
				const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
				let len = b[1] & 0x7f, off = 2;
				if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
				else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
				let mk = null;
				if (masked) { if (b.length < off + 4) return; mk = b.subarray(off, off + 4); off += 4; }
				if (b.length < off + len) return;
				let payload = b.subarray(off, off + len);
				if (mk) { const u = Buffer.allocUnsafe(len); for (let i = 0; i < len; i++) u[i] = payload[i] ^ mk[i & 3]; payload = u; }
				conn.buf = b.subarray(off + len);
				if (op === 0) { if (conn.frags) { conn.frags.push(payload); if (fin) { wsHandle(conn, Buffer.concat(conn.frags), conn.fragOp); conn.frags = null; } } }
				else if (fin) wsHandle(conn, payload, op);
				else { conn.frags = [payload]; conn.fragOp = op; }
			}
		}
		function wsHandle(conn, payload, op) {
			if (op === 8) { wsSend(conn, 8, Buffer.alloc(0)); WS_CLIENTS.delete(conn); return; }
			if (op === 9) { wsSend(conn, 10, payload); return; }
			if (op !== 1) return;
			let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch (e) { return; }
			switch (msg.t) {
				case 'hello': conn.audioSent = -1; wsSendJson(conn, { t: 'hello', ok: true, rom: meta.rom, frames: meta.frames }); break;
				case 'play': conn.playing = !!msg.on; break;
				case 'pad': {
					const keys = Array.isArray(msg.keys) ? msg.keys.map(k => String(k).toUpperCase()) : [];
					let mask = 0;
					for (const k of keys) if (k in KEYMAP) mask |= KEYMAP[k];
					heldMask = mask;
					gba.keypad.currentDown = ~heldMask & 0x3ff;
					if (sess.on) recordStep('pad', { keys });
					break;
				}
			}
		}
		// 服务端帧泵：有 playing 客户端才跑；实时节流（帧数×16.7ms）；帧+音频主动推送
		let wsPumping = false;
		const WS_BATCH = 16;
		// 精确睡眠：Windows setTimeout 粒度 ~15ms 会把每帧 16.7ms 预算膨胀到 ~25ms（帧率掉到 39fps）。
		// Atomics.wait 主线程可用（浏览器才禁），精度 ~1ms 且不烧 CPU；<1.5ms 残余用忙等
		const WS_ATOMIC = new Int32Array(new SharedArrayBuffer(4));
		// Windows 系统定时器粒度 15.6ms：Atomics.wait/setTimeout 都被量化（睡 5-10ms 实际睡 15.6ms
		// → 每帧膨胀到 ~28ms=36fps）。泵内残余(<25ms)用忙等消除；仅游戏运行时段占约半核，
		// 空闲（无 playing 客户端）不进此路径
		function preciseSleep(ms) {
			if (ms <= 0.3) return;
			const end = performance.now() + ms;
			if (ms > 25) { try { Atomics.wait(WS_ATOMIC, 0, 0, ms - 14); } catch (e) {} }
			while (performance.now() < end) { }
		}
		async function wsPump() {
			if (wsPumping) return; wsPumping = true;
			let bmpMsg = null; // 帧消息复用缓冲（避免每帧 Buffer.concat 分配 115KB）
			while (true) {
				const playing = [...WS_CLIENTS].filter(c => c.playing && !c.sock.destroyed);
				if (!playing.length) { await new Promise(r => setTimeout(r, 80)); continue; }
				const t0 = Date.now(); const __t1 = t0;
				gba.keypad.currentDown = ~heldMask & 0x3ff;
				try { runFrames(1); } catch (e) { console.error('ws pump:', e.message); await new Promise(r => setTimeout(r, 500)); continue; }
				const __t2 = Date.now();
				if (meta.frames - lastPersistFrame >= 1800) { saveState(); lastPersistFrame = meta.frames; } // ~30s 一次：落盘耗时数百ms，过频=周期性掉帧
				// ★每帧推 BMP：模拟 60fps = 视觉 60fps（攒批推送会掉到 4fps=画面卡顿主因）
				const pd = gba.video.renderPath.pixelData;
				if (pd) {
					const bmp = makeBMPBuffer(pd.data, pd.width, pd.height);
					if (!bmpMsg || bmpMsg.length !== bmp.length + 4) bmpMsg = Buffer.concat([Buffer.from([1, 0, 0, 0]), bmp]);
					else bmp.copy(bmpMsg, 4);
					for (const c of playing) wsSend(c, 2, bmpMsg);
				}
				const __t3 = Date.now();
				wsPushAudio(playing);
				if ((meta.frames & 0x1FF) === 0) console.log('[pump] run=' + (__t2-__t1) + 'ms bmp+send=' + (__t3-__t2) + 'ms total=' + (__t3-__t1) + 'ms');
				// ★必须让出事件循环（setImmediate 还栈处理 I/O），否则同步泵会饿死一切收包
				await new Promise(r => setImmediate(r));
				preciseSleep(16.7 - (Date.now() - t0));
			}
		}
		function wsPushAudio(conns) {
			const a = gba.audio;
			if (!a || !a.buffers) return;
			const mask = a.sampleMask, cur = a.samplePointer >>> 0;
			for (const c of conns) {
				let sent = c.audioSent;
				if (sent < 0 || sent > mask) { sent = (cur - 4096 + (mask + 1)) & mask; c.audioSent = sent; } // 从写指针后方 0.125s 起步
				let n = (cur - sent + (mask + 1)) & (mask >>> 0);
				if (n > (mask + 1) / 2) n = (mask + 1) / 2;
				if (n < 8192) continue; // ≥0.25s 才推，减少消息数
				const f32 = new Float32Array(n * 2);
				let p = sent;
				for (let i = 0; i < n; i++) { f32[i * 2] = a.buffers[0][p]; f32[i * 2 + 1] = a.buffers[1][p]; p = (p + 1) & mask; }
				c.audioSent = p;
				wsSend(c, 2, Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from(f32.buffer, 0, f32.byteLength)]));
			}
		}
		wsPump(); // 常驻：无 playing 客户端时自闲置
		server.listen(port, () => {
			// 锁在 listen 成功后创建：启动失败不会污染/删除在运行实例的锁
			fs.writeFileSync(serveLockFile, JSON.stringify({ port, pid: process.pid, time: Date.now() }));
			// 心跳：锁文件被外部意外删除时 10s 内自动恢复，避免单写者保护失效
			setInterval(() => { try { fs.writeFileSync(serveLockFile, JSON.stringify({ port, pid: process.pid, time: Date.now() })); } catch (e) {} }, 10000);
			console.log('serve 监听 http://localhost:' + port + '（Ctrl-C 退出；rom=' + meta.rom + '，帧=' + meta.frames + '）');
			const url = 'http://127.0.0.1:' + port + '/memview.html';
			// 自动打开调试页面（memview 由 serve 静态提供，同源直连）
			try {
				const cp = require('child_process');
				if (process.platform === 'win32') cp.exec('start "" "' + url + '"', { shell: 'cmd.exe', stdio: 'ignore' });
				else if (process.platform === 'darwin') cp.exec('open "' + url + '"');
				else cp.exec('xdg-open "' + url + '"');
			} catch (e) {}
		});
		setInterval(() => {}, 1 << 30); // 保活
		break;
	}
	case 'hook':
		cmdHook();
		break;
	default:
		throw new Error('未知命令: ' + cmd);
}
function cmdHook() {
	const sub = args[0];
	if (sub === 'add') {
		let a = args[1];
		if (a === 'preset') a = args[2]; // hook add preset <rs|emerald>
		let addr, name;
		if (PRESETS[a]) {
			for (const [n, v] of Object.entries(PRESETS[a])) hookMap.set(v, n);
			console.log(`OK 预设 [${a}]: ` + Object.entries(PRESETS[a]).map(([n, v]) => `${n}@0x${v.toString(16)}`).join(' '));
		} else {
			addr = parseAddr(a);
			name = args[2] || ('hook0x' + addr.toString(16));
			hookMap.set(addr, name);
			console.log(`OK hook ${name} @ 0x${addr.toString(16)}`);
		}
		installHook();
		meta.hooks = [...hookMap].map(([v, n]) => ({ addr: v, name: n }));
		saveState();
		return;
	}
	if (sub === 'clear') {
		hookMap = new Map();
		meta.hooks = [];
		if (fs.existsSync(HOOK_FILE)) fs.unlinkSync(HOOK_FILE);
		saveState();
		console.log('OK hooks 已清空');
		return;
	}
	if (sub === 'list') {
		for (const [addr, name] of hookMap) console.log(`0x${addr.toString(16).padStart(8, '0')}  ${name}`);
		if (!hookMap.size) console.log('（无 hook，用 hook add <addr> [name] 或 hook add preset <rs|emerald>）');
		return;
	}
	if (sub === 'events') {
		if (!fs.existsSync(HOOK_FILE)) { console.log('（无事件，先 hook add 再 run/key）'); return; }
		const lines = fs.readFileSync(HOOK_FILE, 'utf8').trim().split('\n');
		const lastIdx = args.indexOf('--last');
		const n = lastIdx >= 0 ? parseInt(args[lastIdx + 1], 10) : 20;
		const slice = lines.slice(-n);
		if (args.includes('--chars')) {
			// 把事件解码为字符流（按 name 分组）
			const byName = {};
			for (const l of lines) {
				const e = JSON.parse(l);
				const d = e.decoded;
				if (!d || d.charId == null) continue;
				(byName[e.name] = byName[e.name] || []).push(d);
			}
			for (const [name, ds] of Object.entries(byName)) {
				const chars = ds.map(d => d.isChinese
					? `[0x${d.charId.toString(16).toUpperCase()}]`
					: String.fromCharCode(d.charId >= 0x20 && d.charId < 0x7f ? d.charId : 0xb7));
				const cn = ds.filter(d => d.isChinese).length;
				console.log(`== ${name}: ${ds.length} 字符（其中汉字 ${cn}）`);
				console.log('   ' + chars.join(' '));
			}
			return;
		}
		for (const l of slice) {
			const e = JSON.parse(l);
			const d = e.decoded;
			let extra = '';
			if (d && d.charId != null) extra = ` | font=${d.fontNum} lang=${d.lang} charId=0x${d.charId.toString(16)}${d.isChinese ? ' [汉字]' : ''}`;
			console.log(`f${String(e.frame).padStart(6)} ${e.name.padEnd(12)} r0=0x${(e.r0 || 0).toString(16).padStart(8)} r1=0x${(e.r1 || 0).toString(16).padStart(8)}${extra}`);
		}
		console.log(`（${lines.length} 条事件，显示最后 ${slice.length} 条；用 --chars 看字符流）`);
		return;
	}
	throw new Error('用法: hook add <addr|preset> [name] | clear | list | events [--last N] [--chars]');
}


function readTitle() {
	try {
		let t = '';
		for (let i = 0; i < 12; i++) t += String.fromCharCode(gba.mmu.loadU8(0x080000a0 + i) & 0xff);
		return t.trim() || '(空)';
	} catch (e) { return '(未知)'; }
}

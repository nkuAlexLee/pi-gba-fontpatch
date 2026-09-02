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
	fs.writeFileSync(file, buf);
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
		cpu: gba.cpu.freeze(),          // 纯数字/数组，JSON 安全
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
			if (pc >= 0x08000000 && pc < 0x0a000000) {
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

function saveState() {
	meta.frames = meta.frames || 0;
	meta.__snapshot = takeSnapshot();
	fs.writeFileSync(stateFile, JSON.stringify(meta));
}

function runFrames(n) {
	gba.paused = false;
	for (let i = 0; i < n; i++) {
		try {
			gba.advanceFrame();
		} catch (e) {
			// 崩溃诊断: 打印 CPU 现场
			const r = gba.cpu.gprs;
			const names = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','fp','ip','sp','lr','pc'];
			console.error('=== CPU 崩溃现场 (帧 ' + meta.frames + ') ===');
			for (let k = 0; k < 16; k += 4) {
				console.error(names.slice(k, k + 4).map((nm, j) => `${nm.padEnd(4)}=0x${(r[k+j]>>>0).toString(16).padStart(8,'0')}`).join('  '));
			}
			console.error('mode = ' + (gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM'));
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
		 */
		const http = require('http');
		const port = parseInt(args[0] || '8645', 10);
		const cpuInfo = () => ({
			pc: '0x' + (gba.cpu.gprs[15] >>> 0).toString(16),
			mode: gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM',
			warn: lastError || undefined,
		});
		const server = http.createServer((req, res) => {
			let out;
			try {
				const u = new URL(req.url, 'http://localhost');
				const q = u.searchParams;
				const j = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); out = JSON.stringify(obj); };
				switch (u.pathname) {
					case '/status':
						j({ ok: true, rom: meta.rom, frames: meta.frames, hooks: (meta.hooks || []).map(h => ({ addr: '0x' + h.addr.toString(16), name: h.name })), ...cpuInfo() });
						break;
					case '/load': {
						const romPath = q.get('rom');
						const buf = fs.readFileSync(path.resolve(romPath));
						gba.setRom(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
						meta = { frames: 0, rom: path.resolve(romPath) };
						hookMap = new Map(); meta.hooks = []; hookInstalled = false;
						runFrames(1); saveState();
						j({ ok: true, rom: meta.rom, title: readTitle(), ...cpuInfo() });
						break;
					}
					case '/run': {
						const n = Math.min(parseInt(q.get('frames') || '1', 10), 3600);
						runFrames(n); saveState();
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
						for (let i = 0; i * 2 < bytes.length; i++) gba.mmu.store8(addr + i, parseInt(bytes.substr(i * 2, 2), 16));
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
					default:
						res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
						out = JSON.stringify({ ok: false, error: '未知端点: ' + u.pathname });
				}
			} catch (e) {
				res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
				out = JSON.stringify({ ok: false, error: String(e && e.message || e) });
			}
			res.end(out);
		});
		server.listen(port, () => console.log('serve 监听 http://localhost:' + port + '（Ctrl-C 退出；rom=' + meta.rom + '，帧=' + meta.frames + '）'));
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

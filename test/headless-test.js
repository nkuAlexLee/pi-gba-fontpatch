/**
 * Headless smoke test: run the emulator loop in Node with a stubbed DOM,
 * feed it a test ROM, and verify that (a) frames advance, (b) the screen
 * content actually changes (i.e. the game is rendering, not stuck).
 *
 * Usage: node test/headless-test.js <romPath> [frames]
 *
 * All emulator scripts are concatenated into a single scope together with
 * the test body, since top-level class declarations inside eval() are
 * scoped to that single evaluation.
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------------- minimal DOM stubs ---------------- */
let screenHashes = [];
let lastPixels = null;

function makeCanvasStub() {
	return {
		offsetWidth: 480,
		offsetHeight: 320,
		width: 480,
		height: 320,
		getContext() {
			return {
				createImageData(w, h) {
					return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
				},
				putImageData(img) {
					// hash the frame so we can detect animation
					const d = img.data;
					let acc = 0;
					for (let i = 0; i < d.length; i += 97) acc = (acc * 31 + d[i]) >>> 0;
					screenHashes.push(acc);
					lastPixels = img.data;
				},
				drawImage() {},
				getImageData() { return lastPixels; },
				clearRect() {},
			};
		},
	};
}

const STUBS = `
const __window = {
	setTimeout: (f, t) => setTimeout(f, t),
	clearTimeout,
	localStorage: { getItem: () => null, setItem: () => {} },
	addEventListener: () => {},
};
global.window = __window;
window.AudioContext = undefined;
global.document = { createElement: () => makeCanvasStub(), addEventListener: () => {} };
function makeCanvasStub() {
	return {
		offsetWidth: 480, offsetHeight: 320, width: 480, height: 320,
		getContext() {
			return {
				createImageData(w, h) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
				putImageData() {}, drawImage() {}, getImageData() { return null; }, clearRect() {}, setAttribute() {},
			};
		},
		setAttribute() {},
	};
}
global.FileReader = function () {};
global.XMLHttpRequest = function () {};
window.atob = (b64) => Buffer.from(b64, 'base64').toString('binary');
window.btoa = (s) => Buffer.from(s, 'binary').toString('base64');
`;

const SCRIPTS = [
	'js/util.js', 'js/core.js', 'js/arm.js', 'js/thumb.js', 'js/mmu.js',
	'js/io.js', 'js/audio.js', 'js/video.js', 'js/video/proxy.js',
	'js/video/software.js', 'js/irq.js', 'js/keypad.js', 'js/sio.js',
	'js/savedata.js', 'js/gpio.js', 'js/gba.js', 'resources/biosbin.js',
];

const TEST_BODY = `
/* ================= test body ================= */
const romPath = ${JSON.stringify(process.argv[2])};
const frameTarget = parseInt(${JSON.stringify(process.argv[3] || '300')}, 10);

let screenHashes = [];
let lastPixels = null;
function makeCanvasStub() {
	return {
		offsetWidth: 480, offsetHeight: 320, width: 480, height: 320,
		getContext() {
			return {
				createImageData(w, h) {
					return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
				},
				putImageData(img) {
					const d = img.data;
					let acc = 0;
					for (let i = 0; i < d.length; i += 97) acc = (acc * 31 + d[i]) >>> 0;
					screenHashes.push(acc);
					lastPixels = img.data;
				},
				drawImage() {}, getImageData() { return lastPixels; }, clearRect() {}, setAttribute() {},
			};
		},
		setAttribute() {},
	};
}

const gba = new GameBoyAdvance();
const canvas = makeCanvasStub();
gba.setCanvas(canvas);
gba.setBios(biosBin);
gba.logLevel = gba.LOG_ERROR | gba.LOG_WARN;

const __fs = __require('fs');
const __path = __require('path');
const romBuf = __fs.readFileSync(__path.resolve(romPath));
const ab = romBuf.buffer.slice(romBuf.byteOffset, romBuf.byteOffset + romBuf.byteLength);
const ok = gba.setRom(ab);
if (!ok) { console.log('RESULT: setRom FAILED'); process.exit(1); }

let frames = 0, errors = 0;
const t0 = Date.now();
try {
	gba.paused = false;
	for (frames = 0; frames < frameTarget; frames++) {
		gba.advanceFrame();
	}
} catch (e) {
	errors++;
	console.log('EXCEPTION at frame ' + frames + ':', e.message);
	console.log(e.stack.split('\\n').slice(0, 5).join('\\n'));
}

const unique = new Set(screenHashes).size;
console.log('--- headless result ---');
console.log('frames executed :', frames);
console.log('frames rendered :', screenHashes.length);
console.log('unique frames   :', unique, unique > 1 ? '(画面在变化 OK)' : '(画面静止 BAD)');
console.log('exceptions      :', errors);
console.log('elapsed         :', Date.now() - t0, 'ms');
console.log('PC              : 0x' + (gba.cpu.gprs[15] >>> 0).toString(16));
console.log('mode            :', gba.cpu.execMode === gba.cpu.MODE_THUMB ? 'THUMB' : 'ARM');
`;

const code = STUBS + '\n' + SCRIPTS.map(s => fs.readFileSync(path.join(__dirname, '..', s), 'utf8')).join('\n;\n') + '\n' + TEST_BODY;
global.__require = require;
(0, eval)(code);

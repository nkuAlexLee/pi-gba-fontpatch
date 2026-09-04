'use strict';
/**
 * export-missing.js — 全 ROM 字符串普查：找出指针引导导出漏掉的串
 *
 *   node export-missing.js --project <目录> [--add] [--min-letters 6]
 *
 * 原理：
 *   1. 全 ROM 逐段扫 FF 终止的串，用码表盲解码（noHan 英文模式）
 *   2. 可读性过滤（字母数、拉丁占比、控制码占比）
 *   3. 跳过已被现有工程条目物理覆盖的范围（id 起点起 max_bytes 区间）
 *   4. 跳过字库注入区 / append 区 / 全 00/FF 区
 *   5. 剩余 = 漏网串；--add 时自动登记进工程（status=untranslated）
 *
 * 漏因分类（对每条检测引用方式）：
 *   start-ptr  = 有指向串首的指针（此前应被导出，若漏即过滤误杀）
 *   inner-ptr  = 只有指向串内部的指针（别名剔除误杀，insert 只能原地覆盖）
 *   no-ptr     = 无任何静态指针（运行时计算引用，只能原地覆盖）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCharmap, decode } = require('./lib/charmap');
const csv = require('./lib/csv');

function parseArgv(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[a.slice(2)] = argv[++i];
			else args[a.slice(2)] = true;
		} else args._.push(a);
	}
	return args;
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const config = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
	const romPath = path.isAbsolute(config.rom) ? config.rom : path.resolve(root, config.rom);
	const rom = fs.readFileSync(romPath);
	const cm = loadCharmap(config.charmap);

	const files = fs.readdirSync(path.join(root, 'strings')).filter(f => f.endsWith('.csv')).map(f => path.join(root, 'strings', f));
	const rows = [];
	for (const f of files) rows.push(...csv.readObjects(f));
	const covered = [];   // 已覆盖物理区间
	const have = new Set(rows.map(r => r.id.toLowerCase()));
	for (const r of rows) {
		const off = parseInt(r.id, 16);
		if (!isNaN(off)) covered.push([off, off + Number(r.max_bytes || 1) - 1]);
	}
	covered.sort((a, b) => a[0] - b[0]);

	// 排除区：字库注入 + 代码洞 + append 区（从 project.json append_addr 到 ROM 尾）
	const skipRanges = [[0x168A4D8, 0x1777D18]];
	if (config.append_addr) {
		const a = parseInt(config.append_addr, 16) - 0x08000000;
		skipRanges.push([a, rom.length - 1]);
	}
	const inSkip = (p) => skipRanges.some(([s, e]) => p >= s && p <= e);
	const inCovered = (s, e) => {
		// 二分找第一个覆盖起点 >= s
		let lo = 0, hi = covered.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (covered[mid][1] < s) lo = mid + 1;
			else hi = mid - 1;
		}
		for (let i = lo; i < covered.length && covered[i][0] <= e; i++) {
			const [cs, ce] = covered[i];
			if (cs <= s && e <= ce) return true;         // 完全被覆盖
			if (s < ce && cs < e) return true;           // 部分重叠也算已处理
		}
		return false;
	};

	const minLetters = Number(args['min-letters'] || 6);
	const words = (t) => t.replace(/\[[^\]]*\]/g, ' ').split(/[^A-Za-z']+/).filter(w => w.length >= 3);
	const missing = [];
	let scanned = 0;
	const t0 = Date.now();
	// ★一次性构建指针索引: 0x08xxxxxx-0x09xxxxxx 的 4 字节值 → 出现次数
	console.error('  构建指针索引…');
	const ptrIndex = new Map();
	for (let p2 = 0; p2 <= rom.length - 4; p2++) {
		if (rom[p2 + 3] === 0x08 || rom[p2 + 3] === 0x09) {
			const v = rom.readUInt32LE(p2);
			if (v >= 0x08000000 && v < 0x0A000000) ptrIndex.set(v, (ptrIndex.get(v) || 0) + 1);
		}
	}
	console.error('  指针索引:', ptrIndex.size, '个不同地址');
	// ★FF 锚点扫描: 原生 indexOf 定位 FF 边界, 每个间隙只解码一次（比逐字节快百倍）
	let q = 0x100;
	while (q < rom.length - 4) {
		const ff = rom.indexOf(0xFF, q);
		const runEnd = ff === -1 ? rom.length - 4 : ff;
		const runLen = runEnd - q;
		if (runLen >= 6 && !inSkip(q)) {
			const d = decode(rom, q, cm, { noHan: true, maxLen: runLen + 1, escPrefix: config.escPrefix });
			if (d.terminated && d.end - q >= 6) {
				const txt = d.text;
				const ascii = [...txt].filter(c => c.codePointAt(0) >= 0x20 && c.codePointAt(0) <= 0x7E).length;
				const acc = [...txt].filter(c => c.codePointAt(0) >= 0xC0 && c.codePointAt(0) <= 0xFF).length;
				const vw = words(txt).filter(w => /[aeiouyAEIOUY]/.test(w)).length;
				const qualityOk = ascii / txt.length >= 0.85 && acc <= 2 && vw >= 2;
				if (qualityOk && txt.replace(/[^A-Za-z]/g, '').length >= minLetters && !inCovered(q, q + (d.end - q))) {
					const gba = 0x08000000 + q;
					const start = ptrIndex.get(gba) || 0;
					let inner = 0;
					for (let o = 1; o <= Math.min(d.end - q, 32); o++) inner += (ptrIndex.get(gba + o) || 0);
					// 片段判定: 去掉前导空格后首字符为小写字母/标点 = 别的串的中间段
					const trimmed = txt.replace(/^ +/, '');
					const first = trimmed[0] || '';
					const frag = /[a-z]/.test(first) || /[.,;:)\]'}]/.test(first);
					missing.push({ off: q, text: txt, ref: start ? 'start-ptr' : (inner ? 'inner-ptr' : 'no-ptr'), fragment: frag, byteLen: d.end - q + 1 });
				}
			}
		}
		q = runEnd + 1;
	}
	console.error(`扫描完成 ${((Date.now() - t0) / 1000).toFixed(0)}s, 候选串 ${scanned}, 漏网 ${missing.length}`);

	// 汇总
	const byRef = { 'start-ptr': 0, 'inner-ptr': 0, 'no-ptr': 0 };
	for (const m of missing) byRef[m.ref]++;
	console.log('漏因分布:', JSON.stringify(byRef));
	const outFile = path.join(root, 'report', 'missing-strings.json');
	fs.mkdirSync(path.dirname(outFile), { recursive: true });
	fs.writeFileSync(outFile, JSON.stringify(missing.map(m => ({
		id: m.off.toString(16).padStart(8, '0'),
		addr_gba: '0x' + (0x08000000 + m.off).toString(16),
		en: m.text, ref: m.ref, fragment: !!m.fragment,
		// ★字节数必须用 FF 实际位置（d.end），不能用 JS 字符串长度：
		//   控制码 token（[']、[/n]、[玩家] 等）解码后一字符占多字符但只占 1-2 字节，
		//   text.length 虚高 → insert 残尾清 FF 越界抹掉下一条串头部（串行/吞串）
		max_bytes: m.byteLen,
		max_chars: String(Math.floor((m.byteLen - 1) / 2))
	})), null, 1));
	console.log('→ ' + outFile);

	if (args.add) {
		const f = path.join(root, 'strings', 'main-text.csv');
		const all = csv.readObjects(f);
		const ids = new Set(all.map(r => r.id.toLowerCase()));
		let n = 0;
		for (const m of missing) {
			if (ids.has(m.id)) continue;
			all.push({
				id: m.id, addr_gba: '0x' + (0x08000000 + m.off).toString(16), scene: 'main-text', context: '',
				max_bytes: String(m.byteLen), max_chars: String(Math.floor((m.byteLen - 1) / 2)),
				en: m.text, mt: '', final: '', status: 'untranslated', notes: ' [add:census]'
			});
			n++;
		}
		all.sort((a, b) => parseInt(a.id, 16) - parseInt(b.id, 16));
		csv.writeObjects(f, all, []);
		console.log('已登记 ' + n + ' 条（CSV 已按地址重排序）');
	}
}

main();

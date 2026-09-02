'use strict';
/**
 * export-strings.js — 阶段1：从 ROM 静态提取字符串 → 翻译工程 CSV
 *
 * 用法:
 *   初始化翻译工程（一次性）:
 *     node export-strings.js init --project translation --rom roms/xxx.gba
 *
 *   扫描区域提取（可重复执行，自动 merge）:
 *     node export-strings.js scan --project translation --scene title-menu \
 *          --addr 0x0937E070 --len 0x180 [--min-chars 2] [--context "..."]
 *
 *   按已知字符串地址逐条登记（不扫描，精确登记，跳过垃圾）:
 *     node export-strings.js add  --project translation --scene title-menu \
 *          --addr 0x0937E070 [--addr 0x... ...]
 *
 * 说明:
 *   - addr 可用 GBA 地址（0x08xxxxxx）或文件偏移，自动识别
 *   - id = 8位十六进制文件偏移，是跨重导出的稳定主键
 *   - merge 规则: id 相同 → 保留 mt/final/status/notes；en 变化 → status=conflict
 *   - max_bytes = 原串字节数+1（含终止符），即"原地覆盖"的字节预算
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCharmap, decode } = require('./lib/charmap');
const csv = require('./lib/csv');

const HEADER = ['id', 'addr_gba', 'scene', 'context', 'max_bytes', 'max_chars', 'en', 'mt', 'final', 'status', 'notes'];

function parseArgv(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
				const val = argv[++i];
				// 同名参数多次出现 → 收集为数组（如 --addr A --addr B）
				if (args[key] === undefined) args[key] = val;
				else if (Array.isArray(args[key])) args[key].push(val);
				else args[key] = [args[key], val];
			} else args[key] = true;
		} else args._.push(a);
	}
	return args;
}

function toFileOffset(addr) {
	const n = typeof addr === 'number' ? addr : parseInt(addr, 16);
	if (isNaN(n)) throw new Error('非法地址: ' + addr);
	return n >= 0x08000000 ? n - 0x08000000 : n;
}
const gbaAddr = fileOff => '0x' + (0x08000000 + fileOff).toString(16).toUpperCase();
const hexId = fileOff => fileOff.toString(16).padStart(8, '0').toUpperCase();

function projectPaths(projectDir) {
	return {
		root: projectDir,
		config: path.join(projectDir, 'project.json'),
		stringsDir: path.join(projectDir, 'strings'),
		reportDir: path.join(projectDir, 'report'),
		backupDir: path.join(projectDir, 'import-backup'),
	};
}

function loadProject(projectDir) {
	const p = projectPaths(projectDir);
	if (!fs.existsSync(p.config)) {
		console.error('未找到 ' + p.config + '，先执行: node export-strings.js init --project ' + projectDir + ' --rom <rom路径>');
		process.exit(1);
	}
	const config = JSON.parse(fs.readFileSync(p.config, 'utf8'));
	// 相对路径统一基于工程根目录解析
	for (const k of ['charmap', 'glossary', 'rom']) {
		if (config[k] && !path.isAbsolute(config[k])) config[k] = path.resolve(projectDir, config[k]);
	}
	return { paths: p, config };
}

function scenePath(paths, scene) {
	return path.join(paths.stringsDir, scene + '.csv');
}

function loadSceneRows(paths, scene) {
	const f = scenePath(paths, scene);
	return fs.existsSync(f) ? csv.readObjects(f) : [];
}

function saveSceneRows(paths, scene, rows) {
	rows.sort((a, b) => a.id < b.id ? -1 : 1);
	csv.writeObjects(scenePath(paths, scene), rows, []);
}

/* ---------------- init ---------------- */
function cmdInit(args) {
	const projectDir = args.project || 'translation';
	const p = projectPaths(projectDir);
	if (fs.existsSync(p.config) && !args.force) {
		console.error('工程已存在: ' + p.config + '（--force 覆盖）'); process.exit(1);
	}
	[p.stringsDir, p.reportDir, p.backupDir].forEach(d => fs.mkdirSync(d, { recursive: true }));
	if (args.force) {
		// 重置：清空场景表与报告，避免旧数据混入
		for (const f of fs.readdirSync(p.stringsDir)) fs.unlinkSync(path.join(p.stringsDir, f));
	}
	const romPath = args.rom;
	if (romPath && !fs.existsSync(romPath)) { console.error('ROM 不存在: ' + romPath); process.exit(1); }
	const romSize = romPath ? fs.statSync(romPath).size : 0;
	// appendAddr 默认 = ROM 末尾前 0x10000（扩容区），实际使用前请人工确认该区域为空闲
	const config = {
		name: args.name || path.basename(projectDir),
		rom: romPath ? path.resolve(romPath) : '',
		rom_size: '0x' + romSize.toString(16),
		out_rom: 'tmp/汉化输出.gba',
		charmap: path.resolve(__dirname, '../../gba-font-crack/assets/wholewords.txt'),
		glossary: 'glossary.csv',
		append_addr: args['append-addr'] || ('0x' + (0x08000000 + romSize - 0x10000).toString(16)),
		min_status: 'human-reviewed',
		created: new Date().toISOString(),
		_scenes: {},
	};
	fs.writeFileSync(p.config, JSON.stringify(config, null, 2));
	// 术语表模板
	const glossaryPath = path.join(projectDir, config.glossary);
	if (!fs.existsSync(glossaryPath)) {
		csv.writeObjects(glossaryPath, [
			{ en: 'NEW GAME', zh: '新的游戏', note: '主菜单' },
			{ en: 'CONTINUE', zh: '继续游戏', note: '' },
			{ en: 'OPTION', zh: '选项', note: '' },
			{ en: 'POKéMON', zh: '宝可梦', note: '全局统一译名' },
		]);
	}
	console.log('✔ 翻译工程已初始化 →', path.resolve(projectDir));
	console.log('  下一步: node export-strings.js scan --project ' + projectDir + ' --scene <场景名> --addr <GBA地址> --len <字节数>');
}

/* ---------------- scan / add ---------------- */
function extractRegion(rom, start, len, charmap, minChars, maxLen) {
	const rows = [];
	let p = start;
	const end = Math.min(start + len, rom.length);
	while (p < end) {
		const r = decode(rom, p, charmap, { stopAtFF: true, maxLen });
		if (r.terminated && !r.invalid && r.end > p) {
			const contentLen = [...r.text].length;
			const hasContent = [...r.text].some(c => !/^\[.*\]$/.test(c));   // 排除纯控制码
			if (contentLen >= minChars && hasContent) {
				rows.push({ fileOff: p, text: r.text, byteLen: r.end - p + 1 }); // +1 = 终止符
				p = r.end + 1;
				continue;
			}
		}
		p += 1;
	}
	return rows;
}

function registerScene(cfg, scene, meta) {
	cfg._scenes = cfg._scenes || {};
	cfg._scenes[scene] = { ...(cfg._scenes[scene] || {}), ...meta };
}

function mergeRows(oldRows, newRows, scene) {
	const oldById = new Map(oldRows.map(r => [r.id, r]));
	const out = [];
	let added = 0, kept = 0, conflicted = 0;
	for (const n of newRows) {
		const id = hexId(n.fileOff);
		const prev = oldById.get(id);
		if (prev) {
			oldById.delete(id);
			if (prev.en !== n.text) {
				// 原文变了 → 冲突，人工裁决
				out.push({ ...prev, en: n.text, max_bytes: String(n.byteLen), status: 'conflict', notes: (prev.notes || '') + ' [重导出:原文已变化]' });
				conflicted++;
			} else {
				out.push(prev); kept++;
			}
		} else {
			out.push(makeRow(n, scene));
			added++;
		}
	}
	for (const [, orphan] of oldById) {
		out.push({ ...orphan, status: 'conflict', notes: (orphan.notes || '') + ' [重导出:原串已消失]' });
	}
	return { rows: out, added, kept, conflicted };
}

function makeRow(n, scene) {
	const maxBytes = n.byteLen;                       // 原串字节数（含终止符）= 原地覆盖预算
	return {
		id: hexId(n.fileOff),
		addr_gba: gbaAddr(n.fileOff),
		scene,
		context: '',
		max_bytes: String(maxBytes),
		max_chars: String(Math.floor((maxBytes - 1) / 2)),  // 纯中文时的字符数提示
		en: n.text,
		mt: '', final: '',
		status: 'untranslated',
		notes: '',
	};
}

function cmdScan(args) {
	const { paths, config } = loadProject(args.project || 'translation');
	const charmap = loadCharmap(config.charmap);
	const rom = fs.readFileSync(config.rom);
	const scene = args.scene;
	if (!scene) { console.error('缺少 --scene'); process.exit(1); }
	const start = toFileOffset(args.addr);
	const len = parseInt(args.len, 16) || 0x100;
	const minChars = parseInt(args['min-chars'], 10) || 2;
	const maxLen = parseInt(args['max-len'], 16) || 0x100;
	const found = extractRegion(rom, start, len, charmap, minChars, maxLen);
	const oldRows = loadSceneRows(paths, scene);
	const { rows, added, kept, conflicted } = mergeRows(oldRows, found, scene);
	if (args.context) rows.forEach(r => { if (!r.context) r.context = args.context; });
	saveSceneRows(paths, scene, rows);
	registerScene(config, scene, { type: 'scan', addr: gbaAddr(start), len: '0x' + len.toString(16), strings: found.length });
	fs.writeFileSync(paths.config, JSON.stringify(config, null, 2));
	console.log(`✔ 场景 ${scene}: 提取 ${found.length} 条 | 新增 ${added} | 保留 ${kept} | 冲突 ${conflicted}`);
	console.log('  →', path.resolve(scenePath(paths, scene)));
}

function cmdAdd(args) {
	const { paths, config } = loadProject(args.project || 'translation');
	const charmap = loadCharmap(config.charmap);
	const rom = fs.readFileSync(config.rom);
	const scene = args.scene;
	const addrs = args.addr ? (Array.isArray(args.addr) ? args.addr : [args.addr]) : [];
	if (!scene || !addrs.length) { console.error('用法: add --scene <名> --addr <地址> [--addr ...]'); process.exit(1); }
	const oldRows = loadSceneRows(paths, scene);
	const found = [];
	for (const a of addrs) {
		const off = toFileOffset(a);
		const r = decode(rom, off, charmap, { stopAtFF: true, maxLen: 0x400 });
		if (!r.terminated || r.invalid) {
			console.error(`✘ 0x${off.toString(16)}: 不是有效字符串（invalid=${r.invalid} terminated=${r.terminated}），跳过`);
			continue;
		}
		found.push({ fileOff: off, text: r.text, byteLen: r.end - off + 1 });
	}
	const { rows, added, kept, conflicted } = mergeRows(oldRows, found, scene);
	saveSceneRows(paths, scene, rows);
	registerScene(config, scene, { type: 'add', addrs: addrs.join(','), strings: found.length });
	fs.writeFileSync(paths.config, JSON.stringify(config, null, 2));
	console.log(`✔ 场景 ${scene}: 登记 ${found.length} 条 | 新增 ${added} | 保留 ${kept} | 冲突 ${conflicted}`);
}

/* ---------------- probe：文本区密度探测 ---------------- */
function cmdProbe(args) {
	const { config } = loadProject(args.project || 'translation');
	const charmap = loadCharmap(config.charmap);
	const rom = fs.readFileSync(config.rom);
	const blockSize = parseInt(args['block'] || '0x10000', 16);      // 默认 64KB/块
	const minChars = parseInt(args['min-chars'], 10) || 4;
	const maxLen = parseInt(args['max-len'], 16) || 0x100;
	console.log('块地址        字符串数  字符占比  有效文本字节  疑似文本区');
	for (let start = 0; start < rom.length; start += blockSize) {
		const rows = extractRegion(rom, start, blockSize, charmap, minChars, maxLen);
		if (!rows.length) continue;
		let textBytes = 0;
		// 有效文本 = 含至少一个字母/汉字的串（排除纯符号/控制码堆）
		let validCount = 0;
		for (const r of rows) {
			const hasWord = /[A-Za-z]{2,}|[\u4e00-\u9fff]/.test(r.text);
			if (hasWord) { textBytes += r.byteLen; validCount++; }
		}
		const ratio = (textBytes / blockSize * 100).toFixed(1);
		const likely = validCount >= 10 && ratio > 20 ? '◀◀◀' : (validCount >= 3 ? '◀' : '');
		console.log(
			'0x' + (0x08000000 + start).toString(16).padStart(8, '0').toUpperCase(),
			String(rows.length).padStart(6),
			String(validCount).padStart(8),
			(textBytes + 'B').padStart(10),
			ratio.padStart(6) + '%',
			likely
		);
	}
}

/* ---------------- dump：指针引导导出（推荐，质量最高） ----------------
 * 思路反转：不扫文本找指针，而是扫 ROM 里的 4 字节指针（0x08/0x09 开头），
 * 跟随到目标地址尝试解码字符串。能对上的几乎必然是游戏真文本：
 *   - 无需指针的垃圾（代码立即数、字形数据）天然被排除
 *   - 每条自带 pointers 列表 → repoint 阶段直接复用，免二次扫描
 *   - 同一串被多处引用自动合并，引用数即置信度
 */
/**
 * 文本可信度过滤（dump 专用）：指针可能碰巧指向非文本数据，用语言一致性+可读率拦截
 *   - lang=en: 英文基板不应出现汉字（CJK）；拉丁扩展仅允许 éáíóúñ（POKéMON 等合法重音）
 *   - 可读率 ≥ minRatio（默认 0.9）：[token] 挖除后统计 ASCII 可打印+CJK 占比
 */
function isPlausibleText(text, lang, minRatio) {
	let t = (text || '').replace(/\[[^\]]*\]/g, '\u0001');     // token 挖除
	if (lang === 'en') {
		if (/[\u4e00-\u9fff]/.test(t)) return false;            // CJK 混入英文文本
	}
	let good = 0;
	for (const c of t) {
		if (c === '\u0001' || (c >= ' ' && c <= '~') || /[\u4e00-\u9fff]/.test(c)) good++;
		else if (/[éáíóúñÁÉÍÓÚÑ°ºª¿¡]/.test(c)) good++;       // 英文游戏合法重音/符号
		// 其余（扩展拉丁/生僻符号）算 bad
	}
	return t.length > 0 && good / t.length >= minRatio;
}

function cmdDump(args) {
	const { paths, config } = loadProject(args.project || 'translation');
	const charmap = loadCharmap(config.charmap);
	const rom = fs.readFileSync(config.rom);
	const scene = args.scene;
	if (!scene) { console.error('缺少 --scene'); process.exit(1); }
	const from = toFileOffset(args.from || '0x08000000');
	const to = Math.min(toFileOffset(args.to || ('0x' + rom.length.toString(16))), rom.length);
	const minChars = parseInt(args['min-chars'], 10) || 3;
	const maxLen = parseInt(args['max-len'], 16) || 0x200;
	const maxStr = args['allow-long'] ? Infinity : (parseInt(args['budget'] || '256', 10));   // 超长串默认放弃（repoint 成本高，首版只要原地的）

	const lang = args.lang || 'en';
	const minRatio = parseFloat(args['min-ratio'] || '0.9');
	const byTarget = new Map();   // targetOff -> [ptrOff,...]
	for (let p = from; p <= to - 4; p++) {
		const v = rom.readUInt32LE(p);
		const hi = v >>> 24;
		if (hi !== 0x08 && hi !== 0x09) continue;
		const target = v - 0x08000000;
		if (target >= rom.length) continue;
		if (!byTarget.has(target)) byTarget.set(target, []);
		byTarget.get(target).push(p);
	}

	const found = [];
	let rejectedNoText = 0, rejectedTooLong = 0, rejectedBad = 0;
	for (const [target, ptrs] of byTarget) {
		// 指针表自身/代码也会被当 target——解码校验过滤
		// r = decode(rom, target, charmap, { stopAtFF: true, maxLen });
		// lang=en（英文基板）→ noHan：禁用汉字双字节，消除 05b8=纪 与 05=È+b8=, 的歧义
		const r = decode(rom, target, charmap, { stopAtFF: true, maxLen, noHan: lang === 'en' });
		if (!r.terminated || r.invalid || r.end === target) { rejectedBad++; continue; }
		const text = r.text;
		const hasWord = /[A-Za-z]{2,}|[\u4e00-\u9fff]/.test(text);
		if (!hasWord || [...text].length < minChars) { rejectedNoText++; continue; }
		if (!isPlausibleText(text, lang, minRatio)) { rejectedNoText++; continue; }
		const byteLen = r.end - target + 1;
		if (byteLen > maxStr) { rejectedTooLong++; continue; }
		found.push({ fileOff: target, text, byteLen, pointers: ptrs });
	}
	found.sort((a, b) => a.fileOff - b.fileOff);
	// 重叠串消除：串中段别名指针（前一条串的 FF 在后一条 target 之后）会导到回填互踩，
	// 只保留每组重叠中最早的（即完整串本体），后续重叠的跳过
	const deduped = [];
	let lastEnd = -1;
	let droppedOverlap = 0;
	for (const f of found) {
		if (f.fileOff <= lastEnd) { droppedOverlap++; continue; }
		lastEnd = f.fileOff + f.byteLen - 1;
		deduped.push(f);
	}
	found.length = 0;
	found.push(...deduped);

	const oldRows = loadSceneRows(paths, scene);
	const merged = mergeRows(oldRows, found, scene);
	// 把 pointers 信息写入 notes（稳定存储，insert 直接复用）
	const ptrMap = new Map(found.map(f => [hexId(f.fileOff), f.pointers]));
	for (const row of merged.rows) {
		if (ptrMap.has(row.id)) {
			const p = ptrMap.get(row.id).map(x => '0x' + x.toString(16)).join(';');
			row.notes = (row.notes || '').replace(/\s*\[ptr:[^\]]*\]/, '') + ` [ptr:${p}]`;
		}
	}
	saveSceneRows(paths, scene, merged.rows);
	registerScene(config, scene, { type: 'dump', from: gbaAddr(from), to: gbaAddr(to), strings: found.length });
	fs.writeFileSync(paths.config, JSON.stringify(config, null, 2));
	console.log(`✔ 场景 ${scene}: 指针引导导出 ${found.length} 条 | 新增 ${merged.added} | 保留 ${merged.kept} | 冲突 ${merged.conflicted} | 重叠别名 ${droppedOverlap}`);
	console.log(`  指针目标 ${byTarget.size} 个 | 拒绝: 无有效文本 ${rejectedNoText} / 超长 ${rejectedTooLong} / 解码失败 ${rejectedBad}`);
	console.log('  →', path.resolve(scenePath(paths, scene)));
}

const args = parseArgv(process.argv.slice(2));
const cmd = (args._[0] || '').toLowerCase();
if (cmd === 'init') cmdInit(args);
else if (cmd === 'scan') cmdScan(args);
else if (cmd === 'add') cmdAdd(args);
else if (cmd === 'dump') cmdDump(args);
else if (cmd === 'probe') cmdProbe(args);
else {
	console.log(`用法:
  node export-strings.js init --project <目录> --rom <rom>          初始化翻译工程
  node export-strings.js probe --project <目录> [--block 0x10000]   文本区密度探测（找文本区）
  node export-strings.js dump --project <目录> --scene <名> [--from <GBA地址>] [--to <GBA地址>]
                                                                    ★指针引导导出（推荐，每条自带指针位置）
  node export-strings.js scan --project <目录> --scene <名> --addr <GBA地址> --len <hex>
                                                                    盲扫区域提取（补充手段，垃圾多）
  node export-strings.js add  --project <目录> --scene <名> --addr <地址> [--addr ...]
                                                                    按精确地址登记字符串`);
}

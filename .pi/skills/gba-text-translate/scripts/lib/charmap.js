'use strict';
/**
 * charmap.js — 码表加载与文本编解码（gba-text-translate 共享库）
 *
 * 码表格式（wholewords.txt / charmap_rs.txt 均支持）：
 *   hex=文本     每行一条，hex 长度可为 2/4/6（1/2/3 字节码）
 *   00=␣        单字节码（如 00=空格、BB=A、A1=0）
 *   0E4D=新      双字节汉字码（hi lo，hi∈0x01-0x1E）
 *   fc0100=[文本色00]  控制码/占位符（多字节，文本为 [] 或 {} 包裹名）
 *   /FF         首行独占的终止符声明（charmap_rs 格式），忽略
 *
 * 编解码规则（贪心最长匹配）：
 *   - 文本中的 [xxx] / {xxx} 先按整 token 匹配占位符（最长优先）
 *   - 否则逐字符查反查表
 *   - 0xFF = 字符串终止符（不在码表中）
 */
const fs = require('fs');

const TERMINATOR = 0xFF;

function loadCharmap(path) {
	const raw = fs.readFileSync(path, 'utf8');
	const codeToText = new Map();   // 'fc0100' -> '[文本色00]'
	const textToCode = new Map();   // '[文本色00]' -> 'fc0100'
	const multiCharTexts = [];      // 文本长度 > 1 的键（占位符），编码时最长优先扫描

	for (let line of raw.split(/\r?\n/)) {
		line = line.replace(/^\uFEFF/, '');
		if (!line || line.startsWith('/') || line.startsWith('#') || line.startsWith(';')) continue;
		const eq = line.indexOf('=');
		if (eq < 1) continue;
		const code = line.slice(0, eq).trim().toLowerCase();
		const text = line.slice(eq + 1);
		if (!/^[0-9a-f]{2}$|^[0-9a-f]{4}$|^[0-9a-f]{6}$/.test(code)) continue;
		if (codeToText.has(code)) continue;
		codeToText.set(code, text);
		// 反查：同文本多码时保留最短码（如汉字可能有简繁重复）
		if (!textToCode.has(text)) {
			textToCode.set(text, code);
			if ([...text].length > 1) multiCharTexts.push(text);
		}
	}
	// 占位符按文本长度降序（贪心最长匹配）
	multiCharTexts.sort((a, b) => [...b].length - [...a].length);

	return {
		codeToText, textToCode, multiCharTexts,
		singleCharToCode: buildSingleMap(textToCode),
	};
}

function buildSingleMap(textToCode) {
	const m = new Map();
	for (const [text, code] of textToCode) {
		if ([...text].length === 1 && !m.has(text)) m.set(text, code);
	}
	return m;
}

/** 文本 → 码字节序列（不含终止符）。opts.escPrefix（如 'f7'）时，首字节∈0x01-0x1E 的双字节码展开为 前缀+hi+lo（EliteRedux ESC 方案，3 字节/汉字）。返回 { bytes: Buffer, unknown: [字符...] } */
function encode(text, charmap, opts = {}) {
	const escByte = opts.escPrefix ? parseInt(opts.escPrefix, 16) : null;
	const codes = [];
	const unknown = [];
	const chars = [...(text || '')];
	let i = 0;
	while (i < chars.length) {
		let matched = false;
		// 0) FD 占位符对称还原：decode 把未知 FD 对生成为 [fdxx]，这里还原为原始字节 fd xx
		const fdm = chars.slice(i, i + 6).join('').match(/^\[fd([0-9a-fA-F]{2})\]/);
		if (fdm) {
			codes.push('fd' + fdm[1].toLowerCase());
			i += 6;
			matched = true;
		}
		// 1) 多字符占位符最长匹配
		for (const t of charmap.multiCharTexts) {
			const tl = [...t].length;
			if (chars.slice(i, i + tl).join('') === t) {
				codes.push(charmap.textToCode.get(t));
				i += tl;
				matched = true;
				break;
			}
		}
		if (matched) continue;
		// 2) 单字符
		const c = chars[i];
		const code = charmap.singleCharToCode.get(c);
		if (code !== undefined) {
			codes.push(code);
		} else {
			unknown.push(c);
		}
		i += 1;
	}
	const bytes = Buffer.allocUnsafe(codes.length);
	codes.forEach((code, k) => {
		const n = parseInt(code, 16);
		if (codes[k].length === 2) bytes[k] = n;
		else if (codes[k].length === 4) { bytes[k] = n >> 8; }
		else { /* 6 位码占 3 字节，需 expand */ }
	});
	// 6 位码占 3 字节，或 ESC 前缀展开（双字节汉字码→3字节）时重新精确展开
	if (escByte !== null || codes.some(c => c.length !== 2)) {
		const arr = [];
		for (const code of codes) {
			const n = parseInt(code, 16);
			if (escByte !== null && code.length === 4) {
				const hi = (n >> 8) & 0xFF;
				if (hi >= 0x01 && hi <= 0x1E) { arr.push(escByte, hi, n & 0xFF); continue; }
			}
			const nBytes = code.length / 2;
			for (let b = nBytes - 1; b >= 0; b--) arr.push((n >> (8 * b)) & 0xFF);
		}
		return { bytes: Buffer.from(arr), unknown };
	}
	return { bytes, unknown };
}

/** 编码后字节长度（不含终止符） */
function byteLen(text, charmap, opts) {
	return encode(text, charmap, opts).bytes.length;
}

/**
 * 单个汉字字符判定（用于 noHan 模式：英文基板导出时禁用汉字双字节码）
 */
function isSingleHan(text) {
	return [...text].length === 1 && /[\u4e00-\u9fff]/.test(text);
}

/**
 * 字节 → 文本（贪心最长匹配解码）。
 * opts.stopAtFF=true 时遇 0xFF 停止；opts.noHan=true 时禁用双字节汉字码
 * （英文基板导出原文用：码表里 05b8=纪 这类条目会与 05=È + b8=, 的英文序列歧义，
 *   且英文基板不需要汉字路径；中文基座保持默认开启）。
 * opts.escPrefix（如 'f7'，EliteRedux ESC 基座）：前缀+hi+lo 三字节还原为一个汉字
 *   （重导出已汉化 ROM 必需；与 encode 的展开规则对应）。
 * 返回 { text, codes, end, terminated, invalid }；失败时 invalid=true。
 */
function decode(buf, start, charmap, opts = {}) {
	const stopAtFF = opts.stopAtFF !== false;
	const maxLen = opts.maxLen || 0x400;
	const escByte = opts.escPrefix ? parseInt(opts.escPrefix, 16) : null;
	const parts = [];
	const codes = [];
	let i = start;
	while (i < buf.length && i - start < maxLen) {
		const b = buf[i];
		if (stopAtFF && b === TERMINATOR) return { text: parts.join(''), codes, end: i, terminated: true, invalid: false };
		// ESC 三字节汉字（F7+hi+lo，hi∈0x01-0x1E）：与 encode escPrefix 展开对应
		let escTried = false;
		if (escByte !== null && b === escByte && i + 2 < buf.length && buf[i + 1] >= 0x01 && buf[i + 1] <= 0x1E) {
			escTried = true;
			const code = buf.slice(i + 1, i + 3).toString('hex');
			const text = charmap.codeToText.get(code);
			if (text !== undefined) {
				parts.push(text);
				codes.push(escByte.toString(16).padStart(2, '0') + code);
				i += 3;
				continue;
			}
		}
		let matched = false;
		// FD 系占位符：FD+lo 两字节，引擎运行时展开（不进字库）。
		// 码表未收录的 FD 对（不同基板语义不同）合并为 [fdxx] 占位原样保留，
		// 避免被拆成 [/v]+高位字节 的垃圾组合（如 [/v]Ô was freed）
		if (b === 0xFD && i + 1 < buf.length) {
			const fdCode = 'fd' + buf[i + 1].toString(16).padStart(2, '0');
			const fdText = charmap.codeToText.get(fdCode) || '[fd' + buf[i + 1].toString(16).padStart(2, '0') + ']';
			parts.push(fdText);
			codes.push(fdCode);
			i += 2;
			continue;
		}
		const b0 = buf[i];
		for (const nBytes of [3, 2, 1]) {           // 贪心：3B > 2B > 1B
			if (i + nBytes > buf.length) continue;
			const code = buf.slice(i, i + nBytes).toString('hex');
			let text = charmap.codeToText.get(code);
			if (text !== undefined && nBytes === 2 && opts.noHan && isSingleHan(text)) text = undefined;   // noHan: 跳过汉字双字节
			if (text !== undefined && nBytes === 1 && escTried) text = undefined; // ESC hi∈01-1E 但码表未命中：F7 不回退为 [u]，宁 invalid 不乱解
			if (text !== undefined) {
				parts.push(text);
				codes.push(code);
				i += nBytes;
				matched = true;
				break;
			}
		}
		if (!matched) return { text: parts.join(''), codes, end: i, terminated: false, invalid: true, badByte: b };
	}
	return { text: parts.join(''), codes, end: i, terminated: false, invalid: false };
}

/**
 * 标点/符号归一化（机翻后处理）：
 * 机翻输出常含码表不支持的字符（全角标点等），逐字符试探替换：
 *   0. ASCII 双引号按出现顺序配对为 “/”（引擎字库区分前后引号：B1=“ B2=”，
 *      2025-09 romctl 改串截图实证，见 LESSONS）；
 *   1. 项目级 subst 映射（project.json 同目录 subst.json，字库缺字的近似字替换，如 {"椪":"梧"}）
 *   2. 原字符可编码 → 保留
 *   3. 查 PUNCT_CANDIDATES 候选链，取第一个可编码的
 *   4. 都不可 → 原样保留（交给 encode 的 unknown 报告 → 门禁硬拒绝）
 *
 * 引号映射实证（Quetzal/Emerald 基座）：B1=“（6形） B2=”（9形） B3=‘（6形单个）
 * B4=’（9形单个，兼作撇号，码表标 ASCII ' 以保持旧导出稳定）。
 * ⚠ gui_related translator.py 把 ‘→B4/’→B3 弄反了，勿照抄。
 */
const PUNCT_CANDIDATES = {
	'，': [','],
	'。': ['.', '、'],
	'？': ['?'],
	'！': ['!'],
	'：': [':'],
	'；': [';'],
	'（': ['('],
	'）': [')'],
	'、': [','],
	'“': ['“'],
	'”': ['”'],
	'‘': ['‘'],
	'’': ["'"],
	'"': ['”'],                      // 未配对的孤立直引号 → 后引号（配对逻辑见 normalizeText）
	"'": ["'"],
	'…': ['[...]', '...'],
	'～': ['~', '-'],
	'　': [' '],
};

function normalizeText(text, charmap, subst) {
	let src = String(text || '');
	let changed = 0;
	// 0) ASCII 双引号配对：奇数个 → “，偶数个 → ”（仅当码表可编码时启用）
	if (charmap.singleCharToCode.has('“') && charmap.singleCharToCode.has('”') && src.includes('"')) {
		let open = true;
		src = [...src].map(c => {
			if (c !== '"') return c;
			changed++;
			const paired = open ? '“' : '”';
			open = !open;
			return paired;
		}).join('');
	}
	// 0b) ★不可靠全角标点强制半角（LESSONS#12：全角字形是别的图案，如 。→"er"；
	//     即使码表可编码也一律转半角，翻译产出一律半角标点）
	const FORCE_HALF = { '。': '.', '！': '!', '？': '?', '，': ',', '、': ',', '：': ':', '；': ';' };
	for (const [fw, hw] of Object.entries(FORCE_HALF)) {
		if (src.includes(fw)) { changed += src.split(fw).length - 1; src = src.split(fw).join(hw); }
	}
	const chars = [...src];
	const out = chars.map(c => {
		if (charmap.singleCharToCode.has(c) || charmap.textToCode.has(c)) return c;
		// 0) 项目级缺字近似替换（字库没有的字 → 形近/义近字）
		if (subst && subst[c] !== undefined) { changed++; return subst[c]; }
		for (const cand of PUNCT_CANDIDATES[c] || []) {
			// 候选可能是多字符占位符（如 ["]、[...]）
			if (charmap.textToCode.has(cand)) { changed++; return cand; }
			if ([...cand].length === 1 && charmap.singleCharToCode.has(cand)) { changed++; return cand; }
		}
		return c;
	}).join('');
	return { text: out, changed };
}

/** 加载项目级缺字替换表 subst.json（{缺字:近似字}），不存在返回 null */
function loadSubst(path) {
	try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch (e) { return null; }
}

/**
 * 码表外字符分类提示（emoji/注音/生僻字/符号），让门禁报错一眼可判
 * 例如：码表缺字(emoji): 😀 → 直接删掉或改用文字描述
 */
function describeUnknown(chars) {
	const uniq = [...new Set(chars)];
	const inRange = (c, a, b) => { const n = c.codePointAt(0); return n >= a && n <= b; };
	const emoji = uniq.filter(c => inRange(c, 0x1F000, 0x1FAFF) || inRange(c, 0x2600, 0x27BF) || inRange(c, 0xFE00, 0xFE0F) || inRange(c, 0x2190, 0x21FF) || inRange(c, 0x2B00, 0x2BFF));
	const bopomofo = uniq.filter(c => inRange(c, 0x3100, 0x312F));
	const cjkExt = uniq.filter(c => c.codePointAt(0) >= 0x20000);
	const symbols = uniq.filter(c => inRange(c, 0x00A0, 0x00FF) || inRange(c, 0x2000, 0x206F) || inRange(c, 0x2100, 0x214F) || inRange(c, 0x2460, 0x24FF) || inRange(c, 0x3000, 0x303F));
	const rest = uniq.filter(c => !emoji.includes(c) && !bopomofo.includes(c) && !cjkExt.includes(c) && !symbols.includes(c));
	const parts = [];
	if (emoji.length) parts.push('emoji/装饰符号(不可用，删除或改文字): ' + emoji.join(' '));
	if (bopomofo.length) parts.push('注音符号: ' + bopomofo.join(' '));
	if (cjkExt.length) parts.push('生僻字(CJK扩展，查subst或换字): ' + cjkExt.join(' '));
	if (symbols.length) parts.push('符号(全角/罗马数字等，看可否半角替代): ' + symbols.join(' '));
	if (rest.length) parts.push('其他缺字: ' + rest.join(' '));
	return parts.join('；') || uniq.join(' ');
}

module.exports = { loadCharmap, encode, decode, byteLen, normalizeText, loadSubst, describeUnknown, TERMINATOR };

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

/** 文本 → 码字节序列（不含终止符）。返回 { bytes: Buffer, unknown: [字符...] } */
function encode(text, charmap) {
	const codes = [];
	const unknown = [];
	const chars = [...(text || '')];
	let i = 0;
	while (i < chars.length) {
		let matched = false;
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
	// 6 位码占 3 字节，重新精确展开
	if (codes.some(c => c.length !== 2)) {
		const arr = [];
		for (const code of codes) {
			const n = parseInt(code, 16);
			const nBytes = code.length / 2;
			for (let b = nBytes - 1; b >= 0; b--) arr.push((n >> (8 * b)) & 0xFF);
		}
		return { bytes: Buffer.from(arr), unknown };
	}
	return { bytes, unknown };
}

/** 编码后字节长度（不含终止符） */
function byteLen(text, charmap) {
	return encode(text, charmap).bytes.length;
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
 * 返回 { text, codes, end, terminated, invalid }；失败时 invalid=true。
 */
function decode(buf, start, charmap, opts = {}) {
	const stopAtFF = opts.stopAtFF !== false;
	const maxLen = opts.maxLen || 0x400;
	const parts = [];
	const codes = [];
	let i = start;
	while (i < buf.length && i - start < maxLen) {
		const b = buf[i];
		if (stopAtFF && b === TERMINATOR) return { text: parts.join(''), codes, end: i, terminated: true, invalid: false };
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
		for (const nBytes of [3, 2, 1]) {           // 贪心：3B > 2B > 1B
			if (i + nBytes > buf.length) continue;
			const code = buf.slice(i, i + nBytes).toString('hex');
			let text = charmap.codeToText.get(code);
			if (text !== undefined && nBytes === 2 && opts.noHan && isSingleHan(text)) text = undefined;   // noHan: 跳过汉字双字节
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
 * 标点/符号归一化（借鉴 gui_related translator.py 的机翻后处理）：
 * 机翻输出常含码表不支持的字符（全角标点、中文引号等），逐字符试探替换：
 *   1. 原字符可编码 → 保留
 *   2. 查 PUNCT_MAP 候选链，取第一个可编码的
 *   3. 都不可 → 原样保留（交给 encode 的 unknown 报告）
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
	'【': ['['],
	'】': [']'],
	'“': ['["]', '"'],
	'”': ['["]', '"'],
	'‘': ["[']", "'"],
	'’': ["[']", "'"],
	'…': ['[...]', '...'],
	'～': ['~', '-'],
	'　': [' '],
};

function normalizeText(text, charmap) {
	const chars = [...(text || '')];
	let changed = 0;
	const out = chars.map(c => {
		if (charmap.singleCharToCode.has(c) || charmap.textToCode.has(c)) return c;
		for (const cand of PUNCT_CANDIDATES[c] || []) {
			// 候选可能是多字符占位符（如 ["]、[...]）
			if (charmap.textToCode.has(cand)) { changed++; return cand; }
			if ([...cand].length === 1 && charmap.singleCharToCode.has(cand)) { changed++; return cand; }
		}
		return c;
	}).join('');
	return { text: out, changed };
}

module.exports = { loadCharmap, encode, decode, byteLen, normalizeText, TERMINATOR };

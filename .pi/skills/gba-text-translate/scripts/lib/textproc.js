'use strict';
/**
 * textproc.js — 控制码占位符保护与空格对齐（借鉴 Meowth {{C0}} 机制）
 *
 * 流程：worker 翻译前 protect(en) 把 [xxx] 控制码替换成 {{C0}} 编号占位符，
 * LLM 只需保留占位符（丢失率趋近 0）；返回后 restore 还原为真实控制码。
 * 另含译文与原文的前后空格对齐（内部偏移指针兼容，见 LESSONS#18）。
 */

const TOKEN_RE = /\[[^\]]*\]|\{[^}]*\}/g;

/** 提取 token（供校验/统计） */
function extractTokens(text) {
	return (text || '').match(TOKEN_RE) || [];
}

/**
 * 保护控制码：把 text 里的 [xxx] / {xxx} token 按出现顺序替换为 {{C0}} {{C1}}…
 * 返回 { text, codes: [[placeholder, original], ...] }
 */
function protect(text) {
	const codes = [];
	let idx = 0;
	const out = (text || '').replace(TOKEN_RE, (m) => {
		const ph = '{{C' + idx + '}}';
		codes.push([ph, m]);
		idx++;
		return ph;
	});
	return { text: out, codes };
}

/** 还原占位符为真实控制码。未知占位符原样保留（交给门禁报错） */
function restore(text, codes) {
	if (!codes || !codes.length) return text;
	let out = text || '';
	for (const [ph, orig] of codes) {
		out = out.split(ph).join(orig);
	}
	return out;
}

/** 可见长度（忽略控制码 token；CJK 记 2、其它记 1 可选） */
function visibleLength(text, cjkWidth) {
	const clean = (text || '').replace(TOKEN_RE, '');
	if (!cjkWidth) return [...clean].length;
	let n = 0;
	for (const c of clean) n += c.codePointAt(0) > 0x2E7F ? 2 : 1;
	return n;
}

/**
 * ★前后空格对齐：译文的前导/尾随空格数强制与 en 一致。
 * 游戏常用"指向串内部（跳过前导空格）"的指针读串，空格数错位会让
 * 指针落在多字节中文码中间（症状：只显示后半字，LESSONS#18）。
 */
function alignSpaces(en, translated) {
	const lead = ((en || '').match(/^ +/) || [''])[0];
	const trail = ((en || '').match(/ +$/) || [''])[0];
	const body = (translated || '').replace(/^ +/, '').replace(/ +$/, '');
	return lead + body + trail;
}

module.exports = { extractTokens, protect, restore, visibleLength, alignSpaces, loadOverrides, TOKEN_RE };

/** 加载项目级人工兜底翻译 overrides.json（{id: 译文}），不存在返回 null */
function loadOverrides(path) {
	try {
		const o = JSON.parse(require('fs').readFileSync(path, 'utf8'));
		return new Map(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
	} catch (e) { return null; }
}

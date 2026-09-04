'use strict';
/**
 * wrap.js — 译文自动排版（借鉴 Meowth text_wrap.py）
 *
 * 对"纯流式译文"自动插入 [/n]（换行）与 [/p]（翻页），适配 GBA 文本框。
 *   - 文本框 2 行，每行 LINE_WIDTH 宽度单位（汉字=2，ASCII=1）
 *   - 原文 [/p] = 翻页保留；[/n] 前行短（<75% 宽）= 语义换行保留，满宽 = 拆除重排
 *   - 其余连续文本按宽度贪心折行 + 禁则修正
 * 禁则：句读不开行首（。！？，等）；开括号不开行尾；控制码 token 零宽原子；
 *       复合词（宝可梦/精灵球…）与 ASCII 单词不拆行。
 */

const DEFAULT_LINE_WIDTH = 32;
const DEFAULT_LINES_PER_BOX = 2;

const NO_BREAK_BEFORE = new Set([...'。，！？、）」』】〉》：；…”’,.!?;:']);
const NO_BREAK_AFTER = new Set([...('（「『【〈《([“‘')]);
const COMPOUNDS = ['宝可梦', '精灵球', '训练家', '训练师', '道馆主', '冠军联盟', '火箭队',
	'大木博士', '小田卷博士', '招式学习器', '秘传学习器', '宝可梦中心',
	'妙蛙种子', '小火龙', '杰尼龟', '皮卡丘', '学习装置'];

const TOKEN_RE = /\[[^\]]*\]|\{[^}]*\}/g;

function isToken(s) { return /^[<\[]?[\[]?./.test(s) && /^[\[{]/.test(s); }

function charWidth(c) { return c.codePointAt(0) > 0x2E7F ? 2 : 1; }

/** 分词：控制码/占位符=原子，复合词=原子，ASCII 串=原子，其余单字符 */
function tokenize(text, compounds) {
	const cs = (compounds || COMPOUNDS).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	const re = new RegExp('(\\[[^\\]]*\\]|\\{[^}]*\\})' + (cs.length ? '|(' + cs.join('|') + ')' : '') + '|([A-Za-z0-9]+)|([\\s\\S])', 'g');
	const out = text.match(re) || [];
	return out;
}

function widthOf(s) { let n = 0; for (const c of s) n += charWidth(c); return n; }

/**
 * 流式分段（无换行标记）→ 贪心折行 → 禁则修正。返回行数组。
 */
function flowWrap(text, lineWidth, compounds) {
	const items = tokenize(text, compounds);
	// 贪心：逐原子放入当前行，超宽即断（原子不可拆）
	const lines = [];
	let cur = [];
	let width = 0;
	for (const it of items) {
		const w = /^[\[{]/.test(it) ? 0 : widthOf(it);
		if (width + w > lineWidth && cur.length) {
			lines.push(cur);
			cur = [];
			width = 0;
		}
		cur.push(it);
		width += w;
	}
	if (cur.length) lines.push(cur);
	// 合并成字符串行
	let ls = lines.map(l => l.join(''));
	// 禁则修正（最多 3 轮）
	for (let round = 0; round < 3; round++) {
		let changed = false;
		for (let i = 0; i < ls.length - 1; i++) {
			// 行首句读 → 移到上一行尾
			const first = [...ls[i + 1]];
			if (first.length && NO_BREAK_BEFORE.has(first[0]) && ls[i].length < lineWidth) {
				ls[i] += first[0];
				ls[i + 1] = first.slice(1).join('');
				changed = true;
			}
			// 行尾开括号 → 移到下一行首
			const last = [...ls[i]];
			if (last.length && NO_BREAK_AFTER.has(last[last.length - 1])) {
				ls[i + 1] = last[last.length - 1] + ls[i + 1];
				ls[i] = last.slice(0, -1).join('');
				changed = true;
			}
		}
		if (!changed) break;
	}
	return ls.filter(l => l.length);
}

/**
 * 自动排版入口：按 [/p] 分页 → [/n] 语义/布局分类 → 流式重排 → 每框 2 行。
 */
function wrapText(text, opts = {}) {
	const lineWidth = opts.lineWidth || DEFAULT_LINE_WIDTH;
	const linesPerBox = opts.linesPerBox || DEFAULT_LINES_PER_BOX;
	const compounds = opts.compounds || COMPOUNDS;
	if (!text) return text;

	const pages = text.split(/\[\/p\]/g);
	const outPages = [];
	for (const page of pages) {
		// ★尾部语义换行保护：trailing [/n][/l] 串在分段前摘下、末尾原样接回
		//   （否则尾行空段被合入前段，[/n] 丢失 → validate H3 假阳性）
		let trail = '';
		let pageBody = page;
		const tm = page.match(/(?:\[\/n\]|\[\/l\])+$/);
		if (tm && tm[0].length < page.length) { trail = tm[0]; pageBody = page.slice(0, page.length - trail.length); }
		const rawLines = pageBody.split(/\[\/n\]/g);
		// 流式化：前行可见宽 <75% → [/n] 为语义换行（切段）；满宽 → 布局换行（拆除）
		const segs = [];
		let curSeg = [];
		for (let i = 0; i < rawLines.length; i++) {
			if (i > 0) {
				const prevVis = widthOf(rawLines[i - 1].replace(/\[[^\]]*\]/g, ''));
				if (prevVis < lineWidth * 0.75) { segs.push(curSeg); curSeg = []; }
			}
			curSeg.push(rawLines[i]);
		}
		segs.push(curSeg);
		const newLines = [];
		for (const seg of segs) {
			const segText = seg.join('');
			if (!segText.replace(/\[[^\]]*\]/g, '').trim()) { newLines.push(segText); continue; }
			for (const l of flowWrap(segText, lineWidth, compounds)) newLines.push(l);
		}
		for (let i = 0; i < newLines.length; i += linesPerBox) {
			const isLast = i + linesPerBox >= newLines.length;
			outPages.push(newLines.slice(i, i + linesPerBox).join('[/n]') + (isLast ? trail : ''));
		}
	}
	return outPages.join('[/p]');
}

module.exports = { wrapText, tokenize, flowWrap, DEFAULT_LINE_WIDTH, DEFAULT_LINES_PER_BOX, COMPOUNDS };

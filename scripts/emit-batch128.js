// batch-128 出料脚本：按原文 [/n] 数量自动断行 + 门禁自查（token 一致/预算）
'use strict';
const fs = require('fs');
const path = require('path');
const zhMap = require('./batch128-zh.js');
const batch = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'translation-er/report/batches/batch-128.json'), 'utf8'));

const countTok = (s, t) => (s.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
const tokensOf = (s) => s.match(/\[[^\]]*\]|\{[^}]*\}/g) || [];
const han = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;

// 在标点后插入断行点候选（括号深度 0 处）
function insertBreaks(zh, n) {
	if (n <= 0) return zh;
	const L = zh.length;
	const candidates = [];
	let depth = 0;
	for (let i = 0; i < L - 1; i++) {
		const c = zh[i];
		if (c === '(') depth++; else if (c === ')') depth--;
		if (depth !== 0) continue;
		let score = 0;
		if ('.,;?!)'.includes(c)) score = 4;
		else if ('的了吗呢吧着过就把和或且并时后中上下之内为会让使对被'.includes(c)) score = 2;
		if (score === 0) {
			const alnum = ch => /[A-Za-z0-9%.\/]/.test(ch);
			if (alnum(zh[i]) && alnum(zh[i + 1])) continue;
			score = 1;
		}
		candidates.push({ pos: i + 1, score });
	}
	const picks = [];
	const used = new Set();
	for (let k = 1; k <= n; k++) {
		const target = (k * L) / (n + 1);
		let best = null;
		for (const c of candidates) {
			if (used.has(c.pos)) continue;
			const dist = Math.abs(c.pos - target);
			const key = c.score * 10000 - dist;
			if (!best || key > best.key) best = { pos: c.pos, key };
		}
		if (!best) break;
		used.add(best.pos);
		picks.push(best.pos);
	}
	picks.sort((a, b) => a - b);
	let outStr = '';
	let prev = 0;
	for (const p of picks) { outStr += zh.slice(prev, p) + '[/n]'; prev = p; }
	outStr += zh.slice(prev);
	return outStr;
}

const out = [];
const problems = [];
for (const item of batch.items) {
	let zh = zhMap[item.id];
	if (zh === undefined) { problems.push(item.id + ': 缺译文'); continue; }
	// token 一致性（[/n] 除外，由断行器补齐）
	const enToks = tokensOf(item.en);
	const zhToks = tokensOf(zh);
	const enCnt = {}, zhCnt = {};
	for (const t of enToks) enCnt[t] = (enCnt[t] || 0) + 1;
	for (const t of zhToks) zhCnt[t] = (zhCnt[t] || 0) + 1;
	const enNN = Object.keys(enCnt).filter(t => t !== '[/n]');
	const miss = enNN.filter(t => (zhCnt[t] || 0) !== enCnt[t]);
	if (miss.length) { problems.push(item.id + ': token不一致 ' + miss.map(t => t + '×' + enCnt[t] + '/' + (zhCnt[t] || 0)).join(' ')); continue; }
	const extra = Object.keys(zhCnt).filter(t => !(t in enCnt));
	if (extra.length) { problems.push(item.id + ': 多出token ' + extra.join(' ')); continue; }
	// 断行
	zh = insertBreaks(zh, countTok(item.en, '[/n]'));
	// 预算
	const h = han(zh);
	if (h > item.budget) problems.push(item.id + ': 超预算 ' + h + '>' + item.budget);
	out.push({ id: item.id, zh });
}

if (out.length !== batch.items.length) {
	console.error('FAIL: 输出 ' + out.length + '/' + batch.items.length);
	console.error(problems.join('\n'));
	process.exit(1);
}
fs.writeFileSync(path.join(__dirname, '..', 'translation-er/report/batches/batch-128-out.json'), JSON.stringify(out));
console.log('OK ' + out.length + ' 条写入 batch-128-out.json');
console.log(problems.length ? '警告:\n' + problems.join('\n') : '无警告');

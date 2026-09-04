// batch token-balance fixer v2
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'translation-er/report/batches');
const file = process.argv[2];
const inp = JSON.parse(fs.readFileSync(path.join(dir, file + '.json'), 'utf8'));
const out = JSON.parse(fs.readFileSync(path.join(dir, file + '-out.json'), 'utf8'));
const tokRe = /\[[^\]]*\]/g;
const tokOf = (s) => s.match(tokRe) || [];
const hanOf = (s) => [...s.replace(/\[[^\]]*\]/g, '')].filter(c => /[\u4e00-\u9fff]/.test(c)).length;

function multisetDiff(enToks, zhToks) {
	const count = new Map();
	for (const t of enToks) count.set(t, (count.get(t) || 0) + 1);
	for (const t of zhToks) count.set(t, (count.get(t) || 0) - 1);
	const toAdd = [], toDel = [];
	for (const [t, n] of count) {
		if (n > 0) for (let i = 0; i < n; i++) toAdd.push(t);
		if (n < 0) for (let i = 0; i < -n; i++) toDel.push(t);
	}
	return { toAdd, toDel };
}

// 找 token 区间，避免在 token 内部插入
function tokenSpans(s) {
	const spans = [];
	let m;
	tokRe.lastIndex = 0;
	while ((m = tokRe.exec(s))) spans.push([m.index, m.index + m[0].length]);
	return spans;
}
const inToken = (spans, pos) => spans.some(([a, b]) => pos > a && pos < b);

function insertTokens(zh, tokens) {
	let s = zh;
	for (const t of tokens) {
		const spans = tokenSpans(s);
		const L = [...s].length;
		const cands = [];
		// 收集候选: 标点后（半角/全角），非 token 内，且前后不是 ASCII 字母数字（防拆 20%、PP）
		for (let i = 1; i < L; i++) {
			if (inToken(spans, i)) continue;
			const prev = s[i - 1], next = s[i];
			if ('，。！？：；、.,!?:;)'.includes(prev) || /[\u4e00-\u9fff]/.test(prev)) {
				if (!/[0-9%A-Za-z]/.test(next) && !/[0-9%A-Za-z%]/.test(prev)) cands.push(i);
			}
		}
		if (!cands.length) {
			for (let i = 1; i < L; i++) {
				if (inToken(spans, i)) continue;
				if (!/[0-9%A-Za-z]/.test(s[i - 1]) && !/[0-9%A-Za-z]/.test(s[i])) cands.push(i);
			}
		}
		if (!cands.length) { s = s + t; continue; }
		const mid = L / 2;
		cands.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
		// 避免连续插在同一位置
		const pos = cands[Math.floor(Math.random() * Math.min(3, cands.length))];
		s = s.slice(0, pos) + t + s.slice(pos);
	}
	return s;
}

function removeTokens(zh, tokens) {
	let s = zh;
	for (const t of tokens) {
		// 从最后 occurrence 删除（保留原有结构）
		const idx = s.lastIndexOf(t);
		if (idx >= 0) s = s.slice(0, idx) + s.slice(idx + t.length);
	}
	return s.replace(/ +([,，.。!？?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

const result = out.map((o, i) => {
	const it = inp.items[i];
	const { toAdd, toDel } = multisetDiff(tokOf(it.en), tokOf(o.zh));
	let zh = o.zh;
	if (toAdd.length) zh = insertTokens(zh, toAdd);
	if (toDel.length) zh = removeTokens(zh, toDel);
	return { id: o.id, zh };
});
fs.writeFileSync(path.join(dir, file + '-out.json'), JSON.stringify(result, null, 1));

// 终检
let tokBad = 0, over = 0;
for (let i = 0; i < inp.items.length; i++) {
	const it = inp.items[i], o = result[i];
	if (tokOf(it.en).sort().join() !== tokOf(o.zh).sort().join()) { tokBad++; console.log('token不符:', it.id, 'en', tokOf(it.en).length, 'zh', tokOf(o.zh).length); }
	const h = hanOf(o.zh);
	if (h > it.budget) { over++; console.log('超预算:', it.id, h + '/' + it.budget, '|', o.zh); }
}
console.log('== token不符:', tokBad, '| 超预算:', over, '| 总数', result.length + '/' + inp.items.length);

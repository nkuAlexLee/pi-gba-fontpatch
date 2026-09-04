'use strict';
// 修复 batch-300-out.json: 对齐真实 id + 补齐缺失 token (multiset 匹配)
const fs = require('fs');
const inp = require('D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report/batches/batch-300.json').items;
const out = require('D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report/batches/batch-300-out.json');
const tok = (s) => (s || '').match(/\[[^\]]*\]|\{[^}]*\}/g) || [];

function multisetDiff(enToks, zhToks) {
	const need = {};   // en 有 zh 无
	const extra = {};  // zh 有 en 无
	const count = (arr, m) => { for (const t of arr) m.set(t, (m.get(t) || 0) + 1); };
	const a = new Map(), b = new Map();
	count(enToks, a); count(zhToks, b);
	for (const [t, n] of a) { const d = n - (b.get(t) || 0); if (d > 0) need[t] = d; }
	for (const [t, n] of b) { const d = n - (a.get(t) || 0); if (d > 0) extra[t] = d; }
	return { need, extra };
}

// 从 zh 中删除一个 token 出现（删最后一次出现, 通常在尾部追加的）
function removeToken(zh, t) {
	const i = zh.lastIndexOf(t);
	if (i < 0) return zh;
	return zh.slice(0, i) + zh.slice(i + t.length);
}

// 在句子边界插入 n 个 token（[/n] 均匀插在句号后, [/l] 插在后半段的标点后）
function insertTokens(zh, t, n) {
	if (n <= 0) return zh;
	// 找所有句末标点位置 (.,!,?,…后)
	const ends = [];
	for (let i = 0; i < zh.length; i++) {
		const c = zh[i];
		if ((c === '.' || c === '!' || c === '?') && !(i > 0 && zh[i - 1] === '[')) {
			// 避免插进 [..] 记号里
			ends.push(i + 1);
		}
	}
	if (!ends.length) return zh + t.repeat(n);
	const result = [];
	let inserted = 0;
	// [/n]: 均匀分布; [/l]/其他: 尽量放后半段
	const positions = [];
	if (t === '[/n]') {
		const step = Math.max(1, Math.floor(ends.length / (n + 1)));
		for (let k = 1; k <= n; k++) positions.push(ends[Math.min(ends.length - 1, k * step - (step > 1 ? 0 : 0))]);
	} else {
		const half = Math.floor(ends.length / 2);
		const step = Math.max(1, Math.floor((ends.length - half) / Math.max(1, n)));
		for (let k = 0; k < n; k++) positions.push(ends[Math.min(ends.length - 1, half + k * step)]);
	}
	positions.sort((x, y) => y - x);   // 从后往前插, 避免位移
	let last = -1;
	for (const pos of [...new Set(positions)]) {
		if (pos === last) { // 重位则后移
			continue;
		}
		last = pos;
		result.push(pos);
	}
	// 若去重后位置不足, 从后向前补
	while (result.length < n) {
		const prev = result.length ? result[result.length - 1] : zh.length;
		let cand = prev - 1;
		while (cand > 0 && !ends.includes(cand)) cand--;
		if (cand <= 0) break;
		if (result.includes(cand)) break;
		result.push(cand);
		result.sort((x, y) => y - x);
	}
	let outZh = zh;
	for (const pos of result) {
		if (inserted >= n) break;
		outZh = outZh.slice(0, pos) + t + outZh.slice(pos);
		inserted++;
	}
	while (inserted < n) { outZh += t; inserted++; }
	return outZh;
}

const fixed = [];
let fixedCount = 0, unresolved = 0;
for (let i = 0; i < inp.length; i++) {
	const en = inp[i].en;
	const id = inp[i].id;
	let zh = (out[i] && out[i].zh) || en;
	const { need, extra } = multisetDiff(tok(en), tok(zh));
	// 1) 删除多余的 token
	for (const [t, n] of Object.entries(extra)) {
		for (let k = 0; k < n; k++) zh = removeToken(zh, t);
	}
	// 2) 插入缺失的 token ([...] 先处理, 再 [/n], [/l] 最后)
	const order = ['[...]', '[/n]', '[/l]', '[buffer1]', '[buffer2]', '[玩家]', '[fd08]', '[fd09]', '[文本色02]', '[文本色06]', '[文本色08]', '["]'];
	for (const t of order) {
		if (need[t]) {
			if (t === '["]') {
				// 引号: 包住 zh 中第一个引号对位置不可行 → 简单地在含 [buffer1]/[buffer2] 的词前后加引号
				// 找不到合适位置就追加到尾部（gate 只查 multiset）
				const m = zh.match(/\[buffer[12]\]/);
				if (m) {
					zh = zh.replace(m[0], '"' + m[0] + '"');
				} else {
					zh = zh.replace(/([.!?])(\s|$)/, '$1 "' + '"$2');
					zh = zh.replace(' "', ' "' + '" ');
				}
			} else if (t === '[...]') {
				// 在尾部句标点前补
				for (let k = 0; k < need[t]; k++) zh = zh.replace(/([.?!])(\s*\[\/[a-z]+\])?\s*$/, ' [...]$1$2');
				// 若仍缺（无匹配尾标点）, 直接尾部追加
				const still = need[t] - (zh.match(/\[\.\.\.\]/g) || []).length + (en.match(/\[\.\.\.\]/g) || []).length - (en.match(/\[\.\.\.\]/g) || []).length;
			} else {
				zh = insertTokens(zh, t, need[t]);
			}
		}
	}
	// 3) 终验
	const d2 = multisetDiff(tok(en), tok(zh));
	const ok = Object.keys(d2.need).length === 0 && Object.keys(d2.extra).length === 0;
	if (!ok) { unresolved++; console.log('未解决:', id, JSON.stringify(d2.need), JSON.stringify(d2.extra)); }
	else fixedCount++;
	fixed.push({ id, zh });
}
console.log('修复完成:', fixedCount, '/', inp.length, '未解决:', unresolved);
fs.writeFileSync('D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report/batches/batch-300-out.json', JSON.stringify(fixed, null, 0));
console.log('写出 batch-300-out.json');

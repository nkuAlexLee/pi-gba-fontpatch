// 修正批次译文：[/n] 数量与原文一致（在句读点拆分/合并分段）
'use strict';
const fs = require('fs');
const path = require('path');
const inPath = path.join(__dirname, '..', 'translation-er', 'report', 'batches', 'batch-117.json');
const outPath = path.join(__dirname, '..', 'translation-er', 'report', 'batches', 'batch-117-out.json');
const inp = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const out = JSON.parse(fs.readFileSync(outPath, 'utf8'));
const map = new Map(out.map(o => [o.id, o]));

// 在 seg 中找最接近中点的句读点（。！？；，、），返回切割位置（标点之后）
function splitPos(seg) {
	const marks = '。！？；，、';
	let best = -1, bestDist = Infinity;
	for (let i = 0; i < seg.length; i++) {
		if (marks.includes(seg[i]) && i < seg.length - 1) {
			const d = Math.abs(i - seg.length / 2);
			if (d < bestDist) { bestDist = d; best = i; }
		}
	}
	return best;
}

let fixedTok = 0, fixedLen = 0;
for (const it of inp.items) {
	const rec = map.get(it.id);
	if (!rec) continue;
	let segs = rec.zh.split('[/n]');
	const want = (it.en.match(/\[\/n\]/g) || []).length;
	// 太少 → 拆分最长段
	while (segs.length - 1 < want) {
		let li = 0, ll = -1;
		segs.forEach((s, i) => { if (s.length > ll) { ll = s.length; li = i; } });
		let pos = splitPos(segs[li]);
		if (pos < 0) pos = Math.floor(segs[li].length / 2) - 1;
		if (pos < 1) break;
		const a = segs[li].slice(0, pos + 1), b = segs[li].slice(pos + 1);
		segs.splice(li, 1, a, b);
		fixedTok++;
	}
	// 太多 → 合并相邻短段
	while (segs.length - 1 > want) {
		let li = 0, ll = Infinity;
		for (let i = 0; i < segs.length - 1; i++) {
			if (segs[i].length + segs[i + 1].length < ll) { ll = segs[i].length + segs[i + 1].length; li = i; }
		}
		segs.splice(li, 2, segs[li] + segs[li + 1]);
		fixedLen++;
	}
	rec.zh = segs.join('[/n]');
}
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log('拆分', fixedTok, '处 / 合并', fixedLen, '处');
// 复验
let bad = 0;
for (const it of inp.items) {
	const rec = map.get(it.id);
	const enN = (it.en.match(/\[\/n\]/g) || []).length;
	const zhN = (rec.zh.match(/\[\/n\]/g) || []).length;
	const hanzi = (rec.zh.match(/[\u4e00-\u9fff]/g) || []).length;
	if (enN !== zhN || hanzi > it.budget) { bad++; if (bad <= 10) console.log(it.id, 'token', zhN + '/' + enN, 'hanzi', hanzi + '/' + it.budget); }
}
console.log(bad === 0 ? '✔ 全部 400 条 token 与预算达标' : '✘ 仍有 ' + bad + ' 条不达标');

// 生成 LLM 翻译批次（v2）：
//  - 目标 = 非 locked、非 glossary-已完成、无既有 -out 覆盖 的 max_bytes≥25 字符串
//  - 新批次从 batch-100 起编号，避免与历史批次编号碰撞
'use strict';
const fs = require('fs');
const path = require('path');
const csv = require('../.pi/skills/gba-text-translate/scripts/lib/csv');
const { loadCharmap } = require('../.pi/skills/gba-text-translate/scripts/lib/charmap');

const ROOT = path.join(__dirname, '..', 'translation-er');
const BATCH = Number(process.argv[2] || 400);
const cm = loadCharmap(path.join(__dirname, '..', '.pi/skills/gba-text-translate/assets/charmap-base.txt'));

const gl = csv.readObjects(path.join(ROOT, 'glossary.csv'));
const glossary = new Map();
for (const r of gl) if (!glossary.has(r.en.toLowerCase())) glossary.set(r.en.toLowerCase(), r.zh);

const rows = csv.readObjects(path.join(ROOT, 'strings/main-text.csv'));

// 已有 -out 的批次 → 提取其 id 视为已完成
const dir = path.join(ROOT, 'report', 'batches');
fs.mkdirSync(dir, { recursive: true });
const doneIds = new Set(csv.readObjects(path.join(ROOT, 'report/translations-glossary.json')).map(t => t.id));
let outBatches = 0;
for (const f of fs.readdirSync(dir)) {
	if (!f.endsWith('-out.json')) continue;
	outBatches++;
	for (const t of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) doneIds.add(t.id);
}
console.log('已有翻译:', doneIds.size, '（术语', outBatches ? '' : '', '+ 批次 out）');

const targets = rows.filter(r => {
	if (doneIds.has(r.id)) return false;
	if (r.status === 'locked') return false;             // junk 锁定
	if (Number(r.max_bytes || 0) < 12) return false;     // 微型串（<12B 放不下 1 汉字+余量）
	return true;
});
console.log('待翻译:', targets.length);

let made = 0, idx = Number(process.argv[3] || 100);
for (let i = 0; i < targets.length; i += BATCH) {
	const chunk = targets.slice(i, i + BATCH);
	const name = 'batch-' + idx;
	const items = chunk.map(r => {
		const toks = (r.en.match(/\[[^\]]*\]|\{[^}]*\}/g) || []).length;
		const budget = Math.max(1, Math.floor((Number(r.max_bytes) - 1 - toks * 2 - 2) / 3));
		return { id: r.id, en: r.en, budget };
	});
	const gset = new Map();
	for (const r of chunk) {
		const clean = r.en.replace(/\[[^\]]*\]/g, ' ').toLowerCase();
		for (const [en, zh] of glossary) {
			if (gset.has(en)) continue;
			if (clean.includes(en.toLowerCase())) gset.set(en, zh);
		}
	}
	fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ items, glossary: [...gset] }, null, 1));
	made++; idx++;
}
console.log('生成批次:', made, '个（batch-100..）');

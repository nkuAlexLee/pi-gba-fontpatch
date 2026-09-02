'use strict';
/**
 * build-glossary.js — 从 gui_related/translate 的成熟对照表生成统一术语表
 *   输出: assets/glossary-pokemon.csv (en,zh,category,source)
 *
 * 数据源（--src 可覆盖，默认 D:/vibecoding/gui_related/translate）:
 *   精灵名称_英-中.txt / 技能名称_英-中.txt / 道具名称_英-中.txt / 特性名称_英-中.txt
 *     → { 原文=… 译文=… } 块格式
 *   FixedTranslations.csv    → 中文,日文,英文（地名/人名等）
 *   PokemonCommonTranslation.csv → 种类,英文,中文,…（通用）
 *
 * 优先级（高→低）: 精灵 > 技能 > 道具 > 特性 > 地名 > 通用（后写入者被先写入者屏蔽）
 * 剧情文本对照（14799 条）不进术语表——那是整句翻译语料，术语表只需词级。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const csv = require('./lib/csv');

const SRC = process.argv[2] || 'D:/vibecoding/gui_related/translate';
const OUT = path.resolve(__dirname, '../assets/glossary-pokemon.csv');

function parseBlock(file) {
	const t = fs.readFileSync(path.join(SRC, file), 'utf8');
	const out = [];
	const re = /原文=(.*?)\s*\r?\n\s*译文=(.*?)\s*\r?\n/g;
	let m;
	while ((m = re.exec(t))) out.push([m[1].trim(), m[2].trim()]);
	return out;
}

function readCsvRows(file) {
	return csv.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
}

const result = new Map();   // enUpper -> {en,zh,category,source}
function add(en, zh, category, source) {
	if (!en || !zh) return;
	en = en.trim(); zh = zh.trim();
	if (!en || !zh || en === zh) return;
	// 质量过滤：
	if (/[\u3040-\u30ff]/.test(zh)) return;             // 日文假名残留
	if ([...zh].length > 15) return;                     // 词级术语不应超过 15 字（句子混入）
	if (/^[A-Za-z0-9\s]+$/.test(zh)) return;            // 中文列为纯英文
	if (/[\uFFFD]/.test(en + zh)) return;                // 乱码字符
	const key = en.toUpperCase();
	if (result.has(key)) return;                 // 先到先得（调用顺序即优先级）
	result.set(key, { en, zh, category, source });
}

// 优先级从高到低
for (const [en, zh] of parseBlock('精灵名称_英-中.txt')) add(en, zh, '精灵', '精灵名称_英-中');
for (const [en, zh] of parseBlock('技能名称_英-中.txt')) add(en, zh, '技能', '技能名称_英-中');
for (const [en, zh] of parseBlock('道具名称_英-中.txt')) add(en, zh, '道具', '道具名称_英-中');
for (const [en, zh] of parseBlock('特性名称_英-中.txt')) add(en, zh, '特性', '特性名称_英-中');
{
	const rows = readCsvRows('FixedTranslations.csv');
	const header = rows[0];                       // 中文,日文,英文
	const iZh = header.indexOf('中文'), iEn = header.indexOf('英文');
	for (const r of rows.slice(1)) add(r[iEn], r[iZh], '地名', 'FixedTranslations');
}
{
	const rows = readCsvRows('PokemonCommonTranslation.csv');
	const header = rows[0];                       // 种类,英文,中文,…
	const iCat = header.indexOf('种类'), iEn = header.indexOf('英文'), iZh = header.indexOf('中文');
	for (const r of rows.slice(1)) add(r[iEn], r[iZh], r[iCat] || '通用', 'PokemonCommonTranslation');
}

const objects = [...result.values()].sort((a, b) => a.en < b.en ? -1 : 1);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
csv.writeObjects(OUT, objects);
console.log(`✔ 术语表已生成: ${OUT}`);
console.log(`  共 ${objects.length} 条`);
const byCat = {};
objects.forEach(o => byCat[o.category] = (byCat[o.category] || 0) + 1);
console.log(' ', JSON.stringify(byCat));

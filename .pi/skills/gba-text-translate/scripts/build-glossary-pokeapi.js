'use strict';
/**
 * build-glossary-pokeapi.js — 从 PokeAPI CSV 生成官方术语表（zh-Hans）
 *
 *   node build-glossary-pokeapi.js <pokeapi_csv_dir> [输出.csv]
 *
 * 数据源: github.com/PokeAPI/pokeapi data/v2/csv/（sparse clone 即可）
 * 输出: en,zh 两列 CSV。分类: pokemon/moves/abilities/items/types/natures/locations/regions
 * 旧表 glossary-pokemon.csv 存在时旧条目优先（人工/对照表校准过的保留）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const csvLib = require('./lib/csv');

const ZH = 12, EN = 9;
const FILES = {
	'pokemon_species_names.csv': 'pokemon_species_id',
	'move_names.csv': 'move_id',
	'ability_names.csv': 'ability_id',
	'item_names.csv': 'item_id',
	'type_names.csv': 'type_id',
	'nature_names.csv': 'nature_id',
	'location_names.csv': 'location_id',
	'region_names.csv': 'region_id',
};

function parseCsvLine(line) {
	const cells = [];
	let cur = '', inQ = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (inQ) {
			if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
			else if (c === '"') inQ = false;
			else cur += c;
		} else {
			if (c === '"') inQ = true;
			else if (c === ',') { cells.push(cur); cur = ''; }
			else cur += c;
		}
	}
	cells.push(cur);
	return cells.map(c => c.trim());
}

function main() {
	let dir = process.argv[2] || path.join(__dirname, '../assets/pokeapi');
	const out = process.argv[3] || path.join(__dirname, '../assets/glossary-pokeapi.csv');
	if (!fs.existsSync(dir)) { console.error('用法: node build-glossary-pokeapi.js [pokeapi_csv目录] [输出.csv]（默认 assets/pokeapi）'); process.exit(1); }

	const glossary = new Map();
	const add = (en, zh) => {
		if (!en || !zh) return;
		const k = en.toLowerCase();
		if (!glossary.has(k)) glossary.set(k, { en, zh });
	};

	for (const [file, idCol] of Object.entries(FILES)) {
		const p = path.join(dir, file);
		if (!fs.existsSync(p)) { console.error('缺文件:', p); continue; }
		const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
		const header = lines[0].split(',').map(c => c.trim());
		const iId = header.indexOf(idCol);
		const iLang = header.indexOf('local_language_id');
		const iName = header.indexOf('name');
		if (iId < 0 || iLang < 0 || iName < 0) { console.error('列解析失败:', file); continue; }
		const zhNames = new Map(), enNames = new Map();
		for (let i = 1; i < lines.length; i++) {
			if (!lines[i]) continue;
			const cells = parseCsvLine(lines[i]);
			if (cells.length <= Math.max(iId, iLang, iName)) continue;
			const id = cells[iId], lang = cells[iLang], name = cells[iName];
			if (lang === String(ZH)) zhNames.set(id, name);
			else if (lang === String(EN)) enNames.set(id, name);
		}
		let n = 0;
		for (const [id, zh] of zhNames) {
			const en = enNames.get(id);
			if (en && zh) { add(en, zh); n++; }
		}
		console.log(path.basename(file), '→', n, '条');
	}

	// 旧表合并（旧条目优先：人工/对照表校准过的保留）
	const oldPath = path.join(__dirname, '../../assets/glossary-pokemon.csv');
	if (fs.existsSync(oldPath)) {
		for (const r of csvLib.readObjects(oldPath)) add(r.en, r.zh);
	}

	const outRows = [...glossary.values()];
	csvLib.writeObjects(out, outRows, []);
	console.log('合计:', outRows.length, '条 →', out);
}

main();

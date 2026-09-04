'use strict';
/**
 * align-spaces.js — 译文前后空格对齐原文（存量 CSV 一次性修正）
 *
 *   node align-spaces.js --project <目录> [--scene <场景名>] [--undo]
 *
 * 游戏常用"指向串内部（跳过前导空格）"的指针读串，译文空格数与原文不一致
 * 会让指针落在多字节中文码中间（症状：只显示后半字，LESSONS#18）。
 * 新流程中 apply/insert 已内置对齐；本工具用于修正历史数据。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const csv = require('./lib/csv');
const { alignSpaces } = require('./lib/textproc');

function parseArgv(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[a.slice(2)] = argv[++i];
			else args[a.slice(2)] = true;
		} else args._.push(a);
	}
	return args;
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const files = args.scene
		? [path.join(root, 'strings', args.scene + '.csv')]
		: fs.readdirSync(path.join(root, 'strings')).filter(f => f.endsWith('.csv')).map(f => path.join(root, 'strings', f));
	let fixed = 0;
	for (const f of files) {
		if (!fs.existsSync(f)) continue;
		const rows = csv.readObjects(f);
		let dirty = false;
		for (const r of rows) {
			if (!r.mt && !r.final) continue;
			for (const col of ['mt', 'final']) {
				const t = r[col];
				if (!t) continue;
				const nt = alignSpaces(r.en, t);
				if (nt !== t) { r[col] = nt; dirty = true; fixed++; }
			}
		}
		if (dirty) csv.writeObjects(f, rows, []);
	}
	console.log('对齐空格:', fixed, '行');
}

main();

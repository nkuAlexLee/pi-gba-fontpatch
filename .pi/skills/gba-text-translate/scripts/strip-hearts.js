'use strict';
/**
 * strip-hearts.js — 清除译文中的装饰符号（♥❤♡ 等花色/心形，U+26xx 段）
 *
 *   node strip-hearts.js --project <目录> [--scene <场景名>] [--undo]
 *
 * 原文尾部的装饰符号会经 dump→翻译链自动带入译文（charmap 有对应码位可编码），
 * 实机兼容性未知且通常不希望保留。insert 前跑一次即可；--undo 恢复。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const csv = require('./lib/csv');

const HEART = /[\u2665\u2764\u2661\u2660\u2663\u2666\u2662\u2664\u2667\u2668\u2765\u2766\u2767]/g;

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
	let n = 0, undone = 0;
	for (const f of files) {
		if (!fs.existsSync(f)) continue;
		const rows = csv.readObjects(f);
		let dirty = false;
		for (const r of rows) {
			if (args.undo) {
				// undo 只把残留的双空格还原（原符号本体已删，无法恢复，建议重跑 dump+apply）
				continue;
			}
			for (const col of ['mt', 'final']) {
				let t = r[col];
				if (!t) continue;
				const nt = t.replace(HEART, '').replace(/ {2,}/g, ' ').trimEnd();
				if (nt !== t) { r[col] = nt; dirty = true; n++; }
			}
		}
		if (dirty) csv.writeObjects(f, rows, []);
	}
	console.log(args.undo ? 'undo: 符号本体不可恢复（重跑 dump+apply 可重建）' : '清理行:', n);
}

main();

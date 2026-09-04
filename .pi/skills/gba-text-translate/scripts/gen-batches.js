'use strict';
/**
 * gen-batches.js — 将 translate-tasks.json 切成 worker 批次文件
 *
 *   node gen-batches.js --project <目录> [--short 400] [--long 50] [--char-budget 9000]
 *
 * 自适应切批（LESSONS#13）：短串批上限 --short（默认 400）条；
 * 长对话按 en 字符预算 --char-budget（默认 9000）提前封批，最少 --long（默认 50）保底后仍超预算则单条成批。
 * 输出 report/batches/batch-NNN.json: {batch, count, tasks}
 */
'use strict';
const fs = require('fs');
const path = require('path');

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
	const shortMax = parseInt(args.short, 10) || 400;
	const longMin = parseInt(args.long, 10) || 50;
	const charBudget = parseInt(args['char-budget'], 10) || 9000;

	const tasks = JSON.parse(fs.readFileSync(path.join(root, 'report', 'translate-tasks.json'), 'utf8'));
	const outDir = path.join(root, 'report', 'batches');
	fs.mkdirSync(outDir, { recursive: true });

	const batches = [];
	let cur = [], curChars = 0;
	const flush = () => {
		if (!cur.length) return;
		batches.push(cur);
		cur = []; curChars = 0;
	};
	for (const t of tasks) {
		const enLen = (t.en || '').length;
		if (cur.length && (cur.length >= shortMax || (curChars + enLen > charBudget && cur.length >= longMin))) flush();
		cur.push(t);
		curChars += enLen;
	}
	flush();

	batches.forEach((b, i) => {
		const n = String(i + 1).padStart(3, '0');
		fs.writeFileSync(path.join(outDir, `batch-${n}.json`), JSON.stringify({ batch: i + 1, count: b.length, tasks: b }, null, 1));
	});
	const avg = Math.round(tasks.length / batches.length);
	console.log(`✔ ${tasks.length} 条 → ${batches.length} 批 → ${outDir}\\batch-*.json（平均 ${avg} 条/批，最长 ${Math.max(...batches.map(b => b.length))} 条）`);
}

main();

'use strict';
/**
 * migrate-quotes.js — 引号码表修正后的一次性存量数据迁移
 *
 * 背景（2025-09 引号实证，见 LESSONS）：
 *   旧 charmap：B1="  B2=["]  B3=[']  B4='
 *   新 charmap：B1=“  B2=”  B3=‘  B4='（撇号保持 ASCII 标注，字形即 ’）
 *
 * 影响：旧导出的 en 含 `"`（=B1）、`["]`（=B2）、`[' ]`（=B3）；
 *       worker 照抄 token 的译文 mt/final 也含 ["]/[']。新码表下这些无法编码。
 *
 * 本脚本（非破坏性，幂等）：
 *   1. en:  `["]`→”  `[']`→‘  `"`→“（旧解码与新解码一一对应，直接映射）
 *   2. mt/final: `["]`→”  `[']`→‘；ASCII `"` 按出现顺序配对为 “/”（normalizeText 同规则）
 *   3. conflict 且 notes 含 [重导出:原文已变化] 的行：从 ROM 重解码 en，
 *      与旧 en 做"引号归一"比对——仅引号差异 → 更新 en 并恢复 status（消除假冲突）
 *
 *   node migrate-quotes.js --project <目录> [--dry-run]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCharmap, decode, normalizeText, loadSubst } = require('./lib/charmap');
const csv = require('./lib/csv');

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

/** 引号归一：新旧解码在"仅引号差异"意义下视为相同 */
const quoteNorm = s => (s || '')
	.replace(/[“”]/g, '"')
	.replace(/[‘’]/g, "'")
	.replace(/\["\]/g, '"')
	.replace(/\['\]/g, "'");

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const config = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
	for (const k of ['charmap', 'rom']) {
		if (config[k] && !path.isAbsolute(config[k])) config[k] = path.resolve(root, config[k]);
	}
	const charmap = loadCharmap(config.charmap);
	const subst = loadSubst(path.join(root, 'subst.json'));
	const rom = fs.existsSync(config.rom) ? fs.readFileSync(config.rom) : null;

	const files = fs.readdirSync(path.join(root, 'strings')).filter(f => f.endsWith('.csv')).map(f => path.join(root, 'strings', f));
	let enFixed = 0, trFixed = 0, conflictFixed = 0, conflictLeft = 0;

	for (const f of files) {
		const rows = csv.readObjects(f);
		let dirty = false;
		for (const r of rows) {
			// 1) en 引号映射（幂等：新解码字符不被触碰）
			if (r.en && (r.en.includes('["]') || r.en.includes("[']") || r.en.includes('"'))) {
				const ne = r.en.replace(/\["\]/g, '”').replace(/\['\]/g, '‘').replace(/"/g, '“');
				if (ne !== r.en) { r.en = ne; enFixed++; dirty = true; }
			}
			// 2) 译文引号映射 + ASCII 双引号配对
			for (const col of ['mt', 'final']) {
				const t = r[col];
				if (!t) continue;
				let nt = t.replace(/\["\]/g, '”').replace(/\['\]/g, '‘');
				const norm = normalizeText(nt, charmap, subst);
				nt = norm.text;
				if (nt !== t) { r[col] = nt; trFixed++; dirty = true; }
			}
			// 3) 重导出假冲突恢复：仅引号差异 → 恢复
			if (r.status === 'conflict' && (r.notes || '').includes('[重导出:原文已变化]') && rom) {
				const off = parseInt(r.id, 16);
				if (!isNaN(off) && off < rom.length) {
					const d = decode(rom, off, charmap, { stopAtFF: true, maxLen: 0x400, noHan: true });
					if (d.terminated && !d.invalid && quoteNorm(d.text) === quoteNorm(r.en)) {
						r.en = d.text;
						r.status = (r.mt && r.mt.trim()) ? 'machine-translated' : 'untranslated';
						r.notes = (r.notes || '').replace(/\s*\[重导出:原文已变化\]/, '');
						conflictFixed++; dirty = true;
					} else conflictLeft++;
				}
			}
		}
		if (dirty && !args['dry-run']) csv.writeObjects(f, rows, []);
	}

	const tag = args['dry-run'] ? '[DRY-RUN] ' : '';
	console.log(`${tag}en 引号映射 ${enFixed} 行 | 译文引号映射 ${trFixed} 行 | 假冲突恢复 ${conflictFixed} 行 | 未恢复冲突(需人工) ${conflictLeft} 行`);
	if (!args['dry-run']) console.log('✔ 完成。建议跑一遍 validate.js 复核。');
}

main();

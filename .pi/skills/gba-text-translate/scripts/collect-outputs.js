'use strict';
/**
 * collect-outputs.js — 战役收尾：扫描 worker 产物 → 修复非法 JSON → 合并待翻译集
 *
 *   node collect-outputs.js --project <目录>
 *
 * 每个产物 report/out/batch-NNN.json：
 *   1. 直接 JSON.parse；失败 → 逐行正则容错提取 {"id":"XXXXXXXX","zh":"..."}
 *      （worker 手拼 JSON 时 ASCII 引号未转义是高发病，单行结构可救回）
 *   2. 条数与 report/batches/batch-NNN.json 的 tasks 数比对，缺失 id 记为不完整
 *   3. 全部合法条目合并 → report/translations-merged.json（供 apply --in）
 *
 * 输出汇总：合法批 / 修复批 / 不完整批（需重派）清单
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

function repairByLine(s) {
	// 单行条目容错提取（贪心 .* 吃掉未转义的内嵌引号）
	const out = [];
	const re = /"id"\s*:\s*"([0-9A-Fa-f]{8})"\s*,\s*"zh"\s*:\s*"(.*)"\s*[},]/g;
	let m;
	while ((m = re.exec(s)) !== null) out.push({ id: m[1].toUpperCase(), zh: m[2] });
	return out;
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const outDir = path.join(root, 'report', 'out');
	const batchDir = path.join(root, 'report', 'batches');
	const merged = new Map();
	const needRedispatch = [];

	const files = fs.readdirSync(outDir).filter(f => /^(batch|retry)-\d+\.json$/.test(f))
		.sort((a, b) => (a.startsWith('retry') ? 1 : 0) - (b.startsWith('retry') ? 1 : 0) || a.localeCompare(b));   // retry 后处理 → 同 id 覆盖主批
	for (const f of files) {
		const nn = f.match(/\d+/)[0];
		const s = fs.readFileSync(path.join(outDir, f), 'utf8');
		let entries = null, repaired = false;
		try { entries = JSON.parse(s); } catch (e) { entries = repairByLine(s); repaired = true; }
		if (!Array.isArray(entries) || !entries.length) { needRedispatch.push(nn + '(不可解析)'); continue; }

		// 条数/id 完整性比对
		let expected = [];
		try {
			const bt = JSON.parse(fs.readFileSync(path.join(batchDir, `batch-${nn}.json`), 'utf8'));
			expected = (bt.tasks || []).map(t => t.id.toUpperCase());
		} catch (e) { /* 批文件缺失则跳过比对 */ }
		const got = new Set(entries.map(e => String(e.id).toUpperCase()));
		const missing = expected.filter(id => !got.has(id));
		if (expected.length && missing.length === expected.length) { needRedispatch.push(nn + '(全缺)'); continue; }

		for (const e of entries) {
			if (e && e.id && typeof e.zh === 'string' && e.zh.trim()) merged.set(String(e.id).toUpperCase(), e.zh);
		}
		if (repaired || missing.length) {
			console.log(`  batch-${nn}: ${repaired ? '已容错修复' : 'JSON 合法'}${missing.length ? `，缺 ${missing.length} 条 (${missing.slice(0, 3).join(',')}${missing.length > 3 ? '…' : ''})` : ''}`);
		}
	}

	const out = [...merged.entries()].map(([id, zh]) => ({ id, zh }));
	fs.writeFileSync(path.join(root, 'report', 'translations-merged.json'), JSON.stringify(out, null, 1));
	console.log(`✔ 收集 ${files.length} 个产物 → ${out.length} 条唯一译文 → report/translations-merged.json`);
	if (needRedispatch.length) console.log(`⚠ 需重派批次: ${needRedispatch.join(' ')}`);
}

main();

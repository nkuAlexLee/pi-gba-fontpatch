'use strict';
/**
 * validate.js — 阶段3：导入前门禁校验（任何硬错误则整体拒绝导入）
 *
 *   node validate.js --project translation [--scene 名] [--strict] [--quiet]
 *
 * 检查项:
 *   H1 状态合法: human-reviewed→final 非空; machine-translated→mt 非空; conflict/locked 不导入
 *   H2 码表覆盖: 译文中每个字符都能编码
 *   H3 控制码完整: 原文的 [token] 集合与译文一致
 *   H4 字节预算: 译文编码+终止符 ≤ max_bytes（超长警告，由 import 决策 repoint）
 *   H5 残留英文: 原文与译文共有的 ≥4 字母英文词 = worker 抄了原文（硬错误）
 *   W1 术语一致: en 命中 glossary 时译文应包含对应 zh（--strict 时升级为错误）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCharmap, encode, normalizeText, loadSubst, describeUnknown } = require('./lib/charmap');
const csv = require('./lib/csv');

function parseArgv(argv) {
	const args = { _: [] };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a.startsWith('--')) {
			const key = a.slice(2);
			if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) args[key] = argv[++i];
			else args[key] = true;
		} else args._.push(a);
	}
	return args;
}

function extractTokens(text) {
	return (text || '').match(/\[[^\]]*\]|\{[^}]*\}/g) || [];
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const config = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
	for (const k of ['charmap', 'glossary', 'rom']) {
		if (config[k] && !path.isAbsolute(config[k])) config[k] = path.resolve(root, config[k]);
	}
	const charmap = loadCharmap(config.charmap);
	const encOpts = config.escPrefix ? { escPrefix: config.escPrefix } : {};
	const subst = loadSubst(path.join(root, 'subst.json'));
	const glossary = fs.existsSync(config.glossary)
		? csv.readObjects(config.glossary) : [];
	const files = args.scene
		? [path.join(root, 'strings', args.scene + '.csv')]
		: fs.readdirSync(path.join(root, 'strings')).filter(f => f.endsWith('.csv')).map(f => path.join(root, 'strings', f));

	const errors = [], warnings = [];
	let total = 0, importable = 0;
	const stats = { untranslated: 0, 'machine-translated': 0, 'human-reviewed': 0, conflict: 0, locked: 0 };

	for (const f of files) {
		if (!fs.existsSync(f)) continue;
		const scene = path.basename(f, '.csv');
		for (const row of csv.readObjects(f)) {
			total++;
			stats[row.status] = (stats[row.status] || 0) + 1;
			const where = `${scene}/${row.id}`;
			// 选择用于导入的文本
			let text = null;
			if (row.status === 'human-reviewed') {
				if (!row.final || !row.final.trim()) errors.push(`H1 ${where}: human-reviewed 但 final 为空`);
				else text = row.final;
			} else if (row.status === 'machine-translated') {
				if (!row.mt || !row.mt.trim()) errors.push(`H1 ${where}: machine-translated 但 mt 为空`);
				else text = row.mt;
			} else {
				continue;   // untranslated / conflict / locked 不参与导入
			}
			if (text === null) continue;
			importable++;
			// H2 码表覆盖（emoji/符号/生僻字等码表外内容 = 硬错误）
			const normText = normalizeText(text, charmap, subst).text;
			if (normText !== text) row.__norm = normText;
			const { unknown, bytes } = encode(normText, charmap, encOpts);
			if (unknown.length) errors.push(`H2 ${where}: 码表外内容 ${describeUnknown(unknown)}`);
			// H3 控制码（排版码 [/n][/l][/p] 由 wrapText 自动重排，不参与对比）
			const LAYOUT = new Set(['[/n]', '[/l]', '[/p]']);
			const sig = t => extractTokens(t).filter(x => !LAYOUT.has(x)).sort().join('|');
			const enT = sig(row.en);
			const zhT = sig(text);
			if (enT !== zhT) errors.push(`H3 ${where}: 控制码不一致 原[${enT}] 译[${zhT}]`);
			// H5 残留英文（与 apply 门禁 checkTranslatable 同规则）
			// keep_en（project.json）：专有名词白名单（船名/游戏名等官方不译项）
			const keepEn = config.keep_en || [];
			const strip = t => {
				let s = (t || '').replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ');
				for (const k of keepEn) s = s.split(k).join(' ');
				return s;
			};
			const enWords = new Set((strip(row.en).match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase()));
			const zhWords = new Set((strip(text).match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase()));
			const leftover = [...zhWords].filter(w => enWords.has(w));
			if (leftover.length) errors.push(`H5 ${where}: 残留英文未翻译 ${leftover.join(' ')}`);
			// H4 字节预算
			const totalBytes = bytes.length + 1;
			if (totalBytes > Number(row.max_bytes)) {
				warnings.push(`H4 ${where}: ${totalBytes}B > 预算${row.max_bytes}B（超出 ${totalBytes - Number(row.max_bytes)}B，将走 repoint）`);
			}
			// W1 术语（词边界 + 跳过短词条，与 prepare 的命中逻辑一致）
			for (const g of glossary) {
				if (!g.en || !g.zh || g.en.length < 3) continue;
				const re = new RegExp('(^|[^A-Za-z])' + g.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z]|$)', 'i');
				if (re.test(row.en) && !text.includes(g.zh)) {
					const msg = `W1 ${where}: 术语 "${g.en}"应译为"${g.zh}"，译文中未发现`;
					(args.strict ? errors : warnings).push(msg);
				}
			}
		}
	}

	// 报告
	const lines = [
		`# validate ${new Date().toISOString()}`,
		`总数 ${total} | 可导入 ${importable} | 状态分布 ${JSON.stringify(stats)}`,
		`错误 ${errors.length} | 警告 ${warnings.length}`,
		...errors.map(e => '[ERROR] ' + e),
		...warnings.map(w => '[WARN]  ' + w),
	].join('\n');
	if (!args.quiet) console.log(lines);
	fs.mkdirSync(path.join(root, 'report'), { recursive: true });
	fs.writeFileSync(path.join(root, 'report', 'validate-latest.log'), lines);

	if (errors.length) {
		console.error(`\n✘ 门禁未通过（${errors.length} 个硬错误），禁止导入`);
		process.exit(1);
	}
	console.log(`\n✔ 门禁通过（警告 ${warnings.length} 个），可导入`);
}

main();

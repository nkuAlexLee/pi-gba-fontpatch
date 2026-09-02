'use strict';
/**
 * translate-batch.js — 阶段2：AI/人工双轨翻译工具
 *
 * AI 通道（pi agent 工作流，不直接手改 CSV，保证格式安全）:
 *   # 生成翻译任务包（含术语表命中与字数预算），agent 按 prompt 翻译产出 JSON
 *     node translate-batch.js prepare --project translation [--file strings/xx.csv] [--scene 名]
 *   # agent 翻译后写入 report/translations.json: [{"id":"0137E070","zh":"新的游戏"},...]
 *     node translate-batch.js apply --project translation --in report/translations.json
 *
 * 单条快速写入（agent 或人工脚本化修改）:
 *     node translate-batch.js set --project translation --scene title-menu \
 *          --id 0137E070 --col final --text "新的游戏"
 *
 * 规则:
 *   - apply 只填 mt 列（final 已有内容则跳过并记录）
 *   - set 可写 mt 或 final；写 final 后 status=human-reviewed
 *   - 所有写入前校验: 控制码/占位符 token 必须与原文一致、码表全覆盖
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCharmap, encode, normalizeText } = require('./lib/charmap');
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

function loadProject(projectDir) {
	const root = projectDir;
	const config = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
	for (const k of ['charmap', 'glossary', 'rom']) {
		if (config[k] && !path.isAbsolute(config[k])) config[k] = path.resolve(root, config[k]);
	}
	config.stringsDir = path.join(root, 'strings');
	config.reportDir = path.join(root, 'report');
	return { root, config };
}

function listSceneFiles(cfg, file) {
	if (file) return [path.resolve(file)];
	return fs.readdirSync(cfg.stringsDir).filter(f => f.endsWith('.csv')).map(f => path.join(cfg.stringsDir, f));
}

function extractTokens(text) {
	const m = (text || '').match(/\[[^\]]*\]|\{[^}]*\}/g);
	return m ? m : [];
}

function checkTranslatable(en, zh, charmap) {
	const errors = [];
	// 0) 机翻质量门槛（借鉴 gui_related）：原文含英文单词而译文几乎无中文 → 拒绝
	const hasEnglishWords = /[A-Za-z]{2,}/.test(en.replace(/\[[^\]]*\]/g, ''));
	const zhChars = (zh.match(/[\u4e00-\u9fff]/g) || []).length;
	if (hasEnglishWords && zhChars === 0) errors.push('机翻质量: 译文中无中文（疑似返回原文）');
	// 1) 占位符/控制码 token 集合必须一致
	const enTokens = extractTokens(en).sort().join('|');
	const zhTokens = extractTokens(zh).sort().join('|');
	if (enTokens !== zhTokens) errors.push(`token 不一致: 原[${enTokens}] 译[${zhTokens}]`);
	// 2) 码表全覆盖（先标点归一化再检查）
	const { text: norm } = normalizeText(zh, charmap);
	const { unknown } = encode(norm, charmap);
	if (unknown.length) errors.push('码表缺字: ' + [...new Set(unknown)].join(' '));
	return errors;
}

/* ---------------- prepare ---------------- */
function cmdPrepare(args) {
	const { root, config } = loadProject(args.project || 'translation');
	const files = listSceneFiles(config, args.file);
	const charmap = loadCharmap(config.charmap);
	const glossary = fs.existsSync(config.glossary)
		? csv.readObjects(config.glossary) : [];
	const tasks = [];
	// 术语命中用词边界匹配（避免 's→的 / Hi→嗨 / TIME→时间 这类子串误命中）
	const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const glossaryRe = glossary
		.filter(g => g.en && g.en.length >= 3)                 // 太短的词条（<3字符）不参与自动命中
		.map(g => ({ g, re: new RegExp('(^|[^A-Za-z])' + esc(g.en) + '([^A-Za-z]|$)', 'i') }));
	for (const f of files) {
		const scene = path.basename(f, '.csv');
		for (const row of csv.readObjects(f)) {
			if (row.status !== 'untranslated') continue;
			const hits = glossaryRe.filter(({ re }) => re.test(row.en)).map(({ g }) => `${g.en}→${g.zh}`);
			tasks.push({
				id: row.id, scene,
				en: row.en,
				context: row.context || '',
				max_bytes: Number(row.max_bytes),
				hint: `纯中文≤${row.max_chars}字；每汉字2字节；控制码[...]原样保留`,
				glossary: hits,   // 已是 "en→zh" 字符串数组
			});
		}
	}
	fs.mkdirSync(config.reportDir, { recursive: true });
	const tasksPath = path.join(config.reportDir, 'translate-tasks.json');
	fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
	const prompt = [
		'# 翻译任务（Game Boy Advance 宝可梦改版汉化）',
		'',
		'## 规则',
		'1. 译文为简体中文，风格贴合宝可梦官方译名习惯',
		'2. `glossary` 命中的术语必须使用指定译名',
		'3. `[方括号]` 内为游戏引擎控制码/占位符，必须原样保留，位置可按中文语序调整',
		'4. 编码后每汉字 2 字节，译文含控制码字节总长不得超过 `max_bytes`（含 1 字节终止符）',
		'5. 标点规则：不使用全角标点，逗号=半角 , 句号=半角 . 问号=半角 ?（引擎码表无全角标点）',
		'6. 译文必须是中文（不得返回英文原文）；宝可梦官方译名习惯优先',
		'7. 输出 JSON 数组到 report/translations.json: [{"id":"...","zh":"..."}]，不要输出其他内容',
		'',
		'## 任务',
		JSON.stringify(tasks, null, 2),
	].join('\n');
	const promptPath = path.join(config.reportDir, 'translate-prompt.md');
	fs.writeFileSync(promptPath, prompt);
	console.log(`✔ 任务 ${tasks.length} 条 → ${tasksPath}`);
	console.log(`  prompt  → ${promptPath}`);
	console.log(`  下一步: agent 按 prompt 翻译，产出 report/translations.json 后执行 apply`);
}

/* ---------------- apply ---------------- */
function cmdApply(args) {
	const { root, config } = loadProject(args.project || 'translation');
	const charmap = loadCharmap(config.charmap);
	const inPath = path.resolve(args.in || path.join(config.reportDir, 'translations.json'));
	const translations = JSON.parse(fs.readFileSync(inPath, 'utf8'));
	const byId = new Map(translations.map(t => [t.id, t.zh]));
	const scenes = [...new Set(translations.map(t => t.scene).filter(Boolean))];
	const files = scenes.length
		? scenes.map(s => path.join(config.stringsDir, s + '.csv'))
		: listSceneFiles(config, args.file);
	let applied = 0, skipped = 0, failed = 0;
	const failures = [];
	for (const f of files) {
		if (!fs.existsSync(f)) continue;
		const rows = csv.readObjects(f);
		let dirty = false;
		for (const row of rows) {
			const zh = byId.get(row.id);
			if (zh === undefined) continue;
			const errs = checkTranslatable(row.en, zh, charmap);
			if (errs.length) {
				failures.push({ id: row.id, zh, errs });
				failed++;
				continue;
			}
			if (row.final && row.final.trim()) { skipped++; continue; }   // 人工已审，不覆盖
			const norm = normalizeText(zh, charmap);
			row.mt = norm.text;                                          // 标点归一化后写入
			if (norm.changed) byId.set(row.id + '_norm', norm.changed);
			row.status = 'machine-translated';
			dirty = true;
			applied++;
		}
		if (dirty) csv.writeObjects(f, rows, []);
	}
	fs.writeFileSync(path.join(config.reportDir, 'apply-report.json'), JSON.stringify({ applied, skipped, failed, normalized: [...byId.entries()].filter(([k]) => k.endsWith('_norm')), failures }, null, 2));
	console.log(`✔ 写入 ${applied} | 跳过(已人工审) ${skipped} | 失败 ${failed}`);
	if (failures.length) {
		failures.slice(0, 10).forEach(f => console.error(`  ✘ ${f.id}: ${f.errs.join('; ')}`));
		console.error('  详见 report/apply-report.json');
	}
}

/* ---------------- set ---------------- */
function cmdSet(args) {
	const { root, config } = loadProject(args.project || 'translation');
	const charmap = loadCharmap(config.charmap);
	const f = path.join(config.stringsDir, args.scene + '.csv');
	if (!fs.existsSync(f)) { console.error('场景文件不存在: ' + f); process.exit(1); }
	if (!['mt', 'final'].includes(args.col)) { console.error('--col 只能是 mt 或 final'); process.exit(1); }
	const rows = csv.readObjects(f);
	const row = rows.find(r => r.id.toLowerCase() === String(args.id).toLowerCase());
	if (!row) { console.error('id 不存在: ' + args.id); process.exit(1); }
	const errs = checkTranslatable(row.en, args.text, charmap);
	if (errs.length && !args.force) {
		console.error('✘ 校验失败（--force 可强制覆盖）:\n  ' + errs.join('\n  '));
		process.exit(1);
	}
	const norm = normalizeText(args.text, charmap);
	row[args.col] = norm.text;
	if (norm.changed) console.log(`  (标点归一化 ${norm.changed} 处)`);
	if (args.col === 'final' && row.final.trim()) row.status = 'human-reviewed';
	else if (args.col === 'mt' && row.status === 'untranslated') row.status = 'machine-translated';
	if (args.note) row.notes = args.note;
	csv.writeObjects(f, rows, []);
	const { bytes } = encode(args.text, charmap);
	console.log(`✔ ${row.id} ${args.col}="${args.text}" (${bytes + 1}B/${row.max_bytes}B) → ${row.status}`);
}

const args = parseArgv(process.argv.slice(2));
const cmd = (args._[0] || '').toLowerCase();
if (cmd === 'prepare') cmdPrepare(args);
else if (cmd === 'apply') cmdApply(args);
else if (cmd === 'set') cmdSet(args);
else {
	console.log(`用法:
  node translate-batch.js prepare --project <目录> [--file strings/xx.csv]   生成 AI 翻译任务包
  node translate-batch.js apply   --project <目录> [--in report/translations.json]
                                                                            应用 AI 译文到 mt 列
  node translate-batch.js set     --project <目录> --scene <名> --id <ID> --col mt|final --text "译文"
                                                                            单条写入（含校验）`);
}

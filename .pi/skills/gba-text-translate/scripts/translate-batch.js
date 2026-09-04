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
const { loadCharmap, encode, normalizeText, loadSubst, describeUnknown } = require('./lib/charmap');
const { loadOverrides } = require('./lib/textproc');
const { protect, restore, alignSpaces } = require('./lib/textproc');
const { wrapText } = require('./lib/wrap');
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
	config.encOpts = config.escPrefix ? { escPrefix: config.escPrefix } : {};
	config.subst = loadSubst(path.join(root, 'subst.json'));
	config.overridesPath = fs.existsSync(path.join(root, 'overrides.json')) ? path.join(root, 'overrides.json') : null;
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

function checkTranslatable(en, zh, charmap, encOpts, subst, keepEn) {
	const errors = [];
	// 0) 机翻质量门槛（借鉴 gui_related）：原文含英文单词而译文几乎无中文 → 拒绝
	const hasEnglishWords = /[A-Za-z]{2,}/.test(en.replace(/\[[^\]]*\]/g, ''));
	const zhChars = (zh.match(/[\u4e00-\u9fff]/g) || []).length;
	if (hasEnglishWords && zhChars === 0) errors.push('机翻质量: 译文中无中文（疑似返回原文）');
	// 0b) ★残留英文硬拒绝：原文与译文共有的 ≥4 字母英文词（token 外）= worker 抄了原文
	//     keep_en（project.json）：专有名词白名单（船名/游戏名等官方不译项），先剔除再比对
	const strip = t => {
		let s = (t || '').replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ');
		for (const k of keepEn || []) s = s.split(k).join(' ');
		return s;
	};
	const enWords = new Set((strip(en).match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase()));
	const zhWords = new Set((strip(zh).match(/[A-Za-z]{4,}/g) || []).map(w => w.toLowerCase()));
	const leftover = [...zhWords].filter(w => enWords.has(w));
	if (leftover.length) errors.push('残留英文未翻译: ' + leftover.join(' '));
	// 1) 占位符/控制码 token 集合必须一致
	//    排版码 [/n][/l][/p] 不参与对比：由 wrapText 自动重排（apply 落盘前会重新折行）
	const LAYOUT = new Set(['[/n]', '[/l]', '[/p]']);
	const sigTokens = t => extractTokens(t).filter(x => !LAYOUT.has(x)).sort().join('|');
	const enTokens = sigTokens(en);
	const zhTokens = sigTokens(zh);
	if (enTokens !== zhTokens) errors.push(`token 不一致: 原[${enTokens}] 译[${zhTokens}]`);
	// 2) 码表全覆盖（先标点归一化再检查）
	const { text: norm } = normalizeText(zh, charmap, subst);
	const { unknown } = encode(norm, charmap, encOpts);
	if (unknown.length) errors.push('码表外内容(拒绝导入): ' + describeUnknown(unknown));
	return errors;
}

/* ---------------- prepare ---------------- */
function cmdPrepare(args) {
	const { root, config } = loadProject(args.project || 'translation');
	const files = listSceneFiles(config, args.file);
	const charmap = loadCharmap(config.charmap);
	const encOpts = config.encOpts;
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
			const pr = protect(row.en);
			tasks.push({
				id: row.id, scene,
				en: pr.text,                 // 控制码已替换为 {{Cn}} 占位符
				codes: pr.codes,             // [[占位符, 原始token], ...]
				context: row.context || '',
				max_bytes: Number(row.max_bytes),
				hint: `纯中文≤${row.max_chars}字（每汉字${config.escPrefix ? 3 : 2}字节）；控制码已变成{{Cn}}占位符，原样保留即可；不要自行添加换行`,
				glossary: hits,
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
		'3. `{{C数字}}` 占位符是原文控制码，必须原样保留（数量与顺序一致），位置可按中文语序调整',
		'4. 不要自行添加换行/翻页——排版系统会自动处理；占位符代表原文的换行/翻页位置，保留即可',
		'5. 标点规则：不使用全角标点，逗号=半角 , 句号=半角 . 问号=半角 ?（引擎码表无全角标点）；引号必须用成对的中文弯引号 “ ”（引擎字库区分前后引号），单引号用 ‘ ’',
		'6. 译文必须是中文（不得返回英文原文）；宝可梦官方译名习惯优先；任何码表外字符（全角标点、省略号…、破折号——等）都会被门禁拒绝',
		'7. 禁止输出任何 emoji/表情/装饰符号/注音/生僻字等码表外字符（会被门禁拒绝，整条译文作废）',
		'8. 输出 JSON 数组到 report/translations.json: [{"id":"...","zh":"..."}]，不要输出其他内容',
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
	const overridesMap = loadOverrides(config);
	const charmap = loadCharmap(config.charmap);
	const encOpts = config.encOpts;
	const inPath = path.resolve(args.in || path.join(config.reportDir, 'translations.json'));
	const translations = JSON.parse(fs.readFileSync(inPath, 'utf8'));
	const byId = new Map(translations.map(t => [t.id, typeof t === 'string' ? { zh: t } : t]));
	// ★codes 回查表：worker 产出只需 {id,zh}，占位符映射从任务包按 id 补齐（条目自带 codes 时优先）
	const codesMap = new Map();
	for (const bf of ['translate-tasks.json', ...fs.readdirSync(config.reportDir).filter(f => /^batch-\d+\.json$/.test(f)).map(f => path.join('batches', f))]) {
		try {
			const data = JSON.parse(fs.readFileSync(path.join(config.reportDir, bf), 'utf8'));
			for (const t of (data.tasks || data)) if (t && t.id && t.codes) codesMap.set(t.id, t.codes);
		} catch (e) { /* 文件缺失/损坏跳过 */ }
	}
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
			const entry = byId.get(row.id);
			if (entry === undefined) continue;
			const zh = typeof entry === 'string' ? entry : entry.zh;
			// ★占位符还原：worker 输出的 {{Cn}} 按任务包 codes 映射还原为真实控制码
			const restored = restore(zh, entry.codes || codesMap.get(row.id));
			// ★前导/尾随空格对齐原文（内部偏移指针兼容）
			const _zhFixed = alignSpaces(row.en, restored);
			// overrides.json 是人工兑底，但同样要过门禁（缺字/残留英文/token），不合格拒绝并记录
			const isOverride = !!(config.overridesPath && overridesMap && overridesMap.has(row.id.toLowerCase()));
			const errs = checkTranslatable(row.en, _zhFixed, charmap, encOpts, config.subst, config.keep_en);
			if (errs.length) {
				failures.push({ id: row.id, zh: _zhFixed, errs, source: isOverride ? 'override' : 'worker' });
				failed++;
				continue;
			}
			if (row.final && row.final.trim()) { skipped++; continue; }   // 人工已审，不覆盖
			if (isOverride) {
				row.mt = overridesMap.get(row.id.toLowerCase());
				row.status = 'human-reviewed';
				dirty = true; applied++; continue;
			}
			let norm = normalizeText(_zhFixed, charmap, config.subst).text;
			// ★自动排版：按文本框宽度重排换行/翻页（保留语义换行，流式部分自动折行）
			norm = wrapText(norm, { lineWidth: Number(config.line_width) || undefined });
			row.mt = norm.text ?? norm;                                          // 标点归一化后写入
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
	const encOpts = config.encOpts;
	const f = path.join(config.stringsDir, args.scene + '.csv');
	if (!fs.existsSync(f)) { console.error('场景文件不存在: ' + f); process.exit(1); }
	if (!['mt', 'final'].includes(args.col)) { console.error('--col 只能是 mt 或 final'); process.exit(1); }
	const rows = csv.readObjects(f);
	const row = rows.find(r => r.id.toLowerCase() === String(args.id).toLowerCase());
	if (!row) { console.error('id 不存在: ' + args.id); process.exit(1); }
	const errs = checkTranslatable(row.en, args.text, charmap, encOpts, config.subst, config.keep_en);
	if (errs.length && !args.force) {
		console.error('✘ 校验失败（--force 可强制覆盖）:\n  ' + errs.join('\n  '));
		process.exit(1);
	}
	const enLead2 = (row.en || '').match(/^ +/);
	const enTrail2 = (row.en || '').match(/ +$/);
	const normRes = normalizeText(args.text, charmap, config.subst);
	const bodyN = normRes.text.replace(/^ +/, '').replace(/ +$/, '');
	row[args.col] = ' '.repeat(enLead2 ? enLead2[0].length : 0) + bodyN + ' '.repeat(enTrail2 ? enTrail2[0].length : 0);
	if (normRes.changed) console.log(`  (标点归一化 ${normRes.changed} 处)`);
	if (args.col === 'final' && row.final.trim()) row.status = 'human-reviewed';
	else if (args.col === 'mt' && row.status === 'untranslated') row.status = 'machine-translated';
	if (args.note) row.notes = args.note;
	csv.writeObjects(f, rows, []);
	const { bytes } = encode(args.text, charmap, { escPrefix: config && config.escPrefix });
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

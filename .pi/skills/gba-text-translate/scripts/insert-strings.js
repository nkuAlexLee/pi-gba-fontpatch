'use strict';
/**
 * insert-strings.js — 阶段3：回填 ROM（原地覆盖 / 扩容重指向）
 *
 *   node insert-strings.js --project translation [--dry-run] [--allow-mt] [--only <ID>] [--scene 名]
 *
 * 策略决策树（每条独立决策）:
 *   1. 译文编码+FF ≤ 原串字节数 → 【原地覆盖】尾部 FF 填充，指针零风险
 *   2. 超长 → 指针扫描（全 ROM 搜 4字节小端 == 0x08000000+fileOffset）
 *      ├─ 有引用 → 【repoint】串写入 append_addr（自动 4 字节对齐+递增），全部指针改指新址
 *      │           原址数据清 FF 防误读
 *      └─ 无引用 → 跳过并记录（需人工分析：偏移表/运行时生成指针/压缩）
 *
 * 输出: project.json 的 out_rom + report/import-latest.json（含每条策略与指针清单，可回滚）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { loadCharmap, encode, decode, TERMINATOR } = require('./lib/charmap');
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

/** 全 ROM 扫描指向 gbaAddr 的 4 字节小端指针（逐字节步进，覆盖脚本区非对齐情形） */
function scanPointers(rom, gbaAddrNum) {
	const hits = [];
	const b0 = gbaAddrNum & 0xFF, b1 = (gbaAddrNum >> 8) & 0xFF, b2 = (gbaAddrNum >> 16) & 0xFF, b3 = (gbaAddrNum >> 24) & 0xFF;
	for (let p = 0; p <= rom.length - 4; p++) {
		if (rom[p] === b0 && rom[p + 1] === b1 && rom[p + 2] === b2 && rom[p + 3] === b3) hits.push(p);
	}
	return hits;
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const config = JSON.parse(fs.readFileSync(path.join(root, 'project.json'), 'utf8'));
	for (const k of ['charmap', 'glossary', 'rom', 'out_rom']) {
		if (config[k] && !path.isAbsolute(config[k])) config[k] = path.resolve(root, config[k]);
	}
	const charmap = loadCharmap(config.charmap);
	const rom = fs.readFileSync(config.rom);
	const romSize = rom.length;
	const outPath = path.resolve(args.out || config.out_rom);   // loadProject 已将 out_rom 绝对化
	const appendAddr = parseInt(config.append_addr, 16);
	let appendCursor = appendAddr - 0x08000000;

	if (appendCursor < 0 || appendCursor >= romSize) {
		console.error(`✘ append_addr ${config.append_addr} 超出 ROM 范围，请在 project.json 修正`);
		process.exit(1);
	}

	const allowMt = !!args['allow-mt'];
	const onlyId = args.only ? String(args.only).toLowerCase() : null;
	const sceneFilter = args.scene;

	const files = sceneFilter
		? [path.join(root, 'strings', sceneFilter + '.csv')]
		: fs.readdirSync(path.join(root, 'strings')).filter(f => f.endsWith('.csv')).map(f => path.join(root, 'strings', f));

	const report = { date: new Date().toISOString(), dry_run: !!args['dry-run'], rom_in: config.rom, rom_out: outPath, rows: [] };
	let done = 0, repointed = 0, skipped = 0, failed = 0;
	let dirty = false;

	for (const f of files) {
		if (!fs.existsSync(f)) continue;
		const scene = path.basename(f, '.csv');
		for (const row of csv.readObjects(f)) {
			if (onlyId && row.id.toLowerCase() !== onlyId) continue;
			const rec = { id: row.id, scene, addr_gba: row.addr_gba, status: row.status, strategy: null };
			// 选文本
			let text = null;
			if (row.status === 'human-reviewed') text = row.final;
			else if (row.status === 'machine-translated' && allowMt) text = row.mt;
			else { skipped++; report.rows.push({ ...rec, strategy: 'skip:状态不满足' }); continue; }
			if (!text || !text.trim()) { skipped++; report.rows.push({ ...rec, strategy: 'skip:译文为空' }); continue; }

			const { bytes, unknown } = encode(text, charmap);
			if (unknown.length) {
				failed++;
				report.rows.push({ ...rec, strategy: 'fail:缺字 ' + [...new Set(unknown)].join(' ') });
				continue;
			}
			const newLen = bytes.length + 1;                    // 含终止符
			const maxBytes = Number(row.max_bytes);
			const fileOff = parseInt(row.id, 16);
			const origLen = maxBytes;                            // 原串字节数（含 FF）

			if (newLen <= origLen) {
				// ① 原地覆盖
				rec.strategy = 'inplace';
				rec.bytes = `${newLen}/${origLen}`;
				if (!args['dry-run']) {
					bytes.forEach((b, k) => { rom[fileOff + k] = b; });
					rom[fileOff + bytes.length] = TERMINATOR;
					for (let k = bytes.length + 1; k < origLen; k++) rom[fileOff + k] = TERMINATOR;   // 残尾清 FF
				}
				done++; dirty = true;
			} else {
				// ② 扩容重指向：优先用导出时收集的指针（notes 里 [ptr:...]），否则全 ROM 扫描
				let pointers = [];
				const m = (row.notes || '').match(/\[ptr:([^\]]*)\]/);
				if (m && m[1]) {
					pointers = m[1].split(';').map(s => parseInt(s, 16)).filter(p => !isNaN(p) && p < romSize);
				} else {
					pointers = scanPointers(rom, gba);
				}
				if (!pointers.length) {
					failed++;
					rec.strategy = 'fail:超长且无ROM内指针引用（偏移表/运行时指针/压缩，需人工分析）';
					rec.bytes = `${newLen}/${origLen}`;
					report.rows.push(rec);
					continue;
				}
				rec.strategy = 'repoint';
				rec.bytes = `${newLen}/${origLen}`;
				rec.pointers = pointers.map(p => '0x' + p.toString(16));
				if (!args['dry-run']) {
					const paddedLen = (newLen + 3) & ~3;                     // 4 字节对齐后总长
					if (appendCursor + paddedLen > romSize) {
						rec.strategy = 'fail:append 区空间不足';
						failed++;
						report.rows.push(rec);
						continue;
					}
					const startOff = appendCursor;                            // 新串起始（文件偏移）
					bytes.forEach((b, k) => { rom[startOff + k] = b; });
					rom[startOff + bytes.length] = TERMINATOR;
					for (let k = newLen; k < paddedLen; k++) rom[startOff + k] = TERMINATOR;   // 对齐填充
					const startGba = 0x08000000 + startOff;
					for (const p of pointers) rom.writeUInt32LE(startGba, p); // 全部指针改指新址
					for (let k = 0; k < origLen; k++) rom[fileOff + k] = TERMINATOR;           // 原址清 FF
					rec.new_addr = '0x' + startGba.toString(16).toUpperCase();
					appendCursor = startOff + paddedLen;
				}
				repointed++; done++; dirty = true;
			}
			report.rows.push(rec);
		}
	}

	if (dirty && !args['dry-run']) {
		fs.mkdirSync(path.dirname(outPath), { recursive: true });
		fs.writeFileSync(outPath, rom);
	}
	report.summary = { done, repointed, skipped, failed, append_used: '0x' + (appendCursor - (appendAddr - 0x08000000)).toString(16) };
	fs.mkdirSync(path.join(root, 'report'), { recursive: true });
	fs.writeFileSync(path.join(root, 'report', 'import-latest.json'), JSON.stringify(report, null, 2));
	console.log(`${args['dry-run'] ? '[DRY-RUN] ' : ''}完成 ${done}（repoint ${repointed}）| 跳过 ${skipped} | 失败 ${failed}`);
	report.rows.forEach(r => console.log(`  ${r.id} [${r.scene}] ${r.strategy}${r.bytes ? ' ' + r.bytes : ''}${r.new_addr ? ' → ' + r.new_addr : ''}${r.pointers ? ' 指针' + r.pointers.length + '处' : ''}`));
	if (failed) { console.error('✘ 存在失败条目，详见 report/import-latest.json'); }
	else if (!args['dry-run']) console.log('✔ 输出 ROM →', outPath);
}

main();

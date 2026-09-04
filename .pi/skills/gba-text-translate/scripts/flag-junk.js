'use strict';
/**
 * flag-junk.js — 乱码/非自然语言字符串识别：启发式打标 status=locked，notes=[junk]
 *
 *   node flag-junk.js --project <目录> [--scene main-text] [--undo]
 *
 * 判定启发式（针对英文基板导出）：
 *   J1 无元音单词：整串无 [aeiouy] 的 ≥3 字母词（如 "JmJ"、"Wrgl"）
 *   J2 辅音堆：长度≤12 且无空格且辅音/元音比 > 4
 *   J3 控制码混杂：含 ≥2 个 [fdxx] 类未知码 且 可读正文 ≤ 3 字符
 *   J4 单字符重复：同一非空字符连续 ≥4 次（"!!!!" 类由白名单豁免！?...）
 * 已翻译（mt/final 非空）或已 human-reviewed 的行不覆盖；--undo 恢复 untranslated
 */
'use strict';
const fs = require('fs');
const path = require('path');
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

function isJunk(en) {
	const s = (en || '').trim();
	if (!s) return null;
	const words = s.replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ').split(/[^A-Za-z']+/).filter(w => w.length >= 3);
	// 无元音但合法的词白名单（hmm/TVs 等）
	const WL = new Set(['hmm', 'hmmm', 'hm', 'shh', 'shhh', 'tsk', 'brr', 'mmm', 'tv', 'tvs', 'tv', 'dvd', 'dvds', 'cd', 'cds', 'mr', 'mrs', 'ms', 'dr', 'vs', 'pkmn', 'gps', 'rgb', 'pts', 'dmg', 'exp', 'atk', 'def', 'spa', 'spd', 'spe', 'acc', 'evs', 'ivs', 'npc', 'pp', 'oh', 'umm', 'ermm', 'aww', 'ooh', 'ahh', 'shhh']);
	// J1: 串中所有 ≥3 字母词都无元音（且不在白名单）→ 乱码（如 "JmJ"）
	if (words.length > 0 && words.every(w => !/[aeiouyAEIOUY]/.test(w) && !WL.has(w.toLowerCase()))) return 'J1全无元音词';
	const letters = s.replace(/[^A-Za-z]/g, '');
	const spaces = (s.match(/ /g) || []).length;
	// J2: 短串完全无元音（排已有空格分词的自然词）
	if (s.length <= 12 && spaces === 0 && letters.length >= 4) {
		const vowels = (letters.match(/[aeiouyAEIOUY]/g) || []).length;
		if (vowels === 0) return 'J2辅音堆';
	}
	// J3: 未知 fd 码堆砌
	const fd = (s.match(/\[fd[0-9a-f]{2}\]/gi) || []).length;
	const readable = s.replace(/\[[^\]]*\]/g, '').trim();
	if (fd >= 2 && readable.length <= 3) return 'J3fd码堆';
	// J4: 同字符重复 ≥4（! ? . 除外）
	const sNoSp = s.replace(/ /g, '');
	if (/([^!?.,:;'"()\u00a1-\u00ff\w\._-])\1{3,}/.test(sNoSp)) return 'J4符号重复';
	return null;
}

function main() {
	const args = parseArgv(process.argv.slice(2));
	const root = args.project || 'translation';
	const files = args.scene
		? [path.join(root, 'strings', args.scene + '.csv')]
		: fs.readdirSync(path.join(root, 'strings')).filter(f => f.endsWith('.csv')).map(f => path.join(root, 'strings', f));
	let flagged = 0, undone = 0;
	for (const f of files) {
		if (!fs.existsSync(f)) continue;
		const rows = csv.readObjects(f);
		let dirty = false;
		for (const r of rows) {
			if (args.undo) {
				if (r.status === 'locked' && (r.notes || '').includes('[junk]')) {
					r.status = 'untranslated';
					r.notes = (r.notes || '').replace(/\s*\[junk\][^,;]*/, '');
					dirty = true; undone++;
				}
				continue;
			}
			if (r.status !== 'untranslated') continue;
			if (r.mt || r.final) continue;
			const why = isJunk(r.en);
			if (why) {
				r.status = 'locked';
				r.notes = (r.notes || '') + ` [junk]${why}`;
				dirty = true; flagged++;
			}
		}
		if (dirty) csv.writeObjects(f, rows, []);
	}
	console.log(`${args.undo ? '撤销' : '标记'} junk: ${args.undo ? undone : flagged} 条`);
}

main();

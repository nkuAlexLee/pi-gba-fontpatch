// 二次修复：内容 token 手工修正 + [/n][/p][/l][...] 程序化均衡 + 全量校验
'use strict';
const fs = require('fs');
const P = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report/batches/batch-110-out.json';
const INP = 'D:/vibecoding/gba-font-cracker-js/gbajs2/translation-er/report/batches/batch-110.json';
const out = JSON.parse(fs.readFileSync(P, 'utf8'));
const inp = JSON.parse(fs.readFileSync(INP, 'utf8'));

// 内容 token 手工修正
const manual = {
	'00394EE6': '亚当:嗯[...][/n][玩家][fd08][...]是吧?[/p]我们的对战,让我想起了[/n]初见米可利[/l]的时候。[/p]也许你是可能超越[/n]米可利的天才!',
	'003958B0': '小遥:嗨,[玩家][fd08]![/p]你记得卡那兹市那个[/n]叫居合斩哥的人吗?[/l]他在那里有栋房子。[/p]原来他弟弟住在紫堇市。[/p]猜猜他叫什么?[/p][...] [...] [...] [...] [...] [...][/n][...] [...] [...] [...] [...][/p]碎岩哥!',
	'003961FD': '小悠:哟,[玩家]![/p]你记得卡那兹市那个[/n]叫居合斩哥的家伙吗?[/l]他在那里有栋房子,对吧?[/p]原来他弟弟住在紫堇市。[/p]猜猜他叫什么?[/p][...] [...] [...] [...] [...][/n][...] [...] [...] [...] [...][/p]碎岩哥!',
	'0039834E': '[...]咦?[...]什么?[/p]海底[...]喂?[...]窟?[/p][...]信号断了[...][/n]听不清[...][/p]滋滋[...]',
	'0039A387': '冒昧问一句,[...][/n]你是[玩家]吗?[/p]我是[buffer1],很荣幸[/n]与你结识。[/p]我仰慕你已久[...][/p][...] [...] [...] [...][/p]那个[...]希望这要求[/n]不算太为难你,[...][/p]我能拜你为师吗,[/n][玩家]?'
};
for (const r of out) if (manual[r.id]) r.zh = manual[r.id];

const tokRe = /\[[^\]]*\]|\{[^}]*\}/g;
const cnt = (a) => { const m = {}; for (const x of a) m[x] = (m[x] || 0) + 1; return m; };

// 自动均衡 [/n] [/p] [/l] [...]
function balance(zh, enToks) {
	const need = cnt(enToks);
	for (let round = 0; round < 12; round++) {
		const have = cnt(zh.match(tokRe) || []);
		let acted = false;
		for (const T of ['[/n]', '[/p]', '[/l]', '[...]']) {
			const d = (need[T] || 0) - (have[T] || 0);
			if (d === 0) continue;
			acted = true;
			if (d > 0) {
				// 插入 d 个
				for (let j = 0; j < d; j++) {
					if (T === '[...]') {
						// 找最长的连续 [...] 串，追加到串尾
						const runs = [...zh.matchAll(/(?:\[\.\.\.\] ?){2,}/g)];
						if (runs.length) {
							const best = runs.sort((a, b) => b[0].length - a[0].length)[0];
							const at = best.index + best[0].length;
							zh = zh.slice(0, at) + '[...] ' + zh.slice(at).replace(/^ /, '');
						} else {
							zh = zh + ' [...]';
						}
					} else {
						// 找不在 token 旁的句末标点，按比例选位，插在标点后
						const cands = [];
						for (let i = 0; i < zh.length; i++) {
							if (!'[!?.,]'.includes(zh[i])) continue;
							const inTok = zh.lastIndexOf('[', i) > zh.lastIndexOf(']', i);
							if (inTok) continue;
							const after = zh.slice(i + 1).match(/^\[[^\]]*\]/);
							if (after) continue;               // 标点后紧跟 token → 跳过
							if (zh[i + 1] === ' ' && zh[i + 2] === '[') continue;
							cands.push(i);
						}
						if (!cands.length) { zh += T; break; }
						const idx = Math.min(cands.length - 1, Math.max(0, Math.floor(((j + 1) * cands.length) / (d + 1)) - 1));
						const at = cands[idx] + 1;
						zh = zh.slice(0, at) + T + zh.slice(at);
					}
				}
			} else {
				// 多余 → 从最后往前删
				for (let j = 0; j < -d; j++) {
					const i = zh.lastIndexOf(T);
					if (i < 0) break;
					zh = zh.slice(0, i) + zh.slice(i + T.length);
				}
			}
		}
		if (!acted) break;
	}
	return zh;
}

for (let i = 0; i < out.length; i++) {
	out[i].zh = balance(out[i].zh, inp.items[i].en.match(tokRe) || []);
}
fs.writeFileSync(P, JSON.stringify(out, null, 1), 'utf8');

// ===== 全量复检 =====
const han = (s) => (s.match(/[\u4e00-\u9fff]/g) || []).length;
let tokBad = 0, hanBad = [], fwBad = [], engBad = [], ok = 0;
inp.items.forEach((it, i) => {
	const a = cnt(it.en.match(tokRe) || []), b = cnt(out[i].zh.match(tokRe) || []);
	let bad = false;
	for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if ((a[k] || 0) !== (b[k] || 0)) bad = true;
	if (bad) { tokBad++; console.log('TOK', it.id); }
	else ok++;
	if (han(out[i].zh) > it.budget) hanBad.push(it.id + ' han=' + han(out[i].zh) + ' b=' + it.budget);
	if (/[，。？！：；（）【】～、]/.test(out[i].zh)) fwBad.push(it.id);
	const plain = out[i].zh.replace(tokRe, '');
	if (/[A-Za-z]{2,}/.test(plain)) engBad.push(it.id + ':' + plain.match(/[A-Za-z]{2,}/g).join(','));
});
console.log('token一致:', ok, '/ 400 | 不一致:', tokBad);
console.log('超预算:', hanBad.join(' ') || '无');
console.log('全角:', fwBad.length, '残留英文:', engBad.length, engBad.slice(0, 5));

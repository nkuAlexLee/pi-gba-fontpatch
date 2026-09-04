// batch-119-out 最终修复与校验
'use strict';
const fs = require('fs');
const p = __dirname + '/../translation-er/report/batches/batch-119-out.json';
const inp = require(__dirname + '/../translation-er/report/batches/batch-119.json');
const out = JSON.parse(fs.readFileSync(p, 'utf8'));

const a = out.find(o => o.id === '00B2D088');
// token 序列需为 [/n],["],[/n],[/n] —— ["] 单独成 token（紧邻 ]）
a.zh = '多亏了被称为["]同步的习性，整群宝可梦[/n]能配合得天衣无缝，同时[/n]发起攻击，[/n]完美一致。';
const b = out.find(o => o.id === '00EA3930');
b.zh = '在对手身上种下[/n]种子偷取体力。';

// 兜底：全部译文半角化（防手误）
const FW = { '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';', '、': ',' };
for (const o of out) o.zh = o.zh.replace(/[，。！？：；、]/g, c => FW[c]);

fs.writeFileSync(p, JSON.stringify(out, null, 1));

// 终验
const tok = s => (s.match(/\[[^\]]*\]|\{[^}]*\}/g) || []).sort().join('|');
const han = s => (s.match(/[\u4e00-\u9fff]/g) || []).length;
let bad = 0;
for (let i = 0; i < inp.items.length; i++) {
	const x = inp.items[i], y = out[i];
	if (tok(x.en) !== tok(y.zh)) { bad++; console.log('TOK', x.id, tok(x.en), '→', tok(y.zh)); }
	if (han(y.zh) > x.budget) { bad++; console.log('BUDGET', x.id, han(y.zh), '>', x.budget); }
	if (/[\u4e00-\u9fff]/.test(y.zh) && /[，。？！：；、“”‘’…～]/.test(y.zh)) { bad++; console.log('FW', x.id); }
}
console.log(bad === 0 ? '终验全部通过' : '存在问题 ' + bad, '| 条目', out.length + '/' + inp.items.length);
